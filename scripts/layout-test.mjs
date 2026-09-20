/**
 * 跨裝置版面測試。
 *
 * 開發計畫第 3 章答應過要測三種尺寸，之前只測了 1280×720 與 iPad，
 * 這支把它補齊。要證明的不是「好不好看」（那我判斷不了），而是
 * 「有沒有東西跑到畫面外、疊在一起、或被裁掉」——這幾種問題機器看得出來，
 * 而且在不同解析度上最容易發生。
 *
 * 每個尺寸都檢查：
 *   1. 不會出現橫向捲軸（畫面被撐開就代表有東西超出寬度）
 *   2. 下面那條工具列整條在畫面內，而且不會壓到戰場
 *   3. 蜂巢、敵人、危險線都在畫面範圍內
 *   4. 題目、漏字提示、結束訊息三段文字不重疊
 *   5. 開場畫面與校準畫面整個看得到
 *
 * 用法：node scripts/layout-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`    [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/*
 * iPad 橫向要測兩次：螢幕鍵盤彈出來之後可視高度會少掉一大截，
 * 而那正是他實際打字時看到的畫面。不測的話，「鍵盤一出來蜂巢就被蓋住」
 * 這種問題只有他在 iPad 上才會遇到。
 */
const SIZES = [
  { name: '桌機 1920×1080', width: 1920, height: 1080 },
  { name: '桌機 1440×900', width: 1440, height: 900 },
  { name: '筆電 1280×720', width: 1280, height: 720 },
  { name: 'iPad 橫向 1024×768', width: 1024, height: 768, touch: true },
  { name: 'iPad 橫向＋螢幕鍵盤 1024×430', width: 1024, height: 430, touch: true }
];

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const pageErrors = [];

for (const size of SIZES) {
  console.log(`\n${size.name}`);

  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: !!size.touch,
    isMobile: !!size.touch
  });
  await context.addInitScript(() => {
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${e.message}`));

  /* ── 開場畫面 ── */
  await page.goto(`${BASE}/game?group=w04&n=200&show=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  const pregame = await page.evaluate(() => {
    const r = document.getElementById('pregame').getBoundingClientRect();
    const btn = document.querySelector('.btn-order').getBoundingClientRect();
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      btnBottom: btn.bottom,
      btnTop: btn.top,
      h: window.innerHeight,
      panelH: r.height
    };
  });
  check('開場畫面沒有撐出橫向捲軸', !pregame.overflowX);
  check(
    '開場的按鈕整顆在畫面內',
    pregame.btnTop >= 0 && pregame.btnBottom <= pregame.h,
    `按鈕 ${Math.round(pregame.btnTop)}~${Math.round(pregame.btnBottom)}，畫面高 ${pregame.h}`
  );

  /* ── 戰鬥畫面 ── */
  if (size.touch) {
    await page.click('[data-order="sequential"]');
  } else {
    await page.click('[data-order="sequential"]');
  }
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  await page.waitForTimeout(200);

  const L = await page.evaluate(() => {
    const s = window.__spellbeeScene;
    const canvas = document.querySelector('#game-root canvas');
    const chrome = document.getElementById('game-chrome').getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const box = (t) => ({ top: t.y - t.height / 2, bottom: t.y + t.height / 2, x: t.x });
    return {
      overflowX: document.documentElement.scrollWidth > w,
      canvasW: canvas ? canvas.clientWidth : 0,
      canvasH: canvas ? canvas.clientHeight : 0,
      w,
      h,
      chromeTop: chrome.top,
      chromeBottom: chrome.bottom,
      laneY: s.laneY,
      hiveX: s.hiveX,
      dangerX: s.dangerX,
      enemyX: s.enemy.x,
      word: box(s.wordText),
      miss: box(s.missText),
      missHint: box(s.missHint),
      status: box(s.statusText)
    };
  });

  check('戰鬥畫面沒有撐出橫向捲軸', !L.overflowX);
  check(
    '畫布鋪滿視窗',
    Math.abs(L.canvasW - L.w) <= 2 && Math.abs(L.canvasH - L.h) <= 2,
    `畫布 ${L.canvasW}×${L.canvasH}、視窗 ${L.w}×${L.h}`
  );
  check(
    '工具列整條在畫面內',
    L.chromeBottom <= L.h + 1 && L.chromeTop >= 0,
    `${Math.round(L.chromeTop)}~${Math.round(L.chromeBottom)} / ${L.h}`
  );
  /*
   * 工具列不能壓到戰場那條線。壓到的話，敵人走到蜂巢前面那幾步
   * 會被按鈕蓋住——而那正是最需要看清楚的時刻。
   */
  check(
    '工具列沒有壓到戰場',
    L.laneY + 45 <= L.chromeTop,
    `戰場 y=${Math.round(L.laneY)}、工具列 top=${Math.round(L.chromeTop)}`
  );
  check(
    '蜂巢、危險線、敵人都在畫面內',
    L.hiveX > 40 && L.hiveX < L.w && L.dangerX > 0 && L.dangerX < L.w && L.enemyX > 0 && L.enemyX <= L.w,
    `蜂巢 ${Math.round(L.hiveX)}、危險線 ${Math.round(L.dangerX)}、敵人 ${Math.round(L.enemyX)} / 寬 ${L.w}`
  );
  check(
    '題目文字在畫面內',
    L.word.top >= 0 && L.word.bottom <= L.h,
    `${Math.round(L.word.top)}~${Math.round(L.word.bottom)} / ${L.h}`
  );
  /*
   * 三段文字不能疊在一起：最後一條命被某個字打掉的時候，
   * 「蜂巢被攻破了」與「正確拼法」會同時出現在畫面上。
   */
  check(
    '漏字提示與結束訊息不重疊',
    L.missHint.bottom < L.status.top,
    `提示底 ${Math.round(L.missHint.bottom)}、結束訊息頂 ${Math.round(L.status.top)}`
  );
  check(
    '漏字提示與題目不重疊',
    L.word.bottom < L.miss.top,
    `題目底 ${Math.round(L.word.bottom)}、提示頂 ${Math.round(L.miss.top)}`
  );

  /* ── 校準畫面 ── */
  await page.goto(`${BASE}/game?group=w04&n=200&calibrate=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#calibrate:not([hidden])', { timeout: 15000 });
  const cal = await page.evaluate(() => {
    const word = document.getElementById('calibrate-word').getBoundingClientRect();
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      top: word.top,
      bottom: word.bottom,
      h: window.innerHeight
    };
  });
  check('校準畫面沒有撐出橫向捲軸', !cal.overflowX);
  check(
    '校準的題目在畫面內',
    cal.top >= 0 && cal.bottom <= cal.h,
    `${Math.round(cal.top)}~${Math.round(cal.bottom)} / ${cal.h}`
  );

  await context.close();
}

await browser.close();

console.log('\n驗收');
check('沒有未捕捉的例外', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
