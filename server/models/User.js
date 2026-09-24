const { ObjectId } = require('mongodb');
const { getDB } = require('../db');
const { calcCoinsForCorrectAnswer } = require('../utils/coins');

const DEFAULT_THEME = 'sports';

function collection() {
  return getDB().collection('users');
}

async function createUser(nickname) {
  const now = new Date();
  const doc = {
    nickname: nickname.trim(),
    nicknameLower: nickname.trim().toLowerCase(),
    avatar: { baseCharacter: 'rookie', accessories: [] },
    activeTheme: DEFAULT_THEME,
    audioPrefs: { bgmVolume: 0.5, sfxVolume: 0.8, muted: false },
    coins: 0,
    /*
     * 遊戲模式的等級與經驗（C2）。
     *
     * 只存累計經驗，等級一律由 shared/levels.js 的曲線算出來——
     * 兩個都存的話遲早會對不起來，而那種不一致最難查：
     * 經驗條看起來滿了，等級卻沒動。
     */
    xp: 0,
    /*
     * 蜂蜜：遊戲模式賺的錢，買裝備用（C5）。
     *
     * 跟金幣分開是刻意的：金幣是練習模式賺的、買造型；蜂蜜是遊戲模式賺的、
     * 買力量。兩邊各有各的用途，那個在戰鬥中一直跳的蜂蜜數字也終於有了去處——
     * 在這之前它只是一場的分數，打完就沒了。
     */
    honey: 0,
    ownedGear: [],
    equipped: { weapon: 'weapon_wood', armor: 'armor_thin', trinket: null },
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

/**
 * 加經驗值，回傳更新後的累計。
 *
 * 用 $inc 而不是讀出來加一加再寫回去：兩場同時回報（重送、多分頁）時，
 * 讀-改-寫會讓其中一場的經驗憑空消失。等級不存，由累計經驗算出來。
 *
 * 舊帳號沒有 xp 欄位，$inc 會自己補上，不用另外做資料遷移。
 */
async function addXp(id, amount) {
  const gain = Math.max(0, Math.round(Number(amount) || 0));
  if (!gain) {
    const user = await findById(id);
    return user ? user.xp || 0 : 0;
  }
  const r = await collection().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $inc: { xp: gain } },
    { returnDocument: 'after', projection: { xp: 1 } }
  );
  return (r && (r.value ? r.value.xp : r.xp)) || gain;
}

/**
 * 加蜂蜜（遊戲模式打完一場）。跟 addXp 一樣用 $inc，理由也一樣：
 * 兩場同時回報時，讀-改-寫會讓其中一場的蜂蜜憑空消失。
 */
async function addHoney(id, amount) {
  const gain = Math.max(0, Math.round(Number(amount) || 0));
  if (!gain) {
    const user = await findById(id);
    return user ? user.honey || 0 : 0;
  }
  const r = await collection().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $inc: { honey: gain } },
    { returnDocument: 'after', projection: { honey: 1 } }
  );
  return (r && (r.value ? r.value.honey : r.honey)) || gain;
}

/**
 * 買一件裝備：扣蜂蜜、記進擁有清單。
 *
 * 條件寫進 query 而不是先讀出來再判斷——「蜂蜜夠」與「還沒買過」都由
 * 資料庫在同一個原子操作裡檢查。先讀再寫的話，連按兩下就會扣兩次錢。
 * 回傳 null 代表條件不成立（錢不夠或已經買過），呼叫端據此回錯誤訊息。
 */
async function buyGear(id, gearKey, cost) {
  const r = await collection().findOneAndUpdate(
    {
      _id: new ObjectId(id),
      honey: { $gte: cost },
      ownedGear: { $ne: gearKey }
    },
    { $inc: { honey: -cost }, $addToSet: { ownedGear: gearKey } },
    { returnDocument: 'after' }
  );
  return r && (r.value !== undefined ? r.value : r);
}

/** 換裝。哪些 key 合法由呼叫端（路由）依 equipment.js 判斷。 */
async function setEquipped(id, slot, gearKey) {
  await collection().updateOne(
    { _id: new ObjectId(id) },
    { $set: { [`equipped.${slot}`]: gearKey } }
  );
  return findById(id);
}

async function findByNickname(nickname) {
  return collection().findOne({ nicknameLower: nickname.trim().toLowerCase() });
}

async function findById(id) {
  return collection().findOne({ _id: new ObjectId(id) });
}

async function listProfiles() {
  return collection()
    .find({}, { projection: { nickname: 1, avatar: 1, activeTheme: 1, coins: 1, stats: 1 } })
    .sort({ nickname: 1 })
    .toArray();
}

/*
 * 這個帳號自己的資料放在哪些 collection。
 *
 * 刪帳號要連著清掉，不然資料會變成沒有主人的孤兒，之後只會越積越多。
 * wordAudio 刻意不在這張表裡——**錄音是跨帳號共用的**：孩子錄過的那個字
 * 不管誰登入都要聽到他自己的聲音，換一個帳號玩不該把它弄不見。
 */
const OWNED_COLLECTIONS = [
  'attempts',
  'practiceSessions',
  'wordProgress',
  'groupProgress',
  'groupCompletions',
  'gameResults',
  // 戰役進度也是這個帳號自己的：哥哥打到第 30 關不代表弟弟也打到
  'campaignProgress'
];

async function deleteUser(id) {
  const _id = new ObjectId(id);
  const user = await collection().findOne({ _id });
  if (!user) return null;

  const db = getDB();
  for (const name of OWNED_COLLECTIONS) {
    await db.collection(name).deleteMany({ userId: _id });
  }
  await collection().deleteOne({ _id });
  return user;
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
  // pinHash 是舊帳號留下來的欄位，現在不再產生，但既有資料還有，照樣不外流
  const { pinHash, nicknameLower, ...safe } = user;
  return safe;
}

module.exports = {
  createUser,
  findByNickname,
  findById,
  listProfiles,
  deleteUser,
  OWNED_COLLECTIONS,
  touchLastLogin,
  updateAudioPrefs,
  applyAttemptResult,
  addXp,
  addHoney,
  buyGear,
  setEquipped,
  addOwnedItem,
  equipItem,
  unequipAccessory,
  sanitizeUser
};
