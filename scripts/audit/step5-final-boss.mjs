// 步驟五：大魔王（第 100 關）打 8 次，用「每一鍵先看畫面」的機器人。輸或漏字的那幾場把錄影檔存到 /tmp。
// 用法：node scripts/audit/step5-final-boss.mjs（要有 mongod，見 real-mongo-test.mjs）
// 步驟五（不在 test:all 裡，一次要跑十幾分鐘）：在真的瀏覽器裡抽樣打戰役關卡。
// 真的 MongoDB＋真的伺服器＋真的 Chrome，機器人照畫面上要打的字按鍵盤。
// 用法：node scripts/audit/step5-campaign-sweep.mjs [--levels=1,2,24]
//
// 每一關驗：
//   - 題目是伺服器給的那一批（數量、內容），速度與特殊敵人跟關卡表一致
//   - 打贏：結算畫面有星等、伺服器記了過關、進度往前一關、經驗與蜂蜜有進帳
//   - 「➡️ 第 N+1 關」按鈕出現，按下去真的到第 N+1 關（最後一關沒有這顆）
// 另外：打輸不會過關、跳關的網址會被擋、弱點章真的先出他的弱點字。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(`${ROOT}/scripts/x.mjs`);
const { chromium } = require('playwright-core');
const { MongoClient, ObjectId } = require('mongodb');
const wordBank = require(`${ROOT}/server/data/word-bank.js`);
const { buildCampaign } = await import(`${ROOT}/public/js/shared/campaign.js`);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = process.argv.find((a) => a.startsWith('--levels='));
const LEVELS = arg ? arg.split('=')[1].split(',').map(Number) : [1, 2, 24, 25, 26, 50, 51, 75, 76, 99, 100];

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 真的 MongoDB＋伺服器 ──────────────────────────────── */
const cache = join(homedir(), '.cache', 'spellbee-mongo');
const bin = (existsSync(cache) ? readdirSync(cache) : []).map((d) => join(cache, d, 'bin', 'mongod')).find(existsSync);
if (!bin) { console.log('找不到 mongod，跳過'); process.exit(0); }
const dataDir = mkdtempSync(join(tmpdir(), 'spellbee-sweep-'));
const MPORT = 28000 + Math.floor(Math.random() * 1000);
const mongod = spawn(bin, ['--dbpath', dataDir, '--port', String(MPORT), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
const URI = `mongodb://127.0.0.1:${MPORT}/spellbee_sweep`;
const PORT = 9000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
await sleep(1500);
const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), MONGODB_URI: URI }, stdio: 'ignore' });
process.on('exit', () => { try { server.kill('SIGKILL'); mongod.kill('SIGKILL'); } catch (e) { /* */ } try { rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* */ } });
for (let i = 0; i < 100; i += 1) {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (h && h.database === 'connected') break;
  await sleep(200);
}
const client = new MongoClient(URI);
await client.connect();
const db = client.db();

const reg = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce', wordBankId: 'g3a' }) });
const cookie = reg.headers.get('set-cookie').split(';')[0];
const user = (await reg.json()).user;
const uid = new ObjectId(user._id);
const campaign = buildCampaign(wordBank.listGroups('g3a'));
const setHighest = (n) => db.collection('campaignProgress').updateOne({ userId: uid }, { $set: { highestCleared: n }, $setOnInsert: { userId: uid } }, { upsert: true });
const highest = async () => (await db.collection('campaignProgress').findOne({ userId: uid }))?.highestCleared || 0;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const [cn, cv] = cookie.split('=');
await ctx.addCookies([{ name: cn, value: cv, url: BASE }]);
await ctx.addInitScript(([u, id]) => {
  try {
    localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u));
    // 跳過手速校準（那是另一段流程，有自己的測試）；打開「顯示單字」讓機器人看得到要打什麼
    localStorage.setItem(`sb:v2:u:${id}:gameDifficulty`, JSON.stringify('normal'));
  } catch (e) { /* */ }
}, [user, user._id]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

let wantOrder = null;
async function waitReady() {
  for (let i = 0; i < 150; i += 1) {
    const s = await page.evaluate(() => ({
      ready: !!(window.__spellbee && window.__spellbee.ready),
      pregame: !!document.getElementById('pregame') && !document.getElementById('pregame').hidden,
      locked: !!document.getElementById('locked-panel') && !document.getElementById('locked-panel').hidden
    })).catch(() => ({}));
    if (s.locked) return 'locked';
    if (s.pregame) {
      /*
       * 開場畫面的兩顆開始鍵就是出題順序（照順序／打亂）。按關卡設計的那一顆——
       * 按另一顆會把關卡的設計蓋掉（docs/audit/step5 的 P5-2），那是另外驗的事。
       */
      const want = wantOrder || 'random';
      await page.click(`#pregame .btn-order[data-order="${want}"]`, { timeout: 3000 }).catch(() => {});
      await sleep(300);
      continue;
    }
    if (s.ready) return 'ready';
    await sleep(200);
  }
  return 'timeout';
}

/* 機器人：照畫面上的目標字按鍵，三選一按 1。idle=true 就什麼都不打（測打輸） */
async function play({ idle = false, maxMs = 8 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') return st;
    if (st.perkOffer) { await sleep(300); await page.keyboard.press('1'); await sleep(150); continue; }
    if (!idle && st.target) await page.keyboard.type(st.target.slice(st.typed || 0), { delay: 25 });
    await sleep(idle ? 500 : 60);
  }
  return page.evaluate(() => window.__spellbee.state());
}

/*
 * 結算畫面：一開始寫「結算中…」，伺服器回來才換成星等與「下一關」。
 * 回傳時一併量「結算中…」停了多久——那段時間按「再打一場」會重打同一關。
 */
async function postgame() {
  const t0 = Date.now();
  let shownAt = null;
  for (let i = 0; i < 80; i += 1) {
    const p = await page.evaluate(() => {
      const el = document.getElementById('postgame');
      return el && !el.hidden ? {
        title: document.getElementById('postgame-title')?.textContent || '',
        level: document.getElementById('postgame-level')?.textContent || '',
        again: document.getElementById('postgame-again')?.textContent || ''
      } : null;
    });
    if (p && shownAt === null) shownAt = Date.now();
    if (p && p.level && !/結算中/.test(p.level)) return { ...p, pendingMs: Date.now() - (shownAt || t0) };
    await sleep(100);
  }
  return page.evaluate(() => ({ level: document.getElementById('postgame-level')?.textContent || '', again: document.getElementById('postgame-again')?.textContent || '', pendingMs: null }));
}
async function postgameOld() {
  for (let i = 0; i < 60; i += 1) {
    const p = await page.evaluate(() => {
      const el = document.getElementById('postgame');
      return el && !el.hidden ? {
        title: document.getElementById('postgame-title')?.textContent || '',
        level: document.getElementById('postgame-level')?.textContent || '',
        again: document.getElementById('postgame-again')?.textContent || ''
      } : null;
    });
    if (p && (p.level || i > 20)) return p;
    await sleep(250);
  }
  return null;
}

/* ── 第 100 關打 6 次，輸的那幾場把錄影檔存下來 ── */
import('node:fs').then(()=>{});
const fs = require('node:fs');
for (let attempt = 1; attempt <= 8; attempt += 1) {
  await setHighest(99);
  wantOrder = 'random';
  await page.goto(`${BASE}/game?level=100&show=1`, { waitUntil: 'domcontentloaded' });
  await waitReady();
  const t0 = Date.now();
  const samples = [];
  let st;
  while (Date.now() - t0 < 6 * 60 * 1000) {
    st = await page.evaluate(() => window.__spellbee.state());
    if (samples.length < 40) samples.push({ t: Date.now() - t0, word: st.wordIndex, target: st.target, typed: st.typed, hp: st.hp, kills: st.stats?.wordsKilled, missed: st.stats?.wordsMissed, line: await page.evaluate(() => JSON.stringify(window.__spellbee.waitingLine())) });
    if (st.status !== 'running') break;
    if (st.perkOffer) { await sleep(300); await page.keyboard.press('1'); await sleep(150); continue; }
    // 像人一樣：每按一個鍵之前先看畫面上要的是哪一個字母
    const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
    if (ch) await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    const p2 = await page.evaluate(() => window.__spellbee.state());
    if (p2.paused) console.log('  （遊戲是暫停的！）', Math.round((Date.now() - t0) / 1000), '秒');
    await sleep(60);
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`第 ${attempt} 次：${st.status}，${secs} 秒，kills=${st.stats?.wordsKilled} missed=${st.stats?.wordsMissed}`);
  if (st.status === 'lost' || (st.stats?.wordsMissed || 0) > 0) {
    const log = await page.evaluate(() => window.__spellbee.log());
    fs.writeFileSync(`/tmp/boss-human-${attempt}.json`, JSON.stringify(log));
    fs.writeFileSync(`/tmp/boss-human-${attempt}-samples.json`, JSON.stringify(samples, null, 1));
    console.log('  存了錄影檔與前 40 個取樣');
  }
}
console.log('JS 例外：', errs.join(' | ') || '沒有');
await browser.close(); await client.close(); process.exit(0);
