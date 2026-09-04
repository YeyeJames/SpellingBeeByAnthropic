const { ObjectId } = require('mongodb');
const { getDB } = require('../db');

function collection() {
  return getDB().collection('practiceSessions');
}

/**
 * 記錄一次練習開了哪些單字。
 * wordIds 是單字庫的字串 id（例如 p1-account），不是 ObjectId。
 */
async function createSession(userId, partLabel, wordIds) {
  const doc = {
    userId: new ObjectId(userId),
    partLabel: partLabel || null,
    wordIds,
    startedAt: new Date()
  };
  const result = await collection().insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

module.exports = { createSession };
