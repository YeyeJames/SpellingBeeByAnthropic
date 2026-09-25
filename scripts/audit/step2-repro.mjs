// 步驟二重現腳本（不在 test:all 裡）：兩個孩子在同一台電腦、同一個 Chrome 上切換。用法：node scripts/audit/step2-repro.mjs
import { createRequire } from 'node:module';
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(`${ROOT}/scripts/x.mjs`);
const { chromium } = require('playwright-core');
const { createFakeDb, installFakeDb } = await import(`${ROOT}/scripts/lib/fake-mongo.mjs`);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const { SHOP_ITEMS } = require(`${ROOT}/server/data/shop-items.js`);
const store = { shopItems: SHOP_ITEMS.map((i) => ({ ...i })) };
installFakeDb(createFakeDb(store, { uniqueIndexes: {
  attempts: ['userId', 'opId'], groupCompletions: ['userId', 'opId'], gameResults: ['userId', 'opId'],
  purchases: ['userId', 'opId'], eventBatches: ['userId', 'opId'], battleLogs: ['userId', 'opId'], campaignProgress: ['userId']
} }));
const PORT = 9000 + Math.floor(Math.random() * 900);
process.env.PORT = String(PORT);
const rl = console.log, re = console.error; console.log = () => {}; console.error = () => {};
require(`${ROOT}/server/index.js`);
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) break; await new Promise((r) => setTimeout(r, 100)); }
console.log = rl; console.error = re;
process.removeAllListeners('uncaughtException'); process.removeAllListeners('unhandledRejection');
process.on('unhandledRejection', (e) => { console.log('ERR', e.message); process.exit(1); });

const reg = async (nickname, wordBankId) => {
  const r = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, wordBankId }) });
  return String((await r.json()).user._id);
};
const pierceId = await reg('Pierce', 'g3a');
const allenId = await reg('Allen', 'allen');
const who = (id) => (id === pierceId ? 'Pierce' : id === allenId ? 'Allen' : id);
const attemptsBy = () => (store.attempts || []).map((a) => `${who(String(a.userId))}:${a.wordId}`);
const users = () => (store.users || []).map((u) => `${u.nickname} coins=${u.coins} practiced=${u.stats.totalWordsPracticed}`).join(' | ');

const browser = await chromium.launch({ executablePath: CHROME });

async function pick(page, nickname) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.profile-tile', { timeout: 10000 });
  await page.click(`.profile-tile:has-text("${nickname}")`);
  await page.waitForURL(/practice/, { timeout: 10000 });
  await page.waitForSelector('#part-picker .part-btn', { timeout: 10000 });
  await page.waitForTimeout(500);
}
async function startFirstGroup(page) {
  await page.click('#part-picker .part-btn >> nth=0');
  await page.click('#start-practice-btn');
  await page.waitForSelector('#answer-input:not([disabled])', { timeout: 10000 });
}
async function answer(page, text = 'zzz') {
  await page.fill('#answer-input', text);
  await page.click('#submit-answer-btn');
  await page.waitForTimeout(200);
  await page.click('#next-btn').catch(() => {});
  await page.waitForTimeout(200);
}
const nav = (page) => page.evaluate(() => document.querySelector('[data-nav-nickname]')?.textContent);

/* S1：兩個分頁。分頁一是 Pierce 在練習；分頁二有人換成 Allen；回到分頁一繼續答 */
{
  console.log('\n=== S1 兩個分頁 ===');
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await pick(a, 'Pierce');
  await startFirstGroup(a);
  await answer(a);
  const b = await ctx.newPage();
  await pick(b, 'Allen');
  await a.bringToFront();
  await answer(a); await answer(a);
  await a.waitForTimeout(1500);
  console.log('attempts:', attemptsBy().join(', '));
  console.log('users:', users());
  console.log('分頁一導覽列名字:', await nav(a));
  const pierceSession = await a.evaluate(() => document.getElementById('progress-label')?.textContent);
  console.log('分頁一練習進度:', pierceSession);
  // 分頁一上的偏好寫到誰名下？
  const keys = await a.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('lastGroup')));
  console.log('lastGroup keys:', keys.map((k) => k.replace(/sb:v2:u:([a-f0-9]+):/, (m, id) => `[${id}]`)).join(' '), '| pierce', pierceId, 'allen', allenId);
  await ctx.close();
  store.attempts = [];
}

/* S2：換人之後按「上一頁」 */
{
  console.log('\n=== S2 換人後按上一頁 ===');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await pick(p, 'Pierce');
  await startFirstGroup(p);
  await answer(p);
  await p.click('[data-nav-switch]');
  await p.click('[data-nav-switch-account]');
  await p.waitForURL(/index/);
  await p.waitForSelector('.profile-tile');
  await p.click('.profile-tile:has-text("Allen")');
  await p.waitForURL(/practice/);
  await p.waitForTimeout(800);
  await p.goBack(); await p.waitForTimeout(500);
  await p.goBack(); await p.waitForTimeout(1500);
  console.log('上兩頁後 URL:', p.url(), '導覽列名字:', await nav(p));
  const restored = await p.evaluate(() => ({ practicing: !document.getElementById('practice-panel')?.classList.contains('hidden'), label: document.getElementById('progress-label')?.textContent }));
  console.log('畫面：', JSON.stringify(restored));
  await ctx.close();
  store.attempts = [];
}

/* S3：Pierce 離線作答（排進佇列）→ 換 Allen（上線）→ Allen 練習 → Pierce 回來 */
{
  console.log('\n=== S3 離線佇列＋換人 ===');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await pick(p, 'Pierce');
  await startFirstGroup(p);
  await ctx.setOffline(true);
  await answer(p); await answer(p);
  const q = await p.evaluate((id) => (JSON.parse(localStorage.getItem(`sb:v2:u:${id}:outbox`) || '[]')).length, pierceId);
  console.log('Pierce 佇列:', q);
  await ctx.setOffline(false);
  // 網路恢復前就換人（孩子不會等同步完成）
  await p.evaluate(() => { location.href = '/index.html'; });
  await p.waitForSelector('.profile-tile');
  await p.click('.profile-tile:has-text("Allen")');
  await p.waitForURL(/practice/); await p.waitForTimeout(1500);
  console.log('Allen 登入後 attempts:', attemptsBy().join(', ') || '(none)');
  await pick(p, 'Pierce'); await p.waitForTimeout(2000);
  console.log('Pierce 回來後 attempts:', attemptsBy().join(', ') || '(none)');
  console.log('users:', users());
  await ctx.close();
  store.attempts = [];
}

/* S4：練習途中 session 不見了（過期、在別的分頁登出）*/
{
  console.log('\n=== S4 練習途中 session 失效 ===');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await pick(p, 'Pierce');
  await startFirstGroup(p);
  await answer(p);
  await p.waitForTimeout(800);
  const before = attemptsBy().length;
  // 另一個分頁按了登出（跟 session 過期是同一個結果）
  const other = await ctx.newPage();
  await other.goto(`${BASE}/index.html`);
  await other.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }));
  await p.bringToFront();
  await answer(p); await answer(p);
  await p.waitForTimeout(1500);
  const q = await p.evaluate((id) => (JSON.parse(localStorage.getItem(`sb:v2:u:${id}:outbox`) || '[]')).length, pierceId);
  console.log(`session 失效前記到 ${before} 筆，之後的兩筆：伺服器 ${attemptsBy().length - before} 筆、佇列裡 ${q} 筆`);
  console.log('畫面：', p.url(), await nav(p));
  await ctx.close();
}

await browser.close();
process.exit(0);
