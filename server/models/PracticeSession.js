const { ObjectId } = require('mongodb');
const { getDB } = require('../db');

function collection() {
  return getDB().collection('practiceSessions');
}

async function createSession(userId, tagsFilter, wordIds) {
  const doc = {
    userId: new ObjectId(userId),
    tagsFilter: tagsFilter || [],
    wordIds: wordIds.map((id) => new ObjectId(id)),
    startedAt: new Date(),
    completedAt: null,
    coinsEarned: 0
  };
  const result = await collection().insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function getSession(id, userId) {
  return collection().findOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
}

async function addCoinsEarned(id, amount) {
  await collection().updateOne({ _id: new ObjectId(id) }, { $inc: { coinsEarned: amount } });
}

async function completeSession(id) {
  await collection().updateOne({ _id: new ObjectId(id) }, { $set: { completedAt: new Date() } });
  return collection().findOne({ _id: new ObjectId(id) });
}

module.exports = { createSession, getSession, addCoinsEarned, completeSession };
