const { ObjectId } = require('mongodb');
const { getDB } = require('../db');
const { hashPin } = require('../utils/pin');
const { calcCoinsForCorrectAnswer } = require('../utils/coins');

const DEFAULT_THEME = 'sports';

function collection() {
  return getDB().collection('users');
}

async function createUser(nickname, pin) {
  const pinHash = await hashPin(pin);
  const now = new Date();
  const doc = {
    nickname: nickname.trim(),
    nicknameLower: nickname.trim().toLowerCase(),
    pinHash,
    avatar: { baseCharacter: 'rookie', accessories: [] },
    activeTheme: DEFAULT_THEME,
    audioPrefs: { bgmVolume: 0.5, sfxVolume: 0.8, muted: false },
    coins: 0,
    stats: {
      totalWordsPracticed: 0,
      totalCorrect: 0,
      totalIncorrect: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPracticeDate: null
    },
    ownedItemKeys: [],
    createdAt: now,
    lastLoginAt: now
  };
  const result = await collection().insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function findByNickname(nickname) {
  return collection().findOne({ nicknameLower: nickname.trim().toLowerCase() });
}

async function findById(id) {
  return collection().findOne({ _id: new ObjectId(id) });
}

async function listProfiles() {
  return collection()
    .find({}, { projection: { nickname: 1, avatar: 1, activeTheme: 1 } })
    .sort({ nickname: 1 })
    .toArray();
}

async function touchLastLogin(id) {
  await collection().updateOne({ _id: new ObjectId(id) }, { $set: { lastLoginAt: new Date() } });
}

async function updateAudioPrefs(id, prefs) {
  await collection().updateOne({ _id: new ObjectId(id) }, { $set: { audioPrefs: prefs } });
}

/**
 * 記錄一次作答結果：更新 streak/正確率統計與金幣，回傳更新後的 user。
 * 這個 app 一次只會有一個玩家在單一 session 內作答，故用讀取後寫入即可，不需要交易。
 */
async function applyAttemptResult(id, correct) {
  const user = await findById(id);
  const newStreak = correct ? user.stats.currentStreak + 1 : 0;
  const bestStreak = Math.max(user.stats.bestStreak, newStreak);
  const coinsAwarded = correct ? calcCoinsForCorrectAnswer(newStreak) : 0;

  const update = {
    $set: {
      'stats.currentStreak': newStreak,
      'stats.bestStreak': bestStreak,
      'stats.lastPracticeDate': new Date()
    },
    $inc: {
      'stats.totalWordsPracticed': 1,
      'stats.totalCorrect': correct ? 1 : 0,
      'stats.totalIncorrect': correct ? 0 : 1,
      coins: coinsAwarded
    }
  };
  await collection().updateOne({ _id: new ObjectId(id) }, update);
  const updatedUser = await findById(id);
  return { user: updatedUser, coinsAwarded, newStreak };
}

async function addOwnedItem(id, itemKey, cost) {
  await collection().updateOne(
    { _id: new ObjectId(id) },
    { $addToSet: { ownedItemKeys: itemKey }, $inc: { coins: -cost } }
  );
  return findById(id);
}

async function equipItem(id, type, itemKey) {
  if (type === 'theme') {
    await collection().updateOne({ _id: new ObjectId(id) }, { $set: { activeTheme: itemKey } });
  } else {
    await collection().updateOne({ _id: new ObjectId(id) }, { $addToSet: { 'avatar.accessories': itemKey } });
  }
  return findById(id);
}

async function unequipAccessory(id, itemKey) {
  await collection().updateOne({ _id: new ObjectId(id) }, { $pull: { 'avatar.accessories': itemKey } });
  return findById(id);
}

function sanitizeUser(user) {
  if (!user) return null;
  const { pinHash, nicknameLower, ...safe } = user;
  return safe;
}

module.exports = {
  createUser,
  findByNickname,
  findById,
  listProfiles,
  touchLastLogin,
  updateAudioPrefs,
  applyAttemptResult,
  addOwnedItem,
  equipItem,
  unequipAccessory,
  sanitizeUser
};
