const { ObjectId } = require('mongodb');
const { getDB } = require('../db');
const { nextBoxLevel, nextReviewAt } = require('../utils/spacedRepetition');

function collection() {
  return getDB().collection('wordProgress');
}

/** wordId 是單字庫裡的字串 id（例如 p1-account），不是 ObjectId */
async function getForUser(userId, wordIds) {
  return collection()
    .find({ userId: new ObjectId(userId), wordId: { $in: wordIds } })
    .toArray();
}

async function recordResult(userId, wordId, correct) {
  const key = { userId: new ObjectId(userId), wordId };
  const existing = await collection().findOne(key);
  const currentBox = existing ? existing.boxLevel : 0;
  const boxLevel = nextBoxLevel(currentBox, correct);
  const now = new Date();

  await collection().updateOne(
    key,
    {
      $set: {
        boxLevel,
        lastResult: correct ? 'correct' : 'incorrect',
        lastAttemptAt: now,
        nextReviewAt: nextReviewAt(boxLevel, now)
      },
      $inc: correct ? { timesCorrect: 1 } : { timesIncorrect: 1 }
    },
    { upsert: true }
  );
}

async function getReviewQueue(userId, limit = 50) {
  return collection()
    .find({ userId: new ObjectId(userId), nextReviewAt: { $lte: new Date() } })
    .sort({ nextReviewAt: 1 })
    .limit(limit)
    .toArray();
}

module.exports = { getForUser, recordResult, getReviewQueue };
