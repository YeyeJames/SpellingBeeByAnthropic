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

/*
 * --expose-gc 讓我們可以主動觸發垃圾回收。
 *
 * 沒有它的話，usedJSHeapSize 只會一路往上到 GC 自己跑為止，
 * 量到的「成長」分不出是真的留著不放，還是只是還沒回收的鋸齒。
 * 主動 GC 之後再量，剩下的才是真正被留住的記憶體。
 */
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--js-flags=--expose-gc']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

// 把瀏覽器的錯誤帶回終端機——bot 跑的時候沒有人在看 console
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  /*
   * 「哪些字有真人錄音」那支要登入與資料庫，這台機器兩個都沒有，
   * 所以它回 503、瀏覽器記一筆錯誤。這是設計好會發生而且已經處理掉的
   * （拿不到就全部用機器語音），不算故障——但也不能整段忽略 503，
   * 否則真的壞掉時測試會安靜地放行。只放行這一支。
   */
  if (m.type() === 'error' && EXPECTED_503.some((u) => (m.location()?.url || '').includes(u))) return;
  if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
});

const results = [];

for (let run = 0; run < runs; run += 1) {
  const seed = 1000 + run;
  await page.goto(`${BASE}/game?seed=${seed}&n=${wordCount}&difficulty=${difficulty}&order=sequential`, {
    waitUntil: 'domcontentloaded'
  });

  // 等除錯 API 就緒（表示場景也建好了）
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
    timeout: 15000
  });

  // GC 之後的基準線，跟結束時的數字相減才是「真的被留住的」
  const heapBaseline = await page.evaluate(() => {
    if (window.gc) {
      window.gc();
      window.gc();
    }
    return performance.memory ? performance.memory.usedJSHeapSize : 0;
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

  const heapAfter = await page.evaluate(() => {
    if (window.gc) {
      window.gc();
      window.gc();
    }
    return performance.memory ? performance.memory.usedJSHeapSize : 0;
  });
  const retainedMB = heapBaseline ? (heapAfter - heapBaseline) / 1048576 : null;

  results.push({ seed, keys, retainedMB, ...final });

  const st = final.state;
  console.log(
    `場 ${run + 1}/${runs} seed=${seed} ${st.status}` +
      `  殺 ${st.stats.wordsKilled} 漏 ${st.stats.wordsMissed}` +
      `  對 ${st.stats.correctLetters} 錯 ${st.stats.wrongLetters}` +
      `  每格工作 p50 ${final.perf.workP50}ms p95 ${final.perf.workP95}ms` +
      `  間隔 p50 ${final.perf.p50}ms` +
      `  heap 回收後留下 ${retainedMB === null ? '—' : retainedMB.toFixed(2)}MB` +
      `  錄影 ${final.logEntries} 動作`
  );
}

if (args.shot) {
  await page.screenshot({ path: String(args.shot) });
  console.log(`截圖：${args.shot}`);
}

await browser.close();

// ── 判定 ───────────────────────────────────────────────────
/*
 * 這幾支要登入與資料庫，這台機器兩個都沒有，所以它們回 503、瀏覽器記一筆錯誤。
 * 全都是設計好會發生而且已經處理掉的：拿不到錄音就用機器語音，問不到解鎖狀態
 * 就放行，分數記不到就算了。不算故障——但也不能整段忽略 503，
 * 否則真的壞掉時測試會安靜地放行。只放行這幾支。
 */
const EXPECTED_503 = ['/api/words/recorded', '/api/game/access', '/api/game/result'];

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
/*
 * 判定看的是「每格工作量」而不是「影格間隔」。
 *
 * 無頭瀏覽器用軟體渲染，間隔本來就跑不到 60fps（實測約 24~26fps），
 * 拿它當門檻只會量到瀏覽器的節流，不是程式的效能。
 * 工作量才是「在真實機器上還有多少餘裕」，而且無頭環境量得準。
 * 真機的實際 fps 我測不到，那要靠遊戲裡的 F3 畫面自己看。
 */
check(
  '每格工作量 p95 ≤ 4ms（60fps 預算 16.7ms 的四分之一）',
  results.every((r) => r.perf.workP95 <= 4),
  results.map((r) => r.perf.workP95).join(', ')
);
check(
  'GC 之後留下的記憶體 ≤ 1MB（戰鬥中不應持續配置）',
  results.every((r) => (r.retainedMB ?? 0) <= 1),
  results.map((r) => (r.retainedMB === null ? '—' : r.retainedMB.toFixed(2))).join(', ')
);

console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
