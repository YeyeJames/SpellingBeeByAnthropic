/**
 * 帳號流程與解鎖關卡。
 *
 * 這次改的是整個進入流程，而且全部在資料庫那一側：
 *   首頁選帳號（沒有密碼）→ 進練習頁 → 同一組練完兩次 → 遊戲才開得起來。
 *
 * 這條路徑沒有一處能靠「看程式碼看起來對」交差：解鎖條件寫錯，孩子要嘛
 * 永遠玩不到遊戲，要嘛第一次就跳過練習；刪帳號寫錯會把孩子錄的音一起刪掉。
 * 所以用記憶體假資料庫把真的路由掛起來跑（見 lib/fake-mongo.mjs）。
 *
 * 要證明的事：
 *   1. 沒有密碼也能建帳號、選帳號；重名要擋下來
 *   2. 新帳號每一組都是鎖的
 *   3. 練完「一次」還不夠——差一次就是不給玩
 *   4. 練完兩次才解鎖，而且遊戲端與練習端講同一句話
 *   5. 沒做完整組不算數（不然前端送一筆假的就繞過去了）
 *   6. 重試不會讓一次變成兩次（背景佇列一定會重送）
 *   7. 解鎖進度跟著帳號走：哥哥練過，弟弟還是鎖的
 *   8. 錄音跨帳號共用：換帳號照樣聽得到
 *   9. 分數記在各自的帳號底下，而且重送不會被加兩次
 *  10. 刪帳號會清掉那個帳號的東西，但**不會**刪掉共用的錄音
 *
 * 用法：node scripts/account-flow-test.mjs
 */

import { createRequire } from 'node:module';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const store = {
  users: [],
  wordAudio: [],
  attempts: [],
  practiceSessions: [],
  wordProgress: [],
  groupProgress: [],
  groupCompletions: [],
  gameResults: []
};

const fakeDb = createFakeDb(store, {
  uniqueIndexes: {
    attempts: ['userId', 'opId'],
    groupCompletions: ['userId', 'opId'],
    gameResults: ['userId', 'opId']
  }
});
// 一定要在載入任何模型之前換掉：模型是在載入時就把 getDB 解構走的
installFakeDb(fakeDb);

const express = require('express');
const authRouter = require('../server/routes/auth.js');
const practiceRouter = require('../server/routes/practice.js');
const gameRouter = require('../server/routes/game.js');
const wordsRouter = require('../server/routes/words.js');
const wordBank = require('../server/data/word-bank.js');

/* ── 把路由掛起來 ─────────────────────────────────────────── */
const app = express();
app.use(express.json());
/*
 * 假的 session。
 * 帶 x-test-user 就算用那個帳號登入；註冊與登入會寫進 req.session，
 * 所以這裡要讓它是一個真的可以寫的物件。
 */
const sessions = new Map();
app.use((req, res, next) => {
  const key = req.get('x-test-user') || 'anon';
  if (!sessions.has(key)) sessions.set(key, {});
  const s = sessions.get(key);
  if (req.get('x-test-user')) s.userId = req.get('x-test-user');
  req.session = s;
  req.session.destroy = (cb) => cb && cb();
  next();
});
app.use('/api/auth', authRouter);
app.use('/api/practice', practiceRouter);
app.use('/api/game', gameRouter);
app.use('/api/words', wordsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { body, as } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(as ? { 'x-test-user': String(as) } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/* ── 1. 建帳號，沒有密碼 ───────────────────────────────── */
console.log('1) 沒有密碼的帳號');
let brother = null;
let sister = null;
{
  const a = await call('POST', '/api/auth/register', { body: { nickname: '哥哥' } });
  check('只給名字就建得起來', a.status === 201, `${a.status} ${a.body?.error || ''}`);
  check('沒有回傳任何密碼欄位', a.body?.user && !('pinHash' in a.body.user),
    Object.keys(a.body?.user || {}).join(','));
  brother = a.body.user._id;

  const b = await call('POST', '/api/auth/register', { body: { nickname: '妹妹' } });
  check('第二個帳號也建得起來', b.status === 201, String(b.status));
  sister = b.body.user._id;

  const dup = await call('POST', '/api/auth/register', { body: { nickname: '哥哥' } });
  check('同名要擋下來', dup.status === 409, `${dup.status} ${dup.body?.error || ''}`);

  const login = await call('POST', '/api/auth/login', { body: { nickname: '哥哥' } });
  check('選帳號不用輸入任何密碼', login.status === 200, `${login.status} ${login.body?.error || ''}`);

  const missing = await call('POST', '/api/auth/login', { body: { nickname: '不存在的人' } });
  check('沒有這個帳號要說清楚', missing.status === 404, String(missing.status));

  const list = await call('GET', '/api/auth/profiles');
  check('清單上有兩個帳號', list.body.profiles.length === 2,
    list.body.profiles.map((p) => p.nickname).join('、'));
}

/* ── 2~4. 解鎖：練完兩次才能玩 ───────────────────────────── */
console.log('\n2) 新帳號每一組都是鎖的');
const GROUP = 'w18'; // 14 個字，測試打得完
const GROUP_SIZE = wordBank.wordsByGroup(GROUP).length;
/*
 * 門檻本來是「練兩次」，家長試玩後改成「練一次」（2026-09）：兩兄弟的語感
 * 練一次就夠了，沒記住的字在遊戲裡被扣分很快就記得了。
 * 這裡照伺服器的常數測，不寫死數字——下次再調不必回來改測試。
 */
const UNLOCK = require('../server/models/GroupProgress.js').UNLOCK_AFTER_COMPLETIONS;
{
  const access = await call('GET', `/api/game/access?group=${GROUP}`, { as: brother });
  check('遊戲端說還沒解鎖', access.body.unlocked === false, JSON.stringify(access.body.unlocked));
  check(`還要練 ${UNLOCK} 次`, access.body.completionsNeeded === UNLOCK, String(access.body.completionsNeeded));

  const prog = await call('GET', '/api/practice/progress', { as: brother });
  check('練習端也是鎖的', !prog.body.progress[GROUP]?.unlocked, JSON.stringify(prog.body.progress[GROUP]));
  check('兩邊講同一個門檻', prog.body.unlockAfter === UNLOCK, String(prog.body.unlockAfter));
  check('門檻是「練一次」', UNLOCK === 1, String(UNLOCK));
}

async function completeGroup(userId, opId, answered = GROUP_SIZE) {
  return call('POST', '/api/practice/group-complete', {
    as: userId,
    body: { opId, groupId: GROUP, answered }
  });
}

console.log('\n3) 練完一次就解鎖');
{
  const r = await completeGroup(brother, 'op-1');
  check('記下來了', r.status === 200, `${r.status} ${r.body?.error || ''}`);
  check('練習次數是 1', r.body.progress.practiceCompletions === 1, String(r.body.progress.practiceCompletions));
  check('解鎖了', r.body.progress.unlocked === true, String(r.body.progress.unlocked));

  const access = await call('GET', `/api/game/access?group=${GROUP}`, { as: brother });
  check('遊戲端也說可以玩了', access.body.unlocked === true, String(access.body.unlocked));
  check('還差 0 次', access.body.completionsNeeded === 0, String(access.body.completionsNeeded));
}

console.log('\n4) 解鎖之後再練，次數照記、也不會又鎖回去');
{
  const r = await completeGroup(brother, 'op-2');
  check('練習次數是 2', r.body.progress.practiceCompletions === 2, String(r.body.progress.practiceCompletions));
  check('還是解鎖的', r.body.progress.unlocked === true, String(r.body.progress.unlocked));
}

/* ── 5. 沒做完不算 ───────────────────────────────────────── */
console.log('\n5) 沒把整組做完不算練過一次');
{
  const before = store.groupProgress.find((r) => r.groupId === 'w17' && String(r.userId) === String(sister));
  const r = await call('POST', '/api/practice/group-complete', {
    as: sister,
    body: { opId: 'op-partial', groupId: 'w17', answered: 3 }
  });
  check('被擋下來', r.status === 400, `${r.status} ${r.body?.error || ''}`);
  check('錯誤訊息說得出要幾個字', /\d+ 個字/.test(r.body.error || ''), r.body?.error || '');
  const after = store.groupProgress.find((x) => x.groupId === 'w17' && String(x.userId) === String(sister));
  check('沒有偷偷記上去', !after || after.practiceCompletions === (before?.practiceCompletions || 0));
}

/* ── 6. 重試不能重複計數 ─────────────────────────────────── */
console.log('\n6) 背景佇列重送同一筆');
{
  const again = await completeGroup(brother, 'op-2'); // 跟前面同一個 opId
  check('伺服器認出是重送', again.body.duplicate === true, JSON.stringify(again.body.duplicate));
  check('次數沒有變成 3', again.body.progress.practiceCompletions === 2,
    String(again.body.progress.practiceCompletions));
}

/* ── 7. 進度跟著帳號走 ───────────────────────────────────── */
console.log('\n7) 哥哥練過，妹妹還是鎖的');
{
  const access = await call('GET', `/api/game/access?group=${GROUP}`, { as: sister });
  check('妹妹那一組還是鎖的', access.body.unlocked === false, String(access.body.unlocked));
  check('妹妹的練習次數是 0', access.body.practiceCompletions === 0, String(access.body.practiceCompletions));

  const prog = await call('GET', '/api/practice/progress', { as: sister });
  check('妹妹的進度表裡沒有哥哥的紀錄', !prog.body.progress[GROUP],
    JSON.stringify(prog.body.progress));
}

/* ── 8. 錄音跨帳號共用 ───────────────────────────────────── */
console.log('\n8) 錄音是跨帳號共用的');
{
  // 模擬孩子用哥哥的帳號錄了一個字
  store.wordAudio.push({ wordId: 'w06-loose', gridfsFileId: 'fake-file', mimeType: 'audio/webm' });

  const asBrother = await call('GET', '/api/words/recorded', { as: brother });
  const asSister = await call('GET', '/api/words/recorded', { as: sister });
  check('哥哥聽得到', asBrother.body.wordIds.includes('w06-loose'), asBrother.body.wordIds.join(','));
  check('妹妹也聽得到（同一份錄音）', asSister.body.wordIds.includes('w06-loose'),
    asSister.body.wordIds.join(','));
  check(
    '錄音資料不帶帳號（所以本來就不可能分帳號）',
    store.wordAudio.every((d) => !('userId' in d)),
    Object.keys(store.wordAudio[0]).join(',')
  );
}

/* ── 9. 分數各記各的 ─────────────────────────────────────── */
console.log('\n9) 分數記在各自的帳號底下');
{
  const r = await call('POST', '/api/game/result', {
    as: brother,
    body: { opId: 'game-1', groupId: GROUP, score: 240, accuracy: 0.92, won: true, wordsKilled: 14 }
  });
  check('記下來了', r.status === 200, `${r.status} ${r.body?.error || ''}`);
  check('最高分是 240', r.body.progress.bestScore === 240, String(r.body.progress.bestScore));
  check('玩了 1 場', r.body.progress.gamesPlayed === 1, String(r.body.progress.gamesPlayed));

  const dup = await call('POST', '/api/game/result', {
    as: brother,
    body: { opId: 'game-1', groupId: GROUP, score: 240, accuracy: 0.92, won: true }
  });
  check('重送不會被加兩次', dup.body.duplicate === true && dup.body.progress.gamesPlayed === 1,
    `duplicate=${dup.body.duplicate} games=${dup.body.progress.gamesPlayed}`);

  const low = await call('POST', '/api/game/result', {
    as: brother,
    body: { opId: 'game-2', groupId: GROUP, score: 100, accuracy: 0.5, won: false }
  });
  check('打得比較差不會把最高分蓋掉', low.body.progress.bestScore === 240,
    String(low.body.progress.bestScore));
  check('累積分數是兩場相加', low.body.progress.totalScore === 340,
    String(low.body.progress.totalScore));

  const crazy = await call('POST', '/api/game/result', {
    as: brother,
    body: { opId: 'game-3', groupId: GROUP, score: 99999999, accuracy: 7, won: true }
  });
  check('離譜的分數會被夾住', crazy.body.progress.bestScore < 99999999,
    String(crazy.body.progress.bestScore));
  check('正確率不會超過 100%', crazy.body.progress.bestAccuracy <= 1,
    String(crazy.body.progress.bestAccuracy));

  const sisterScores = await call('GET', '/api/game/scores', { as: sister });
  check('妹妹的分數還是 0', sisterScores.body.totals.totalScore === 0,
    JSON.stringify(sisterScores.body.totals));
}

/* ── 9.5 經驗值也是各記各的，而且由伺服器說了算（C2） ───── */
console.log('\n9.5) 等級與經驗');
{
  const { xpForBattle, levelFromXp } = await import('../public/js/shared/levels.js');
  const wordBank = require('../server/data/word-bank.js');
  const groupSize = wordBank.wordsByGroup(GROUP).length;

  const before = await call('GET', `/api/game/access?group=${GROUP}`, { as: sister });
  check('開場是 1 級', before.body.level === 1, `Lv${before.body.level}`);
  check('access 會帶重學名單下來（新帳號是空的）',
    Array.isArray(before.body.relearnIds) && before.body.relearnIds.length === 0,
    JSON.stringify(before.body.relearnIds));

  const body = {
    opId: 'xp-1', groupId: GROUP, score: 100, accuracy: 1, won: true,
    wordsKilled: groupSize, wordsMissed: 0,
    correctLetters: 40, wrongLetters: 0, longKills: 2, relearns: 0
  };
  const r = await call('POST', '/api/game/result', { as: sister, body });
  const expected = xpForBattle({
    correctLetters: 40, kills: groupSize, longKills: 2, relearns: 0,
    wordCount: groupSize, won: true, perfect: true
  });
  check('伺服器算出來的經驗跟共用公式一致', r.body.xpGained === expected,
    `${r.body.xpGained} vs ${expected}`);
  check('等級跟著累計經驗走', r.body.level === levelFromXp(r.body.xp).level,
    `Lv${r.body.level}、${r.body.xp} XP`);

  /*
   * 重學數要被夾住。
   *
   * 那是五倍經驗的來源：不夾的話，前端送一個 relearns: 9999 就能一次升到破表。
   * 這個帳號的名單是空的，所以上限是 0。
   */
  const cheatRelearn = await call('POST', '/api/game/result', {
    as: sister,
    body: { ...body, opId: 'xp-cheat-relearn', relearns: 9999 }
  });
  check('灌水的重學數會被夾成 0（名單是空的）',
    cheatRelearn.body.xpGained === expected,
    `${cheatRelearn.body.xpGained} vs ${expected}`);

  /*
   * 字母數也要夾，但夾的上限是「整組所有字母的長度」，不是這一場打了幾個。
   * 所以灌水之後經驗會變多——只是不會變成無限大。
   * （第一版把兩個夾在同一次請求裡測，結果分不出是哪一個在動。）
   */
  const maxLetters = wordBank
    .wordsByGroup(GROUP)
    .reduce((a, w) => a + String(w.english || '').length, 0);
  const ceiling = xpForBattle({
    correctLetters: maxLetters, kills: groupSize, longKills: 2, relearns: 0,
    wordCount: groupSize, won: true, perfect: true
  });
  const cheatLetters = await call('POST', '/api/game/result', {
    as: sister,
    body: { ...body, opId: 'xp-cheat-letters', correctLetters: 999999 }
  });
  check('灌水的字母數會被夾到整組的字母總長',
    cheatLetters.body.xpGained === ceiling,
    `${cheatLetters.body.xpGained} vs 上限 ${ceiling}（整組 ${maxLetters} 個字母）`);

  // 重送同一場不可以再加一次經驗
  const beforeDup = cheatLetters.body.xp;
  const dup = await call('POST', '/api/game/result', { as: sister, body });
  check('重送不會再加一次經驗', dup.body.duplicate === true, JSON.stringify(dup.body.duplicate));
  const after = await call('GET', `/api/game/access?group=${GROUP}`, { as: sister });
  check('重送之後累計經驗沒變', after.body.xp === beforeDup, `${beforeDup} → ${after.body.xp}`);
}

/* ── 10. 刪帳號 ─────────────────────────────────────────── */
console.log('\n10) 刪帳號');
{
  const wrong = await call('DELETE', `/api/auth/profiles/${brother}`, {
    body: { confirmNickname: '哥' }
  });
  check('名字打錯不刪', wrong.status === 400, `${wrong.status} ${wrong.body?.error || ''}`);
  check('帳號還在', store.users.some((u) => String(u._id) === String(brother)));

  const audioBefore = store.wordAudio.length;
  const ok = await call('DELETE', `/api/auth/profiles/${brother}`, {
    body: { confirmNickname: '哥哥' }
  });
  check('名字打對就刪掉了', ok.status === 200, `${ok.status} ${ok.body?.error || ''}`);
  check('帳號不見了', !store.users.some((u) => String(u._id) === String(brother)));
  check('他的解鎖進度清掉了',
    !store.groupProgress.some((r) => String(r.userId) === String(brother)),
    `${store.groupProgress.length} 列`);
  check('他的遊戲成績清掉了',
    !store.gameResults.some((r) => String(r.userId) === String(brother)));
  check('他的練習完成紀錄清掉了',
    !store.groupCompletions.some((r) => String(r.userId) === String(brother)));

  /*
   * 這一條是整段最重要的。
   * 錄音是孩子自己錄的，跨帳號共用；刪掉一個帳號就把它一起刪掉的話，
   * 那些聲音再也回不來，而且沒有任何錯誤訊息——只有孩子發現「又變回機器音」。
   */
  check('錄音沒有跟著被刪掉', store.wordAudio.length === audioBefore,
    `${audioBefore} → ${store.wordAudio.length}`);

  const stillThere = await call('GET', '/api/words/recorded', { as: sister });
  check('妹妹還聽得到那個錄音', stillThere.body.wordIds.includes('w06-loose'),
    stillThere.body.wordIds.join(','));

  check('妹妹的帳號沒有被波及', store.users.some((u) => String(u._id) === String(sister)));
}

server.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
