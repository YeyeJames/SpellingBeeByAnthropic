/**
 * 特效耐久測試——Phase 1.3 的驗收。
 *
 * 1.3 加了蜂針、字母碎片、裂痕、擊殺噴濺與頓挫。這些東西每秒會觸發好幾次，
 * 所以最該擔心的不是「跑得動嗎」，而是「跑久了會不會愈來愈頓」。
 *
 * 要證明的事：
 *   1. 連續玩三分鐘，每格工作量不隨時間上升
 *   2. GC 之後留下的記憶體沒有持續成長（代表特效沒有在配置物件）
 *   3. 物件池夠大，不會一直回收還在演的粒子
 *   4. 頓挫期間的按鍵不會被吃掉（1.2 的輸入佇列在這裡第一次派上真正用場）
 *
 * 用法：node scripts/soak-test.mjs [--minutes=3]
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
const MINUTES = Number(args.minutes) || 3;

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

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--js-flags=--expose-gc']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

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

// 全部 100 個字、輕鬆難度：要能連續打三分鐘不中斷
await page.goto(`${BASE}/game?seed=777&part=all&n=100&difficulty=easy&order=sequential`, {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
  timeout: 15000
});

async function gcHeapBytes() {
  return page.evaluate(() => {
    if (window.gc) {
      window.gc();
      window.gc();
    }
    return performance.memory ? performance.memory.usedJSHeapSize : 0;
  });
}

const heapStart = await gcHeapBytes();
const startedAt = Date.now();
const durationMs = MINUTES * 60 * 1000;

/* 每 30 秒取一次樣，用來看趨勢而不只是頭尾兩點 */
const samples = [];
let nextSampleAt = 30000;
let typed = 0;

console.log(`連續遊玩 ${MINUTES} 分鐘…`);

while (Date.now() - startedAt < durationMs) {
  // 一口氣打一整個字，讓擊殺與頓挫真的發生
  const word = await page.evaluate(() => {
    const s = window.__spellbee.state();
    return s && s.status === 'running' ? s.target.slice(s.typed) : null;
  });
  if (!word) {
    await page.evaluate(() => window.__spellbee.restart());
    continue;
  }
  for (const ch of word) {
    await page.keyboard.press(ch);
    typed += 1;
    await page.waitForTimeout(35);
  }
  // 讓擊殺特效與頓挫演完
  await page.waitForTimeout(140);

  const elapsed = Date.now() - startedAt;
  if (elapsed >= nextSampleAt) {
    const heap = await gcHeapBytes();
    const perf = await page.evaluate(() => window.__spellbee.perf());
    const fx = await page.evaluate(() => window.__spellbee.effects());
    samples.push({ sec: Math.round(elapsed / 1000), heap, perf, fx });
    console.log(
      `  ${String(Math.round(elapsed / 1000)).padStart(3)}s` +
        `  每格工作 p95 ${perf.workP95}ms` +
        `  heap ${(heap / 1048576).toFixed(1)}MB` +
        `  池子回收 ${fx.recycled}` +
        `  已打 ${typed} 字母`
    );
    nextSampleAt += 30000;
  }
}

const heapEnd = await gcHeapBytes();
const finalPerf = await page.evaluate(() => window.__spellbee.perf());
const finalFx = await page.evaluate(() => window.__spellbee.effects());
const finalState = await page.evaluate(() => window.__spellbee.state());

/* ── 頓挫期間不能吃掉按鍵 ──────────────────────────────── */
const hitStop = await page.evaluate(async () => {
  const s = window.__spellbee.state();
  // 先把這個字打到只剩一個字母
  const rest = s.target.slice(s.typed);
  for (let i = 0; i < rest.length - 1; i += 1) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: rest[i], bubbles: true }));
  }
  await new Promise(requestAnimationFrame);

  const before = window.__spellbee.state().stats;
  const lastCh = window.__spellbee.expectedLetter();
  // 打完最後一個字母 → 觸發擊殺與 80ms 頓挫
  window.dispatchEvent(new KeyboardEvent('keydown', { key: lastCh, bubbles: true }));
  // 頓挫期間立刻再打三個字母（下一個字的開頭）
  await new Promise(requestAnimationFrame);
  const next = window.__spellbee.state().target.slice(0, 3);
  for (const ch of next) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
  }
  const queuedDuringStop = window.__spellbee.queue().size;

  await new Promise((r) => setTimeout(r, 300));
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const after = window.__spellbee.state().stats;
  return {
    queuedDuringStop,
    correctDelta: after.correctLetters - before.correctLetters,
    wrongDelta: after.wrongLetters - before.wrongLetters,
    queueAfter: window.__spellbee.queue().size,
    dropped: window.__spellbee.queue().dropped
  };
});

await browser.close();

/* ── 判定 ───────────────────────────────────────────────── */
const heapGrowthMB = (heapEnd - heapStart) / 1048576;
const firstWork = samples.length ? samples[0].perf.workP95 : finalPerf.workP95;
const lastWork = finalPerf.workP95;

console.log('\n結果');
console.log(
  `  打了 ${typed} 個字母、殺了 ${finalState.stats.wordsKilled} 個字、` +
    `heap ${(heapStart / 1048576).toFixed(1)} → ${(heapEnd / 1048576).toFixed(1)}MB`
);

console.log('\n驗收');
check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check(
  `每格工作量 p95 ≤ 4ms`,
  finalPerf.workP95 <= 4,
  `${finalPerf.workP95}ms（最差單格 ${finalPerf.workWorst}ms）`
);
check(
  '工作量沒有隨時間往上爬',
  lastWork <= firstWork + 1.5,
  `開頭 ${firstWork}ms → 結尾 ${lastWork}ms`
);
check(
  `GC 後 heap 成長 ≤ 3MB（${MINUTES} 分鐘）`,
  heapGrowthMB <= 3,
  `${heapGrowthMB.toFixed(2)}MB`
);
/*
 * 回收率而不是「回收次數為零」。
 *
 * 回收最舊的粒子是設計好的退讓，不是缺陷。而且這個測試裡的 bot 是每 35ms
 * 打一個字母、連續擊殺，比任何小孩都快十倍——拿「零回收」當門檻，只會逼我
 * 為一個不存在的情境無限放大池子。改看佔比：偏高才代表池子真的開太小。
 */
const recycleRate = finalFx.spawned ? finalFx.recycled / finalFx.spawned : 0;
check(
  '物件池回收率 < 2%（代表池子夠大）',
  recycleRate < 0.02,
  `${(recycleRate * 100).toFixed(2)}%（${finalFx.recycled}/${finalFx.spawned}）` +
    ` 分布 ${JSON.stringify(finalFx.recycledBy)}`
);
check(
  '頓挫期間的按鍵有排隊',
  hitStop.queuedDuringStop > 0,
  `排了 ${hitStop.queuedDuringStop} 個`
);
check(
  '頓挫結束後按鍵全部補上且順序正確',
  hitStop.correctDelta >= 4 && hitStop.wrongDelta === 0,
  `對 +${hitStop.correctDelta}／錯 +${hitStop.wrongDelta}，佇列剩 ${hitStop.queueAfter}，丟棄 ${hitStop.dropped}`
);

console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
