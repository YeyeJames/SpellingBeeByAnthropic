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

/**
 * 到期要複習的字。
 *
 * allowedIds 是他自己那一本的字。一定要在查詢裡就限定，不能撈出來再濾：
 * Allen 的帳號在「選了自己的課本、畫面卻還是 Pierce 的」那段時間練過
 * Pierce 的字，那些紀錄還在。不限定的話，練習頁的「複習 N 個」會把它們
 * 算進去，按下去卻說「沒有需要複習的單字」；而且別本的字排在前面時，
 * 會把他自己真正到期的字擠出這 50 個之外。
 */
async function getReviewQueue(userId, allowedIds, limit = 50) {
  return collection()
    .find({ userId: new ObjectId(userId), wordId: { $in: allowedIds }, nextReviewAt: { $lte: new Date() } })
    .sort({ nextReviewAt: 1 })
    .limit(limit)
    .toArray();
}

/*
 * 「學會了」的門檻。boxLevel 到這一格（21 天後才要再複習）就不再算弱點。
 * 跟 game.js 的 RELEARN_MASTERED_BOX 同一個數字：那邊決定「還給不給五倍經驗」，
 * 這邊決定「還算不算弱點」，兩個說的是同一件事，不可以一邊說學會了、一邊說還不會。
 */
const MASTERED_BOX = 4;

/**
 * 他的弱點字：答錯過、還沒學會的那些，最弱的排前面（C4）。
 *
 * @param allowedIds 只從這些 id 裡挑（他自己那一本）——兩個孩子的紀錄在
 *                   同一個集合裡，不限範圍的話 Allen 的複習關會混進 Pierce 課本的字
 * @param dueOnly    true = 只要「到了該複習的時間」的字（複習關用）
 *                   false = 不管時間，最弱的優先（第 4 章用）
 *
 * 複習關為什麼只拿到期的：他在複習關把一個字打對，那個字要**離開**複習關，
 * 照間隔複習的時間表之後再回來。不然複習關永遠是同一批字，
 * 「打對了就不用再複習」這個他看得懂的因果就不見了。
 *
 * 排序：格子越低越弱 → 錯越多次越弱 → 越久沒碰越優先。
 */
async function weakWords(userId, allowedIds, { dueOnly = false, limit = 20 } = {}) {
  const allowed = new Set(allowedIds);
  const now = Date.now();
  const rows = await collection().find({ userId: new ObjectId(userId) }).toArray();
  return rows
    .filter((r) => allowed.has(r.wordId))
    .filter((r) => (r.timesIncorrect || 0) > 0 && (r.boxLevel || 0) < MASTERED_BOX)
    /*
     * 「到期」包含第 0 格（剛答錯的字），不管時間。
     *
     * 第 0 格的間隔是 10 分鐘，照時間算的話，他剛打錯一批字、卡關、回到地圖，
     * 複習關卻寫「目前沒有要複習的字」——出口正好在他最需要的時候消失。
     * spacedRepetition.js 自己的註解也寫著「答錯回到第 0 格立即複習」。
     */
    .filter((r) => !dueOnly || (r.boxLevel || 0) === 0 || !r.nextReviewAt
      || new Date(r.nextReviewAt).getTime() <= now)
    .sort((a, b) =>
      (a.boxLevel || 0) - (b.boxLevel || 0)
      || (b.timesIncorrect || 0) - (a.timesIncorrect || 0)
      || new Date(a.lastAttemptAt || 0) - new Date(b.lastAttemptAt || 0))
    .slice(0, limit)
    .map((r) => r.wordId);
}

module.exports = { getForUser, recordResult, getReviewQueue, weakWords, MASTERED_BOX };
