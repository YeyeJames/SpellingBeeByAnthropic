/**
 * 商店一定要有東西。
 *
 * 兒子第一次玩就先跑去點商店想看有什麼——而那時候 Render 上的
 * shopItemCount 是 0，他看到的是一片空白。
 *
 * 原因不是「忘了跑 npm run seed」，是流程本身有問題：商店品項跟單字庫
 * 一樣是靜態資料，單字庫不需要 seed 就能用，商店沒有道理需要。
 * 商店是賺金幣的唯一理由，第一次點進去空白，他學到的是「這裡沒東西」，
 * 之後就不會再點了。
 *
 * 要證明的事：
 *   1. 連上資料庫就會有品項，不需要任何額外指令
 *   2. 重複啟動不會變成重複的品項（upsert 要真的是冪等的）
 *   3. 改過價格之後，重新啟動會更新到新的價格
 *   4. 清單本身是合理的：每一項都有 key/價格，圖檔真的存在
 *   5. 真的空的時候，畫面要說話而不是留一片空白
 *
 * 用法：node scripts/shop-test.mjs
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const { SHOP_ITEMS } = require('../server/data/shop-items');

/* ── 4. 清單本身 ─────────────────────────────────────────── */
console.log('1) 清單本身要合理');
{
  check('有品項', SHOP_ITEMS.length > 0, `${SHOP_ITEMS.length} 項`);
  const keys = SHOP_ITEMS.map((i) => i.key);
  check('key 不重複（重複的話 upsert 會互相蓋掉）', new Set(keys).size === keys.length);
  check(
    '每一項都有 key、名稱、正的價格',
    SHOP_ITEMS.every((i) => i.key && i.name && Number.isFinite(i.cost) && i.cost > 0),
    SHOP_ITEMS.filter((i) => !(i.key && i.name && i.cost > 0)).map((i) => i.key).join(',')
  );
  /*
   * 圖檔要真的在。
   *
   * 少一個檔案不會有任何錯誤訊息，只會在商店裡出現一個破掉的圖——
   * 而那正是「看起來壞掉了」的樣子。
   */
  const missing = SHOP_ITEMS.filter((i) => i.iconAsset && !existsSync(`public${i.iconAsset}`));
  check('圖檔都存在', missing.length === 0, missing.map((i) => i.iconAsset).join(', '));
}

/* ── 1~3. 連上資料庫就有東西 ─────────────────────────────── */
console.log('2) 連上資料庫就會有品項，不必跑任何指令');
{
  const store = { shopItems: [], users: [] };
  const fake = createFakeDb(store);

  /*
   * 呼叫 db.js 裡**真的**那個 seedShopItems，不是在測試裡另外抄一份
   * upsert 迴圈——抄一份的話，真正的程式壞掉了測試照樣會過。
   *
   * connectDB() 本身要連真的 MongoClient，所以只跑它成功之後的那一步；
   * 而出問題的正是那一步（以前根本沒有那一步）。
   */
  const { seedShopItems } = require('../server/db.js');
  const items = SHOP_ITEMS;

  await seedShopItems(fake);
  check('第一次啟動就把品項建起來了', store.shopItems.length === items.length,
    `${store.shopItems.length} / ${items.length}`);
  check('品項內容真的寫進去了',
    items.every((i) => store.shopItems.some((r) => r.key === i.key && r.cost === i.cost)),
    store.shopItems.map((r) => `${r.key}:${r.cost}`).join(', '));

  await seedShopItems(fake);
  await seedShopItems(fake);
  check('重複啟動不會變成重複的品項', store.shopItems.length === items.length,
    `跑三次之後有 ${store.shopItems.length} 項`);

  // 改價格 → 重新啟動 → 要更新
  const target = store.shopItems.find((i) => i.key === items[0].key);
  target.cost = 99999;
  await seedShopItems(fake);
  const after = store.shopItems.find((i) => i.key === items[0].key);
  check('改過的價格會被更新回程式碼裡的值', after.cost === items[0].cost,
    `${after.cost}（應該是 ${items[0].cost}）`);

  /*
   * 連線流程真的有呼叫它。
   *
   * 上面那幾條是直接呼叫 seedShopItems() 測的，所以只要函式本身沒壞就會過——
   * 但當初出事的**不是函式，是沒有人呼叫它**（品項只寫在一支要手動跑的
   * 腳本裡）。把 connectDB 裡那一行刪掉，上面全部照樣通過。
   *
   * connectDB() 要連真的 MongoClient，在這台機器上跑不起來，所以退而求其次
   * 檢查原始碼裡那一行還在。這條比較弱，但它守的正是真正斷掉過的地方。
   */
  const { readFileSync } = await import('node:fs');
  const dbSrc = readFileSync(new URL('../server/db.js', import.meta.url), 'utf8');
  const connectBody = dbSrc.slice(
    dbSrc.indexOf('async function connectDB'),
    dbSrc.indexOf('async function seedShopItems')
  );
  const wiredUp = /await\s+seedShopItems\s*\(/.test(
    connectBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  );
  check('connectDB() 真的會呼叫它（當初斷掉的就是這一環）', wiredUp);
}

/* ── 5. 空的時候畫面要說話 ───────────────────────────────── */
console.log('3) 萬一真的空了，畫面不能留一片空白');
{
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  /*
   * 攔截商店 API 回一個空清單，模擬「資料庫裡沒有品項」。
   * 這是他實際遇到的畫面，所以一定要驗這個狀態長什麼樣子。
   */
  await context.route('**/api/shop/items*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  );
  /*
   * 商店頁沒登入會直接導回首頁，那樣 renderItems() 根本不會跑，
   * 測出來的「空白」是被導走造成的，不是空清單造成的——
   * 第一版就是這樣假失敗的（cards=0、text=""，因為頁面壓根沒渲染）。
   * 所以塞一個假的登入狀態進去。
   */
  const FAKE_USER = { _id: 'u-test', nickname: '測試', coins: 500, activeTheme: 'sports', ownedItemKeys: [], avatar: { baseCharacter: 'rookie', accessories: [] } };
  await context.route('**/api/auth/me*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: FAKE_USER }) })
  );
  await context.addInitScript((user) => {
    try {
      localStorage.removeItem('sb:v2:shared:shopItems');
      localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(user));
    } catch (e) { /* 無痕模式 */ }
  }, FAKE_USER);

  await page.goto(`${BASE}/shop.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const grid = await page.evaluate(() => {
    const el = document.getElementById('shop-grid');
    return { text: (el?.textContent || '').trim(), cards: el?.querySelectorAll('.shop-card').length ?? -1 };
  });
  check('沒有商品卡', grid.cards === 0, String(grid.cards));
  check('但有寫一句話，不是一片空白', grid.text.length > 0, JSON.stringify(grid.text));

  check('沒有 JS 例外', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
