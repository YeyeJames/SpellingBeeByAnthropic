const { ObjectId } = require('mongodb');
const { getDB } = require('../db');

function collection() {
  return getDB().collection('words');
}

async function createWord({ english, chinese, exampleSentence, tags }, createdBy) {
  const now = new Date();
  const doc = {
    english,
    chinese,
    exampleSentence,
    tags,
    audio: { type: 'tts', gridfsFileId: null, mimeType: null, durationSec: null },
    createdBy: new ObjectId(createdBy),
    createdAt: now,
    updatedAt: now,
    timesShown: 0,
    timesCorrect: 0
  };
  const result = await collection().insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function findDuplicateEnglish(english, excludeId) {
  const query = { english: { $regex: `^${escapeRegex(english)}$`, $options: 'i' } };
  if (excludeId) query._id = { $ne: new ObjectId(excludeId) };
  return collection().findOne(query);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listWords({ tag, search } = {}) {
  const query = {};
  if (tag) query.tags = tag;
  if (search) {
    query.$or = [
      { english: { $regex: escapeRegex(search), $options: 'i' } },
      { chinese: { $regex: escapeRegex(search), $options: 'i' } }
    ];
  }
  return collection().find(query).sort({ createdAt: -1 }).toArray();
}

async function listWordsByTags(tags) {
  const query = tags && tags.length ? { tags: { $in: tags } } : {};
  return collection().find(query).toArray();
}

async function getWordById(id) {
  return collection().findOne({ _id: new ObjectId(id) });
}

async function updateWord(id, fields) {
  await collection().updateOne(
    { _id: new ObjectId(id) },
    { $set: { ...fields, updatedAt: new Date() } }
  );
  return getWordById(id);
}

async function deleteWord(id) {
  await collection().deleteOne({ _id: new ObjectId(id) });
}

async function listTags() {
  return collection().distinct('tags');
}

async function setAudio(id, { gridfsFileId, mimeType, durationSec }) {
  await collection().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        audio: { type: 'recorded', gridfsFileId, mimeType, durationSec },
        updatedAt: new Date()
      }
    }
  );
  return getWordById(id);
}

async function clearAudio(id) {
  await collection().updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        audio: { type: 'tts', gridfsFileId: null, mimeType: null, durationSec: null },
        updatedAt: new Date()
      }
    }
  );
  return getWordById(id);
}

async function incrementStats(id, correct) {
  const inc = { timesShown: 1 };
  if (correct) inc.timesCorrect = 1;
  await collection().updateOne({ _id: new ObjectId(id) }, { $inc: inc });
}

module.exports = {
  createWord,
  findDuplicateEnglish,
  listWords,
  listWordsByTags,
  getWordById,
  updateWord,
  deleteWord,
  listTags,
  incrementStats,
  setAudio,
  clearAudio
};
