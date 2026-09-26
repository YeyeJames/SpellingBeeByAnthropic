// 步驟六重現腳本（不在 test:all 裡）：商店買東西、換主題、穿配件之後換頁，畫面還記不記得。
// 真的伺服器＋假資料庫＋真的 Chrome。用法：node scripts/audit/step6-repro.mjs
import { createRequire } from 'node:module';
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(`${ROOT}/scripts/x.mjs`);
const { chromium } = require('playwright-core');
const { createFakeDb, installFakeDb } = await import(`${ROOT}/scripts/lib/fake-mongo.mjs`);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SHOP_ITEMS } = require(`${ROOT}/server/data/shop-items.js`);
const store = { shopItems: SHOP_ITEMS.map((i) => ({ ...i })) };
installFakeDb(createFakeDb(store, { uniqueIndexes: { purchases: ['userId', 'opId'], eventBatches: ['userId', 'opId'] } }));
const PORT = 9000 + Math.floor(Math.random() * 900);
process.env.PORT = String(PORT);
const rl = console.log, re = console.error; console.log = () => {}; console.error = () => {};
require(`${ROOT}/server/index.js`);
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) break; await sleep(100); }
console.log = rl; console.error = re;
process.removeAllListeners('uncaughtException'); process.removeAllListeners('unhandledRejection');
process.on('unhandledRejection', (e) => { console.log('ERR', e.message); process.exit(1); });

await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce' }) });
const me = () => store.users.find((u) => u.nickname === 'Pierce');
me().coins = 5000;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.profile-tile');
await page.click('.profile-tile:has-text("Pierce")');
await page.waitForURL(/practice/);
await sleep(800);

const card = (name) => page.locator(`.shop-card:has(.sc-name:text-is("${name}")) .sc-action button`);
const nameOf = (key) => SHOP_ITEMS.find((i) => i.key === key).name;
const cached = () => page.evaluate(() => JSON.parse(localStorage.getItem('sb:v2:shared:currentUser') || 'null'));
async function gotoShop() {
  await page.goto(`${BASE}/shop.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shop-card', { timeout: 10000 });
  await sleep(150); // 快取畫出來的那一刻（背景驗證還沒回來）
}

console.log('=== R1 買太陽眼鏡 → 換頁 → 回商店 ===');
await gotoShop();
await card(nameOf('accessory_sunglasses')).click();
for (let i = 0; i < 30 && !(me().ownedItemKeys || []).includes('accessory_sunglasses'); i += 1) await sleep(150);
console.log('伺服器：', JSON.stringify({ owned: me().ownedItemKeys, coins: me().coins }));
console.log('快取裡的使用者：', JSON.stringify({ owned: (await cached()).ownedItemKeys, coins: (await cached()).coins }));
await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
await sleep(800);
await gotoShop();
console.log('回商店第一眼，太陽眼鏡的按鈕：', await card(nameOf('accessory_sunglasses')).textContent());
await sleep(2000);
console.log('等 2 秒後，太陽眼鏡的按鈕：', await card(nameOf('accessory_sunglasses')).textContent());

console.log('\n=== R2 穿上太陽眼鏡 → 換頁 → 回商店、看個人檔案 ===');
await gotoShop();
await sleep(1500);
await card(nameOf('accessory_sunglasses')).click(); // 穿上
await sleep(1200);
console.log('伺服器配件：', JSON.stringify(me().avatar.accessories));
await page.goto(`${BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
await sleep(300);
console.log('個人檔案第一眼有沒有太陽眼鏡：', await page.evaluate(() => !!document.querySelector('#avatar-preview img[src*="sunglasses"]')));
await sleep(2000);
console.log('等 2 秒後：', await page.evaluate(() => !!document.querySelector('#avatar-preview img[src*="sunglasses"]')));

console.log('\n=== R3 買太空主題並套用 → 換頁 ===');
await gotoShop();
await sleep(1500);
await card(nameOf('theme_space')).click(); // 買
for (let i = 0; i < 30 && !(me().ownedItemKeys || []).includes('theme_space'); i += 1) await sleep(150);
await sleep(300);
await card(nameOf('theme_space')).click(); // 套用
await sleep(1200);
console.log('伺服器主題：', me().activeTheme, '｜這一頁：', await page.evaluate(() => document.body.dataset.theme));
const themes = [];
await page.goto(`${BASE}/practice.html`, { waitUntil: 'commit' });
for (let i = 0; i < 12; i += 1) { themes.push(await page.evaluate(() => document.body?.dataset.theme).catch(() => '?')); await sleep(150); }
console.log('換到練習頁，前 1.8 秒的主題：', themes.join(' → '));

console.log('\n=== R4 買失敗（伺服器說錢不夠）時，已經套用的主題與配件會不會留著 ===');
me().coins = 2500;
await gotoShop();
await sleep(1500);
await page.route('**/api/shop/purchase', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"金幣不夠喔"}' }));
await card(nameOf('theme_dino')).click(); // 樂觀：先扣錢、先變成已擁有
await sleep(100);
const dinoBtn = await card(nameOf('theme_dino')).textContent().catch(() => '?');
console.log('按下購買之後的按鈕：', dinoBtn);
if (/套用/.test(dinoBtn)) await card(nameOf('theme_dino')).click().catch(() => {});
await sleep(2500);
console.log('伺服器擁有：', JSON.stringify(me().ownedItemKeys), '主題：', me().activeTheme);
console.log('這一頁：主題', await page.evaluate(() => document.body.dataset.theme), '｜錯誤訊息', await page.textContent('#shop-error').catch(() => ''));
console.log('快取：擁有', JSON.stringify((await cached()).ownedItemKeys), '主題', (await cached()).activeTheme);
await page.unroute('**/api/shop/purchase');

console.log('\n=== R5 個人檔案的音量設定 ===');
await page.goto(`${BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
await sleep(1200);
await page.evaluate(() => { const b = document.getElementById('bgm-volume'); b.value = '0.2'; b.dispatchEvent(new Event('input', { bubbles: true })); b.dispatchEvent(new Event('change', { bubbles: true })); });
await page.click('#save-audio-btn');
await sleep(1200);
console.log('伺服器：', JSON.stringify(me().audioPrefs), '｜訊息：', await page.textContent('#audio-save-msg'));
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(1500);
console.log('重新整理後滑桿：', await page.evaluate(() => document.getElementById('bgm-volume').value));

console.log('\n=== 確認是不是只是快取舊了：再載入一次 ===');
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(1500);
console.log('個人檔案第二次載入：音量滑桿', await page.evaluate(() => document.getElementById('bgm-volume').value),
  '｜太陽眼鏡', await page.evaluate(() => !!document.querySelector('#avatar-preview img[src*="sunglasses"]')));

console.log('\n=== R6 導覽列的靜音 → 換頁 ===');
await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
await sleep(1200);
await page.click('[data-nav-mute]');
await sleep(800);
console.log('伺服器 muted：', me().audioPrefs.muted, '｜這一頁按鈕：', await page.textContent('[data-nav-mute]'));
await page.goto(`${BASE}/shop.html`, { waitUntil: 'domcontentloaded' });
await sleep(1500);
console.log('換到商店，導覽列按鈕：', await page.textContent('[data-nav-mute]'));

console.log('\nJS 例外：', errs.length ? errs.join(' | ') : '沒有');
await browser.close();
process.exit(0);
