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

/** 同上，但範圍是任意一批字（戰役關卡、複習關不一定是單一組別）。 */
async function relearnIdsAmong(userId, wordIds) {
  if (!wordIds.length) return [];
  const rows = await WordProgress.getForUser(userId, wordIds);
  return rows
    .filter((r) => (r.timesIncorrect || 0) > 0 && (r.boxLevel || 0) < RELEARN_MASTERED_BOX)
    .map((r) => r.wordId);
}

let campaignPromise = null;
function campaignRules() {
  if (!campaignPromise) campaignPromise = import('../../public/js/shared/campaign.js');
  return campaignPromise;
}

/** 這一組現在開不開得起來。遊戲頁載入時問這一支。 */
router.get('/access', async (req, res, next) => {
  try {
    const groupId = String(req.query.group || '');
    const [{ levelFromXp: lvOf, levelRewards: rewardsOf }] = await Promise.all([levels()]);

    /*
     * 沒有組別：戰役關卡或複習關（C4）。
     *
     * 這兩種的題目由 /api/campaign 決定，這裡只給「他是誰」——等級、經驗、
     * 裝備、重學名單。本來沒有組別就直接 400，遊戲頁拿不到就退回 1 級、
     * 全裸、空名單：**在戰役裡他的等級與存錢買的裝備全部不算數**。
     *
     * 重學名單給整本課本的（題目是哪些字這裡不知道）；前端只拿它對照這一場
     * 真的出現的字，伺服器結算時也只對這一場的字重算，兩邊範圍一致。
     */
    if (!groupId) {
      const bankIds = wordBank.getBank(wordBank.resolveBankId(req.user.wordBankId)).words.map((w) => w.id);
      const totalXp = req.user.xp || 0;
      const lv = lvOf(totalXp);
      return res.json({
        unlocked: true,
        level: lv.level,
        xp: totalXp,
        xpInto: lv.into,
        xpNeed: lv.need,
        rewards: rewardsOf(lv.level),
        relearnIds: await relearnIdsAmong(req.user._id, bankIds),
        wordBankId: wordBank.resolveBankId(req.user.wordBankId),
        ...(await equippedFor(req.user)),
        honey: req.user.honey || 0
      });
    }
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
      /* C4：戰役關卡用關號、複習關用 review，不再只有組別 */
      level: levelNo,
      review,
      /*
       * C4：每個字這一場打得怎樣 [{ id, outcome, shown }]。
       *   outcome 1 乾淨打完、2 打完但有打錯、3 漏掉
       *   shown   這個字有沒有顯示在畫面上（顯示著打對是抄，不算會拼）
       * 經驗值的上限、以及寫進 wordProgress 的結果都從這裡來。
       */
      words: reportedWords,
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

    /*
     * 這一場是哪一種：組別、戰役關卡、複習關。
     *
     * 本來只收組別，而戰役關卡的網址是 ?level=N、沒有 group——遊戲頁
     * 看到沒有 group 就直接不送了。結果**戰役打完什麼都沒記**：經驗、蜂蜜
     * 都沒進帳，戰鬥中經驗條照樣在漲，重新整理之後就不見了。
     */
    const mode = review ? 'review' : levelNo ? 'level' : groupId ? 'group' : null;
    if (!mode) return res.status(400).json({ error: '缺少 groupId' });

    const bankId = wordBank.resolveBankId(req.user.wordBankId);
    const bankIds = wordBank.getBank(bankId).words.map((w) => w.id);

    /* 這一場「可能出現」的字。回報上來的字不在裡面就丟掉 */
    let allowedIds;
    if (mode === 'group') {
      if (!wordBank.wordsByGroup(groupId).length) {
        return res.status(400).json({ error: '找不到這一組單字' });
      }
      allowedIds = wordBank.wordsByGroup(groupId).map((w) => w.id);
    } else if (mode === 'level') {
      const { buildCampaign, levelAt, isUnlocked } = await campaignRules();
      const lvl = levelAt(buildCampaign(wordBank.listGroups(bankId)), levelNo);
      if (!lvl) return res.status(404).json({ error: '沒有這一關' });
      const cp = await getDB().collection('campaignProgress').findOne({ userId: req.user._id });
      if (!isUnlocked(lvl.level, cp?.highestCleared || 0)) {
        return res.status(403).json({ error: '這一關還沒解開' });
      }
      // 弱點章的題目是他自己的弱點字＋補上的字，範圍是整本課本
      allowedIds = lvl.weakness
        ? bankIds
        : lvl.groupIds.flatMap((g) => wordBank.wordsByGroup(g).map((w) => w.id));
    } else {
      /*
       * 複習關 ×3：回報的字必須真的是他的弱點字，不然送一個 review: true
       * 再附上隨便幾個字，就能拿三倍經驗。不限到期——開打時到期、
       * 打完時可能剛好過了那個時間點，那不該讓他這一場白打。
       */
      allowedIds = await WordProgress.weakWords(req.user._id, bankIds, { limit: 9999 });
    }
    const allowed = new Set(allowedIds);

    /* 整理回報的字：只留這一場可能出現的、同一個字取最差的結果 */
    const byId = new Map();
    for (const w of Array.isArray(reportedWords) ? reportedWords : []) {
      const id = String(w?.id || '');
      const outcome = Number(w?.outcome);
      if (!allowed.has(id) || ![1, 2, 3].includes(outcome)) continue;
      const prev = byId.get(id);
      byId.set(id, {
        id,
        outcome: Math.max(prev?.outcome || 0, outcome),
        shown: !!w.shown || !!prev?.shown
      });
    }
    const battle = [...byId.values()];
    // 組別模式可以不帶字（舊版遊戲頁）；戰役與複習一定要帶，不然無從驗起
    if (mode !== 'group' && !battle.length) {
      return res.status(400).json({ error: '缺少這一場的單字結果' });
    }
    const battleIds = battle.length ? battle.map((w) => w.id) : allowedIds;
    const battleWords = battleIds.map((id) => wordBank.getWordById(id)).filter(Boolean);

    const results = getDB().collection('gameResults');
    const duplicateReply = async () => res.json({
      duplicate: true,
      progress: mode === 'group' ? await GroupProgress.getForGroup(req.user._id, groupId) : null
    });
    if (await results.findOne({ userId: req.user._id, opId })) return duplicateReply();

    /*
     * 分數以伺服器能驗到的範圍為準。
     *
     * 完全信任前端送來的數字，等於分數表可以隨便寫。這裡不做完整的重播驗證
     * （那要把整場錄影送上來），但至少把離譜的數字夾住：分數不可能是負的，
     * 也不可能超過這一場的字數能產生的上限。
     */
    const wordCount = battleWords.length;
    const safeScore = clamp(Number(score) || 0, 0, wordCount * MAX_SCORE_PER_WORD);
    const safeAccuracy = clamp(Number(accuracy) || 0, 0, 1);

    try {
      await results.insertOne({
        userId: req.user._id,
        opId,
        mode,
        groupId: mode === 'group' ? groupId : null,
        level: mode === 'level' ? Number(levelNo) : null,
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
        wordCount,
        finishedAt: new Date()
      });
    } catch (err) {
      if (err.code === 11000) return duplicateReply();
      throw err;
    }

    /*
     * 經驗值由伺服器自己算，不收前端算好的總分。
     *
     * 而且每一項材料都夾在「這一場打得出來的上限」之內：
     *   - 字母數不可能超過這一場所有字的總長度
     *   - 擊殺數不可能超過字數
     *   - 重學數不可能超過伺服器自己那份名單的長度
     * 最後那條特別重要——它是五倍經驗的來源，不夾住的話，
     * 前端送一個 relearns: 9999 就能一次升到破表。
     *
     * ⚠️ 重學名單一定要在「寫進 wordProgress」**之前**算：剛打對的字寫進去之後
     * 格子會往上升，可能就掉出名單，伺服器算出來的經驗會比戰鬥中顯示的少。
     */
    const maxLetters = battleWords.reduce((a, w) => a + String(w.english || '').length, 0);
    const ownRelearn = await relearnIdsAmong(req.user._id, battleIds);

    const safeKills = clamp(Number(wordsKilled) || 0, 0, wordCount);
    const stats = {
      correctLetters: clamp(Number(correctLetters) || 0, 0, maxLetters),
      kills: safeKills,
      longKills: clamp(Number(longKills) || 0, 0, safeKills),
      relearns: clamp(Number(relearns) || 0, 0, Math.min(safeKills, ownRelearn.length)),
      wordCount,
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

    const { effects } = await equippedFor(req.user);
    stats.longWordFactor = effects.longWordFactor;

    const { xpForBattle, levelFromXp, levelRewards, XP } = await levels();
    // 📖 複習關整場 ×3（倍率是伺服器依模式決定的，不收前端送的數字）
    stats.xpFactor = mode === 'review' ? XP.reviewFactor : 1;
    const beforeXp = req.user.xp || 0;
    const beforeLevel = levelFromXp(beforeXp).level;
    const xpGained = xpForBattle(stats);
    const afterXp = await User.addXp(req.user._id, xpGained);
    const after = levelFromXp(afterXp);

    /*
     * 蜂蜜進帳戶（C5）。
     *
     * safeScore 已經夾過上限（這一場字數 × MAX_SCORE_PER_WORD），所以這裡
     * 直接用它——遊戲裡看到的那個蜂蜜數字，就是存進帳戶的數字，
     * 兩個不一樣的話他會問「為什麼打到 400 只拿到 300」。
     */
    const honeyAfter = await User.addHoney(req.user._id, safeScore);

    const progress = mode === 'group'
      ? await GroupProgress.recordGameResult(req.user._id, groupId, { score: safeScore, accuracy: safeAccuracy })
      : null;

    /*
     * 這一場每個字的結果寫進 wordProgress（C4）。
     *
     * 在此之前遊戲模式從來沒寫過這裡——精熟度只看練習模式，他在遊戲裡
     * 把一個字打對一百次，系統還是認為他不會。第 4 章與複習關都從這裡撈題目，
     * 不接上的話，打對了的字永遠不會離開複習關。
     *
     *   乾淨打完 → 答對　　打完但有打錯、或漏掉 → 答錯（跟練習模式同一個標準）
     *   **畫面上有顯示這個字 → 不記**：看著打對是抄，不代表會拼；
     *   看著還漏掉，是速度的問題，也不是拼字的問題
     */
    let masteryRecorded = 0;
    for (const w of battle) {
      if (w.shown) continue;
      await WordProgress.recordResult(req.user._id, w.id, w.outcome === 1);
      masteryRecorded += 1;
    }
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
      honey: honeyAfter,
      xpFactor: stats.xpFactor,
      masteryRecorded
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
