/**
 * 戰役（C3）：100 關的關卡表、解鎖進度、每一關要打哪些字。
 *
 * 關卡表本身是算出來的（public/js/shared/campaign.js），這裡只做三件事：
 *   1. 把表送給地圖頁，順便標出哪些解開了
 *   2. 一關的題目由**伺服器**決定要哪幾組、幾個字
 *   3. 打贏了就記下來，解開下一關
 *
 * 第 2 項為什麼要伺服器決定：前端自己挑的話，他打第 3 關卻送「第 100 關
 * 過了」上來，整個戰役就沒有意義了。前端只送關號，題目與判定都在這裡。
 */

const express = require('express');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');
const wordBank = require('../data/word-bank');
const WordProgress = require('../models/WordProgress');

const router = express.Router();
router.use(requireAuth);

let campaignPromise = null;
function campaignRules() {
  if (!campaignPromise) campaignPromise = import('../../public/js/shared/campaign.js');
  return campaignPromise;
}

/* 經驗倍率跟前端同一份（shared/levels.js），ES module 只能動態載入 */
let levelsPromise = null;
async function reviewFactor() {
  if (!levelsPromise) levelsPromise = import('../../public/js/shared/levels.js');
  return (await levelsPromise).XP.reviewFactor;
}

/** 這個帳號的戰役進度。沒有紀錄就是還沒開始（第 1 關解開著）。 */
async function progressFor(userId) {
  const row = await getDB().collection('campaignProgress').findOne({ userId });
  return {
    highestCleared: row?.highestCleared || 0,
    clearedAt: row?.clearedAt || null,
    stars: row?.stars || {}
  };
}

/** 整張表 + 解鎖狀態。地圖頁靠這一支。 */
router.get('/', async (req, res, next) => {
  try {
    const { buildCampaign, isUnlocked, campaignSummary, CHAPTERS } = await campaignRules();
    const campaign = buildCampaign(wordBank.listGroups(req.user.wordBankId));
    const progress = await progressFor(req.user._id);
    const review = await reviewSummary(req.user);

    res.json({
      chapters: CHAPTERS.map((c) => ({ n: c.n, title: c.title, blurb: c.blurb })),
      /* 📖 複習關的入口（C4）：有幾個字等著複習。0 就是「沒有要複習的字」 */
      review,
      summary: campaignSummary(campaign, progress.highestCleared),
      highestCleared: progress.highestCleared,
      levels: campaign.map((l) => ({
        ...l,
        unlocked: isUnlocked(l.level, progress.highestCleared),
        cleared: l.level <= progress.highestCleared,
        stars: progress.stars[String(l.level)] || 0
      }))
    });
  } catch (err) {
    next(err);
  }
});

/** 這個帳號那一本課本的全部單字 id。弱點只能從自己那一本裡挑。 */
function bankWordIds(user) {
  return wordBank.getBank(wordBank.resolveBankId(user.wordBankId)).words.map((w) => w.id);
}

/* 複習關一場最多幾個字：大約跟一組一樣，五分鐘左右打得完 */
const REVIEW_SIZE = 20;

async function reviewSummary(user) {
  const due = await WordProgress.weakWords(user._id, bankWordIds(user), { dueOnly: true, limit: 999 });
  return { count: due.length, size: Math.min(due.length, REVIEW_SIZE), xpFactor: await reviewFactor() };
}

/**
 * 📖 複習關（C4）：題目是他答錯過、還沒學會、而且到了該複習時間的字。
 *
 * 這是 §0 的核心——卡關的出口是複習關，不是重打舊關。
 *   - 不佔關號、不用解鎖、隨時可以打，打幾次都可以：卡關的時候隨時有路走
 *   - 經驗 ×3，輸贏都算：去複習是變強最快的方法
 *   - 沒有到期的弱點字就沒有複習關——「沒有要複習的字」本身就是一個好消息
 */
router.get('/review', async (req, res, next) => {
  try {
    const wordIds = await WordProgress.weakWords(req.user._id, bankWordIds(req.user), {
      dueOnly: true,
      limit: REVIEW_SIZE
    });
    if (!wordIds.length) {
      return res.status(404).json({ error: '目前沒有要複習的字，太棒了！', empty: true });
    }
    res.json({
      review: true,
      wordIds,
      wordBankId: wordBank.resolveBankId(req.user.wordBankId),
      order: 'random',
      xpFactor: await reviewFactor()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 一關要打哪些字。
 *
 * 遊戲頁帶 ?level=N 進來時問這一支，拿到的是已經挑好、排好的單字 id 清單。
 * 沒解開的關卡直接擋掉——不然網址改個數字就能跳到第 100 關。
 */
router.get('/level/:level', async (req, res, next) => {
  try {
    const { buildCampaign, levelAt, isUnlocked, pickLevelWordIds } = await campaignRules();
    const campaign = buildCampaign(wordBank.listGroups(req.user.wordBankId));
    const level = levelAt(campaign, req.params.level);
    if (!level) return res.status(404).json({ error: '沒有這一關' });

    const progress = await progressFor(req.user._id);
    if (!isUnlocked(level.level, progress.highestCleared)) {
      return res.status(403).json({
        error: `第 ${level.level} 關還沒解開，先過第 ${progress.highestCleared + 1} 關`,
        locked: true,
        nextLevel: progress.highestCleared + 1
      });
    }

    const fallback = [];
    for (const gid of level.groupIds) {
      for (const w of wordBank.wordsByGroup(gid)) fallback.push(w.id);
    }

    /*
     * 第 4 章是「個人弱點章」（C4）：題目是**他自己**最弱的字。
     *
     * 先放他最弱的字，不夠的用這一關原本對應的組別補滿——一關的大小跟
     * 其他關一樣，也永遠不會是空的（他還沒錯過幾個字的時候也打得了）。
     *
     * 弱點字不管到期沒有都拿（跟複習關不同）：這一章是進度，每一關都要有東西。
     * 他在這一關把字打對了，那些字的格子會往上升（結算時寫進 wordProgress），
     * 下一關就輪到下一批最弱的——「24 關把弱點掃過一遍」就是這樣發生的，
     * 不需要事先把 24 關的題目分好。
     */
    /*
     * 混合關與中王：每一組平均抽，每次開都重抽（shared/campaign.js 的 pickLevelWordIds）。
     * 本來是整串接起來送出去、遊戲頁取前面 N 個，後面幾組一個都輪不到（step5 的 P5-1）。
     * 單一組、沒有上限的關，回來的就是整組照原本的順序，跟以前一樣。
     */
    let wordIds = pickLevelWordIds(
      level,
      (gid) => wordBank.wordsByGroup(gid).map((w) => w.id),
      Math.random,
      (id) => wordBank.getWordById(id)?.english || id
    );
    let weakCount = 0;
    if (level.weakness) {
      const size = level.wordLimit || fallback.length;
      const weak = await WordProgress.weakWords(req.user._id, bankWordIds(req.user), { limit: size });
      const weakSet = new Set(weak);
      wordIds = [...weak, ...fallback.filter((id) => !weakSet.has(id))].slice(0, size);
      weakCount = weak.length;
    }

    res.json({
      level: {
        ...level,
        weakCount,
        // 弱點章但他還沒有任何弱點字：整關都是補上去的字，畫面要講清楚
        weaknessPending: !!level.weakness && weakCount === 0
      },
      // 遊戲頁要用它去 /api/wordbank 拿對的那一本（那支不需要登入，看不到 req.user）
      wordBankId: wordBank.resolveBankId(req.user.wordBankId),
      // 只送 id 與組別，單字內容遊戲頁本來就會自己去 /api/wordbank 拿
      wordIds,
      limit: level.weakness ? null : level.wordLimit,
      order: level.order
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 打完一關。
 *
 * 只有贏了才推進度，而且只能往前推一關——送「第 100 關過了」上來不會讓
 * 前面 99 關一起跳過去。同一關重複打不會倒退（已經過的關再打輸也還是過了）。
 */
router.post('/clear', async (req, res, next) => {
  try {
    const { buildCampaign, levelAt, isUnlocked } = await campaignRules();
    const { level, won, score, accuracy, opId } = req.body || {};
    const campaign = buildCampaign(wordBank.listGroups(req.user.wordBankId));
    const row = levelAt(campaign, level);
    if (!row) return res.status(404).json({ error: '沒有這一關' });

    const progress = await progressFor(req.user._id);
    if (!isUnlocked(row.level, progress.highestCleared)) {
      return res.status(403).json({ error: '這一關還沒解開' });
    }

    if (!won) {
      return res.json({ highestCleared: progress.highestCleared, advanced: false });
    }

    /*
     * 星等：打贏 1 顆、正確率 ≥90% 2 顆、零失誤 3 顆。
     *
     * 給的是「再打一次」的理由——他已經過的關可以回頭拿三顆星，
     * 而那是重打舊關唯一站得住腳的動機（§0 反對的是「為了等級刷舊關」，
     * 不是反對回頭挑戰）。
     */
    const acc = Math.max(0, Math.min(1, Number(accuracy) || 0));
    const stars = acc >= 1 ? 3 : acc >= 0.9 ? 2 : 1;
    const prevStars = progress.stars[String(row.level)] || 0;

    const nextHighest = Math.max(progress.highestCleared, row.level);
    await getDB().collection('campaignProgress').updateOne(
      { userId: req.user._id },
      {
        $set: {
          highestCleared: nextHighest,
          [`stars.${row.level}`]: Math.max(prevStars, stars),
          clearedAt: new Date()
        },
        $setOnInsert: { userId: req.user._id }
      },
      { upsert: true }
    );

    const after = await progressFor(req.user._id);
    res.json({
      highestCleared: after.highestCleared,
      advanced: after.highestCleared > progress.highestCleared,
      stars: Math.max(prevStars, stars),
      nextLevel: after.highestCleared + 1 <= campaign.length ? after.highestCleared + 1 : null,
      opId: opId || null,
      score: Number(score) || 0
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
