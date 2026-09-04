const { getDB } = require('../db');
const wordBank = require('../data/word-bank');

/**
 * 單字本身來自寫死的競賽單字庫（server/data/word-bank.js），不存資料庫。
 * 資料庫只保存「真人錄音」這種會變動的附加資料，用單字 id（字串）對應。
 */
function audioCollection() {
  return getDB().collection('wordAudio');
}

const NO_AUDIO = { type: 'tts', gridfsFileId: null, mimeType: null, durationSec: null };

function withAudio(word, audioDoc) {
  if (!word) return null;
  return {
    ...word,
    _id: word.id, // 前端沿用 _id 欄位，這裡直接對應單字庫的 id
    audio: audioDoc
      ? {
          type: 'recorded',
          gridfsFileId: audioDoc.gridfsFileId,
          mimeType: audioDoc.mimeType,
          durationSec: audioDoc.durationSec
        }
      : NO_AUDIO
  };
}

async function audioMap() {
  const docs = await audioCollection().find({}).toArray();
  return new Map(docs.map((d) => [d.wordId, d]));
}

async function listWords() {
  const audios = await audioMap();
  return wordBank.allWords().map((w) => withAudio(w, audios.get(w.id)));
}

async function listWordsByPart(part) {
  const audios = await audioMap();
  return wordBank.wordsByPart(part).map((w) => withAudio(w, audios.get(w.id)));
}

async function getWordById(id) {
  const word = wordBank.getWordById(id);
  if (!word) return null;
  const audioDoc = await audioCollection().findOne({ wordId: id });
  return withAudio(word, audioDoc);
}

async function getAudio(id) {
  return audioCollection().findOne({ wordId: id });
}

async function setAudio(id, { gridfsFileId, mimeType, durationSec }) {
  await audioCollection().updateOne(
    { wordId: id },
    { $set: { wordId: id, gridfsFileId, mimeType, durationSec, updatedAt: new Date() } },
    { upsert: true }
  );
  return getWordById(id);
}

async function clearAudio(id) {
  await audioCollection().deleteOne({ wordId: id });
  return getWordById(id);
}

module.exports = {
  listWords,
  listWordsByPart,
  getWordById,
  getAudio,
  setAudio,
  clearAudio,
  PARTS: wordBank.PARTS
};
