/**
 * 每個帳號在每一組單字上的進度。
 *
 * ── 為什麼要有這個 ──────────────────────────────────────────
 * 遊戲模式不該讓孩子在「完全沒看過這組字」的情況下直接玩。那樣他會一直
 * 被沒見過的字打死，學到的只有挫折。所以規則是：**同一組單字要先在
 * 練習模式完整做完一次，遊戲才開得起來。**
 *
 * 練習模式看得到中文與例句，答完還會把正確拼法亮出來；遊戲模式是考試。
 * 先練再考，順序才對。
 *
 * ── 跟著帳號走的東西 ────────────────────────────────────────
 * 練了幾次、解鎖了沒有、最高分、玩了幾場——全部是這個帳號自己的。
 * 哥哥練過不等於弟弟練過。
 *
 * 唯一跨帳號共用的是單字錄音（存在 wordAudio，只用 wordId 當鍵，
 * 不帶 userId）。誰錄的都算數，因為那是「這個字該怎麼唸」，跟誰在玩無關。
 */

const { ObjectId } = require('mongodb');
const { getDB } = require('../db');

/**
 * 練習完整做完幾次才解鎖遊戲。
 *
 * 本來是 2。家長實際試玩後改成 1（2026-09）：兩兄弟的語感練一次就夠了，
 * 第二次練習只是在等；就算還有幾個字沒記住，在遊戲裡被扣分很快就記得了——
 * 而且遊戲的結果現在也會寫進精熟度（C4），沒記住的字會自己回到複習關。
 *
 * 解鎖狀態是讀取時用這個數字現算的（見 decorate），不是存死在資料庫裡，
 * 所以改了之後，已經練過一次的組會立刻解鎖，不必補資料。
 */
const UNLOCK_AFTER_COMPLETIONS = 1;

function collection() {
  return getDB().collection('groupProgress');
}

function blank(groupId) {
  return {
    groupId,
    practiceCompletions: 0,
    gamesPlayed: 0,
    bestScore: 0,
    totalScore: 0,
    bestAccuracy: 0,
    lastPracticedAt: null,
    lastPlayedAt: null
  };
}

function decorate(row) {
  const completions = row.practiceCompletions || 0;
  return {
    ...row,
    unlocked: completions >= UNLOCK_AFTER_COMPLETIONS,
    // 還要再練幾次才解鎖。畫面直接用這個數字，不要各自再算一次
    completionsNeeded: Math.max(0, UNLOCK_AFTER_COMPLETIONS - completions)
  };
}

/** 這個帳號在所有組別上的進度，以 groupId 為鍵。 */
async function listForUser(userId) {
  const rows = await collection().find({ userId: new ObjectId(userId) }).toArray();
  const out = {};
  rows.forEach((r) => {
    const { _id, userId: _u, ...rest } = r;
    out[r.groupId] = decorate({ ...blank(r.groupId), ...rest });
  });
  return out;
}

async function getForGroup(userId, groupId) {
  const row = await collection().findOne({ userId: new ObjectId(userId), groupId });
  if (!row) return decorate(blank(groupId));
  const { _id, userId: _u, ...rest } = row;
  return decorate({ ...blank(groupId), ...rest });
}

/**
 * 練習模式把一整組做完了。
 *
 * 只有「做完」才算——中途離開不算。這條規則的用意是讓他把整組字看過，
 * 做一半就跳走沒有達到目的。
 */
async function recordPracticeCompletion(userId, groupId) {
  await collection().updateOne(
    { userId: new ObjectId(userId), groupId },
    {
      $inc: { practiceCompletions: 1 },
      $set: { lastPracticedAt: new Date() }
    },
    { upsert: true }
  );
  return getForGroup(userId, groupId);
}

/** 打完一場遊戲。分數累積在這個帳號底下。 */
async function recordGameResult(userId, groupId, { score = 0, accuracy = 0 } = {}) {
  const before = await getForGroup(userId, groupId);
  await collection().updateOne(
    { userId: new ObjectId(userId), groupId },
    {
      $inc: { gamesPlayed: 1, totalScore: Math.max(0, Math.round(score)) },
      $set: {
        bestScore: Math.max(before.bestScore || 0, Math.max(0, Math.round(score))),
        bestAccuracy: Math.max(before.bestAccuracy || 0, Math.max(0, Math.min(1, accuracy))),
        lastPlayedAt: new Date()
      }
    },
    { upsert: true }
  );
  return getForGroup(userId, groupId);
}

module.exports = {
  UNLOCK_AFTER_COMPLETIONS,
  listForUser,
  getForGroup,
  recordPracticeCompletion,
  recordGameResult
};
