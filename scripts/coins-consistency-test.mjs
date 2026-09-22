/**
 * 金幣數字不可以變少。
 *
 * 兒子第三次回報：「本來 700 多，跳到單字庫去錄音時，又變成 680。」
 *
 * 金幣本身沒有算錯。壞的是換頁：requireLogin() 為了不擋畫面，換頁時直接
 * 拿 localStorage 裡快取的 user 畫出來，而練習途中賺到的錢只加在記憶體裡，
 * 從來沒寫回快取。所以下一頁拿到的是**這一頁載入時**的舊數字。
 *
 * 背景其實會重抓一次 user，但以前沒有人聽那個結果（auth.js 發了
 * 'user-refreshed'，全專案沒有任何 listener），所以連自我修正的機會都沒有。
 *
 * 錢變少對小孩不是顯示問題，是「我的錢不見了」。
 *
 * 要證明的事：
 *   1. 伺服器確認新的金幣數之後，快取會跟著更新（下一頁才不會倒退）
 *   2. 背景驗證回來時，導覽列會往上校正
 *   3. 但不會把「等待期間剛賺到的錢」蓋掉——那會變成另一種錢變少
 *
 * 用法：node scripts/coins-consistency-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

/*
 * 不需要真的登入、真的練習。
 *
 * 這幾條驗的是 nav-partial 與 auth 這兩個模組之間的約定，把它們直接
 * 載進一個空白頁測就好——搭一整套資料庫環境只為了繞到那幾行，
 * 反而會讓測試在環境有問題時假失敗。
 */
await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });

const CACHE_KEY = 'sb:v2:shared:currentUser';

console.log('1) 伺服器確認金幣後，快取要跟著更新');
{
  const result = await page.evaluate(async (cacheKey) => {
    const auth = await import('/js/auth.js');
    const nav = await import('/js/nav-partial.js');

    // 先放一個「這一頁載入時」的快取，金幣 680
    localStorage.setItem(cacheKey, JSON.stringify({ _id: 'u1', nickname: '測試', coins: 680 }));

    // 掛上導覽列（用快取那個 user，跟真實流程一樣）
    document.body.insertAdjacentHTML('beforeend', '<div data-nav-mount></div>');
    await nav.mountNav({ _id: 'u1', nickname: '測試', coins: 680 }, 'practice');

    const shownAtLoad = document.querySelector('[data-nav-coins]')?.textContent;

    // 練習途中賺了錢，伺服器確認到 700
    nav.setNavCoins(700);

    return {
      shownAtLoad,
      shownNow: document.querySelector('[data-nav-coins]')?.textContent,
      cached: auth.getCachedUser()?.coins,
      navValue: nav.getNavCoins()
    };
  }, CACHE_KEY);

  check('載入時顯示快取的數字', result.shownAtLoad === '🪙 680', result.shownAtLoad);
  check('賺到錢之後畫面跟上', result.shownNow === '🪙 700', result.shownNow);
  check(
    '快取也被更新了（這就是換頁不會倒退的原因）',
    result.cached === 700,
    `快取=${result.cached}`
  );
  check('getNavCoins() 一致', result.navValue === 700, String(result.navValue));
}

console.log('2) 換頁之後不會倒退回舊數字');
{
  /*
   * 真的換一頁，然後看導覽列從快取拿到什麼。
   * 修好之前這裡會是 680——那正是他看到的畫面。
   */
  const cached = await page.evaluate((k) => JSON.parse(localStorage.getItem(k))?.coins, CACHE_KEY);
  check('換頁前快取已經是新的數字', cached === 700, String(cached));

  await page.goto(`${BASE}/wordbank.html`, { waitUntil: 'domcontentloaded' });
  const afterNav = await page.evaluate((k) => JSON.parse(localStorage.getItem(k))?.coins, CACHE_KEY);
  check('換到單字庫之後，快取沒有被舊值蓋回去', afterNav >= 700, String(afterNav));
}

console.log('3) 背景驗證只往上校正，不會抹掉剛賺到的錢');
{
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(async (cacheKey) => {
    const nav = await import('/js/nav-partial.js');
    localStorage.setItem(cacheKey, JSON.stringify({ _id: 'u1', nickname: '測試', coins: 500 }));
    document.body.insertAdjacentHTML('beforeend', '<div data-nav-mount></div>');
    await nav.mountNav({ _id: 'u1', nickname: '測試', coins: 500 }, 'practice');

    // 快取落後：伺服器其實有 900
    window.dispatchEvent(new CustomEvent('user-refreshed', { detail: { coins: 900, nickname: '測試' } }));
    const afterUp = nav.getNavCoins();

    /*
     * 反過來的情況：他在等待期間又答對了幾題（畫面已經 950），
     * 這時候那個「頁面剛載入時發出」的舊回應才回來，說只有 900。
     * 蓋下去就等於把剛賺到的 50 抹掉——又變成錢變少，只是換一個原因。
     */
    nav.setNavCoins(950);
    window.dispatchEvent(new CustomEvent('user-refreshed', { detail: { coins: 900, nickname: '測試' } }));
    const afterStale = nav.getNavCoins();

    return { afterUp, afterStale };
  }, CACHE_KEY);

  check('快取落後時，往上校正到伺服器的數字', r.afterUp === 900, String(r.afterUp));
  check('過時的回應不會把剛賺到的錢蓋掉', r.afterStale === 950, String(r.afterStale));
}

check('沒有 JS 例外', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
