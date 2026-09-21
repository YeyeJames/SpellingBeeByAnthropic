const express = require('express');
const { getDB } = require('../db');
const Word = require('../models/Word');
const WordProgress = require('../models/WordProgress');
const PracticeSession = require('../models/PracticeSession');
const GroupProgress = require('../models/GroupProgress');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const wordBank = require('../data/word-bank');

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

/*
 * 判定規則跟前端用同一個檔案。
 *
 * 前端會先在本地判定對錯給即時回饋，伺服器再自行重判一次（金幣與統計
 * 以伺服器為準）。兩邊各寫一次的話遲早會不一致，而症狀是最難解釋的那種：
 * 畫面說答對了，金幣卻沒加。所以規則只有一份，這裡動態載進來。
 *
 * 那個檔案是 ES module，CommonJS 只能用動態 import；載入結果快取起來，
 * 不要每次作答都重新載。
 */
let answerMatchPromise = null;
function answerMatch() {
  if (!answerMatchPromise) {
    answerMatchPromise = import('../../public/js/shared/answer-match.js');
  }
  return answerMatchPromise;
}

router.post('/session', async (req, res, next) => {
  try {
    const part = Number(req.body.part);
    const group = req.body.group ? String(req.body.group) : null;
    const order = req.body.order === 'sequential' ? 'sequential' : 'random';
    const reviewOnly = !!req.body.reviewOnly;

    let candidates;
    let label;
    if (reviewOnly) {
      // 複習模式跨組，把所有到期的單字都撈進來
      const dueProgress = await WordProgress.getReviewQueue(req.user._id);
      const dueIds = new Set(dueProgress.map((p) => p.wordId));
      candidates = (await Word.listWords()).filter((w) => dueIds.has(w._id));
      if (!candidates.length) {
        return res.status(400).json({ error: '目前沒有需要複習的單字，太棒了！' });
      }
      label = 'review';
    } else if (group) {
      candidates = await Word.listWordsByGroup(group);
      if (!candidates.length) {
        return res.status(400).json({ error: '找不到這一組單字' });
      }
      label = group;
    } else {
      // part 是舊參數，保留給既有的連結與紀錄
      if (!Word.PARTS.includes(part)) {
        return res.status(400).json({ error: '請選擇要練習哪一組' });
      }
      candidates = await Word.listWordsByPart(part);
      label = `part${part}`;
    }

    // 順序模式照單字表原本的排列，隨機模式才打亂
    const selected = order === 'sequential' ? candidates : shuffle(candidates);

    await PracticeSession.createSession(req.user._id, label, selected.map((w) => w._id));

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

    const { isAnswerCorrect } = await answerMatch();
    const correct = isAnswerCorrect(userAnswer, word.english);

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

/*
 * 這個帳號在每一組上的進度：練完幾次、解鎖了沒有、最高分。
 *
 * 練習頁用它在每顆按鈕上標「已練 1/2 次」或「🔒」，遊戲頁用它擋下
 * 還沒練過的組別。同一支 API 兩邊共用，才不會兩個畫面講不同的話。
 */
router.get('/progress', async (req, res, next) => {
  try {
    const progress = await GroupProgress.listForUser(req.user._id);
    res.json({
      progress,
      unlockAfter: GroupProgress.UNLOCK_AFTER_COMPLETIONS,
      groups: wordBank.listGroups()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 練習模式把一整組做完了。
 *
 * 跟作答一樣走背景佇列補送，所以同樣要能重複執行：重試不可以讓
 * 「練完兩次」憑空變成三次，那會讓解鎖條件形同虛設。
 */
router.post('/group-complete', async (req, res, next) => {
  try {
    const { opId, groupId, answered } = req.body || {};
    if (!opId) return res.status(400).json({ error: '缺少 opId' });
    if (!groupId) return res.status(400).json({ error: '缺少 groupId' });

    const groupWords = wordBank.wordsByGroup(groupId);
    if (!groupWords.length) return res.status(400).json({ error: '找不到這一組單字' });

    /*
     * 真的做完整組才算。
     *
     * 沒有這道檢查的話，開一場練習、答一題就離開，前端只要送一次
     * group-complete 就能把解鎖條件繞過去——那整條規則就白寫了。
     */
    if (Number(answered) < groupWords.length) {
      return res.status(400).json({
        error: `這一組有 ${groupWords.length} 個字，要全部做完才算練完一次`
      });
    }

    const completions = completionsCollection();
    const existing = await completions.findOne({ userId: req.user._id, opId });
    if (existing) {
      const progress = await GroupProgress.getForGroup(req.user._id, groupId);
      return res.json({ duplicate: true, progress });
    }

    try {
      await completions.insertOne({
        userId: req.user._id,
        opId,
        groupId,
        answered: Number(answered) || 0,
        completedAt: new Date()
      });
    } catch (err) {
      if (err.code === 11000) {
        const progress = await GroupProgress.getForGroup(req.user._id, groupId);
        return res.json({ duplicate: true, progress });
      }
      throw err;
    }

    const progress = await GroupProgress.recordPracticeCompletion(req.user._id, groupId);
    res.json({ progress });
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

function completionsCollection() {
  // 只存在為了去重：哪一筆「練完一組」已經算過了
  return getDB().collection('groupCompletions');
}

module.exports = router;
