// 步驟三重現腳本（不在 test:all 裡）：網路不穩、伺服器重開、資料庫還沒醒。
// 真的 MongoDB＋伺服器跑在另一個 process（才能中途關掉再開）＋真的 Chrome。
// 用法：node scripts/audit/step3-repro.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(`${ROOT}/scripts/x.mjs`);
const { chromium } = require('playwright-core');
const { MongoClient } = require('mongodb');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mongodBin() {
  const cache = join(homedir(), '.cache', 'spellbee-mongo');
  for (const d of existsSync(cache) ? readdirSync(cache) : []) {
    const bin = join(cache, d, 'bin', 'mongod');
    if (existsSync(bin)) return bin;
  }
  throw new Error('找不到 mongod');
}
const MPORT = 28000 + Math.floor(Math.random() * 1000);
const URI = `mongodb://127.0.0.1:${MPORT}/spellbee_step3`;
const dataDir = mkdtempSync(join(tmpdir(), 'spellbee-step3-'));
let mongod = null;
function startMongo() { mongod = spawn(mongodBin(), ['--dbpath', dataDir, '--port', String(MPORT), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' }); }

const PORT = 9000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let server = null;
function startServer() {
  server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), MONGODB_URI: URI }, stdio: 'ignore' });
}
async function stopServer() { server.kill('SIGKILL'); await sleep(300); }
async function waitHealthy(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
    if (h && h.database === 'connected') return Date.now() - t0;
    await sleep(200);
  }
  return null;
}
process.on('exit', () => { try { server?.kill('SIGKILL'); mongod?.kill('SIGKILL'); } catch (e) { /* */ } try { rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* */ } });

startMongo();
await sleep(1500);
startServer();
console.log('伺服器就緒（毫秒）：', await waitHealthy());
const client = new MongoClient(URI);
await client.connect();
const db = client.db();

const reg = async (nickname) => {
  const r = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, wordBankId: 'g3a' }) });
  return (await r.json()).user;
};
const pierce = await reg('Pierce');
const attempts = () => db.collection('attempts').countDocuments({});

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const overlay = () => page.evaluate(() => {
  const el = document.querySelector('[data-waking]');
  return el ? el.innerText.split('\n')[1] || el.innerText.slice(0, 40) : null;
});
async function login() {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.profile-tile');
  await page.click('.profile-tile:has-text("Pierce")');
  await page.waitForURL(/practice/);
  await page.waitForSelector('#part-picker .part-btn');
  await sleep(500);
}
async function startPractice() {
  await page.click('#part-picker .part-btn >> nth=0');
  await page.click('#start-practice-btn');
  await page.waitForSelector('#answer-input:not([disabled])', { timeout: 15000 });
}
async function answer() {
  await page.fill('#answer-input', 'zzz');
  await page.click('#submit-answer-btn', { timeout: 3000 }).catch((e) => console.log('   （按不到送出：', e.message.split('\n')[0], '）'));
  await sleep(300);
}
async function next() {
  await page.click('#next-btn', { timeout: 3000 }).catch((e) => console.log('   （按不到下一題：', e.message.split('\n')[0], '）'));
  await page.waitForSelector('#answer-input:not([disabled])', { timeout: 5000 }).catch(() => {});
}
/* 等蓋住的那一層消失，回傳等了幾秒（孩子被擋住多久） */
async function waitNoOverlay(max = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max && (await overlay()) !== null) await sleep(250);
  return Math.round((Date.now() - t0) / 100) / 10;
}
async function watchOverlay(ms) {
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const o = await overlay();
    seen.push(o ? 1 : 0);
    await sleep(500);
  }
  const on = seen.filter(Boolean).length * 0.5;
  return `${on} 秒被蓋住（觀察 ${ms / 1000} 秒）`;
}

await login();
await startPractice();

/* N1：網路閃一下（連得上網、但這一個請求失敗）*/
console.log('\n=== N1 練習中網路閃一下 ===');
{
  let n = 0;
  await page.route('**/api/practice/attempt', (route) => { n += 1; return n <= 1 ? route.abort('connectionreset') : route.continue(); });
  const before = await attempts();
  await answer();
  console.log('答完之後：', await watchOverlay(6000));
  console.log('被蓋住時畫面上寫：', await overlay());
  await page.unroute('**/api/practice/attempt');
  await sleep(6000);
  console.log('作答有沒有送到：', (await attempts()) - before, '筆');
  await next();
}

/* N3：伺服器重開（部署）時繼續練習 */
console.log('\n=== N3 練習中伺服器重開 ===');
{
  const before = await attempts();
  await stopServer();
  await answer();
  console.log('伺服器關著、答一題：', await watchOverlay(5000));
  console.log('孩子要等幾秒才能按下一題：', await waitNoOverlay(), '秒（伺服器還關著）');
  await next();
  await answer();
  console.log('再答一題，又被擋：', await waitNoOverlay(), '秒');
  await next();
  startServer();
  const up = await waitHealthy();
  console.log('伺服器重開完成（毫秒）：', up);
  console.log('重開後：', await watchOverlay(8000));
  await waitNoOverlay();
  await sleep(4000);
  console.log('關機期間的兩題有沒有送到：', (await attempts()) - before, '筆（應為 2）');
  const me = await page.evaluate(() => fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.status));
  console.log('重開後還是登入的嗎：', me === 200 ? '是' : `否（${me}）`);
  await next();
}

/* N4：資料庫還沒醒（伺服器先起來、資料庫晚 8 秒才起來）*/
console.log('\n=== N4 資料庫晚醒 ===');
{
  await stopServer();
  mongod.kill('SIGKILL');
  await sleep(500);
  startServer();
  await sleep(1500);
  const t0 = Date.now();
  const nav = page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(8000);
  startMongo();
  await nav;
  let state = null;
  for (let i = 0; i < 80; i += 1) {
    state = await page.evaluate(() => ({
      waking: !!document.querySelector('[data-waking]'),
      fatal: document.body.innerText.includes('載入失敗'),
      ready: !!document.querySelector('#part-picker .part-btn') && !document.body.classList.contains('page-loading')
    })).catch(() => null);
    if (state && (state.ready || state.fatal)) break;
    await sleep(500);
  }
  console.log(`資料庫晚 8 秒：${Math.round((Date.now() - t0) / 1000)} 秒後`, JSON.stringify(state));
}

/* N2：遊戲打完剛好連不上 → 結算畫面會不會被蓋住 */
console.log('\n=== N2 遊戲結算時連不上 ===');
{
  await waitHealthy();
  await page.route('**/api/game/result', (r) => r.abort('connectionreset'));
  await page.route('**/api/campaign/clear', (r) => r.abort('connectionreset'));
  await page.route('**/api/practice/**', (r) => r.abort('connectionreset')); // 佇列補送也不通
  await page.route('**/api/game/result**', (r) => r.abort('connectionreset'));
  await page.goto(`${BASE}/game?level=1&n=3&difficulty=easy&order=sequential&show=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 30000 });
  for (let i = 0; i < 10; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') break;
    if (st.perkOffer) { await sleep(400); await page.keyboard.press('1'); continue; }
    await page.keyboard.type(st.target, { delay: 30 });
    await sleep(150);
  }
  console.log('打完之後：', await watchOverlay(25000));
  const postgame = await page.evaluate(() => !document.getElementById('postgame')?.hidden);
  console.log('結算畫面還在嗎：', postgame);
}

/* N6：本機儲存用了多少 */
console.log('\n=== N6 本機儲存 ===');
{
  const used = await page.evaluate(() => {
    let total = 0;
    const big = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      total += (k.length + v.length) * 2;
      big.push([k.replace(/u:[a-f0-9]{24}/, 'u:<id>'), v.length]);
    }
    return { kb: Math.round(total / 1024), top: big.sort((a, b) => b[1] - a[1]).slice(0, 6) };
  });
  console.log('目前用了', used.kb, 'KB；最大的幾項：', JSON.stringify(used.top));
}

console.log('\nJS 例外：', errs.length ? errs.join(' | ') : '沒有');
await browser.close();
await client.close();
process.exit(0);
