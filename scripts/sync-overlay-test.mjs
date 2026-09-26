/**
 * 背景同步失敗時，不能把孩子正在用的畫面蓋住（docs/audit/step3 的 N1～N3、3-A）。
 *
 * 要證明的事：
 *   1. 練習中伺服器連不上（503／網路斷一下）：「正在喚醒伺服器」那一層一次都不出現，
 *      下一題照樣按得到；連上之後答案全部補送，一筆不少、一筆不多
 *   2. 遊戲打完剛好連不上：結算畫面不會被蓋住
 *   3. 反向檢查：頁面剛打開、伺服器真的在睡覺，等待畫面**還是要出現**，醒了之後頁面照常打開
 *
 * 用法：node scripts/sync-overlay-test.mjs（自己起伺服器）
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const store = {};
installFakeDb(createFakeDb(store, {
  uniqueIndexes: { attempts: ['userId', 'opId'], gameResults: ['userId', 'opId'], eventBatches: ['userId', 'opId'], campaignProgress: ['userId'] }
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
  await sleep(100);
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

await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce' })
});
const pierceId = String(store.users[0]._id);
const attempts = () => (store.attempts || []).length;

const browser = await chromium.launch({ executablePath: CHROME });
const down = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"資料庫尚未連線"}' });

async function newPage() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  return { ctx, page, errs };
}
async function login(page) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.profile-tile', { timeout: 10000 });
  await page.click('.profile-tile:has-text("Pierce")');
  await page.waitForURL(/practice/, { timeout: 10000 });
  await page.waitForSelector('#part-picker .part-btn', { timeout: 10000 });
  await sleep(400);
}
/* 在一段時間內每 200ms 看一次，有沒有被蓋住過 */
async function coveredDuring(page, ms, work = async () => {}) {
  let covered = 0;
  let done = false;
  const watcher = (async () => {
    const t0 = Date.now();
    while (!done && Date.now() - t0 < ms) {
      if (await page.evaluate(() => !!document.querySelector('[data-waking]')).catch(() => false)) covered += 1;
      await sleep(200);
    }
  })();
  await work();
  await sleep(Math.max(0, ms));
  done = true;
  await watcher;
  return covered;
}

console.log('1) 練習中伺服器連不上');
{
  const { ctx, page, errs } = await newPage();
  await login(page);
  await page.click('#part-picker .part-btn >> nth=0');
  await page.click('#start-practice-btn');
  await page.waitForSelector('#answer-input:not([disabled])', { timeout: 10000 });
  const before = attempts();

  await page.route('**/api/practice/attempt', down);
  let clickable = true;
  const covered = await coveredDuring(page, 3000, async () => {
    for (let i = 0; i < 3; i += 1) {
      await page.fill('#answer-input', 'zzz');
      await page.click('#submit-answer-btn', { timeout: 2000 }).catch(() => { clickable = false; });
      await sleep(300);
      await page.click('#next-btn', { timeout: 2000 }).catch(() => { clickable = false; });
      await page.waitForSelector('#answer-input:not([disabled])', { timeout: 3000 }).catch(() => { clickable = false; });
    }
  });
  check('伺服器連不上時，畫面一次都沒有被蓋住', covered === 0, `被蓋住 ${covered} 次`);
  check('連答三題，每一題都按得到送出與下一題', clickable);
  const syncIcon = await page.evaluate(() => document.querySelector('[data-sync-status]')?.textContent || '');
  check('導覽列的小圖示顯示還有資料在等', /📤|⏳/.test(syncIcon), syncIcon);
  check('（前提）這段時間伺服器沒有收到', attempts() === before);

  // 網路斷一下（不是 503，是連線被切斷）
  let cut = 0;
  await page.unroute('**/api/practice/attempt');
  await page.route('**/api/practice/attempt', (route) => { cut += 1; return cut <= 2 ? route.abort('connectionreset') : route.continue(); });
  const covered2 = await coveredDuring(page, 2500, async () => {
    await page.fill('#answer-input', 'zzz');
    await page.click('#submit-answer-btn', { timeout: 2000 });
  });
  check('網路斷一下：畫面也沒有被蓋住', covered2 === 0, `被蓋住 ${covered2} 次`);

  await page.unroute('**/api/practice/attempt');
  for (let i = 0; i < 80 && attempts() < before + 4; i += 1) await sleep(250);
  check('連上之後四題全部補送到', attempts() === before + 4, `${attempts() - before} 題`);
  check('沒有重複計分', new Set(store.attempts.map((a) => a.opId)).size === store.attempts.length);
  const left = await page.evaluate((id) => JSON.parse(localStorage.getItem(`sb:v2:u:${id}:outbox`) || '[]').length, pierceId);
  check('佇列清空了', left === 0, String(left));
  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n2) 遊戲打完剛好連不上');
{
  const { ctx, page, errs } = await newPage();
  await login(page);
  const cut = (route) => route.abort('connectionreset');
  await page.route('**/api/game/result', cut);
  await page.route('**/api/campaign/clear', cut);
  await page.goto(`${BASE}/game?level=1&n=3&difficulty=easy&order=sequential&show=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  for (let i = 0; i < 10; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') break;
    if (st.perkOffer) { await sleep(400); await page.keyboard.press('1'); continue; }
    await page.keyboard.type(st.target, { delay: 30 });
    await sleep(150);
  }
  // 重試約 9 秒後排進佇列、佇列再試：整段看 16 秒
  const covered = await coveredDuring(page, 16000);
  check('結算畫面一次都沒有被蓋住', covered === 0, `被蓋住 ${covered} 次`);
  const q = await page.evaluate((id) => JSON.parse(localStorage.getItem(`sb:v2:u:${id}:outbox`) || '[]'), pierceId);
  check('（前提）成績留在佇列裡', q.some((o) => o.path === '/game/result'), `${q.length} 筆`);
  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n3) 反向檢查：頁面剛打開、伺服器在睡覺');
{
  const { ctx, page, errs } = await newPage();
  // 沒有本機快取：頁面一定要等伺服器回答「你是誰」
  let asleep = 2;
  await page.route('**/api/auth/me', (route) => (asleep-- > 0 ? down(route) : route.continue()));
  // 登入 cookie 先拿好（直接打 API，不經過畫面，本機就沒有快取）
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce' })
  });
  const [n, v] = r.headers.get('set-cookie').split(';')[0].split('=');
  await ctx.addCookies([{ name: n, value: v, url: BASE }]);
  let sawWaking = false;
  const nav = page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 60 && !sawWaking; i += 1) {
    sawWaking = await page.evaluate(() => !!document.querySelector('[data-waking]')).catch(() => false);
    await sleep(200);
  }
  await nav;
  check('伺服器在睡覺時，等待畫面有出現', sawWaking);
  await page.waitForSelector('#part-picker .part-btn', { timeout: 20000 }).catch(() => {});
  const ready = await page.evaluate(() => !!document.querySelector('#part-picker .part-btn') && !document.querySelector('[data-waking]'));
  check('醒了之後頁面照常打開、等待畫面消失', ready);
  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
