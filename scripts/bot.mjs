/**
 * 自動化玩家 bot——Phase 1.1 的另一個驗收標準。
 *
 * 用 Playwright 開真的瀏覽器、發真的鍵盤事件來玩這個遊戲。
 * 它從除錯 API 讀出現在該打哪個字母，依照設定的手速與打錯機率按下去，
 * 模擬一個小四生。意義很簡單：我可以在沒有人的情況下把遊戲玩幾千次，
 * 崩潰、卡死、輸入被吃掉這些事不必等小孩碰到。
 *
 * 用法：
 *   node scripts/bot.mjs                      # 預設中等手速跑 3 場
 *   node scripts/bot.mjs --preset=fast --runs=10
 *   node scripts/bot.mjs --shot=out.png       # 順便截一張圖
 *
 * 需要伺服器已經跑在 BASE（預設 http://127.0.0.1:3100）。
 * 遊戲頁只用 /api/wordbank，不需要資料庫也不需要登入。
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const PRESETS = {
  slow: { msPerLetter: 900, jitterMs: 300, errorRate: 0.1 },
  medium: { msPerLetter: 550, jitterMs: 180, errorRate: 0.06 },
  fast: { msPerLetter: 320, jitterMs: 100, errorRate: 0.03 }
};

const preset = PRESETS[args.preset] || PRESETS.medium;
const runs = Number(args.runs) || 3;
const wordCount = Number(args.n) || 20;
const difficulty = args.difficulty || 'normal';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomWrongLetter(expected) {
  let ch = expected;
  while (ch === expected) ch = String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return ch;
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

// 把瀏覽器的錯誤帶回終端機——bot 跑的時候沒有人在看 console
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
});

const results = [];

for (let run = 0; run < runs; run += 1) {
  const seed = 1000 + run;
  await page.goto(`${BASE}/game?seed=${seed}&n=${wordCount}&difficulty=${difficulty}`, {
    waitUntil: 'domcontentloaded'
  });

  // 等除錯 API 就緒（表示場景也建好了）
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
    timeout: 15000
  });

  const startedAt = Date.now();
  let keys = 0;
  let stalled = 0;
  let lastTick = -1;

  // 保險絲：真實時間上限，避免遊戲卡住時 bot 永遠跑下去
  while (Date.now() - startedAt < 180000) {
    const snap = await page.evaluate(() => ({
      s: window.__spellbee.state(),
      expected: window.__spellbee.expectedLetter()
    }));
    if (!snap.s || snap.s.status !== 'running') break;

    // 偵測「畫面還在但邏輯不動了」——這正是 bot 最該抓到的那種 bug
    if (snap.s.tick === lastTick) {
      stalled += 1;
      if (stalled > 60) throw new Error(`遊戲卡住了：tick 停在 ${snap.s.tick}`);
    } else {
      stalled = 0;
      lastTick = snap.s.tick;
    }

    if (snap.expected) {
      const ch = Math.random() < preset.errorRate ? randomWrongLetter(snap.expected) : snap.expected;
      await page.keyboard.press(ch);
      keys += 1;
    }

    const jitter = (Math.random() * 2 - 1) * preset.jitterMs;
    await sleep(Math.max(40, preset.msPerLetter + jitter));
  }

  const final = await page.evaluate(() => ({
    state: window.__spellbee.state(),
    perf: window.__spellbee.perf(),
    logEntries: window.__spellbee.log().entries.length
  }));

  results.push({ seed, keys, ...final });

  const st = final.state;
  console.log(
    `場 ${run + 1}/${runs} seed=${seed} ${st.status}` +
      `  殺 ${st.stats.wordsKilled} 漏 ${st.stats.wordsMissed}` +
      `  對 ${st.stats.correctLetters} 錯 ${st.stats.wrongLetters}` +
      `  影格 p50 ${final.perf.p50}ms p95 ${final.perf.p95}ms 掉格 ${final.perf.dropped}` +
      `  heap +${final.perf.heapGrowthMB ?? '—'}MB` +
      `  錄影 ${final.logEntries} 動作`
  );
}

if (args.shot) {
  await page.screenshot({ path: String(args.shot) });
  console.log(`截圖：${args.shot}`);
}

await browser.close();

// ── 判定 ───────────────────────────────────────────────────
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n驗收');
check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check(
  '每一場都有正常結束',
  results.every((r) => r.state.status !== 'running'),
  results.map((r) => r.state.status).join(', ')
);
check(
  `每一場至少打完 ${wordCount} 個字`,
  results.every((r) => r.state.stats.wordsKilled >= wordCount),
  results.map((r) => r.state.stats.wordsKilled).join(', ')
);
check(
  '每一場都有錄到動作',
  results.every((r) => r.logEntries > 0),
  results.map((r) => r.logEntries).join(', ')
);
check(
  '影格 p95 ≤ 20ms',
  results.every((r) => r.perf.p95 <= 20),
  results.map((r) => r.perf.p95).join(', ')
);

console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
