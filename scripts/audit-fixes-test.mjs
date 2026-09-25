/**
 * 兩週實測前整體檢查找到的問題，每一個都要有一條測試釘住。
 *
 *   1. 練習頁的「複習 N 個」只算自己那一本（Allen 帳號裡有 Pierce 課本的舊紀錄）
 *   2. 練完一組：別本課本的組不算
 *   3. 同時買兩件造型、錢只夠一件：只會買到一件，金幣不會變負的
 *   4. JSON 壞掉回 400 而不是 500（500 會讓背景佇列一直重送、卡住後面的作答）；
 *      大一點的錄影檔不會被 body 上限擋掉
 *   5. ⭐ 打完一場剛好網路不通：成績與過關排進背景佇列，之後補送成功，
 *      而且用的是同一個 opId（伺服器其實收到過的話不會加兩次）
 *
 * 用法：node scripts/audit-fixes-test.mjs（自己起伺服器）
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

const { SHOP_ITEMS } = require('../server/data/shop-items.js');
const store = { shopItems: SHOP_ITEMS.map((i) => ({ ...i })) };
installFakeDb(createFakeDb(store, {
  uniqueIndexes: {
    purchases: ['userId', 'opId'],
    attempts: ['userId', 'opId'],
    groupCompletions: ['userId', 'opId'],
    gameResults: ['userId', 'opId'],
    battleLogs: ['userId', 'opId'],
    eventBatches: ['userId', 'opId'],
    campaignProgress: ['userId']
  }
}));
const PORT = 9000 + Math.floor(Math.random() * 900);
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
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
const bail = (err) => {
  console.log(`  [FAIL] 測試中途出錯 — ${err && err.message ? err.message.split('\n')[0] : err}`);
  console.log('\n測試中途出錯');
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

async function register(nickname, wordBankId) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, wordBankId })
  });
  const body = await r.json();
  return { cookie: r.headers.get('set-cookie').split(';')[0], id: String(body.user._id) };
}
async function api(cookie, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const userRow = (id) => store.users.find((u) => String(u._id) === id);

const pierce = await register('Pierce', 'g3a');
const allen = await register('Allen', 'allen');

/* ── 1. 複習只算自己那一本 ───────────────────────────────── */
console.log('1) 練習頁的複習只算自己那一本');
{
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const _id = userRow(allen.id)._id;
  store.wordProgress = store.wordProgress || [];
  // Pierce 課本的字排在前面（比較早到期）：舊寫法會把 Allen 自己的字擠掉或算錯
  for (const wordId of ['p1-account', 'p1-addition']) {
    store.wordProgress.push({ userId: _id, wordId, boxLevel: 0, timesIncorrect: 1, nextReviewAt: new Date(past - 1000) });
  }
  store.wordProgress.push({ userId: _id, wordId: 'a-p1-acquaint', boxLevel: 0, timesIncorrect: 1, nextReviewAt: past });

  const q = await api(allen.cookie, 'GET', '/practice/review-queue');
  const ids = (q.body.words || []).map((w) => w._id);
  check('複習數量只算 Allen 的字', ids.length === 1 && ids[0] === 'a-p1-acquaint', JSON.stringify(ids));
  const s = await api(allen.cookie, 'POST', '/practice/session', { reviewOnly: true });
  check('按下複習，拿到的就是那一個字', s.status === 201 && s.body.words?.length === 1 && s.body.words[0]._id === 'a-p1-acquaint',
    `${s.status} ${JSON.stringify((s.body.words || []).map((w) => w._id))}`);
}

/* ── 2. 練完別本的組不算 ─────────────────────────────────── */
console.log('\n2) 練完一組：別本課本的組不算');
{
  const r = await api(allen.cookie, 'POST', '/practice/group-complete', { opId: 'gc-1', groupId: 'p1', answered: 99 });
  check('Pierce 課本的組擋掉', r.status === 404, String(r.status));
  const ok = await api(allen.cookie, 'POST', '/practice/group-complete', { opId: 'gc-2', groupId: 'a-p1', answered: 99 });
  check('自己課本的組照常算', ok.status === 200 && ok.body.progress?.practiceCompletions === 1, `${ok.status}`);
}

/* ── 3. 同時買兩件、錢只夠一件 ───────────────────────────── */
console.log('\n3) 同時買兩件、錢只夠一件');
{
  userRow(pierce.id).coins = 1000;
  const [a, b] = await Promise.all([
    api(pierce.cookie, 'POST', '/shop/purchase', { itemKey: 'accessory_sunglasses', opId: 'buy-a' }),
    api(pierce.cookie, 'POST', '/shop/purchase', { itemKey: 'accessory_cape', opId: 'buy-b' })
  ]);
  const u = userRow(pierce.id);
  check('只買到一件', (u.ownedItemKeys || []).length === 1, JSON.stringify(u.ownedItemKeys));
  check('金幣沒有變負的', u.coins >= 0, String(u.coins));
  check('買不到的那一件回 400（畫面會把先扣的錢退回來）', [a.status, b.status].sort().join(',') === '200,400', `${a.status},${b.status}`);
  const failedOp = a.status === 400 ? 'buy-a' : 'buy-b';
  check('買不到的那一筆購買紀錄撤掉了', !(store.purchases || []).some((p) => p.opId === failedOp));
}

/* ── 4. 壞掉的 JSON、大一點的錄影檔 ──────────────────────── */
console.log('\n4) 請求本身有問題時回 4xx');
{
  const r = await fetch(`${BASE}/api/practice/attempt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: pierce.cookie }, body: '{"opId": "x",'
  });
  check('JSON 壞掉回 400（不是 500，背景佇列才不會一直重送）', r.status === 400, String(r.status));
  // 150KB：超過 express 預設的 100KB、在錄影檔上限 400KB 之內
  const big = { opId: 'big-1', log: { setup: { wordIds: [] }, entries: [], pad: 'x'.repeat(150 * 1024) } };
  const b = await api(pierce.cookie, 'POST', '/telemetry/battle-log', big);
  check('150KB 的錄影檔有送到路由（不是被 body 上限擋掉）', b.status === 400 && /單字庫/.test(b.body.error || ''),
    `${b.status} ${b.body.error || ''}`);
}

/* ── 5. 打完剛好斷線 ─────────────────────────────────────── */
console.log('\n5) ⭐ 打完一場剛好網路不通');
{
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const [n, v] = pierce.cookie.split('=');
  await ctx.addCookies([{ name: n, value: v, url: BASE }]);
  const me = await api(pierce.cookie, 'GET', '/auth/me');
  await ctx.addInitScript((u) => {
    try { localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u)); } catch (e) { /* 無痕 */ }
  }, me.body.user);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  let blocked = 0;
  const block = (route) => { blocked += 1; return route.abort('internetdisconnected'); };
  await page.route('**/api/game/result', block);
  await page.route('**/api/campaign/clear', block);

  await page.goto(`${BASE}/game?level=1&n=6&difficulty=easy&order=sequential&show=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  for (let i = 0; i < 14; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') break;
    if (st.perkOffer) { await page.waitForTimeout(400); await page.keyboard.press('1'); await page.waitForTimeout(150); continue; }
    await page.keyboard.type(st.target, { delay: 30 });
    await page.waitForTimeout(150);
  }
  const won = (await page.evaluate(() => window.__spellbee.state())).status === 'won';
  check('（前提）這一場打贏了', won);

  const outboxKey = `sb:v2:u:${pierce.id}:outbox`;
  let queued = [];
  for (let i = 0; i < 80; i += 1) {
    queued = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), outboxKey);
    if (queued.filter((o) => o.kind === 'battle-report').length >= 2) break;
    await page.waitForTimeout(200);
  }
  const res = queued.find((o) => o.path === '/game/result');
  const clr = queued.find((o) => o.path === '/campaign/clear');
  check('先重試了幾次才放棄', blocked >= 6, `擋了 ${blocked} 次`);
  check('成績排進背景佇列', !!res);
  check('過關排進背景佇列', !!clr);
  check('排進去的用的是同一個 opId（不是佇列自己發的新號碼）', !!res && res.opId === res.body.opId && /:/.test(res.opId),
    res && `${res.opId} / ${res.body.opId}`);
  check('伺服器這時候還沒有這一場', !(store.gameResults || []).length);

  // 網路恢復：打開任何一頁都會把佇列送出去
  await page.unroute('**/api/game/result');
  await page.unroute('**/api/campaign/clear');
  await page.goto(`${BASE}/shop.html`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 60 && !(store.gameResults || []).length; i += 1) await page.waitForTimeout(150);
  for (let i = 0; i < 40 && !(store.campaignProgress || []).length; i += 1) await page.waitForTimeout(150);
  const rows = (store.gameResults || []).filter((g) => String(g.userId) === pierce.id);
  check('補送之後成績進來了，只有一筆', rows.length === 1 && rows[0].opId === res?.opId, `${rows.length} 筆`);
  check('補送之後經驗也進帳了', (userRow(pierce.id).xp || 0) > 0, String(userRow(pierce.id).xp));
  const cp = (store.campaignProgress || []).find((c) => String(c.userId) === pierce.id);
  check('補送之後第 1 關算過了', cp?.highestCleared >= 1, JSON.stringify(cp?.highestCleared));
  const left = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), outboxKey);
  check('佇列清空了', left.length === 0, String(left.length));

  // 再送一次同一筆（例如回應沒傳回來、佇列又送了一次）：不會加兩次
  const xpBefore = userRow(pierce.id).xp;
  await api(pierce.cookie, 'POST', '/game/result', res.body);
  check('同一場重送不會加兩次經驗', userRow(pierce.id).xp === xpBefore);

  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await browser.close();
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
