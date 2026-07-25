const { ObjectId } = require('mongodb');
const { getDB } = require('../db');
const { hashPin } = require('../utils/pin');

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
  sanitizeUser
};
