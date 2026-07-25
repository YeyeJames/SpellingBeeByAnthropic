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

router.post('/session/:id/attempt', async (req, res, next) => {
  try {
    const session = await PracticeSession.getSession(req.params.id, req.user._id);
    if (!session) return res.status(404).json({ error: '找不到這個練習場次' });
    if (session.completedAt) return res.status(400).json({ error: '這個練習場次已經結束了' });

    const { wordId, userAnswer } = req.body || {};
    const inSession = session.wordIds.some((id) => id.toString() === wordId);
    if (!inSession) return res.status(400).json({ error: '這個單字不屬於目前的練習場次' });

    const word = await Word.getWordById(wordId);
    if (!word) return res.status(404).json({ error: '找不到這個單字' });

    const correct = normalizeAnswer(userAnswer) === normalizeAnswer(word.english);

    const [{ coinsAwarded, newStreak }] = await Promise.all([
      User.applyAttemptResult(req.user._id, correct),
      WordProgress.recordResult(req.user._id, wordId, correct),
      Word.incrementStats(wordId, correct)
    ]);

    if (coinsAwarded > 0) {
      await PracticeSession.addCoinsEarned(session._id, coinsAwarded);
    }

    await attemptsCollection().insertOne({
      userId: req.user._id,
      wordId: word._id,
      sessionId: session._id,
      userAnswer: userAnswer || '',
      correct,
      attemptedAt: new Date(),
      streakAtTime: newStreak
    });

    res.json({
      correct,
      correctSpelling: word.english,
      chinese: word.chinese,
      exampleSentence: word.exampleSentence,
      coinsAwarded,
      currentStreak: newStreak
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
