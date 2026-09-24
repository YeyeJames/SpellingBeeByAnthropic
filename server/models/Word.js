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

/*
 * ⚠️ 這幾支都要指定是哪一本課本。
 *
 * 本來 listWords() 是 wordBank.allWords()，而那個回的是**全部課本攤平**
 * （824 字）。結果 Allen 用自己的帳號進單字庫頁，看到的是 Pierce 的
 * 749 個字——他的功課跟弟弟的混在一起，而畫面上看不出來（都是英文）。
 * parts / groups 更糟，本來直接寫死 BANKS[0]，永遠是 Pierce 那一本。
 *
 * 不帶 bankId 就是預設那一本（getBank 的行為），不是「全部」。
 */
async function listWords(bankId) {
  const audios = await audioMap();
  return wordBank.getBank(bankId).words.map((w) => withAudio(w, audios.get(w.id)));
}

async function listWordsByPart(part, bankId) {
  const audios = await audioMap();
  return wordBank.wordsByPart(part, bankId).map((w) => withAudio(w, audios.get(w.id)));
}

async function listWordsByGroup(groupId) {
  const audios = await audioMap();
  return wordBank.wordsByGroup(groupId).map((w) => withAudio(w, audios.get(w.id)));
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

/** 有真人錄音的單字 id。遊戲頁靠它決定哪些字不要用機器語音唸。 */
async function listRecordedWordIds() {
  const docs = await audioCollection().find({}).toArray();
  return docs.filter((d) => d.gridfsFileId).map((d) => d.wordId);
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
  listWordsByGroup,
  getWordById,
  getAudio,
  listRecordedWordIds,
  setAudio,
  clearAudio,
  PARTS: wordBank.PARTS,
  listGroups: wordBank.listGroups
};
