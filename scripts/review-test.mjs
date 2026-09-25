/**
 * C4：複習關、個人弱點章，以及它們需要的那兩條管線。
 *
 * ── 做 C4 之前先發現的兩件事 ────────────────────────────────
 * 1. **戰役打完什麼都沒記。** 遊戲頁回報成績的第一行是 `if (!group) return`，
 *    而戰役的網址是 ?level=N、沒有 group。經驗、蜂蜜都沒進帳，戰鬥中經驗條
 *    照樣在漲，重新整理之後就不見了。
 * 2. **戰役裡他永遠是 1 級、全裸。** 等級、裝備、重學名單都從 /api/game/access
 *    來，而那一支沒有組別就不問了。存錢買的裝備在戰役裡沒有作用。
 * 3. 以及 C4 本身需要的：**遊戲模式從來沒把「哪個字打對、哪個字打錯」寫進
 *    精熟度**，只有練習模式有。第 4 章與複習關都從精熟度撈題目——不接上的話，
 *    他在遊戲裡把一個字打對一百次，那個字還是永遠在複習關裡。
 *
 * ── 這一支證明的事 ─────────────────────────────────────────
 *   1. 戰鬥核心記得每個字打得怎樣（乾淨／有錯／漏掉，取最差）
 *   2. 複習關 ×3：前端與伺服器算出來的經驗一分不差（輸贏都算）
 *   3. 戰役關卡的成績會記、鎖著的關卡不行
 *   4. 遊戲的結果寫進精熟度，但**畫面上顯示著的字不算**（那是抄）
 *   5. 複習關：剛打錯的字馬上出現；打對了就離開；×3 只給真的弱點字；
 *      兩兄弟的弱點字不會混在一起
 *   6. 第 4 章的題目是他自己最弱的字，不夠的補滿
 *   7. 真的在瀏覽器裡打完一關戰役，伺服器真的收到了（這一條擋的是第 1 件事）
 *
 * 用法：node scripts/review-test.mjs（自己起伺服器）
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const { createBattle, applyAction, stepBattle, clearEvents, fingerprint, EV } = await import(
  '../public/js/game/core/battle.js'
);
const { createRecorder, recordAction, replayLog } = await import('../public/js/game/core/recorder.js');
const { xpForBattle, XP } = await import('../public/js/shared/levels.js');

const WORDS = [
  { id: 'a', english: 'elephant' },
  { id: 'b', english: 'cat' },
  { id: 'c', english: 'dog' }
];

/**
 * 打一場。plan[i] 決定第 i 個遇到的字怎麼打：
 *   'clean' 全對　'typo' 先打錯一個字母再打完　'miss' 什麼都不打讓它走到蜂巢
 * 走完 plan 之後剩下的都打乾淨。
 */
function play({ plan = [], words = WORDS, xpFactor = 1, hp } = {}) {
  const st = createBattle({ words, seed: 7, difficulty: 'easy', order: 'sequential', xpFactor, maxHp: hp });
  const events = [];
  // 第幾次「有一個字冒出來」——漏掉的字排回隊伍尾端再出現，也算新的一次
  let appearance = 0;
  const drain = () => {
    for (let i = 0; i < st.evCount; i += 1) {
      events.push(st.ev[i].type);
      if (st.ev[i].type === EV.WORD_START) appearance += 1;
    }
    clearEvents(st);
  };
  drain();
  let guard = 0;
  while (st.status === 'running' && guard++ < 400000) {
    const how = plan[appearance - 1] || 'clean';
    const ch = st.target[st.typed];
    if (how === 'miss') stepBattle(st);
    else if (how === 'typo' && st.typed === 0 && st.cleanWord) applyAction(st, { kind: 'letter', ch: ch === 'q' ? 'z' : 'q' });
    else if (ch) applyAction(st, { kind: 'letter', ch });
    else stepBattle(st);
    drain();
  }
  return { st, events };
}

function serverXp(st) {
  const s = st.stats;
  return xpForBattle({
    correctLetters: s.correctLetters,
    kills: s.wordsKilled,
    longKills: s.longKills,
    relearns: s.relearns,
    wordCount: st.words.length,
    won: st.status === 'won',
    perfect: st.status === 'won' && s.wordsMissed === 0 && s.wrongLetters === 0,
    longWordFactor: st.gear.longWordFactor,
    xpFactor: st.xpFactor
  });
}

/* ── 1. 核心記得每個字 ─────────────────────────────────── */
console.log('1) 戰鬥核心記得每個字打得怎樣');
{
  const { st } = play({ plan: ['clean', 'typo', 'miss'], hp: 5 });
  check('乾淨打完 → 1', st.wordOutcome[0] === 1, String(st.wordOutcome[0]));
  check('打完但有打錯 → 2', st.wordOutcome[1] === 2, String(st.wordOutcome[1]));
  /*
   * 漏掉的字會排回隊伍尾端再遇到一次，那一次打乾淨了——但這一場還是算「不會」：
   * 補打的時候正確拼法剛剛才亮過。
   */
  check('漏掉之後補打對 → 還是 3（取最差的那一次）', st.wordOutcome[2] === 3, String(st.wordOutcome[2]));
  check('最後打完了（漏掉的字補回來了）', st.status === 'won', st.status);
}

/* ── 2. ×3 兩邊一致 ─────────────────────────────────────── */
console.log('\n2) 複習關 ×3：前端與伺服器一分不差');
{
  const base = play({}).st;
  const tripled = play({ xpFactor: 3 });
  check('完美通關：×3 的經驗剛好是三倍', tripled.st.xp === base.xp * 3, `${base.xp} → ${tripled.st.xp}`);
  check('完美通關：前端 = 伺服器', tripled.st.xp === serverXp(tripled.st), `${tripled.st.xp} vs ${serverXp(tripled.st)}`);
  check('有發 XP_BONUS 事件（畫面要飄「複習加倍」）', tripled.events.includes(EV.XP_BONUS));

  const typo = play({ plan: ['typo'], xpFactor: 3 });
  check('有打錯的一場：前端 = 伺服器', typo.st.xp === serverXp(typo.st), `${typo.st.xp} vs ${serverXp(typo.st)}`);

  /*
   * 輸了也給 ×3：卡關的孩子去複習，打輸了還拿不到東西，那個出口就不存在了。
   */
  const lost = play({ plan: ['clean', 'miss', 'miss', 'miss', 'miss'], xpFactor: 3, hp: 1 });
  check('（前提）這一場輸了', lost.st.status === 'lost', lost.st.status);
  check('輸了也有 ×3', lost.st.xp > 0 && lost.events.includes(EV.XP_BONUS), `${lost.st.xp} XP`);
  check('輸了：前端 = 伺服器', lost.st.xp === serverXp(lost.st), `${lost.st.xp} vs ${serverXp(lost.st)}`);

  const normal = play({});
  check('一般關卡沒有倍率事件', !normal.events.includes(EV.XP_BONUS));

  // 錄影檔帶著倍率；舊錄影檔沒有這個欄位 → 1 倍
  const setup = { words: WORDS, seed: 9, difficulty: 'easy', order: 'sequential', xpFactor: 3 };
  const log = createRecorder({ ...setup, wordIds: WORDS.map((w) => w.id) });
  const live = createBattle(setup);
  let guard = 0;
  while (live.status === 'running' && guard++ < 200000) {
    const ch = live.target[live.typed];
    if (ch) { recordAction(log, live.tick, { kind: 'letter', ch }); applyAction(live, { kind: 'letter', ch }); }
    else { stepBattle(live); }
    clearEvents(live);
  }
  const replayed = replayLog(log, WORDS);
  check('錄影檔有存倍率', log.setup.xpFactor === 3, String(log.setup.xpFactor));
  check('重播的指紋與經驗一模一樣', fingerprint(replayed) === fingerprint(live) && replayed.xp === live.xp,
    `${replayed.xp} vs ${live.xp}`);
  const old = { ...log, setup: { ...log.setup } };
  delete old.setup.xpFactor;
  check('舊錄影檔（沒有倍率）退回 1 倍', replayLog(old, WORDS).xpFactor === 1);
}

/* ── 起真的伺服器 ─────────────────────────────────────────── */
const { SHOP_ITEMS } = require('../server/data/shop-items.js');
const store = { shopItems: SHOP_ITEMS.map((i) => ({ ...i })) };
installFakeDb(createFakeDb(store, {
  uniqueIndexes: {
    gameResults: ['userId', 'opId'],
    campaignProgress: ['userId'],
    wordProgress: ['userId', 'wordId']
  }
}));
const PORT = 7000 + Math.floor(Math.random() * 1000);
process.env.PORT = String(PORT);
const realLog = console.log;
const realErr = console.error;
console.log = () => {};
console.error = () => {};
require('../server/index.js');
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i += 1) {
  if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}
console.log = realLog;
console.error = realErr;
// 伺服器會吞掉未捕捉的例外（網站不能整個掛）；測試要接回來，不然卡住不會結束
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
const bail = (err) => {
  console.log(`  [FAIL] 測試中途出錯 — ${err && err.message ? err.message.split('\n')[0] : err}`);
  console.log('\n測試中途出錯');
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const wordBank = require('../server/data/word-bank.js');

async function register(nickname, wordBankId) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, wordBankId })
  });
  const body = await r.json();
  return { cookie: r.headers.get('set-cookie').split(';')[0], id: String(body.user._id) };
}
const userRow = (id) => store.users.find((u) => String(u._id) === id);
const progressOf = (id, wordId) =>
  (store.wordProgress || []).find((r) => String(r.userId) === id && r.wordId === wordId);
async function api(cookie, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
let op = 0;
const nextOp = () => `op-${++op}`;

const pierce = await register('Pierce', 'g3a');
const allen = await register('Allen', 'allen');
const w01 = wordBank.wordsByGroup('w01').map((w) => w.id);

/* ── 3. 戰役的成績會記 ─────────────────────────────────── */
console.log('\n3) 戰役關卡的成績會記下來');
{
  const before = { xp: userRow(pierce.id).xp || 0, honey: userRow(pierce.id).honey || 0 };
  const words = w01.slice(0, 3).map((id) => ({ id, outcome: 1, shown: false }));
  const r = await api(pierce.cookie, 'POST', '/game/result', {
    opId: nextOp(), level: 1, words, score: 90, accuracy: 1, won: false,
    wordsKilled: 3, wordsMissed: 0, correctLetters: 12, wrongLetters: 0, longKills: 0, relearns: 0
  });
  check('收下了', r.status === 200, `${r.status} ${r.body.error || ''}`);
  check('經驗有進帳', (userRow(pierce.id).xp || 0) > before.xp, `${before.xp} → ${userRow(pierce.id).xp}`);
  check('蜂蜜有進帳', (userRow(pierce.id).honey || 0) === before.honey + 90, String(userRow(pierce.id).honey));
  check('成績記成「戰役關卡」', store.gameResults.at(-1).mode === 'level' && store.gameResults.at(-1).level === 1);

  const locked = await api(pierce.cookie, 'POST', '/game/result', {
    opId: nextOp(), level: 5, words, score: 90, won: true, wordsKilled: 3
  });
  check('鎖著的關卡不收（不然改個關號就能刷）', locked.status === 403, String(locked.status));

  const foreign = await api(pierce.cookie, 'POST', '/game/result', {
    opId: nextOp(), level: 1, words: [{ id: 'a-p1-acquaint', outcome: 1 }], score: 10, wordsKilled: 1
  });
  check('不屬於這一關的字會被丟掉（一個都不剩就不收）', foreign.status === 400, String(foreign.status));

  const access = await api(pierce.cookie, 'GET', '/game/access');
  check('沒有組別也問得到等級與裝備（戰役裡他不再是 1 級全裸）',
    access.status === 200 && typeof access.body.level === 'number' && !!access.body.equipped,
    `${access.status} Lv${access.body.level}`);
}

/* ── 4. 遊戲的結果寫進精熟度 ─────────────────────────────── */
console.log('\n4) 遊戲的結果寫進精熟度（顯示著的字不算）');
const [wClean, wTypo, wMiss, wShown] = w01.slice(3, 7);
{
  const r = await api(pierce.cookie, 'POST', '/game/result', {
    opId: nextOp(), groupId: 'w01', score: 40, accuracy: 0.9, won: false,
    words: [
      { id: wClean, outcome: 1, shown: false },
      { id: wTypo, outcome: 2, shown: false },
      { id: wMiss, outcome: 3, shown: false },
      { id: wShown, outcome: 1, shown: true }
    ],
    wordsKilled: 2, wordsMissed: 1, correctLetters: 10, wrongLetters: 1
  });
  check('收下了', r.status === 200, `${r.status} ${r.body.error || ''}`);
  check('乾淨打完 → 記成答對', progressOf(pierce.id, wClean)?.lastResult === 'correct');
  check('有打錯 → 記成答錯（跟練習模式同一個標準）', progressOf(pierce.id, wTypo)?.lastResult === 'incorrect');
  check('漏掉 → 記成答錯', progressOf(pierce.id, wMiss)?.lastResult === 'incorrect');
  /*
   * 畫面上顯示著這個字的時候打對，是照著抄，不代表會拼。
   * 記成「答對」的話，他開著「顯示單字」玩一輪，全部的字都會被當成學會了。
   */
  check('畫面上顯示著的字 → 不記', !progressOf(pierce.id, wShown));
  check('伺服器說它記了幾個', r.body.masteryRecorded === 3, String(r.body.masteryRecorded));
}

/* ── 5. 複習關 ──────────────────────────────────────────── */
console.log('\n5) 複習關');
{
  const map = await api(pierce.cookie, 'GET', '/campaign');
  /*
   * 剛打錯的字要**馬上**出現在複習關。它們在第 0 格，照間隔要 10 分鐘後才到期——
   * 照時間算的話，他剛卡關回到地圖，複習關卻說「沒有要複習的字」。
   */
  check('剛打錯的兩個字馬上就在複習關裡', map.body.review?.count === 2, JSON.stringify(map.body.review));
  check('地圖寫出經驗倍率', map.body.review?.xpFactor === XP.reviewFactor);

  const rv = await api(pierce.cookie, 'GET', '/campaign/review');
  check('題目就是那兩個字', rv.status === 200 && [wTypo, wMiss].every((id) => rv.body.wordIds.includes(id))
    && rv.body.wordIds.length === 2, JSON.stringify(rv.body.wordIds));
  check('答對過的字不在複習關', !rv.body.wordIds?.includes(wClean));

  // ×3 只給真的弱點字
  const stats = { score: 20, accuracy: 1, won: true, wordsKilled: 2, wordsMissed: 0, correctLetters: 8, wrongLetters: 0 };
  const xpBefore = userRow(pierce.id).xp;
  const done = await api(pierce.cookie, 'POST', '/game/result', {
    opId: nextOp(), review: true, ...stats,
    words: [{ id: wTypo, outcome: 1, shown: false }, { id: wMiss, outcome: 1, shown: false }]
  });
  check('複習關收下了', done.status === 200, `${done.status} ${done.body.error || ''}`);
  check('伺服器套了 ×3', done.body.xpFactor === 3, String(done.body.xpFactor));
  const expect = xpForBattle({ correctLetters: 8, kills: 2, longKills: 0, relearns: 0, wordCount: 2, won: true,
    perfect: true, longWordFactor: 1, xpFactor: 3 });
  check('經驗 = 同一條公式 ×3', done.body.xpGained === expect && userRow(pierce.id).xp === xpBefore + expect,
    `${done.body.xpGained} vs ${expect}`);

  const cheat = await api(pierce.cookie, 'POST', '/game/result', {
    opId: nextOp(), review: true, ...stats, words: [{ id: w01[10], outcome: 1, shown: false }]
  });
  check('不是弱點字就不給 ×3（送 review: true 加隨便幾個字沒用）', cheat.status === 400, String(cheat.status));

  /*
   * 打對了就離開複習關。這是他看得懂的因果：「我把它打對了，它就不用再複習了」。
   */
  const after = await api(pierce.cookie, 'GET', '/campaign');
  check('打對之後，兩個字都離開了複習關', after.body.review?.count === 0, JSON.stringify(after.body.review));
  const empty = await api(pierce.cookie, 'GET', '/campaign/review');
  check('沒有要複習的字 → 講成好消息', empty.status === 404 && (empty.body.error || '').includes('太棒'),
    empty.body.error);

  // Allen 的複習關不會出現 Pierce 的字
  const aMap = await api(allen.cookie, 'GET', '/campaign');
  check('Allen 的複習關是空的（Pierce 打錯的字不會跑到他那邊）', aMap.body.review?.count === 0,
    JSON.stringify(aMap.body.review));
}

/* ── 6. 第 4 章 ──────────────────────────────────────────── */
console.log('\n6) 第 4 章：題目是他自己最弱的字');
{
  // 直接把進度推到第 75 關，並讓幾個字變成弱點
  store.campaignProgress = store.campaignProgress || [];
  const row = store.campaignProgress.find((r) => String(r.userId) === pierce.id);
  if (row) row.highestCleared = 75;
  else store.campaignProgress.push({ userId: userRow(pierce.id)._id, highestCleared: 75, stars: {} });

  const weak = wordBank.wordsByGroup('w12').slice(0, 4).map((w) => w.id);
  await api(pierce.cookie, 'POST', '/game/result', {
    opId: nextOp(), groupId: 'w12', score: 0, won: false, wordsKilled: 0, wordsMissed: 4,
    words: weak.map((id) => ({ id, outcome: 3, shown: false }))
  });

  const lv = await api(pierce.cookie, 'GET', '/campaign/level/76');
  check('第 76 關打得開', lv.status === 200, `${lv.status} ${lv.body.error || ''}`);
  check('這一關是弱點章', lv.body.level?.weakness === true);
  check('他的弱點字排在最前面', weak.every((id) => lv.body.wordIds.slice(0, 4).includes(id)),
    lv.body.wordIds?.slice(0, 4).join(', '));
  /*
   * 不是 4：上面第 5 節在複習關打對的兩個字，從第 0 格升到第 1 格——
   * 它們離開了複習關（還沒到期），但還沒學會，所以仍然算弱點。
   * 複習關看「現在該不該複習」，第 4 章看「會不會」，兩個問題不一樣。
   * 期望值照規則從資料算，不寫死。
   */
  const expectedWeak = (store.wordProgress || []).filter((r) => String(r.userId) === pierce.id
    && (r.timesIncorrect || 0) > 0 && (r.boxLevel || 0) < 4).length;
  check('寫出有幾個是他的弱點字（答錯過、還沒學會的全部）', lv.body.level?.weakCount === expectedWeak,
    `${lv.body.level?.weakCount} / ${expectedWeak}`);
  check('剛打錯的（第 0 格）排在剛打對一次的（第 1 格）前面',
    weak.every((id) => lv.body.wordIds.slice(0, 4).includes(id))
      && lv.body.wordIds.slice(4, 6).every((id) => [wTypo, wMiss].includes(id)),
    lv.body.wordIds?.slice(0, 6).join(', '));
  check('不夠的補滿，不會只有 4 個字', lv.body.wordIds.length > 4, `${lv.body.wordIds.length} 字`);
  check('不是「還沒有弱點字」', lv.body.level?.weaknessPending === false);
}

/* ── 7. 真的在瀏覽器裡打一關戰役 ─────────────────────────── */
/*
 * 這一條擋的是「戰役打完什麼都沒記」。那個 bug 的程式碼在遊戲頁
 * （`if (!group) return`），只測伺服器是抓不到的——伺服器那邊一直都是好的，
 * 是遊戲頁根本沒送。
 */
console.log('\n7) 在瀏覽器裡真的打完第 1 關，伺服器真的收到');
{
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const [n, v] = pierce.cookie.split('=');
  await ctx.addCookies([{ name: n, value: v, url: BASE }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const resultsBefore = store.gameResults.length;
  const xpBefore = userRow(pierce.id).xp;
  await page.goto(`${BASE}/game?level=1&n=2&difficulty=easy&order=sequential&show=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  const lvl = await page.evaluate(() => window.__spellbee.state().level);
  check('開場的等級是他真正的等級（不是 1 級）', lvl > 1, `Lv${lvl}`);

  for (let i = 0; i < 2; i += 1) {
    const target = await page.evaluate(() => window.__spellbee.state().target);
    await page.keyboard.type(target, { delay: 40 });
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.__spellbee.state().status === 'won', null, { timeout: 10000 }).catch(() => {});
  // 等回報送到
  for (let i = 0; i < 50 && store.gameResults.length === resultsBefore; i += 1) await page.waitForTimeout(100);

  const got = store.gameResults.slice(resultsBefore);
  check('伺服器收到這一場', got.length === 1, `${got.length} 筆`);
  check('記成第 1 關', got[0]?.mode === 'level' && got[0]?.level === 1, JSON.stringify({ mode: got[0]?.mode, level: got[0]?.level }));
  check('經驗真的進帳了（重新整理也不會不見）', userRow(pierce.id).xp > xpBefore, `${xpBefore} → ${userRow(pierce.id).xp}`);
  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));

  // 地圖上的複習入口
  await page.goto(`${BASE}/campaign.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.review-card', { timeout: 10000 }).catch(() => {});
  const card = await page.$eval('.review-card', (e) => ({ text: e.innerText, link: e.getAttribute('href') }))
    .catch(() => null);
  check('地圖上有複習關的入口', !!card, card ? card.text.replace(/\s+/g, ' ') : '（沒有）');
  check('有要複習的字時，它是一個連得過去的入口', card?.link === '/game?review=1', String(card?.link));

  await browser.close();
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
