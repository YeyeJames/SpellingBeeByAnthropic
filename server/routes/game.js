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
const { requireAuth } = require('../middleware/auth');
const wordBank = require('../data/word-bank');

const router = express.Router();
router.use(requireAuth);

/** 這一組現在開不開得起來。遊戲頁載入時問這一支。 */
router.get('/access', async (req, res, next) => {
  try {
    const groupId = String(req.query.group || '');
    if (!groupId) return res.status(400).json({ error: '缺少 group' });
    const group = wordBank.listGroups().find((g) => g.id === groupId);
    if (!group) return res.status(404).json({ error: '找不到這一組單字' });

    const progress = await GroupProgress.getForGroup(req.user._id, groupId);
    res.json({
      group: { id: group.id, label: group.label, count: group.count },
      unlocked: progress.unlocked,
      practiceCompletions: progress.practiceCompletions,
      completionsNeeded: progress.completionsNeeded,
      unlockAfter: GroupProgress.UNLOCK_AFTER_COMPLETIONS,
      bestScore: progress.bestScore
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
    const { opId, groupId, score, accuracy, won, wordsKilled, wordsMissed } = req.body || {};
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
        finishedAt: new Date()
      });
    } catch (err) {
      if (err.code === 11000) {
        const progress = await GroupProgress.getForGroup(req.user._id, groupId);
        return res.json({ duplicate: true, progress });
      }
      throw err;
    }

    const progress = await GroupProgress.recordGameResult(req.user._id, groupId, {
      score: safeScore,
      accuracy: safeAccuracy
    });
    res.json({ progress });
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
