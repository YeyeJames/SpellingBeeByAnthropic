const express = require('express');
const { getDB } = require('../db');
const Word = require('../models/Word');
const WordProgress = require('../models/WordProgress');
const PracticeSession = require('../models/PracticeSession');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DEFAULT_COUNT = 10;
const MAX_COUNT = 30;

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeAnswer(str) {
  return (str || '').trim().toLowerCase();
}

router.post('/session', async (req, res, next) => {
  try {
    const tags = Array.isArray(req.body.tags) ? req.body.tags.filter(Boolean) : [];
    const count = Math.min(Math.max(Number(req.body.count) || DEFAULT_COUNT, 1), MAX_COUNT);
    const reviewOnly = !!req.body.reviewOnly;

    const candidates = await Word.listWordsByTags(tags);
    if (!candidates.length) {
      return res.status(400).json({ error: '這個範圍內還沒有單字，先去單字庫新增幾個吧！' });
    }

    const progressDocs = await WordProgress.getForUser(
      req.user._id,
      candidates.map((w) => w._id)
    );
    const progressMap = new Map(progressDocs.map((p) => [p.wordId.toString(), p]));
    const now = Date.now();

    const due = [];
    const fresh = [];
    const notDue = [];
    candidates.forEach((word) => {
      const progress = progressMap.get(word._id.toString());
      if (!progress) fresh.push(word);
      else if (new Date(progress.nextReviewAt).getTime() <= now) due.push(word);
      else notDue.push(word);
    });

    if (reviewOnly && !due.length) {
      return res.status(400).json({ error: '目前沒有需要複習的單字，太棒了！' });
    }

    const ordered = reviewOnly ? shuffle(due) : [...shuffle(due), ...shuffle(fresh), ...shuffle(notDue)];
    const selected = shuffle(ordered.slice(0, count));

    const session = await PracticeSession.createSession(
      req.user._id,
      tags,
      selected.map((w) => w._id)
    );

    res.status(201).json({ session: { _id: session._id }, words: selected });
  } catch (err) {
    next(err);
  }
});

/**
 * 記錄一次作答。前端會先在本地判定對錯並立即給畫面回饋，
 * 這支 API 是由背景佇列補送的——所以它必須滿足兩個條件：
 *
 * 1. 可重複執行：背景同步會重試，用 opId 去重，避免同一筆作答被重複計分
 * 2. 伺服器自行判定對錯：不信任前端送來的結果，金幣與統計以伺服器為準
 */
router.post('/attempt', async (req, res, next) => {
  try {
    const { opId, wordId, userAnswer, clientSessionId, attemptedAt } = req.body || {};
    if (!opId) return res.status(400).json({ error: '缺少 opId' });

    // 已經記錄過同一筆就直接回目前狀態，不重複計分
    const existing = await attemptsCollection().findOne({ userId: req.user._id, opId });
    if (existing) {
      const user = await User.findById(req.user._id);
      return res.json({
        duplicate: true,
        correct: existing.correct,
        coinsAwarded: 0,
        coins: user.coins,
        stats: user.stats
      });
    }

    const word = await Word.getWordById(wordId);
    if (!word) return res.status(404).json({ error: '找不到這個單字' });

    const correct = normalizeAnswer(userAnswer) === normalizeAnswer(word.english);

    // 先寫作答紀錄：萬一後續步驟失敗而前端重試，唯一索引會擋下重複計分
    try {
      await attemptsCollection().insertOne({
        userId: req.user._id,
        wordId: word._id,
        opId,
        clientSessionId: clientSessionId || null,
        userAnswer: userAnswer || '',
        correct,
        attemptedAt: attemptedAt ? new Date(attemptedAt) : new Date()
      });
    } catch (err) {
      if (err.code === 11000) {
        const user = await User.findById(req.user._id);
        return res.json({ duplicate: true, correct, coinsAwarded: 0, coins: user.coins, stats: user.stats });
      }
      throw err;
    }

    const [{ user: updatedUser, coinsAwarded, newStreak }] = await Promise.all([
      User.applyAttemptResult(req.user._id, correct),
      WordProgress.recordResult(req.user._id, wordId, correct),
      Word.incrementStats(wordId, correct)
    ]);

    res.json({
      correct,
      correctSpelling: word.english,
      chinese: word.chinese,
      exampleSentence: word.exampleSentence,
      coinsAwarded,
      currentStreak: newStreak,
      coins: updatedUser.coins,
      stats: updatedUser.stats
    });
  } catch (err) {
    next(err);
  }
});

router.post('/session/:id/complete', async (req, res, next) => {
  try {
    const session = await PracticeSession.getSession(req.params.id, req.user._id);
    if (!session) return res.status(404).json({ error: '找不到這個練習場次' });
    const completed = await PracticeSession.completeSession(session._id);
    res.json({ session: completed });
  } catch (err) {
    next(err);
  }
});

router.get('/review-queue', async (req, res, next) => {
  try {
    const dueProgress = await WordProgress.getReviewQueue(req.user._id);
    const words = await Promise.all(dueProgress.map((p) => Word.getWordById(p.wordId)));
    res.json({ words: words.filter(Boolean) });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ stats: user.stats, coins: user.coins });
  } catch (err) {
    next(err);
  }
});

function attemptsCollection() {
  // 簡單的作答紀錄，直接操作 collection 即可，不需要額外的 model 檔案
  return getDB().collection('attempts');
}

module.exports = router;
