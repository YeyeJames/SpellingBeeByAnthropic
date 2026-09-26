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

/* ── 抽樣打關卡 ────────────────────────────────────────── */
for (const n of LEVELS) {
  const lvl = campaign[n - 1];
  console.log(`\n第 ${n} 關（第 ${lvl.chapter} 章、${lvl.kind}${lvl.weakness ? '、弱點章' : ''}、${lvl.subtitle}）`);
  await setHighest(n - 1);
  const xp0 = (await db.collection('users').findOne({ _id: uid })).xp || 0;
  const serverLevel = await fetch(`${BASE}/api/campaign/level/${n}`, { headers: { cookie } }).then((r) => r.json());
  const t0 = Date.now();
  wantOrder = lvl.order;
  await page.goto(`${BASE}/game?level=${n}&show=1`, { waitUntil: 'domcontentloaded' });
  const how = await waitReady();
  check('開得起來', how === 'ready', how);
  if (how !== 'ready') continue;
  const words = await page.evaluate(() => window.__spellbee.words());
  const expectCount = serverLevel.limit ? Math.min(serverLevel.limit, serverLevel.wordIds.length) : serverLevel.wordIds.length;
  const ids = new Set(serverLevel.wordIds);
  check('題目是伺服器給的那一批', words.length === expectCount && words.every((w) => ids.has(w.id)),
    `${words.length} 字（伺服器 ${serverLevel.wordIds.length}、上限 ${serverLevel.limit ?? '無'}）`);
  // 速度不在 state() 的快照裡；錄影檔的 setup 記著這一場實際用的速度
  const speed = await page.evaluate(() => window.__spellbee.log()?.setup?.speed);
  check('速度跟關卡表一致', Math.abs((speed || 1) - lvl.speed) < 1e-6, `${speed} / ${lvl.speed}`);
  if (lvl.enemyTraits && lvl.enemyTraits.length) {
    const traits = await page.evaluate(() => window.__spellbee.traitState());
    check('這一關有特殊敵人', traits && (traits.assigned || traits.count || JSON.stringify(traits) !== '{}'), JSON.stringify(traits).slice(0, 80));
  }
  const end = await play();
  const secs = Math.round((Date.now() - t0) / 1000);
  check('機器人打贏了', end.status === 'won', `${end.status}，${secs} 秒`);
  const pg = await postgame();
  check('結算畫面有星等', pg && /★/.test(pg.level), pg && `${pg.level}（「結算中…」停了 ${pg.pendingMs} 毫秒）`);
  for (let i = 0; i < 40 && (await highest()) < n; i += 1) await sleep(200);
  check('伺服器記了過關（進度到第 ' + n + ' 關）', (await highest()) === n, String(await highest()));
  const u = await db.collection('users').findOne({ _id: uid });
  check('經驗有進帳', (u.xp || 0) > xp0, `${xp0} → ${u.xp}`);
  const gr = await db.collection('gameResults').findOne({ userId: uid, mode: 'level', level: n });
  check('成績記成「戰役第 ' + n + ' 關」', !!gr && gr.won === true);
  if (n < campaign.length) {
    check(`有「➡️ 第 ${n + 1} 關」按鈕`, pg && pg.again.includes(`第 ${n + 1} 關`), pg && pg.again);
    wantOrder = campaign[n]?.order;
    await page.click('#postgame-again');
    await page.waitForURL(new RegExp(`level=${n + 1}`), { timeout: 8000 }).catch(() => {});
    check(`按下去真的到第 ${n + 1} 關`, page.url().includes(`level=${n + 1}`), page.url());
    check('而且開得起來（沒有被鎖）', (await waitReady()) === 'ready');
  } else {
    check('最後一關：沒有「下一關」', pg && !/第 \d+ 關/.test(pg.again), pg && pg.again);
    await page.goto(`${BASE}/campaign.html`, { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    const txt = await page.evaluate(() => document.body.innerText);
    check('地圖寫「全部一百關都打完了」', txt.includes('全部一百關都打完了'));
  }
}

/* ── 打輸 ─────────────────────────────────────────────── */
console.log('\n打輸（第 26 關，什麼都不打）');
{
  await setHighest(25);
  await page.goto(`${BASE}/game?level=26&show=1`, { waitUntil: 'domcontentloaded' });
  await waitReady();
  const end = await play({ idle: true, maxMs: 5 * 60 * 1000 });
  check('打輸了', end.status === 'lost', end.status);
  const pg = await postgame();
  check('結算寫「沒過」', pg && /沒過/.test(pg.level), pg && pg.level);
  await sleep(1500);
  check('進度沒有往前', (await highest()) === 25, String(await highest()));
  check('沒有「下一關」按鈕', pg && !/第 27 關/.test(pg.again), pg && pg.again);
}

/* ── 跳關 ─────────────────────────────────────────────── */
console.log('\n改網址跳關（進度第 25 關，直接開第 40 關）');
{
  await page.goto(`${BASE}/game?level=40&show=1`, { waitUntil: 'domcontentloaded' });
  const how = await waitReady();
  check('被擋下來', how === 'locked', how);
  const txt = await page.evaluate(() => document.getElementById('locked-detail')?.textContent || '');
  check('說明要先過哪一關', txt.includes('第 26 關'), txt);
}

/* ── 弱點章真的先出弱點字 ─────────────────────────────── */
console.log('\n弱點章（第 77 關）：先出他的弱點字');
{
  await setHighest(76);
  const weak = wordBank.getBank('g3a').words.slice(100, 108).map((w) => w.id);
  for (const id of weak) {
    await db.collection('wordProgress').updateOne({ userId: uid, wordId: id },
      { $set: { boxLevel: 0, timesIncorrect: 3, lastAttemptAt: new Date(), nextReviewAt: new Date() } }, { upsert: true });
  }
  await page.goto(`${BASE}/game?level=77&show=1&order=sequential`, { waitUntil: 'domcontentloaded' });
  await waitReady();
  const words = await page.evaluate(() => window.__spellbee.words());
  const ids = words.map((w) => w.id);
  check('他的 8 個弱點字都在這一關裡', weak.every((id) => ids.includes(id)), `${weak.filter((id) => ids.includes(id)).length}/8`);
  check('不夠的用原本那一組補滿（這一關不是只有 8 個字）', words.length > weak.length, `${words.length} 字`);
}

console.log('\nJS 例外：', errs.length ? errs.join(' | ') : '沒有');
if (errs.length) failures += 1;
await browser.close();
await client.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
