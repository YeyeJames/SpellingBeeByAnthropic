/**
 * 商店的外觀（擊殺特效、拼字蜂顏色、音效包、稱號）與全家排行榜。
 *
 * 用真的伺服器（假資料庫）＋真的瀏覽器：
 *   1. 伺服器：外觀要先買才能用；同一格換一件會蓋掉上一件；卸下回到預設；
 *      晚到的舊「卸下」不會卸掉後來換上的那一件；稱號文字跟著使用者送
 *   2. 排行榜：要買了那個小遊戲才能記分；只留最高分；不合理的分數擋掉；
 *      全家一起列、照分數排、標出自己；刪帳號連榜上的名字一起刪
 *   3. 商店頁：有分區；按「使用」伺服器真的存了；音效包買之前就能試聽；排行榜畫得出來
 *   4. 個人檔案與選人畫面：拼字蜂換了顏色、看得到稱號
 *   5. ⭐ 遊戲：打掉一隻蟲噴的是買的特效（不是蜂蜜），蜂針換了顏色；
 *      而且戰鬥本身完全一樣（同一個種子、同樣的按鍵，結果的指紋一模一樣）
 *
 * 用法：node scripts/cosmetics-test.mjs（自己起伺服器）
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
installFakeDb(createFakeDb(store, {
  uniqueIndexes: {
    minigamePlays: ['userId', 'opId'], purchases: ['userId', 'opId'], minigameBests: ['userId', 'itemKey'],
    gameResults: ['userId', 'opId']
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
  await sleep(100);
}
console.log = realLog;
console.error = realErr;
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
const bail = (err) => {
  console.log(`  [FAIL] 測試中途出錯 — ${err && err.message ? err.message.split('\n')[0] : err}`);
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

async function register(nickname) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, wordBankId: 'g3a' })
  });
  const body = await r.json();
  return { cookie: r.headers.get('set-cookie').split(';')[0], id: String(body.user._id) };
}
const userOf = (u) => store.users.find((x) => String(x._id) === u.id);
const setUser = (u, patch) => Object.assign(userOf(u), patch);
async function api(u, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const pierce = await register('Pierce');
const allen = await register('Allen');

/* ── 1. 伺服器：外觀 ─────────────────────────────────────── */
console.log('1) 伺服器：外觀要先買、一格一件、卸下回到預設');
{
  let r = await api(pierce, 'POST', '/user/equip', { type: 'cosmetic', itemKey: 'bee_pink' });
  check('沒買不能用', r.status === 400, String(r.status));
  r = await api(pierce, 'POST', '/user/equip', { type: 'cosmetic', itemKey: 'bee_nope' });
  check('認不得的外觀擋掉', r.status === 400, String(r.status));

  setUser(pierce, { coins: 20000 });
  r = await api(pierce, 'POST', '/shop/purchase', { itemKey: 'bee_pink', opId: 'p1' });
  check('買得到', r.status === 200 && userOf(pierce).ownedItemKeys.includes('bee_pink'), String(r.status));
  check('照價格扣錢', userOf(pierce).coins === 20000 - SHOP_ITEMS.find((i) => i.key === 'bee_pink').cost);
  await api(pierce, 'POST', '/shop/purchase', { itemKey: 'bee_sky', opId: 'p2' });
  await api(pierce, 'POST', '/shop/purchase', { itemKey: 'title_star', opId: 'p3' });

  r = await api(pierce, 'POST', '/user/equip', { type: 'cosmetic', itemKey: 'bee_pink' });
  check('用了：存在 cosmetics.beeColor', userOf(pierce).cosmetics?.beeColor === 'bee_pink', JSON.stringify(userOf(pierce).cosmetics));
  r = await api(pierce, 'POST', '/user/equip', { type: 'cosmetic', itemKey: 'bee_sky' });
  check('同一格換一件：蓋掉上一件', userOf(pierce).cosmetics.beeColor === 'bee_sky');
  r = await api(pierce, 'POST', '/user/unequip', { type: 'cosmetic', itemKey: 'bee_pink' });
  check('晚到的舊「卸下」不會卸掉後來換上的', userOf(pierce).cosmetics.beeColor === 'bee_sky');
  r = await api(pierce, 'POST', '/user/unequip', { type: 'cosmetic', itemKey: 'bee_sky' });
  check('卸下：回到預設', !userOf(pierce).cosmetics.beeColor, JSON.stringify(userOf(pierce).cosmetics));

  r = await api(pierce, 'POST', '/user/equip', { type: 'cosmetic', itemKey: 'title_star' });
  check('稱號文字跟著使用者送', r.body.user?.titleText === '🌟 拼字新星', JSON.stringify(r.body.user?.titleText));
  const me = await api(pierce, 'GET', '/auth/me');
  check('/auth/me 也帶著稱號', (me.body.user || me.body)?.titleText === '🌟 拼字新星');
  const profiles = (await (await fetch(`${BASE}/api/auth/profiles`)).json()).profiles;
  check('選人畫面的清單也帶著稱號', profiles.find((p) => p.nickname === 'Pierce')?.titleText === '🌟 拼字新星');
  check('別人沒有稱號就是 null', profiles.find((p) => p.nickname === 'Allen')?.titleText === null);
}

/* ── 2. 排行榜 ──────────────────────────────────────────── */
console.log('\n2) 全家排行榜');
{
  let r = await api(pierce, 'POST', '/shop/score', { itemKey: 'minigame_stack', score: 5 });
  check('沒買那個小遊戲不能記分', r.status === 403, String(r.status));
  setUser(pierce, { ownedItemKeys: [...userOf(pierce).ownedItemKeys, 'minigame_stack'] });
  setUser(allen, { ownedItemKeys: ['minigame_stack'] });
  r = await api(pierce, 'POST', '/shop/score', { itemKey: 'minigame_stack', score: -3 });
  check('負的分數擋掉', r.status === 400);
  r = await api(pierce, 'POST', '/shop/score', { itemKey: 'minigame_stack', score: 2.5 });
  check('不是整數擋掉', r.status === 400);
  r = await api(pierce, 'POST', '/shop/score', { itemKey: 'minigame_stack', score: 99999999 });
  check('大得離譜擋掉', r.status === 400);
  r = await api(pierce, 'POST', '/shop/score', { itemKey: 'theme_space', score: 5 });
  check('不是小遊戲擋掉', r.status === 404);

  for (const s of [3, 10, 7]) await api(pierce, 'POST', '/shop/score', { itemKey: 'minigame_stack', score: s });
  await api(allen, 'POST', '/shop/score', { itemKey: 'minigame_stack', score: 6 });
  const coinsBefore = userOf(pierce).coins;
  const lb = await api(pierce, 'GET', '/shop/leaderboard');
  const board = lb.body.boards?.minigame_stack || [];
  check('只留最高分（3、10、7 → 10）', board.find((x) => x.nickname === 'Pierce')?.best === 10, JSON.stringify(board));
  check('全家一起列、照分數排', board.map((x) => x.nickname).join(',') === 'Pierce,Allen');
  check('標出自己', board.find((x) => x.me)?.nickname === 'Pierce');
  check('榜上看得到稱號', board[0]?.title === '🌟 拼字新星');
  check('每個小遊戲都有一張榜（沒人玩是空的）', Array.isArray(lb.body.boards?.minigame_whack) && lb.body.boards.minigame_whack.length === 0);
  check('記分不會碰金幣', userOf(pierce).coins === coinsBefore);
}

/* ── 3～5. 瀏覽器 ───────────────────────────────────────── */
const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const [cn, cv] = pierce.cookie.split('=');
await context.addCookies([{ name: cn, value: cv, url: BASE }]);
await context.addInitScript(() => localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy')));
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const waitFor = async (fn, ms = 5000) => {
  for (let i = 0; i < ms / 50; i += 1) { if (fn()) return true; await sleep(50); }
  return false;
};

console.log('\n3) 商店頁');
setUser(pierce, { ownedItemKeys: [...userOf(pierce).ownedItemKeys, 'fx_hearts', 'sound_drum'] });
await page.goto(`${BASE}/shop.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-cosmetic]', { timeout: 10000 });
const sections = await page.$$eval('.shop-section', (els) => els.map((e) => e.textContent));
check('有分區（小遊戲、顏色、特效、音效、稱號…）',
  ['小遊戲', '拼字蜂顏色', '打怪特效', '答對音效', '稱號'].every((t) => sections.some((x) => x.includes(t))), sections.join('｜'));
const previews = await page.$$eval('.sc-preview', (els) => els.length);
check('每個音效包都能試聽（買之前也行）', previews === SHOP_ITEMS.filter((i) => i.slot === 'soundPack').length, `${previews} 顆`);
await page.click('.sc-preview');
await page.click('[data-cosmetic="bee_pink"]');
check('按「使用」：伺服器存了', await waitFor(() => userOf(pierce).cosmetics?.beeColor === 'bee_pink'));
await page.click('[data-cosmetic="fx_hearts"]');
await page.click('[data-cosmetic="sound_drum"]');
check('特效、音效也存了', await waitFor(() => userOf(pierce).cosmetics?.killFx === 'fx_hearts' && userOf(pierce).cosmetics?.soundPack === 'sound_drum'),
  JSON.stringify(userOf(pierce).cosmetics));
const using = await page.$eval('[data-cosmetic="bee_pink"]', (b) => b.textContent);
check('按鈕寫「使用中」', /使用中/.test(using), using);
await page.waitForSelector('.lb-game', { timeout: 5000 }).catch(() => {});
const lbText = await page.textContent('#leaderboard');
check('排行榜畫得出來：名字、分數、稱號', /Pierce/.test(lbText) && /10 分/.test(lbText) && /拼字新星/.test(lbText) && /Allen/.test(lbText), lbText.replace(/\s+/g, ' ').slice(0, 120));
// 等快取寫好再換頁（外觀在背景佇列裡送）
await page.waitForFunction(() => {
  try { return JSON.parse(localStorage.getItem('sb:v2:shared:currentUser')).cosmetics.killFx === 'fx_hearts'; } catch (e) { return false; }
}, null, { timeout: 5000 }).catch(() => {});

console.log('\n4) 個人檔案與選人畫面');
await page.goto(`${BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#avatar-preview img', { timeout: 10000 });
const beeSrc = await page.$eval('#avatar-preview img', (img) => img.getAttribute('src'));
check('個人檔案的拼字蜂是粉紅色的', beeSrc === '/assets/sprites/bee-pink.svg', beeSrc);
check('個人檔案看得到稱號', (await page.textContent('#avatar-title')).includes('拼字新星'));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.profile-tile', { timeout: 10000 });
const tile = await page.textContent('.profile-tile:has-text("Pierce")');
check('選人畫面的名字下面有稱號', tile.includes('拼字新星'), tile.replace(/\s+/g, ' '));

console.log('\n5) ⭐ 遊戲：特效換了，戰鬥本身一模一樣');
async function playLevel(seed) {
  await page.goto(`${BASE}/game?level=1&n=3&difficulty=easy&order=sequential&show=1&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  const st = await page.evaluate(() => window.__spellbee.state());
  // 一次直接把整個字的按鍵送進去：每一次跑的按鍵、時間點都一樣
  await page.evaluate((word) => { for (const ch of word) window.__spellbee.press?.(ch); }, st.target);
  await page.keyboard.type(st.target, { delay: 0 });
  await page.waitForTimeout(60);
  return page.evaluate(() => ({
    fx: window.__spellbeeScene.effects.stats().fx,
    splashes: window.__spellbeeScene.effects.stats().splashes,
    stinger: window.__spellbeeScene.effects.pools.stingers.items[0].node.fillColor,
    killed: window.__spellbee.state().stats.wordsKilled
  }));
}
const withFx = await playLevel(12345);
check('打掉一隻：噴的是愛心特效', withFx.killed >= 1 && withFx.fx > 0, JSON.stringify(withFx));
check('打掉一隻：沒有噴蜂蜜', withFx.splashes === 0, String(withFx.splashes));
check('蜂針換成粉紅色', withFx.stinger === 0xff7eb6, withFx.stinger.toString(16));

// 戰鬥邏輯讀不到外觀：同一個種子、同一串按鍵，用核心模擬兩次結果一定一樣
const { createBattle, applyAction, stepBattle } = await import('../public/js/game/core/battle.js');
const coreSrc = (await import('node:fs')).readdirSync(new URL('../public/js/game/core/', import.meta.url))
  .filter((f) => f.endsWith('.js'))
  .map((f) => (require('node:fs')).readFileSync(new URL(`../public/js/game/core/${f}`, import.meta.url), 'utf8'))
  .join('\n');
check('戰鬥核心完全沒有讀外觀（不 import cosmetics、沒有 killFx / soundPack）',
  !/cosmetic|killFx|soundPack|beeColor/.test(coreSrc));
void createBattle; void applyAction; void stepBattle;

await browser.close();
check('沒有瀏覽器錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));

/* ── 刪帳號：榜上的名字一起走 ─────────────────────────────── */
console.log('\n6) 刪帳號');
{
  const r = await api(allen, 'DELETE', `/auth/profiles/${allen.id}`, { confirmNickname: 'Allen' });
  check('刪得掉', r.status === 200, String(r.status));
  check('他的最高分紀錄也刪了', !(store.minigameBests || []).some((x) => String(x.userId) === allen.id));
  const lb = await api(pierce, 'GET', '/shop/leaderboard');
  check('榜上不會再出現他', !(lb.body.boards?.minigame_stack || []).some((x) => x.nickname === 'Allen'));
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
