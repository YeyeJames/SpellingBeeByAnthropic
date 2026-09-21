/**
 * 遊戲頁的解鎖關卡——瀏覽器這一側。
 *
 * 伺服器那邊的規則已經由 account-flow-test 驗過了。這支驗的是**畫面**：
 * 鎖著的時候他看到的是什麼。
 *
 * 為什麼這件事值得單獨測：鎖住如果只是「遊戲開不起來」，他看到的會是一片
 * 黑畫面或一句錯誤訊息，那跟壞掉沒有分別。鎖住必須是一個看得懂的畫面，
 * 講出還差幾次，而且給一條回練習模式的路。
 *
 * 另外要確認的是**別擋錯人**：問不到解鎖狀態（沒登入、資料庫掛了、離線）
 * 一律放行。這種時候他連練習都練不了，再把遊戲鎖起來等於整個 app 不能用。
 *
 * 用法：node scripts/game-gate-test.mjs
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

/**
 * 開一次遊戲頁，並且指定 /api/game/access 要回什麼。
 * @param access null 代表這支 API 整個失敗（沒登入／資料庫掛了／離線）
 */
async function openGame(access) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route('**/api/game/access**', (route) => {
    if (!access) return route.fulfill({ status: 503, body: '{"error":"資料庫尚未連線"}' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(access)
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/game?group=w18&n=20&order=sequential&show=1&difficulty=easy`, {
    waitUntil: 'domcontentloaded'
  });
  return { context, page, errors };
}

/* ── 1. 鎖著的時候 ─────────────────────────────────────── */
console.log('1) 還沒練完兩次');
{
  const { context, page, errors } = await openGame({
    group: { id: 'w18', label: 'Week 18', count: 14 },
    unlocked: false,
    practiceCompletions: 1,
    completionsNeeded: 1,
    unlockAfter: 2
  });

  await page.waitForSelector('#locked-panel:not([hidden])', { timeout: 10000 });
  const text = await page.locator('#locked-panel').innerText();

  check('顯示的是解鎖說明，不是錯誤訊息', /還沒解鎖/.test(text), text.split('\n')[0]);
  check('寫出是哪一組', /Week 18/.test(text), text);
  check('講出已經練了幾次、還差幾次', /1 次/.test(text) && /再 1 次/.test(text), text);

  const link = page.locator('#locked-panel a[href="/practice.html"]');
  check('給了一條回練習模式的路', (await link.count()) === 1);
  /*
   * 這顆不可以是 .btn-order。那個 class 是「照順序／打亂」的按鈕，
   * 借用的話開場畫面就會被算成有三顆順序鈕——測試抓得到，人眼抓不到。
   */
  check('沒有借用開場畫面的順序按鈕樣式',
    (await page.locator('#locked-panel .btn-order').count()) === 0);

  /*
   * 鎖著就不該把 Phaser 與戰鬥載進來——那是幾百 KB，而且載了也用不到。
   * 順便也證明遊戲真的沒有在背景跑起來。
   */
  const started = await page.evaluate(() => !!window.__spellbee && window.__spellbee.ready);
  check('遊戲沒有偷偷開起來', !started, String(started));
  check('載入畫面有收掉（不是卡在載入中）',
    !(await page.evaluate(() => document.body.classList.contains('page-loading'))));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));

  await context.close();
}

/* ── 2. 解鎖之後 ───────────────────────────────────────── */
console.log('\n2) 已經練完兩次');
{
  const { context, page, errors } = await openGame({
    group: { id: 'w18', label: 'Week 18', count: 14 },
    unlocked: true,
    practiceCompletions: 2,
    completionsNeeded: 0,
    unlockAfter: 2
  });

  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  check('遊戲開得起來', true);
  check('沒有跳出解鎖說明',
    await page.evaluate(() => document.getElementById('locked-panel')?.hidden !== false));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));

  await context.close();
}

/* ── 3. 問不到的時候要放行 ─────────────────────────────── */
console.log('\n3) 問不到解鎖狀態（沒登入／資料庫掛了／離線）');
{
  const { context, page, errors } = await openGame(null);

  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  check('照樣玩得起來（不然整個 app 等於不能用）', true);
  check('沒有跳出解鎖說明',
    await page.evaluate(() => document.getElementById('locked-panel')?.hidden !== false));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));

  await context.close();
}

await browser.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
