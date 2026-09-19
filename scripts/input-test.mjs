/**
 * 輸入層測試——Phase 1.2 的驗收。
 *
 * 這裡測的都是「沒做就會覺得怪怪的，但說不出哪裡怪」的事：
 *   1. 延遲直方圖：keydown → 畫面畫出新狀態，p95 要 ≤ 16ms（一個影格）
 *   2. 按著不放不連發
 *   3. 快打不掉鍵：連續狂按，每一個按鍵都要被算到
 *   4. 空窗期排隊：人為封鎖輸入，按鍵要留著而不是被吃掉
 *   5. 輸入法：組字中的按鍵要被擋下並顯示提示
 *   6. 失焦自動暫停
 *   7. 觸控裝置：要能叫出螢幕鍵盤（隱形輸入框拿到焦點）
 *
 * 用法：node scripts/input-test.mjs
 * 需要伺服器跑在 BASE（預設 http://127.0.0.1:3100）。
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

const consoleErrors = [];
async function newGamePage(contextOpts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...contextOpts });
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
  });
  /*
   * 輕鬆難度 + 全部 100 個字（約 700 個字母）。
   * 一場打得完 500 次按鍵，就不必中途重開——重開會把延遲統計歸零。
   */
  await page.goto(`${BASE}/game?seed=4242&part=all&n=100&difficulty=easy`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
    timeout: 15000
  });
  return { page, context };
}

/* ── 1. 延遲直方圖 ──────────────────────────────────────── */
console.log('1) 按鍵延遲（keydown → 畫出新狀態）');
{
  const { page, context } = await newGamePage();
  for (let i = 0; i < 500; i += 1) {
    const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
    if (!ch) break;
    await page.keyboard.press(ch);
    // 每一下之間讓畫面至少更新一格，延遲才量得到「畫出來」的時間
    if (i % 5 === 0) await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  const lat = await page.evaluate(() => window.__spellbee.latency());
  console.log(
    `     樣本 ${lat.samples}　p50 ${lat.p50}ms　p95 ${lat.p95}ms　p99 ${lat.p99}ms　最差 ${lat.worst}ms`
  );
  check('樣本數 ≥ 300', lat.samples >= 300, String(lat.samples));
  check('p95 ≤ 16ms（一個影格）', lat.p95 <= 16, `${lat.p95}ms`);
  await context.close();
}

/* ── 2. 按著不放不連發 ──────────────────────────────────── */
console.log('\n2) 按著不放不該連發');
{
  const { page, context } = await newGamePage();
  const result = await page.evaluate(() => {
    const before = window.__spellbee.state().stats;
    const ch = window.__spellbee.expectedLetter();
    // 模擬按住不放：第一個是真的按下，後面九個都是 repeat
    for (let i = 0; i < 10; i += 1) {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ch, repeat: i > 0, bubbles: true, cancelable: true })
      );
    }
    const after = window.__spellbee.state().stats;
    return {
      correctDelta: after.correctLetters - before.correctLetters,
      wrongDelta: after.wrongLetters - before.wrongLetters
    };
  });
  check(
    '十次 keydown（九次 repeat）只算一次',
    result.correctDelta + result.wrongDelta === 1,
    `對 +${result.correctDelta} 錯 +${result.wrongDelta}`
  );
  await context.close();
}

/* ── 3. 快打不掉鍵 ──────────────────────────────────────── */
console.log('\n3) 連續狂按，每一下都要被算到');
{
  const { page, context } = await newGamePage();
  const result = await page.evaluate(async () => {
    const before = window.__spellbee.state().stats;
    let sent = 0;
    // 不等待任何影格，一口氣灌 200 下——模擬手速遠快於畫面更新
    for (let i = 0; i < 200; i += 1) {
      const ch = window.__spellbee.expectedLetter();
      if (!ch) break;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
      sent += 1;
    }
    const after = window.__spellbee.state().stats;
    return {
      sent,
      counted:
        after.correctLetters -
        before.correctLetters +
        (after.wrongLetters - before.wrongLetters),
      queue: window.__spellbee.queue()
    };
  });
  check(
    `灌 ${result.sent} 下，全部被算到`,
    result.counted === result.sent,
    `算到 ${result.counted}，佇列剩 ${result.queue.size}，丟棄 ${result.queue.dropped}`
  );
  await context.close();
}

/* ── 4. 空窗期排隊 ──────────────────────────────────────── */
console.log('\n4) 不接受輸入的空窗期，按鍵要排隊不能被吃掉');
{
  const { page, context } = await newGamePage();
  const result = await page.evaluate(async () => {
    const before = window.__spellbee.state().stats;
    const st = window.__spellbee.state();
    // 接下來的五個字母：排隊如果亂序，就會被算成打錯，一次驗兩件事
    const letters = st.target.slice(st.typed, st.typed + 5).split('');

    // 人為製造 200ms 的空窗（1.3 的擊殺頓挫會是真實來源）
    window.__spellbee.blockInput(200);
    for (const ch of letters) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
    }
    const duringBlock = window.__spellbee.state().stats.correctLetters - before.correctLetters;
    const queuedDuring = window.__spellbee.queue().size;

    await new Promise((r) => setTimeout(r, 400));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    const after = window.__spellbee.state().stats;
    return {
      sent: letters.length,
      duringBlock,
      queuedDuring,
      afterDelta: after.correctLetters - before.correctLetters,
      wrongDelta: after.wrongLetters - before.wrongLetters,
      queueAfter: window.__spellbee.queue().size,
      dropped: window.__spellbee.queue().dropped
    };
  });
  check('空窗期間確實沒有立刻套用', result.duringBlock === 0, `套用了 ${result.duringBlock}`);
  check('空窗期間有排進佇列', result.queuedDuring === result.sent, `佇列 ${result.queuedDuring}`);
  check(
    '空窗結束後全部補上，而且順序正確',
    result.afterDelta === result.sent && result.wrongDelta === 0,
    `對 +${result.afterDelta}／錯 +${result.wrongDelta}（送出 ${result.sent}）`
  );
  check('佇列已清空且沒有丟棄', result.queueAfter === 0 && result.dropped === 0);
  await context.close();
}

/* ── 5. 中文輸入法 ──────────────────────────────────────── */
console.log('\n5) 中文輸入法要被偵測並提示');
{
  const { page, context } = await newGamePage();
  const result = await page.evaluate(() => {
    const before = window.__spellbee.state().stats;
    // 組字中的按鍵：瀏覽器一律送 keyCode 229
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true, cancelable: true })
    );
    const after = window.__spellbee.state().stats;
    return {
      counted:
        after.correctLetters - before.correctLetters + (after.wrongLetters - before.wrongLetters),
      suspected: window.__spellbee.imeSuspected(),
      warningVisible: !document.getElementById('ime-warning').hidden
    };
  });
  check('組字中的按鍵不被計入', result.counted === 0, `算到 ${result.counted}`);
  check('有標記為輸入法問題', result.suspected === true);
  check('畫面有顯示提示', result.warningVisible === true);

  // 切回英文之後提示要自己消失
  const cleared = await page.evaluate(() => {
    const ch = window.__spellbee.expectedLetter();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
    return {
      suspected: window.__spellbee.imeSuspected(),
      warningVisible: !document.getElementById('ime-warning').hidden
    };
  });
  check('打出正常字母後提示消失', cleared.suspected === false && cleared.warningVisible === false);
  await context.close();
}

/* ── 6. 失焦自動暫停 ────────────────────────────────────── */
console.log('\n6) 切到別的視窗要自動暫停');
{
  const { page, context } = await newGamePage();
  const result = await page.evaluate(async () => {
    const tickBefore = window.__spellbee.state().tick;
    window.dispatchEvent(new Event('blur'));
    await new Promise((r) => setTimeout(r, 250));
    const tickAfter = window.__spellbee.state().tick;
    return { tickBefore, tickAfter, paused: document.body.classList.contains('is-paused') };
  });
  check('畫面有進入暫停狀態', result.paused === true);
  check(
    '暫停期間邏輯沒有繼續推進',
    result.tickAfter === result.tickBefore,
    `${result.tickBefore} → ${result.tickAfter}`
  );
  await context.close();
}

/* ── 7. 觸控裝置 ────────────────────────────────────────── */
console.log('\n7) 觸控裝置要叫得出螢幕鍵盤');
{
  // iPad 橫向；hasTouch 讓遊戲走觸控路徑
  const { page, context } = await newGamePage({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: false
  });
  const before = await page.evaluate(() => ({
    hasTouchInput: !!document.querySelector('.touch-input'),
    tapVisible: !document.getElementById('tap-to-start').hidden,
    listenVisible: getComputedStyle(document.getElementById('listen-buttons')).display !== 'none'
  }));
  check('有建立隱形輸入框', before.hasTouchInput === true);
  check('有顯示「點一下開始」', before.tapVisible === true);
  check('有顯示螢幕上的聽力按鍵', before.listenVisible === true);

  await page.click('#tap-to-start');
  const after = await page.evaluate(() => ({
    focused: document.activeElement?.classList.contains('touch-input'),
    tapVisible: !document.getElementById('tap-to-start').hidden
  }));
  check('點擊後隱形輸入框拿到焦點（螢幕鍵盤才會出現）', after.focused === true);
  check('提示已收起', after.tapVisible === false);

  // 螢幕上的聽力按鍵要真的送得出動作
  const listen = await page.evaluate(async () => {
    const before2 = window.__spellbee.state().stats.listens;
    document.querySelector('[data-listen="replay"]').click();
    await new Promise(requestAnimationFrame);
    return window.__spellbee.state().stats.listens - before2;
  });
  check('螢幕上的「再聽」按鍵有作用', listen === 1, `listens +${listen}`);
  await context.close();
}

await browser.close();

console.log('\n驗收');
check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
