/**
 * 小遊戲：每玩一次付一次錢，而且扣得正確。
 *
 * 家長決定小遊戲「每玩一次付一點金幣」——孩子練累了會先去商店，
 * 買了就無限玩的話，小遊戲很容易變成取代練習的東西。
 *
 * 這一支要證明的是「錢」那一半做對了：
 *   1. 沒買的不能玩
 *   2. 付了才能玩，扣的是 playCost
 *   3. 同一筆重送（網路重試、按鈕連點）只扣一次
 *   4. 錢不夠就不扣，而且金幣不會變成負的
 *   5. 兩個請求同時到，也只有錢夠的那一個會成功
 *   6. 每一個小遊戲都打得開、玩得完、而且結束時不會加任何金幣
 *
 * 用法：node scripts/minigame-test.mjs（自己起伺服器）
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 起真的伺服器，只換掉資料庫 ─────────────────────────── */
/*
 * 商店目錄在真的伺服器上是連線時從 shop-items.js 寫進資料庫的（db.js 的
 * seedShopItems）；假資料庫的 connectDB 不會做這一步，所以這裡照同一份清單先放好。
 */
const { SHOP_ITEMS: CATALOG } = require('../server/data/shop-items.js');
const store = { shopItems: CATALOG.map((i) => ({ ...i })) };
installFakeDb(createFakeDb(store, {
  uniqueIndexes: { minigamePlays: ['userId', 'opId'], purchases: ['userId', 'opId'] }
}));
const PORT = 6000 + Math.floor(Math.random() * 1000);
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
/*
 * server/index.js 為了不讓網站整個掛掉，會把未捕捉的例外吞掉繼續跑。
 * 這對網站是對的，對測試是錯的：測試自己的逾時也會被吞掉，
 * 結果就是整支卡住、永遠不結束（第一次跑就是這樣）。
 * 所以在這裡把它們接過來：記一條失敗、印出來、直接結束。
 */
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
const bail = (err) => {
  console.log(`  [FAIL] 測試中途出錯 — ${err && err.message ? err.message.split('\n')[0] : err}`);
  console.log('\n測試中途出錯');
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const { SHOP_ITEMS } = require('../server/data/shop-items.js');
const MINIGAMES = SHOP_ITEMS.filter((i) => i.type === 'minigame');
const COST = MINIGAMES[0].playCost;

async function register(nickname) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname })
  });
  const body = await r.json();
  return { cookie: r.headers.get('set-cookie').split(';')[0], user: body.user };
}
/** 直接改資料庫：給錢、給東西（測的是「玩」，不是「賺」與「買」） */
function setUser(id, patch) {
  const u = store.users.find((x) => String(x._id) === String(id));
  Object.assign(u, patch);
}
function coinsOf(id) {
  return store.users.find((x) => String(x._id) === String(id)).coins;
}
async function play(cookie, itemKey, opId) {
  const r = await fetch(`${BASE}/api/shop/play`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ itemKey, opId })
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/* ── 1～5. 錢 ───────────────────────────────────────────── */
console.log('1) 沒買的不能玩');
const kid = await register('Pierce');
setUser(kid.user._id, { coins: 1000, ownedItemKeys: [] });
const notOwned = await play(kid.cookie, 'minigame_whack', 'op-1');
check('回 403', notOwned.status === 403, `${notOwned.status} ${notOwned.body.error || ''}`);
check('沒有扣錢', coinsOf(kid.user._id) === 1000, String(coinsOf(kid.user._id)));

console.log('\n2) 付了才能玩');
setUser(kid.user._id, { coins: 1000, ownedItemKeys: MINIGAMES.map((m) => m.key) });
const paid = await play(kid.cookie, 'minigame_whack', 'op-2');
check('付成功', paid.status === 200 && paid.body.ok, `${paid.status}`);
check(`扣的是 playCost（${COST}）`, coinsOf(kid.user._id) === 1000 - COST, String(coinsOf(kid.user._id)));
check('回傳的餘額跟資料庫一樣', paid.body.coins === coinsOf(kid.user._id), String(paid.body.coins));

console.log('\n3) 同一筆重送只扣一次');
const again = await play(kid.cookie, 'minigame_whack', 'op-2');
check('重送也回成功（前端才不會卡住）', again.status === 200 && again.body.ok);
check('但標成重複', again.body.duplicate === true);
check('而且沒有再扣', coinsOf(kid.user._id) === 1000 - COST, String(coinsOf(kid.user._id)));

console.log('\n4) 錢不夠就不扣');
setUser(kid.user._id, { coins: COST - 1 });
const poor = await play(kid.cookie, 'minigame_whack', 'op-3');
check('回 400', poor.status === 400, `${poor.status}`);
check('錯誤訊息講得出一次要多少', (poor.body.error || '').includes(String(COST)), poor.body.error);
check('金幣沒動', coinsOf(kid.user._id) === COST - 1, String(coinsOf(kid.user._id)));
/*
 * 付不成的那一筆要把登記撤掉。不撤的話，這個 opId 會被當成「已經付過」，
 * 他之後有錢了用同一個 opId 再按一次，會拿到「重複、成功」卻沒被扣錢——
 * 等於免費玩一次。
 */
setUser(kid.user._id, { coins: 500 });
const retryAfterEarning = await play(kid.cookie, 'minigame_whack', 'op-3');
check('付不成的那一筆沒有被記成「付過了」', retryAfterEarning.body.duplicate !== true);
check('之後有錢了用同一筆再付，會真的扣錢', coinsOf(kid.user._id) === 500 - COST, String(coinsOf(kid.user._id)));

console.log('\n5) 兩個請求同時到（孩子連點兩下）');
setUser(kid.user._id, { coins: COST + 10 });
const [a, b] = await Promise.all([
  play(kid.cookie, 'minigame_whack', 'op-4'),
  play(kid.cookie, 'minigame_whack', 'op-5')
]);
const oks = [a, b].filter((r) => r.status === 200).length;
check('只有一個成功', oks === 1, `${a.status} / ${b.status}`);
check('金幣沒有變負的', coinsOf(kid.user._id) === 10, String(coinsOf(kid.user._id)));

const unknown = await play(kid.cookie, 'theme_space', 'op-6');
check('不是小遊戲的東西不能「玩」', unknown.status === 404, String(unknown.status));

/* ── 6. 每一個小遊戲都玩得起來 ─────────────────────────── */
console.log('\n6) 每一個小遊戲：付錢 → 玩 → 結束 → 可以再玩一次');
const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// 用真的登入 cookie 進商店
const [name, value] = kid.cookie.split('=');
await context.addCookies([{ name, value, url: BASE }]);
setUser(kid.user._id, { coins: 5000, ownedItemKeys: MINIGAMES.map((m) => m.key) });
await page.goto(`${BASE}/shop.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-minigame-play]', { timeout: 10000 }).catch(() => {});

for (const mg of MINIGAMES) {
  const before = coinsOf(kid.user._id);
  await page.click(`[data-minigame-play="${mg.key}"]`);
  const ready = await page.waitForFunction(
    (k) => window.__minigame && window.__minigame.key === k && window.__minigame.ready, mg.key, { timeout: 15000 }
  ).then(() => true).catch(() => false);
  check(`${mg.name}：打得開`, ready);
  check(`${mg.name}：開始前就扣了 ${mg.playCost}`, coinsOf(kid.user._id) === before - mg.playCost,
    `${before} → ${coinsOf(kid.user._id)}`);

  // 真的玩幾下（每個遊戲自己知道「玩一下」是什麼）
  const scored = await page.evaluate(() => window.__minigame.autoplay());
  check(`${mg.name}：玩得出分數`, scored > 0, `${scored} 分`);

  await page.evaluate(() => window.__minigame.finish());
  const result = await page.waitForSelector('#minigame-result:has-text("分")', { timeout: 8000 })
    .then((el) => el.textContent()).catch(() => '');
  check(`${mg.name}：結束會寫出分數`, /\d/.test(result), result.trim());
  check(`${mg.name}：結束不會加金幣（分數不是真的錢）`, coinsOf(kid.user._id) === before - mg.playCost,
    String(coinsOf(kid.user._id)));

  const againBtn = await page.$('#minigame-again');
  const againText = againBtn ? await againBtn.textContent() : '';
  check(`${mg.name}：有「再玩一次」而且寫出價格`, againText.includes(String(mg.playCost)), againText.trim());

  await page.click('#close-minigame-btn');
  await page.waitForTimeout(200);
}

/*
 * 舊版每打開一次小遊戲就多掛一個事件監聽，打開第五次時，
 * 接到一枚金幣會「叮」五聲。這裡開兩次，確認分數事件只算一次。
 */
const cc = MINIGAMES.find((m) => m.key === 'minigame_coincatch');
for (let i = 0; i < 2; i += 1) {
  await page.click(`[data-minigame-play="${cc.key}"]`);
  await page.waitForFunction(() => window.__minigame && window.__minigame.ready, null, { timeout: 15000 });
  if (i === 0) {
    await page.evaluate(() => window.__minigame.finish());
    await page.click('#close-minigame-btn');
  }
}
const scoreEvents = await page.evaluate(() => {
  window.__minigame.resetScoreEventCount();
  window.__minigame.autoplay();
  return window.__minigame.scoreEventCount();
});
const pts = await page.evaluate(() => window.__minigame.score());
check('打開第二次，分數事件不會重複算', scoreEvents === pts, `事件 ${scoreEvents} 次 / 分數 ${pts}`);
await page.evaluate(() => window.__minigame.finish());
await page.click('#close-minigame-btn');

/*
 * 真的按鍵盤。上面的 autoplay 是直接呼叫遊戲邏輯，測不到
 * 「鍵盤事件有沒有接上」——那一段壞了，遊戲看起來正常，但他按什麼都沒反應。
 */
console.log('\n7) 真的按鍵盤');
setUser(kid.user._id, { coins: 5000 });
await page.click('[data-minigame-play="minigame_whack"]');
await page.waitForFunction(() => window.__minigame.key === 'minigame_whack' && window.__minigame.ready, null, { timeout: 15000 });
await page.waitForTimeout(300);
const current = await page.evaluate(() => window.__minigame.peekLetter && window.__minigame.peekLetter());
check('打蟲：畫面上有一隻蟲', typeof current === 'string' && current.length === 1, String(current));
if (current) await page.keyboard.press(current.toLowerCase());
await page.waitForTimeout(150);
const afterKey = await page.evaluate(() => window.__minigame.score());
check('打蟲：按牠身上的字母（小寫也算）會打到', afterKey === 1, `${afterKey} 分`);
await page.evaluate(() => window.__minigame.finish());
await page.click('#close-minigame-btn');

await page.click('[data-minigame-play="minigame_beeflap"]');
await page.waitForFunction(() => window.__minigame.key === 'minigame_beeflap' && window.__minigame.ready, null, { timeout: 15000 });
const startedBefore = await page.evaluate(() => window.__minigame.peekStarted());
await page.waitForTimeout(800);
const stillWaiting = await page.evaluate(() => window.__minigame.peekStarted());
check('蜜蜂飛行：沒按之前不會開始（不會一打開就掉下去）', startedBefore === false && stillWaiting === false);
await page.keyboard.press('Space');
await page.waitForTimeout(100);
check('蜜蜂飛行：按空白鍵開始', await page.evaluate(() => window.__minigame.peekStarted()) === true);
await page.evaluate(() => window.__minigame.finish());
await page.click('#close-minigame-btn');

/*
 * 錢不夠的時候：按鈕要是灰的，而且寫出差多少——
 * 不是按下去才跳錯誤。
 */
/*
 * 資料庫直接改成 20 塊之後，瀏覽器快取裡還是剛剛的 4000 多——那是這支測試
 * 在背後改資料庫造成的，真實情況只會發生在「別台裝置花掉了錢」，而那種時候
 * 伺服器會擋下來並講清楚（上面第 4 節）。所以這裡把快取清掉再進來，
 * 模擬一次正常的載入，測的是「按鈕照餘額決定能不能按」這件事本身。
 */
setUser(kid.user._id, { coins: 20 });
await page.evaluate(() => localStorage.removeItem('sb:v2:shared:currentUser'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-minigame-play]', { timeout: 10000 });
const poorBtn = await page.$eval(`[data-minigame-play="${cc.key}"]`, (b) => ({ disabled: b.disabled, text: b.textContent }));
check('錢不夠時「玩」是灰的', poorBtn.disabled === true, poorBtn.text);

check('\n沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
