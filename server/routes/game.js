/**
 * 遊戲模式的伺服器端：解鎖關卡與分數累積。
 *
 * 遊戲本身（單字、戰鬥、音效）全部在瀏覽器跑，而且刻意不需要登入也不碰
 * 資料庫——那樣資料庫掛掉時遊戲仍然打得開。這支路由只管兩件跟帳號有關的事：
 *
 *   1. 這個帳號有沒有資格玩這一組（練習模式做完兩次了嗎）
 *   2. 打完一場之後，分數記在這個帳號底下
 */

const express = require('express');
const { getDB } = require('../db');
const GroupProgress = require('../models/GroupProgress');
const User = require('../models/User');
const WordProgress = require('../models/WordProgress');
const { requireAuth } = require('../middleware/auth');
const wordBank = require('../data/word-bank');

const router = express.Router();
router.use(requireAuth);

/*
 * 等級與經驗的公式跟前端用同一個檔案（public/js/shared/levels.js）。
 *
 * 理由跟 practice.js 的答案判定一樣：畫面上經驗條要即時漲，不能等伺服器；
 * 但真正算數的是這裡。兩邊各寫一次遲早會不一致，而症狀最難解釋——
 * 打完看到「升到 7 級」，重新整理又變回 6 級。
 *
 * ES module 在 CommonJS 只能用動態 import，載入結果快取起來。
 */
let levelsPromise = null;
function levels() {
  if (!levelsPromise) levelsPromise = import('../../public/js/shared/levels.js');
  return levelsPromise;
}

let equipmentPromise = null;
function equipment() {
  if (!equipmentPromise) equipmentPromise = import('../../public/js/shared/equipment.js');
  return equipmentPromise;
}

/**
 * 這個帳號現在裝了什麼，以及它換算出來的效果。
 *
 * 只回「他真的擁有」的裝備：資料庫裡如果留著一件已經不存在的 key
 * （改過裝備表、或資料壞掉），就退回初始裝備，而不是讓戰鬥拿到 undefined。
 */
async function equippedFor(user) {
  const { DEFAULT_EQUIPPED, SLOTS, gearByKey, effectsFor } = await equipment();
  const owned = new Set(user.ownedGear || []);
  const saved = user.equipped || {};
  const out = { ...DEFAULT_EQUIPPED };
  for (const slot of SLOTS) {
    const g = gearByKey(saved[slot]);
    if (!g || g.slot !== slot) continue;
    if (g.tier !== 1 && !owned.has(g.key)) continue;
    out[slot] = g.key;
  }
  return { equipped: out, effects: effectsFor(out) };
}

/**
 * 這個帳號在這一組裡「以前錯過」的字。
 *
 * 打對這些字給五倍經驗（§6），所以名單要在開打前就送下去，戰鬥中才飄得出
 * 那個 +20。判定用 wordProgress 的 timesIncorrect——錯過就算，
 * 不管是在練習還是遊戲裡錯的。
 *
 * boxLevel 已經很高（複習系統認為學會了）的字就不算了：那些不再是「不會的字」，
 * 繼續給五倍等於獎勵刷已經會的東西，正是 §0 要避免的。
 */
const RELEARN_MASTERED_BOX = 4;

async function relearnIdsFor(userId, groupId) {
  const wordIds = wordBank.wordsByGroup(groupId).map((w) => w.id);
  if (!wordIds.length) return [];
  const rows = await WordProgress.getForUser(userId, wordIds);
  return rows
    .filter((r) => (r.timesIncorrect || 0) > 0 && (r.boxLevel || 0) < RELEARN_MASTERED_BOX)
    .map((r) => r.wordId);
}

/** 這一組現在開不開得起來。遊戲頁載入時問這一支。 */
router.get('/access', async (req, res, next) => {
  try {
    const groupId = String(req.query.group || '');
    if (!groupId) return res.status(400).json({ error: '缺少 group' });
    /*
     * 只能玩自己課本裡的組。
     *
     * 兩個孩子各有各的課本，拿別人的組 id 進來要擋掉——不然 Allen 會
     * 練到 Pierce 的單字，而且進度還會記在他自己名下。
     */
    const group = wordBank.listGroups(req.user.wordBankId).find((g) => g.id === groupId);
    if (!group) return res.status(404).json({ error: '這一組不在你的單字庫裡' });

    const [progress, relearn, { levelFromXp, levelRewards }] = await Promise.all([
      GroupProgress.getForGroup(req.user._id, groupId),
      relearnIdsFor(req.user._id, groupId),
      levels()
    ]);
    const totalXp = req.user.xp || 0;
    const lv = levelFromXp(totalXp);
    res.json({
      group: { id: group.id, label: group.label, count: group.count },
      unlocked: progress.unlocked,
      practiceCompletions: progress.practiceCompletions,
      completionsNeeded: progress.completionsNeeded,
      unlockAfter: GroupProgress.UNLOCK_AFTER_COMPLETIONS,
      bestScore: progress.bestScore,
      /* C2：開打前要知道自己幾級、經驗條在哪、哪些字是重學的 */
      level: lv.level,
      xp: totalXp,
      xpInto: lv.into,
      xpNeed: lv.need,
      rewards: levelRewards(lv.level),
      relearnIds: relearn,
      wordBankId: wordBank.resolveBankId(req.user.wordBankId),
      /* C5：開打前要知道裝了什麼——戰鬥的擊退、血量、打錯代價都看它 */
      ...(await equippedFor(req.user)),
      honey: req.user.honey || 0
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 打完一場。
 *
 * 跟練習的作答一樣要能重複執行——網路不穩時前端會重送，
 * 重送不可以讓同一場的分數被加兩次。
 */
router.post('/result', async (req, res, next) => {
  try {
    const {
      opId,
      groupId,
      score,
      accuracy,
      won,
      wordsKilled,
      wordsMissed,
      /* C2：經驗值的算式材料。總分不收——收了等於讓前端自己決定升幾級 */
      correctLetters,
      wrongLetters,
      longKills,
      relearns
    } = req.body || {};
    if (!opId) return res.status(400).json({ error: '缺少 opId' });
    if (!groupId) return res.status(400).json({ error: '缺少 groupId' });
    if (!wordBank.wordsByGroup(groupId).length) {
      return res.status(400).json({ error: '找不到這一組單字' });
    }

    const results = getDB().collection('gameResults');
    const existing = await results.findOne({ userId: req.user._id, opId });
    if (existing) {
      const progress = await GroupProgress.getForGroup(req.user._id, groupId);
      return res.json({ duplicate: true, progress });
    }

    /*
     * 分數以伺服器能驗到的範圍為準。
     *
     * 完全信任前端送來的數字，等於分數表可以隨便寫。這裡不做完整的重播驗證
     * （那要把整場錄影送上來），但至少把離譜的數字夾住：分數不可能是負的，
     * 也不可能超過這一組的字數能產生的上限。
     */
    const groupSize = wordBank.wordsByGroup(groupId).length;
    const safeScore = clamp(Number(score) || 0, 0, groupSize * MAX_SCORE_PER_WORD);
    const safeAccuracy = clamp(Number(accuracy) || 0, 0, 1);

    try {
      await results.insertOne({
        userId: req.user._id,
        opId,
        groupId,
        score: safeScore,
        accuracy: safeAccuracy,
        won: !!won,
        wordsKilled: Math.max(0, Number(wordsKilled) || 0),
        wordsMissed: Math.max(0, Number(wordsMissed) || 0),
        // 經驗的算式材料也存下來，之後要調曲線才有真實資料可以回頭算
        correctLetters: Math.max(0, Number(correctLetters) || 0),
        wrongLetters: Math.max(0, Number(wrongLetters) || 0),
        longKills: Math.max(0, Number(longKills) || 0),
        relearns: Math.max(0, Number(relearns) || 0),
        finishedAt: new Date()
      });
    } catch (err) {
      if (err.code === 11000) {
        const progress = await GroupProgress.getForGroup(req.user._id, groupId);
        return res.json({ duplicate: true, progress });
      }
      throw err;
    }

    /*
     * 經驗值由伺服器自己算，不收前端算好的總分。
     *
     * 而且每一項材料都夾在「這一組打得出來的上限」之內：
     *   - 字母數不可能超過整組所有字母的總長度
     *   - 擊殺數不可能超過字數
     *   - 重學數不可能超過伺服器自己那份名單的長度
     * 最後那條特別重要——它是五倍經驗的來源，不夾住的話，
     * 前端送一個 relearns: 9999 就能一次升到破表。
     */
    const groupWords = wordBank.wordsByGroup(groupId);
    const maxLetters = groupWords.reduce((a, w) => a + String(w.english || '').length, 0);
    const ownRelearn = await relearnIdsFor(req.user._id, groupId);

    const safeKills = clamp(Number(wordsKilled) || 0, 0, groupSize);
    const stats = {
      correctLetters: clamp(Number(correctLetters) || 0, 0, maxLetters),
      kills: safeKills,
      longKills: clamp(Number(longKills) || 0, 0, safeKills),
      relearns: clamp(Number(relearns) || 0, 0, Math.min(safeKills, ownRelearn.length)),
      wordCount: groupSize,
      won: !!won,
      /*
       * 完美是伺服器自己判的，不是前端說了算：
       * 打完整組、一個字都沒漏、一個字母都沒打錯。
       */
      perfect:
        !!won &&
        (Number(wordsMissed) || 0) === 0 &&
        (Number(wrongLetters) || 0) === 0
    };

    /*
     * 長字獎勵的倍率由**伺服器自己查**他裝了什麼，不收前端送的。
     * 收了的話，沒買長字獵手的人也能把經驗與蜂蜜灌成兩倍。
     */
    const { effects } = await equippedFor(req.user);
    stats.longWordFactor = effects.longWordFactor;

    const { xpForBattle, levelFromXp, levelRewards } = await levels();
    const beforeXp = req.user.xp || 0;
    const beforeLevel = levelFromXp(beforeXp).level;
    const xpGained = xpForBattle(stats);
    const afterXp = await User.addXp(req.user._id, xpGained);
    const after = levelFromXp(afterXp);

    /*
     * 蜂蜜進帳戶（C5）。
     *
     * safeScore 已經夾過上限（groupSize × MAX_SCORE_PER_WORD），所以這裡
     * 直接用它——遊戲裡看到的那個蜂蜜數字，就是存進帳戶的數字，
     * 兩個不一樣的話他會問「為什麼打到 400 只拿到 300」。
     */
    const honeyAfter = await User.addHoney(req.user._id, safeScore);

    const progress = await GroupProgress.recordGameResult(req.user._id, groupId, {
      score: safeScore,
      accuracy: safeAccuracy
    });
    res.json({
      progress,
      /* 結算畫面要說「這一場賺了多少經驗、有沒有升級」 */
      xpGained,
      xp: afterXp,
      level: after.level,
      xpInto: after.into,
      xpNeed: after.need,
      leveledUp: after.level > beforeLevel,
      levelsGained: Math.max(0, after.level - beforeLevel),
      rewards: levelRewards(after.level),
      /* 這一場賺到的蜂蜜，以及存款總額——結算畫面要兩個都講 */
      honeyGained: safeScore,
      honey: honeyAfter
    });
  } catch (err) {
    next(err);
  }
});

/** 這個帳號的遊戲成績總表。 */
router.get('/scores', async (req, res, next) => {
  try {
    const progress = await GroupProgress.listForUser(req.user._id);
    const totals = Object.values(progress).reduce(
      (acc, row) => ({
        gamesPlayed: acc.gamesPlayed + (row.gamesPlayed || 0),
        totalScore: acc.totalScore + (row.totalScore || 0),
        unlockedGroups: acc.unlockedGroups + (row.unlocked ? 1 : 0)
      }),
      { gamesPlayed: 0, totalScore: 0, unlockedGroups: 0 }
    );
    res.json({ progress, totals });
  } catch (err) {
    next(err);
  }
});

/*
 * 一個字最多能拿多少分的寬鬆上限。
 * 用來夾住離譜的數字，不是精確的平衡計算——真要精確就得驗整場錄影。
 */
const MAX_SCORE_PER_WORD = 500;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

module.exports = router;
