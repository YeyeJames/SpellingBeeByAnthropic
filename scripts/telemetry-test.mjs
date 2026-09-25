/**
 * 行為紀錄與家長報告。
 *
 * 要證明的事：
 *   1. 伺服器只收白名單裡的事件、太大的內容會被丟、重送不會記兩次
 *   2. 錄影檔收到就分析：漏掉的字分成「來不及／不會拼／沒動作」；
 *      別人課本的字不收
 *   3. 報告算得出來：時間花在哪、漏字原因、三選一、小遊戲
 *   4. 下載分析檔：有資料、沒有不該有的欄位、是下載不是顯示
 *   5. ⭐ 刪帳號時行為紀錄一起刪（最不該留下來的就是這個）
 *   6. ⭐ 行為紀錄不走 outbox：它出錯的時候，練習的答案照樣同步得上去
 *   7. 瀏覽器：真的逛幾頁、真的打一場，紀錄真的進得來；報告頁畫得出來；
 *      家長看報告的時間不算在孩子頭上
 *
 * 用法：node scripts/telemetry-test.mjs（自己起伺服器）
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
    eventBatches: ['userId', 'opId'],
    battleLogs: ['userId', 'opId'],
    gameResults: ['userId', 'opId'],
    minigamePlays: ['userId', 'opId'],
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

const wordBank = require('../server/data/word-bank.js');
const { createBattle, applyAction, stepBattle, clearEvents } = await import('../public/js/game/core/battle.js');
const { createRecorder, recordAction } = await import('../public/js/game/core/recorder.js');

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
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
}
const mine = (name, id) => (store[name] || []).filter((r) => String(r.userId) === id);

const pierce = await register('Pierce', 'g3a');
const allen = await register('Allen', 'allen');

/* ── 1. 事件 ─────────────────────────────────────────────── */
console.log('1) 事件：白名單、大小、去重');
{
  const now = Date.now();
  const r = await api(pierce.cookie, 'POST', '/telemetry/events', {
    opId: 'b-1',
    events: [
      { kind: 'page_view', page: 'practice', t: now, data: {} },
      { kind: 'page_leave', page: 'practice', t: now, data: { ms: 120000 } },
      { kind: 'mouse_move', page: 'practice', t: now, data: { x: 1, y: 2 } },
      { kind: 'click', page: 'shop', t: now, data: { text: 'x'.repeat(5000) } }
    ]
  });
  check('收下了', r.status === 200, String(r.status));
  check('不在白名單的種類丟掉（沒有滑鼠座標）', mine('events', pierce.id).every((e) => e.kind !== 'mouse_move'));
  check('只留下三筆', mine('events', pierce.id).length === 3, String(mine('events', pierce.id).length));
  check('太大的內容不留（只留「發生過」）',
    mine('events', pierce.id).find((e) => e.kind === 'click')?.data?.truncated === true);
  const again = await api(pierce.cookie, 'POST', '/telemetry/events', {
    opId: 'b-1', events: [{ kind: 'page_view', page: 'practice', t: now }]
  });
  check('同一批重送不會記兩次', again.body.duplicate === true && mine('events', pierce.id).length === 3);
  const huge = Array.from({ length: 450 }, () => ({ kind: 'page_view', page: 'x', t: now }));
  await api(pierce.cookie, 'POST', '/telemetry/events', { opId: 'b-2', events: huge });
  check('一批最多 200 筆', mine('events', pierce.id).length === 3 + 200, String(mine('events', pierce.id).length));
  // 清掉，後面的報告才好驗
  store.events = (store.events || []).filter((e) => String(e.userId) !== pierce.id);
}

/* ── 2. 錄影檔 ───────────────────────────────────────────── */
console.log('\n2) 錄影檔：收到就分析');
function makeLog(words, plan) {
  const setup = { words, seed: 5, difficulty: 'normal', order: 'sequential' };
  const log = createRecorder({ ...setup, wordIds: words.map((w) => w.id) });
  const st = createBattle(setup);
  let seen = 0;
  let last = -1;
  let guard = 0;
  // 按完一定要往前走一步：真的遊戲裡兩個按鍵不會落在同一個邏輯步
  const act = (a) => { recordAction(log, st.tick, a); applyAction(st, a); stepBattle(st); };
  while (st.status === 'running' && guard++ < 300000) {
    if (st.wordIndex !== last) { last = st.wordIndex; seen += 1; }
    const how = plan[seen - 1] || 'clean';
    const ch = st.target[st.typed];
    if (how === 'slow') { if (st.typed < st.target.length - 1 && st.tick % 60 === 0) act({ kind: 'letter', ch }); else stepBattle(st); }
    else if (how === 'wrong') { if (st.tick % 50 === 0) act({ kind: 'letter', ch: 'q' }); else stepBattle(st); }
    else if (how === 'idle') stepBattle(st);
    else if (ch && st.tick % 25 === 0) act({ kind: 'letter', ch });
    else stepBattle(st);
    clearEvents(st);
  }
  return log;
}
{
  const words = wordBank.wordsByGroup('w01').slice(0, 6);
  const log = makeLog(words, ['clean', 'slow', 'wrong', 'idle', 'clean', 'clean']);
  const r = await api(pierce.cookie, 'POST', '/telemetry/battle-log', { opId: 'g-1', log });
  check('收下了', r.status === 200, `${r.status} ${r.body.error || ''}`);
  const reasons = r.body.summary?.missReasons || {};
  check('分得出「來不及」', reasons.slow >= 1, JSON.stringify(reasons));
  check('分得出「不會拼」', reasons.unknown >= 1, JSON.stringify(reasons));
  check('分得出「沒動作」', reasons.idle >= 1, JSON.stringify(reasons));
  check('算得出英打速度', typeof r.body.summary?.msPerKey === 'number' && r.body.summary.msPerKey > 0,
    `${r.body.summary?.msPerKey} 毫秒／鍵`);
  check('原始按鍵也存了（之後可以重算）', mine('battleLogs', pierce.id)[0]?.entries?.length === log.entries.length);
  const again = await api(pierce.cookie, 'POST', '/telemetry/battle-log', { opId: 'g-1', log });
  check('同一場重送不會存兩份', again.body.duplicate === true && mine('battleLogs', pierce.id).length === 1);

  const foreign = makeLog(wordBank.getBank('allen').words.slice(0, 3), []);
  const bad = await api(pierce.cookie, 'POST', '/telemetry/battle-log', { opId: 'g-2', log: foreign });
  check('別人課本的字不收', bad.status === 400, `${bad.status} ${bad.body.error || ''}`);
}

/* ── 3～4. 報告與下載 ────────────────────────────────────── */
console.log('\n3) 報告');
{
  const now = Date.now();
  await api(pierce.cookie, 'POST', '/telemetry/events', {
    opId: 'b-3',
    events: [
      { kind: 'page_leave', page: 'practice', t: now, data: { ms: 10 * 60000 } },
      { kind: 'page_leave', page: 'shop', t: now, data: { ms: 4 * 60000 } },
      { kind: 'perk_pick', page: 'game', t: now, data: { picked: 'lightning', ms: 600 } },
      { kind: 'perk_pick', page: 'game', t: now, data: { picked: 'rush', ms: 4200 } }
    ]
  });
  const rep = await api(pierce.cookie, 'GET', '/telemetry/report?days=30');
  const p = rep.body.reports?.find((x) => x.nickname === 'Pierce');
  check('每個帳號一份', rep.body.reports?.length === 2, String(rep.body.reports?.length));
  check('時間花在哪：練習 10 分、商店 4 分', p?.time.byPage.practice === 600000 && p?.time.byPage.shop === 240000,
    JSON.stringify(p?.time.byPage));
  check('漏字原因加得起來', p?.misses.slow >= 1 && p?.misses.unknown >= 1 && p?.misses.idle >= 1, JSON.stringify(p?.misses));
  check('三選一：兩次、一半是一秒內選好', p?.perks.decisions === 2 && p?.perks.fastShare === 0.5, JSON.stringify(p?.perks));
  check('英打速度一週一個點', p?.typing.length === 1 && p.typing[0].msPerKey > 0, JSON.stringify(p?.typing));
  const a = rep.body.reports?.find((x) => x.nickname === 'Allen');
  check('Allen 那一份沒有混到 Pierce 的資料', a && a.time.totalMs === 0 && a.misses.total === 0);
}

console.log('\n4) 下載分析檔');
{
  const r = await fetch(`${BASE}/api/telemetry/export?days=30`, { headers: { cookie: pierce.cookie } });
  const text = await r.text();
  const data = JSON.parse(text);
  check('是下載（附檔名）', /attachment; filename="spellbee-analysis-/.test(r.headers.get('content-disposition') || ''),
    r.headers.get('content-disposition'));
  const p = data.profiles.find((x) => x.nickname === 'Pierce');
  check('有行為紀錄與錄影檔', p?.events.length > 0 && p?.battleLogs.length === 1);
  check('沒有 session、沒有舊密碼欄位、沒有內部 id', !/pinHash|nicknameLower|"sid"|"cookie"|"userId"/.test(text));
}

/* ── 5. 刪帳號 ───────────────────────────────────────────── */
console.log('\n5) ⭐ 刪帳號時行為紀錄一起刪');
{
  const temp = await register('Temp', 'g3a');
  await api(temp.cookie, 'POST', '/telemetry/events', { opId: 't-1', events: [{ kind: 'page_view', page: 'x', t: Date.now() }] });
  await api(temp.cookie, 'POST', '/telemetry/battle-log', {
    opId: 't-g', log: makeLog(wordBank.wordsByGroup('w01').slice(0, 2), [])
  });
  check('（前提）有紀錄', mine('events', temp.id).length === 1 && mine('battleLogs', temp.id).length === 1);
  const del = await api(temp.cookie, 'DELETE', `/auth/profiles/${temp.id}`, { confirmNickname: 'Temp' });
  check('刪得掉', del.status === 200, `${del.status} ${del.body.error || ''}`);
  check('行為事件一起刪了', mine('events', temp.id).length === 0);
  check('錄影檔一起刪了', mine('battleLogs', temp.id).length === 0);
  check('批次去重紀錄一起刪了', mine('eventBatches', temp.id).length === 0);

  const dbJs = readFileSync(new URL('../server/db.js', import.meta.url), 'utf8');
  check('行為事件與錄影檔都有 90 天自動刪除的索引',
    /collection\('events'\)\.createIndex\(\{ at: 1 \}, \{ expireAfterSeconds/.test(dbJs)
    && /collection\('battleLogs'\)\.createIndex\(\{ at: 1 \}, \{ expireAfterSeconds/.test(dbJs));
}

/* ── 6. 不走 outbox ──────────────────────────────────────── */
console.log('\n6) ⭐ 行為紀錄不會卡住練習的同步');
{
  const src = readFileSync(new URL('../public/js/telemetry.js', import.meta.url), 'utf8');
  check('telemetry.js 沒有用 outbox', !/from '\.\/outbox\.js'/.test(src));
}

/* ── 7. 瀏覽器 ───────────────────────────────────────────── */
console.log('\n7) 瀏覽器：真的逛、真的打');
{
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const [n, v] = pierce.cookie.split('=');
  await ctx.addCookies([{ name: n, value: v, url: BASE }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // 登入快取要放：遊戲頁從快取認人
  const me = await api(pierce.cookie, 'GET', '/auth/me');
  await ctx.addInitScript((u) => {
    try { localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u)); } catch (e) { /* 無痕 */ }
  }, me.body.user);

  const before = mine('events', pierce.id).length;
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#part-picker .part-btn', { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.click('#part-picker .part-btn:has(.part-title:text-is("Week 1"))');
  await page.goto(`${BASE}/shop.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  for (let i = 0; i < 40 && mine('events', pierce.id).length <= before + 2; i += 1) await page.waitForTimeout(150);
  const got = mine('events', pierce.id).slice(before);
  check('練習頁的「進來」有記到', got.some((e) => e.kind === 'page_view' && e.page === 'practice'), got.map((e) => e.kind + ':' + e.page).join(','));
  check('離開練習頁時記了停多久', got.some((e) => e.kind === 'page_leave' && e.page === 'practice' && e.data.ms > 0));
  check('點了哪一組有記到', got.some((e) => e.kind === 'click' && /Week 1/.test(e.data.text || '')));

  // 打一場戰役：選卡、打完、錄影檔送上去
  const logsBefore = mine('battleLogs', pierce.id).length;
  await page.goto(`${BASE}/game?level=1&n=6&difficulty=easy&order=sequential&show=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  for (let i = 0; i < 12; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') break;
    if (st.perkOffer) { await page.waitForTimeout(400); await page.keyboard.press('1'); await page.waitForTimeout(150); continue; }
    await page.keyboard.type(st.target, { delay: 30 });
    await page.waitForTimeout(150);
  }
  for (let i = 0; i < 60 && mine('battleLogs', pierce.id).length === logsBefore; i += 1) await page.waitForTimeout(150);
  const logs = mine('battleLogs', pierce.id);
  check('打完之後錄影檔自動送上來', logs.length === logsBefore + 1, `${logsBefore} → ${logs.length}`);
  check('伺服器分析得出來（沒有錯誤）', logs.at(-1)?.summary && !logs.at(-1).summary.error && logs.at(-1).summary.status === 'won',
    JSON.stringify(logs.at(-1)?.summary?.status));
  check('錄影檔跟成績是同一個 opId（對得起來）',
    (store.gameResults || []).some((g) => g.opId === logs.at(-1)?.opId));
  // 離開遊戲頁把事件送出去
  await page.goto(`${BASE}/campaign.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const pick = mine('events', pierce.id).find((e) => e.kind === 'perk_pick');
  check('三選一記了選什麼、花多久', !!pick && typeof pick.data.ms === 'number' && pick.data.ms >= 300 && !!pick.data.picked,
    JSON.stringify(pick?.data));
  check('開打記了一筆（第幾關、速度）', mine('events', pierce.id).some((e) => e.kind === 'game_start' && e.data.level === 1 && e.data.speed > 0));

  // 報告頁
  await page.goto(`${BASE}/report.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rkid', { timeout: 10000 }).catch(() => {});
  const text = await page.evaluate(() => document.body.innerText);
  check('報告頁畫得出兩兄弟', text.includes('Pierce') && text.includes('Allen'));
  check('每一段都寫了「怎麼算的」', (text.match(/推估|中位數|只算畫面開在前面/g) || []).length >= 3);
  const reportEvents = mine('events', pierce.id).filter((e) => e.page === 'report').length;
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('家長看報告的時間不算在孩子頭上', mine('events', pierce.id).filter((e) => e.page === 'report').length === reportEvents
    && reportEvents === 0);

  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await browser.close();
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
