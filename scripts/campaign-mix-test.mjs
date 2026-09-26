/**
 * 戰役的混合關與開場順序（docs/audit/step5 的 P5-1／5-A、P5-2／5-B）。
 *
 * 要證明的事：
 *   1. 混合關與中王：每一組平均抽（差不超過 1）、同一關不會抽到兩個拼法一樣的字、
 *      字數等於上限；單一組或沒有上限的關（第 1～2 章、大魔王）跟以前完全一樣
 *   2. 伺服器出的題真的橫跨每一組，而且每次開都重抽
 *   3. 瀏覽器：第 51 關這一場真的有三週的字
 *   4. 開場畫面：戰役關卡只留關卡定的那一顆（第 2 關照順序、第 26 關打亂），
 *      按下去就是那個順序、也不會改掉他在組別遊戲選的偏好；組別遊戲兩顆都在、照他選的
 *
 * 用法：node scripts/campaign-mix-test.mjs（自己起伺服器）
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

const wordBank = require('../server/data/word-bank.js');
const { buildCampaign, pickLevelWordIds } = await import('../public/js/shared/campaign.js');
const { createRng } = await import('../public/js/game/core/rng.js');
const campaign = buildCampaign(wordBank.listGroups('g3a'));
const idsOf = (g) => wordBank.wordsByGroup(g).map((w) => w.id);
const eng = (id) => wordBank.getWordById(id)?.english || id;
const groupOf = (id) => wordBank.getWordById(id)?.group;

/* ── 1. 挑字規則 ───────────────────────────────────────── */
console.log('1) 挑字規則（每一關抽 200 次）');
{
  let uneven = 0;
  let dup = 0;
  let wrongSize = 0;
  let changedSingle = 0;
  const unevenEx = [];
  for (const level of campaign) {
    if (level.weakness) continue;
    const old = level.groupIds.flatMap(idsOf);
    const mixed = level.wordLimit && level.groupIds.length > 1 && old.length > level.wordLimit;
    for (let t = 0; t < 200; t += 1) {
      const ids = pickLevelWordIds(level, idsOf, Math.random, eng);
      if (!mixed) {
        const expect = level.wordLimit ? old.slice(0, level.wordLimit) : old;
        if (ids.join() !== expect.join()) changedSingle += 1;
        continue;
      }
      if (new Set(ids.map(eng)).size !== ids.length) dup += 1;
      if (ids.length !== level.wordLimit) wrongSize += 1;
      const counts = level.groupIds.map((g) => ids.filter((id) => groupOf(id) === g).length);
      if (Math.max(...counts) - Math.min(...counts) > 1) {
        uneven += 1;
        if (unevenEx.length < 3) unevenEx.push(`第 ${level.level} 關 ${JSON.stringify(counts)}`);
      }
    }
  }
  check('混合關：每一組分到的字數差不超過 1', uneven === 0, unevenEx.join(' '));
  check('混合關：同一關不會抽到兩個拼法一樣的字', dup === 0, `${dup} 次`);
  check('混合關：字數剛好等於上限', wrongSize === 0, `${wrongSize} 次`);
  check('單一組、沒有上限的關：跟以前一模一樣（第 1～2 章、大魔王）', changedSingle === 0, `${changedSingle} 次不一樣`);
  const lv25 = campaign[24];
  const seen = new Set();
  for (let t = 0; t < 50; t += 1) seen.add(pickLevelWordIds(lv25, idsOf, Math.random, eng).sort().join());
  check('每次抽的都不一樣（第 25 關抽 50 次）', seen.size > 40, `${seen.size} 種`);
  const a = pickLevelWordIds(lv25, idsOf, (() => { const r = createRng(7); return () => r.next(); })(), eng);
  const b = pickLevelWordIds(lv25, idsOf, (() => { const r = createRng(7); return () => r.next(); })(), eng);
  check('給同一個亂數種子，抽出來一樣（難度模擬器要重現得出來）', a.join() === b.join());
}

/* ── 起伺服器 ──────────────────────────────────────────── */
const { SHOP_ITEMS } = require('../server/data/shop-items.js');
const store = { shopItems: SHOP_ITEMS.map((i) => ({ ...i })) };
installFakeDb(createFakeDb(store, { uniqueIndexes: { campaignProgress: ['userId'], gameResults: ['userId', 'opId'] } }));
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

const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce', wordBankId: 'g3a' })
});
const cookie = reg.headers.get('set-cookie').split(';')[0];
const user = (await reg.json()).user;
store.campaignProgress = [{ userId: store.users[0]._id, highestCleared: 99 }];
const level = (n) => fetch(`${BASE}/api/campaign/level/${n}`, { headers: { cookie } }).then((r) => r.json());

/* ── 2. 伺服器 ─────────────────────────────────────────── */
console.log('\n2) 伺服器出的題');
for (const n of [25, 50, 51, 75]) {
  const d = await level(n);
  const groups = new Set(d.wordIds.map(groupOf));
  check(`第 ${n} 關（${d.level.subtitle}）：${d.wordIds.length} 字、每一組都有`,
    d.wordIds.length === d.level.wordLimit && d.level.groupIds.every((g) => groups.has(g)),
    `${groups.size}/${d.level.groupIds.length} 組`);
}
{
  const a = (await level(51)).wordIds.slice().sort().join();
  const b = (await level(51)).wordIds.slice().sort().join();
  check('同一關開兩次，題目重抽', a !== b);
  const one = await level(1);
  check('第 1 關（單一組、沒有上限）：整組照原本的順序', one.wordIds.join() === idsOf('w01').join());
}

/* ── 3、4. 瀏覽器 ──────────────────────────────────────── */
const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext();
const [cn, cv] = cookie.split('=');
await ctx.addCookies([{ name: cn, value: cv, url: BASE }]);
await ctx.addInitScript(([u, id]) => {
  localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u));
  localStorage.setItem(`sb:v2:u:${id}:gameDifficulty`, JSON.stringify('normal'));
}, [user, user._id]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const orderPref = () => page.evaluate((id) => localStorage.getItem(`sb:v2:u:${id}:gameOrder`), user._id);

console.log('\n3) 瀏覽器：第 51 關這一場');
{
  await page.goto(`${BASE}/game?level=51&order=random&show=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  const words = await page.evaluate(() => window.__spellbee.words());
  const by = {};
  for (const w of words) by[w.group] = (by[w.group] || 0) + 1;
  check('三週的字都有，各 10 個', Object.keys(by).length === 3 && Object.values(by).every((n) => n === 10), JSON.stringify(by));
}

console.log('\n4) 開場畫面的順序');
async function pregame(url) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 20000 });
  return page.evaluate(() => [...document.querySelectorAll('#pregame .btn-order')]
    .filter((b) => !b.hidden && getComputedStyle(b).display !== 'none').map((b) => b.dataset.order));
}
async function start(order) {
  await page.click(`#pregame .btn-order[data-order="${order}"]`);
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  await sleep(200);
  return page.evaluate(() => window.__spellbee.order());
}
{
  // 先在組別遊戲選「打亂」：這是他自己的偏好，戰役不可以改掉它
  store.groupProgress = [{ userId: store.users[0]._id, groupId: 'p1', practiceCompletions: 1 }];
  const g1 = await pregame('/game?group=p1&show=1');
  check('組別遊戲：兩顆都在', g1.length === 2, JSON.stringify(g1));
  check('組別遊戲：按「打亂」就是打亂', (await start('random')) === 'random');
  const prefBefore = await orderPref();

  const v2 = await pregame('/game?level=2&show=1');
  check('第 2 關（照順序）：只留「照順序」', v2.length === 1 && v2[0] === 'sequential', JSON.stringify(v2));
  check('按下去是照順序', (await start('sequential')) === 'sequential');

  const v26 = await pregame('/game?level=26&show=1');
  check('第 26 關（打亂）：只留「打亂」', v26.length === 1 && v26[0] === 'random', JSON.stringify(v26));
  check('按下去是打亂', (await start('random')) === 'random');

  check('打完戰役，他在組別遊戲選的偏好沒有被改掉', (await orderPref()) === prefBefore, `${prefBefore} → ${await orderPref()}`);

  const g2 = await pregame('/game?group=p1&show=1');
  check('回到組別遊戲：兩顆又都在', g2.length === 2, JSON.stringify(g2));
  check('組別遊戲：按「照順序」就是照順序', (await start('sequential')) === 'sequential');
}

check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
