/**
 * 商店、個人檔案、靜音：從頭到尾，而且伺服器是真的（docs/audit/step6）。
 *
 * 既有的 theme-test 用的是假造的伺服器回應，所以「伺服器根本不收主題」這件事
 * 從來沒被看到（step1 的 G2）。這一支不假造任何回應（只有第 6 節故意讓伺服器拒絕）。
 *
 * 要證明的事：
 *   1. ⭐ 買主題、套用：伺服器真的存了，換一頁一打開就是新主題（6-A）
 *   2. 個人檔案的主題切換：來回切都存得進伺服器
 *   3. 穿上配件：個人檔案一打開就看得到（6-B）
 *   4. 音量設定：存了之後重新整理，滑桿就是存的數字（6-B）
 *   5. 導覽列的靜音：換一頁還是靜音（6-B）
 *   6. 伺服器不收（例如錢不夠、換裝失敗）：畫面講出來，並回到伺服器的狀態
 *
 * 用法：node scripts/shop-e2e-test.mjs（自己起伺服器）
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

const { SHOP_ITEMS } = require('../server/data/shop-items.js');
const store = { shopItems: SHOP_ITEMS.map((i) => ({ ...i })) };
installFakeDb(createFakeDb(store, { uniqueIndexes: { purchases: ['userId', 'opId'], eventBatches: ['userId', 'opId'] } }));
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
const me = () => store.users.find((u) => u.nickname === 'Pierce');
me().coins = 6000;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.profile-tile', { timeout: 10000 });
await page.click('.profile-tile:has-text("Pierce")');
await page.waitForURL(/practice/, { timeout: 10000 });
await sleep(800);

const nameOf = (key) => SHOP_ITEMS.find((i) => i.key === key).name;
const btn = (key) => page.locator(`.shop-card:has(.sc-name:text-is("${nameOf(key)}")) .sc-action button`);
const waitFor = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); }
  return false;
};
async function gotoShop() {
  await page.goto(`${BASE}/shop.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shop-card', { timeout: 10000 });
  await sleep(1200);
}
/* 一打開的那一刻（背景驗證還沒回來之前）畫面是什麼樣子 */
async function firstPaint(url, fn) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 40; i += 1) {
    const v = await page.evaluate(fn).catch(() => undefined);
    if (v !== undefined && v !== null) return v;
    await sleep(25);
  }
  return undefined;
}

console.log('1) ⭐ 買主題、套用');
{
  await gotoShop();
  await btn('theme_space').click();
  await waitFor(() => (me().ownedItemKeys || []).includes('theme_space'));
  await sleep(300);
  await btn('theme_space').click(); // 套用
  const saved = await waitFor(() => me().activeTheme === 'space');
  check('伺服器真的存了新主題', saved, me().activeTheme);
  check('商店沒有出現「沒有換成功」', !/沒有換成功/.test(await page.textContent('#shop-error')));
  const theme = await firstPaint('/practice.html', () => (document.body && document.body.dataset.theme) || null);
  check('換到練習頁，一打開就是新主題', theme === 'space', theme);
}

console.log('\n2) 個人檔案的主題切換');
{
  await page.goto(`${BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#theme-switcher button', { timeout: 10000 });
  await sleep(600);
  await page.click('#theme-switcher button:has-text("運動風")');
  check('切回預設：伺服器存了', await waitFor(() => me().activeTheme === 'sports'), me().activeTheme);
  await page.click('#theme-switcher button:has-text("太空")');
  check('再切回太空：伺服器存了', await waitFor(() => me().activeTheme === 'space'), me().activeTheme);
  check('沒有錯誤訊息', !/沒有換成功/.test(await page.textContent('#theme-switcher')));
  const theme = await firstPaint('/wordbank.html', () => (document.body && document.body.dataset.theme) || null);
  check('換一頁，一打開就是太空', theme === 'space', theme);
}

console.log('\n3) 穿上配件 → 個人檔案');
{
  await gotoShop();
  await btn('accessory_sunglasses').click(); // 買
  await waitFor(() => (me().ownedItemKeys || []).includes('accessory_sunglasses'));
  await sleep(300);
  await btn('accessory_sunglasses').click(); // 穿上
  check('伺服器記了穿上', await waitFor(() => (me().avatar.accessories || []).includes('accessory_sunglasses')));
  const shown = await firstPaint('/profile.html', () => (document.querySelector('#avatar-preview') && document.querySelector('#avatar-preview').children.length)
    ? !!document.querySelector('#avatar-preview img[src*="sunglasses"]') : null);
  check('個人檔案一打開就看得到太陽眼鏡', shown === true, String(shown));
}

console.log('\n4) 音量設定');
{
  await page.goto(`${BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#bgm-volume', { timeout: 10000 });
  await sleep(600);
  await page.evaluate(() => { document.getElementById('bgm-volume').value = '0.2'; });
  await page.click('#save-audio-btn');
  check('伺服器存了', await waitFor(() => me().audioPrefs.bgmVolume === 0.2), JSON.stringify(me().audioPrefs));
  const v = await firstPaint('/profile.html', () => {
    const el = document.getElementById('bgm-volume');
    return el && !document.body.classList.contains('page-loading') ? el.value : null;
  });
  check('重新整理之後，滑桿就是存的數字', v === '0.2', v);
}

console.log('\n5) 導覽列的靜音');
{
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-nav-mute]', { timeout: 10000 });
  await sleep(600);
  const before = await page.textContent('[data-nav-mute]');
  await page.click('[data-nav-mute]');
  check('（前提）按下去變成靜音', before === '🔊' && (await page.textContent('[data-nav-mute]')) === '🔇');
  check('伺服器存了', await waitFor(() => me().audioPrefs.muted === true));
  const icon = await firstPaint('/shop.html', () => document.querySelector('[data-nav-mute]')?.textContent || null);
  check('換一頁，一打開還是靜音', icon === '🔇', icon);
  check('而且音量沒有被靜音蓋掉', me().audioPrefs.bgmVolume === 0.2, JSON.stringify(me().audioPrefs));
}

console.log('\n6) 伺服器不收的時候');
{
  // 6a 錢不夠（例如在別台裝置花掉了）：退錢、講原因
  me().coins = 2500;
  await gotoShop();
  const coinsBefore = me().coins;
  await page.route('**/api/shop/purchase', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"金幣不夠喔"}' }));
  await btn('theme_dino').click();
  const refunded = await waitFor(async () => /購買/.test(await btn('theme_dino').textContent()));
  check('買不成：按鈕變回「購買」', refunded);
  check('畫面講出原因', /購買失敗/.test(await page.textContent('#shop-error')));
  // 這一頁以為的金幣（3400）跟伺服器（2500）不一樣：買不成之後要照伺服器的
  const synced = await waitFor(async () => Number(((await page.textContent('[data-nav-coins]')) || '').replace(/[^\d]/g, '')) === coinsBefore);
  const nav = Number(((await page.textContent('[data-nav-coins]')) || '').replace(/[^\d]/g, ''));
  check('導覽列的金幣跟伺服器一致（買不成之後以伺服器為準）', synced, `${nav} / 伺服器 ${coinsBefore}`);
  await page.unroute('**/api/shop/purchase');

  // 6b 換裝失敗：講出來、回到伺服器的主題
  await gotoShop();
  await page.route('**/api/user/equip', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"你還沒有解鎖這個造型"}' }));
  await btn('theme_space').click().catch(() => {}); // 已經在用，可能是停用的按鈕
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.shop-card')].find((c) => /運動/.test(c.textContent));
    return b ? null : null;
  });
  // 從個人檔案切到運動風，伺服器拒絕
  await page.goto(`${BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#theme-switcher button', { timeout: 10000 });
  await sleep(600);
  await page.click('#theme-switcher button:has-text("運動風")');
  await sleep(800);
  check('個人檔案：換不成功會講出來', /沒有換成功/.test(await page.textContent('#theme-switcher')));
  check('伺服器的主題沒變', me().activeTheme === 'space', me().activeTheme);
  await page.unroute('**/api/user/equip');
}

check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
