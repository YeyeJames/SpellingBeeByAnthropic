/**
 * 瀏覽器 ↔ Node 一致性測試。
 *
 * 這支測試本身不測遊戲，它測的是「我有沒有資格用模擬器代替實際遊玩」。
 *
 * 1.5 的驗收要三種手速各跑 200 場。在真實瀏覽器裡跑 600 場要十幾個小時，
 * 所以改用純邏輯模擬器在 Node 裡跑，幾秒鐘就有結果。但那只有在
 * 「模擬器算出來的東西等於瀏覽器裡真的會發生的事」時才有意義——
 * 否則我只是在很有效率地測一個假的遊戲。
 *
 * 作法：
 *   1. 在真實瀏覽器裡用真的鍵盤事件玩完一場
 *   2. 把那一場的錄影檔與最終狀態指紋抓出來
 *   3. 在 Node 裡用同一份 core/ 程式碼重播同一份錄影檔
 *   4. 兩邊的指紋必須完全相同
 *
 * 順帶也證明了「剛剛怪怪的」那顆按鈕真的有用：小孩丟給我的錄影檔，
 * 我在這裡就能一模一樣地重跑出來。
 *
 * 用法：node scripts/parity-test.mjs
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { replayLog } from '../public/js/game/core/recorder.js';
import { fingerprint, snapshot } from '../public/js/game/core/battle.js';

const require = createRequire(import.meta.url);
const { allWords } = require('../server/data/word-bank.js');

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const byId = new Map(allWords().map((w) => [w.id, w]));

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

/**
 * 在瀏覽器裡真的玩完一場。
 * 刻意用不同的手速與失誤率，讓錄影檔涵蓋打對、打錯、退格、重聽、漏字。
 */
async function playInBrowser({ seed, words, difficulty, msPerLetter, errorRate, useExtras }) {
  await page.goto(`${BASE}/game?seed=${seed}&part=all&n=${words}&difficulty=${difficulty}&order=sequential&show=1`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
    timeout: 15000
  });

  const startedAt = Date.now();
  let pressed = 0;
  while (Date.now() - startedAt < 120000) {
    const st = await page.evaluate(() => ({
      s: window.__spellbee.state(),
      ch: window.__spellbee.expectedLetter()
    }));
    if (!st.s || st.s.status !== 'running') break;

    if (st.ch) {
      // 偶爾打錯、偶爾退格、偶爾重聽——錄影檔要涵蓋所有動作種類
      const r = Math.random();
      if (useExtras && r < errorRate) {
        await page.keyboard.press(String.fromCharCode(97 + Math.floor(Math.random() * 26)));
      } else if (useExtras && r < errorRate + 0.04) {
        await page.keyboard.press('Backspace');
      } else if (useExtras && r < errorRate + 0.06) {
        await page.keyboard.press('ArrowUp');
      } else {
        await page.keyboard.press(st.ch);
      }
      pressed += 1;
    }
    await page.waitForTimeout(msPerLetter);
  }

  return page.evaluate(() => ({
    fingerprint: window.__spellbee.fingerprint(),
    state: window.__spellbee.state(),
    log: window.__spellbee.log()
  }));
}

const CASES = [
  { name: '快手速、少失誤', seed: 5001, words: 8, difficulty: 'easy', msPerLetter: 60, errorRate: 0.03, useExtras: true },
  { name: '中手速、會退格重聽', seed: 5002, words: 8, difficulty: 'normal', msPerLetter: 140, errorRate: 0.12, useExtras: true },
  { name: '慢手速、會漏字', seed: 5003, words: 6, difficulty: 'hard', msPerLetter: 420, errorRate: 0.15, useExtras: true },
  { name: '完全不出錯', seed: 5004, words: 8, difficulty: 'easy', msPerLetter: 80, errorRate: 0, useExtras: false }
];

console.log('瀏覽器實際遊玩 ↔ Node 重播\n');

for (const c of CASES) {
  const live = await playInBrowser(c);
  const words = live.log.setup.wordIds.map((id) => byId.get(id));

  const missing = words.filter((w) => !w).length;
  if (missing > 0) {
    check(`${c.name}：錄影檔的單字 id 都對得上`, false, `${missing} 個找不到`);
    continue;
  }

  const replayed = replayLog(live.log, words);
  const replayFp = fingerprint(replayed);
  const rs = snapshot(replayed);

  const same = replayFp === live.fingerprint;
  check(
    `${c.name}（${live.state.status}）`,
    same,
    same
      ? `指紋 ${replayFp}　${live.log.entries.length} 個動作　` +
        `殺 ${rs.stats.wordsKilled} 漏 ${rs.stats.wordsMissed} 錯 ${rs.stats.wrongLetters} 重聽 ${rs.stats.listens}`
      : `瀏覽器 ${live.fingerprint} vs Node ${replayFp}\n` +
        `        瀏覽器 tick=${live.state.tick} 殺=${live.state.stats.wordsKilled} 漏=${live.state.stats.wordsMissed}\n` +
        `        Node   tick=${rs.tick} 殺=${rs.stats.wordsKilled} 漏=${rs.stats.wordsMissed}`
  );
}

await browser.close();

console.log('\n驗收');
check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(
  `\n${failures === 0 ? '全部通過——模擬器的結果可以代表真實遊玩' : `有 ${failures} 項失敗`}`
);
process.exit(failures === 0 ? 0 : 1);
