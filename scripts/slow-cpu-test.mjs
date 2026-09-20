/**
 * 慢電腦測試。
 *
 * 開發計畫第 3 章答應過要「用 CPU 降速模擬較慢的電腦」，之前沒做。
 * 我這台機器跟你家那台不一樣，而且我量到的所有延遲數字都是在
 * 「沒有別的程式在跑」的情況下量的。孩子實際玩的時候，電腦上可能
 * 還開著瀏覽器分頁、防毒、更新程式。
 *
 * 這支用 CDP 把 CPU 降到四分之一速，然後檢查三件事：
 *   1. 遊戲還開得起來、跑得動
 *   2. 快打的時候一個按鍵都不會被吃掉（這是最不能妥協的）
 *   3. 延遲雖然會變差，但還在能玩的範圍
 *
 * 通過標準刻意比正常情況寬鬆：慢電腦上本來就該比較鈍，
 * 要守住的是「不掉字、不卡死」，不是 60fps。
 *
 * 用法：node scripts/slow-cpu-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

/* 四倍降速：大約是一台五六年前的筆電。 */
const THROTTLE_RATE = 4;
/* 慢電腦上的延遲上限。正常情況的標準是 16ms，這裡放寬到三倍多。 */
const MAX_P95_MS = 55;
const LETTERS = 120;

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
});
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  // 錄音清單那支要登入與資料庫，這台機器沒有，回 503 是預期內的
  if (m.type() === 'error' && (m.location()?.url || '').includes('/api/words/recorded')) return;
  if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
});

/*
 * 先確認降速真的生效。
 *
 * 如果 CDP 那道指令因為任何理由沒作用，下面每一項都會輕鬆通過——
 * 而我會得到一份「慢電腦沒問題」的報告，內容其實是在全速機器上跑的。
 * 那比沒有測更糟，所以先量一段固定的計算，比對前後的耗時。
 */
async function busyMs() {
  return page.evaluate(() => {
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 4e6; i += 1) x += Math.sqrt(i);
    return { ms: performance.now() - t0, x };
  });
}

/*
 * 量測用的落腳頁挑 /selftest。
 *   - 不能用 about:blank：它沒有正常的來源，連 localStorage 都讀不到
 *   - 不能用首頁：首頁會去問「誰登入了」，這台機器沒有資料庫，
 *     於是留下一串跟這支測試無關的 503
 * /selftest 不必登入也不碰資料庫，最乾淨。
 */
await page.goto(`${BASE}/selftest`, { waitUntil: 'domcontentloaded' });
await busyMs(); // 先跑一次讓 JIT 熱起來，不然第一次會偏慢
const full = (await busyMs()).ms;

const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE_RATE });
const slow = (await busyMs()).ms;
const ratio = slow / full;

console.log('0) 先確認降速真的生效');
check(
  `同一段計算明顯變慢（${THROTTLE_RATE} 倍降速）`,
  ratio >= 2,
  `全速 ${full.toFixed(0)}ms → 降速後 ${slow.toFixed(0)}ms，慢了 ${ratio.toFixed(1)} 倍`
);
if (ratio < 2) {
  console.log('\n降速沒有生效，後面測出來的數字不能代表慢電腦，直接停。');
  await browser.close();
  process.exit(1);
}

console.log(`\nCPU 降到 1/${THROTTLE_RATE} 速`);
console.log('\n1) 慢電腦上還開得起來');
await page.goto(`${BASE}/game?seed=4242&part=all&n=100&difficulty=easy&order=sequential&show=1`, {
  waitUntil: 'domcontentloaded'
});
const booted = await page
  .waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 40000 })
  .then(() => true)
  .catch(() => false);
check('遊戲啟動', booted);
if (!booted) {
  await browser.close();
  console.log('\n開不起來，後面不用測了');
  process.exit(1);
}

console.log('\n2) 快打不掉字');
/*
 * 連打一百二十個字母，中間完全不等畫面。慢電腦上最容易出現的症狀就是
 * 「打得比畫面快，於是有幾個字母不見了」——那對聽寫遊戲是致命的，
 * 他會以為自己拼錯。
 */
for (let i = 0; i < LETTERS; i += 1) {
  const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
  if (!ch) break;
  await page.keyboard.press(ch);
}
await page.waitForTimeout(500);

const report = await page.evaluate(() => ({
  latency: window.__spellbee.latency(),
  queue: window.__spellbee.queue(),
  perf: window.__spellbee.perf(),
  stats: window.__spellbee.state().stats,
  status: window.__spellbee.state().status
}));

check(
  '一個按鍵都沒被丟掉',
  report.queue.dropped === 0,
  `丟掉 ${report.queue.dropped} 個`
);
check(
  '打對的字母數對得上',
  report.stats.correctLetters + report.stats.wrongLetters >= LETTERS - 5,
  `對 ${report.stats.correctLetters} + 錯 ${report.stats.wrongLetters}，送出 ${LETTERS}`
);
check('沒有打錯（bot 照著答案打）', report.stats.wrongLetters === 0, String(report.stats.wrongLetters));

console.log('\n3) 延遲還在能玩的範圍');
check(
  `按鍵延遲 p95 ≤ ${MAX_P95_MS}ms`,
  report.latency.p95 <= MAX_P95_MS,
  `p50 ${report.latency.p50}ms、p95 ${report.latency.p95}ms、樣本 ${report.latency.samples}`
);
/*
 * 只把「影格工時」當成有意義的數字。
 *
 * 影格間隔在無頭瀏覽器本來就不可信（沒有真正的顯示器在對時），
 * 降速之後更不可信，所以印出來當參考但不拿來判定通過與否。
 * 真正要守住的是上面那兩項：不掉字、延遲還能接受。
 */
console.log(
  `    參考：影格工時 p50 ${report.perf.workP50}ms、p95 ${report.perf.workP95}ms` +
    `（影格間隔 p95 ${report.perf.p95}ms、掉格 ${report.perf.dropped}——無頭環境不可信，僅供參考）`
);

console.log('\n4) 繼續跑得下去');
check('戰鬥沒有卡死', report.status === 'running' || report.status === 'won', report.status);
const advanced = await page.evaluate(async () => {
  const before = window.__spellbee.state().tick;
  await new Promise((r) => setTimeout(r, 1000));
  return window.__spellbee.state().tick - before;
});
check('時鐘還在前進', advanced > 30, `一秒走了 ${advanced} 個邏輯步`);

check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
