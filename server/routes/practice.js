const express = require('express');
const { getDB } = require('../db');
const Word = require('../models/Word');
const WordProgress = require('../models/WordProgress');
const PracticeSession = require('../models/PracticeSession');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

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
    const part = Number(req.body.part);
    const order = req.body.order === 'sequential' ? 'sequential' : 'random';
    const reviewOnly = !!req.body.reviewOnly;

    let candidates;
    if (reviewOnly) {
      // 複習模式跨 Part，把所有到期的單字都撈進來
      const dueProgress = await WordProgress.getReviewQueue(req.user._id);
      const dueIds = new Set(dueProgress.map((p) => p.wordId));
      candidates = (await Word.listWords()).filter((w) => dueIds.has(w._id));
      if (!candidates.length) {
        return res.status(400).json({ error: '目前沒有需要複習的單字，太棒了！' });
      }
    } else {
      if (!Word.PARTS.includes(part)) {
        return res.status(400).json({ error: '請選擇要練習的 Part' });
      }
      candidates = await Word.listWordsByPart(part);
    }

    // 順序模式照單字表原本的排列，隨機模式才打亂
    const selected = order === 'sequential' ? candidates : shuffle(candidates);

    await PracticeSession.createSession(
      req.user._id,
      reviewOnly ? 'review' : `part${part}`,
      selected.map((w) => w._id)
    );

    res.status(201).json({ words: selected });
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
      WordProgress.recordResult(req.user._id, wordId, correct)
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
