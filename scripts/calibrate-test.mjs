/**
 * 難度校準測試——Phase 1.6 的驗收。
 *
 * 要證明的事：
 *   1. 三種手速打完校準，建議的難度都正確
 *   2. 建議完之後三個難度都還能自己選（量測是起點，不是判決）
 *   3. 選過之後會記住，下次不再問
 *   4. ?calibrate=1 可以重新量
 *   5. 網址明確指定難度時不會被校準擋住（所有自動化測試都靠這個）
 *   6. 聲音自我檢查頁打得開、按鈕都在、能播
 *
 * 用法：node scripts/calibrate-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});

const consoleErrors = [];
function watch(page) {
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
  });
}

const CALIBRATION_WORDS = ['cat', 'sun', 'book'];

/** 用固定的每字母間隔打完校準的三個字。 */
async function typeCalibration(page, msPerLetter) {
  for (const word of CALIBRATION_WORDS) {
    for (const ch of word) {
      await page.keyboard.press(ch);
      await page.waitForTimeout(msPerLetter);
    }
  }
}

/* ── 1. 三種手速的建議難度 ──────────────────────────────── */
console.log('1) 手速 → 建議難度');
{
  // 門檻：> 700ms 建議輕鬆、< 350ms 建議挑戰、中間是標準
  const CASES = [
    { name: '慢（900ms/字母）', ms: 900, expect: 'easy' },
    { name: '中（500ms/字母）', ms: 500, expect: 'normal' },
    { name: '快（250ms/字母）', ms: 250, expect: 'hard' }
  ];

  for (const c of CASES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    watch(page);
    await page.goto(`${BASE}/game?n=8&part=all&order=sequential`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#calibrate:not([hidden])', { timeout: 10000 });

    await typeCalibration(page, c.ms);
    await page.waitForSelector('#calibrate-choice:not([hidden])', { timeout: 10000 });

    const suggested = await page.evaluate(
      () => document.querySelector('.btn-difficulty.is-suggested')?.dataset.difficulty
    );
    const detail = await page.evaluate(
      () => document.getElementById('calibrate-detail').textContent
    );
    check(`${c.name} → ${c.expect}`, suggested === c.expect, `建議 ${suggested}；${detail}`);
    await context.close();
  }
}

/* ── 2. 三個難度都能自己選 ──────────────────────────────── */
console.log('\n2) 建議之後仍然可以自己選別的');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${BASE}/game?n=8&part=all&order=sequential`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#calibrate:not([hidden])', { timeout: 10000 });
  await typeCalibration(page, 900); // 會建議 easy
  await page.waitForSelector('#calibrate-choice:not([hidden])', { timeout: 10000 });

  const count = await page.evaluate(() => document.querySelectorAll('.btn-difficulty').length);
  check('三個難度都列出來', count === 3, `${count} 顆`);

  // 故意選一個不是建議值的
  await page.click('[data-difficulty="hard"]');
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
    timeout: 15000
  });
  const used = await page.evaluate(() => window.__spellbee.difficulty());
  check('用的是自己選的難度', used.difficulty === 'hard', used.difficulty);
  check('校準畫面已收起', await page.evaluate(() => document.getElementById('calibrate').hidden));

  /* ── 3. 記住選擇 ── */
  await page.goto(`${BASE}/game?n=8&part=all&order=sequential`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
    timeout: 15000
  });
  const again = await page.evaluate(() => ({
    difficulty: window.__spellbee.difficulty().difficulty,
    calibrateHidden: document.getElementById('calibrate').hidden
  }));
  console.log('\n3) 下次進來不再問，但要看得出來記住了什麼');
  check('沒有再跳校準', again.calibrateHidden === true);
  check('沿用上次的難度', again.difficulty === 'hard', again.difficulty);

  /*
   * 記住難度卻不顯示，會變成「同一台電腦換人玩時默默繼承上一個人的設定」。
   * 爸爸測完換小孩玩，小孩就拿到為大人手速調的難度——那是 100% 失敗率。
   * 所以畫面上一定要看得到，而且要能一鍵重測。
   */
  const shown = await page.evaluate(() => ({
    label: document.getElementById('difficulty-label')?.textContent || '',
    hasButton: !!document.getElementById('btn-recalibrate')
  }));
  check('畫面上看得到目前難度', shown.label.includes('挑戰'), shown.label);
  check('有「重測手速」按鈕', shown.hasButton);

  // 按下去要真的回到校準流程
  await page.click('#btn-recalibrate');
  const backToCalibrate = await page
    .waitForSelector('#calibrate:not([hidden])', { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check('按「重測手速」會回到校準', backToCalibrate);

  // 重測成一個不同的難度，確認真的覆蓋得掉
  await typeCalibration(page, 900);
  await page.waitForSelector('#calibrate-choice:not([hidden])', { timeout: 10000 });
  await page.click('[data-difficulty="easy"]');
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
    timeout: 15000
  });
  const after = await page.evaluate(() => ({
    difficulty: window.__spellbee.difficulty().difficulty,
    label: document.getElementById('difficulty-label')?.textContent || ''
  }));
  check('重測後難度真的換掉', after.difficulty === 'easy', after.difficulty);
  check('標籤跟著更新', after.label.includes('輕鬆'), after.label);

  /* ── 4. 可以重新校準 ── */
  console.log('\n4) ?calibrate=1 可以重新量');
  await page.goto(`${BASE}/game?n=8&part=all&order=sequential&calibrate=1`, { waitUntil: 'domcontentloaded' });
  const reAppeared = await page
    .waitForSelector('#calibrate:not([hidden])', { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check('校準畫面有重新出現', reAppeared);
  await context.close();
}

/* ── 5. 網址指定難度時不被擋住 ──────────────────────────── */
console.log('\n5) 網址指定難度時不跳校準（自動化測試靠這個）');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${BASE}/game?n=8&part=all&order=sequential&difficulty=normal`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
    timeout: 15000
  });
  const r = await page.evaluate(() => ({
    difficulty: window.__spellbee.difficulty().difficulty,
    calibrateHidden: document.getElementById('calibrate').hidden
  }));
  check('直接進入遊戲', r.calibrateHidden === true);
  check('用的是網址指定的難度', r.difficulty === 'normal', r.difficulty);
  await context.close();
}

/* ── 6. 聲音自我檢查頁 ──────────────────────────────────── */
console.log('\n6) 聲音自我檢查頁');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${BASE}/selftest`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__selftest, null, { timeout: 10000 });

  const layout = await page.evaluate(() => ({
    letters: document.querySelectorAll('#letters .btn').length,
    effects: document.querySelectorAll('#effects .btn').length,
    speak: document.querySelectorAll('[data-speak]').length,
    env: document.querySelectorAll('#env dt').length
  }));
  check('八個字母的音階按鈕', layout.letters === 8, String(layout.letters));
  check('九個回饋音按鈕', layout.effects === 9, String(layout.effects));
  check('三個發音按鈕', layout.speak === 3, String(layout.speak));
  check('有列出環境資訊', layout.env >= 4, String(layout.env));

  // 實際按一顆，確認音訊真的起得來、而且畫面有說明現在播什麼
  await page.click('#effects .btn');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    nowPlaying: window.__selftest.nowPlaying(),
    state: window.__selftest.sfx.latencyReport().contextState
  }));
  check('音訊啟動', after.state === 'running', after.state);
  check('畫面有顯示現在播的是什麼', after.nowPlaying.length > 0, after.nowPlaying);

  // 全部播一遍：跑得完、不崩
  await page.click('#run-all');
  await page.waitForFunction(() => !document.getElementById('run-all').disabled, null, {
    timeout: 60000
  });
  const done = await page.evaluate(() => window.__selftest.nowPlaying());
  check('「全部播一遍」跑得完', done.includes('全部播完'), done);
  await context.close();
}

await browser.close();

console.log('\n驗收');
check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
