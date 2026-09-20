/**
 * 漏字時顯示正確拼法。
 *
 * 為什麼這件事重要：漏掉就是不知道怎麼拼。只扣一滴血、換下一個字的話，
 * 他什麼也沒學到——而且漏掉的字會排回隊伍尾端，本場之內還會再遇到，
 * 於是他在同一個字上失敗第二次。所以一定要讓他看見那個字長什麼樣子。
 *
 * 要證明的事：
 *   1. 蜂巢被攻擊到時，畫面上出現的是「剛剛漏掉的那個字」
 *   2. 連中文一起給（他要知道那是什麼意思）
 *   3. 撐得夠久、然後自己淡出
 *   4. 暫停時提示不會自己走完
 *   5. 重開一場不會留著上一場的字
 *   6. 含空白的詞條也要完整顯示
 *
 * 用法：node scripts/miss-reveal-test.mjs
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
const pageErrors = [];

async function openGame(query) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/game?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  return { context, page };
}

/**
 * 故意不打，等敵人走到蜂巢。
 * 用最難的難度，敵人走得最快，測試才不用等太久。
 */
async function waitForMiss(page) {
  const before = await page.evaluate(() => window.__spellbee.state().target);
  await page.waitForFunction(
    (t) => window.__spellbee.state()?.target !== t || window.__spellbee.state()?.status !== 'running',
    before,
    { timeout: 20000 }
  );
  return before;
}

/* ── 1~3. 基本行為 ──────────────────────────────────────── */
console.log('1) 蜂巢被攻擊到時顯示正確拼法');
{
  const { context, page } = await openGame('group=w18&n=200&order=sequential&difficulty=hard&show=1');

  const missedWord = await waitForMiss(page);
  const reveal = await page.evaluate(() => window.__spellbee.missReveal());

  check('有東西顯示出來', reveal.visible, JSON.stringify(reveal));
  check(`顯示的是剛剛漏掉的「${missedWord}」`, reveal.word === missedWord, reveal.word);
  check('一起給了中文', reveal.hint.startsWith('正確拼法・'), reveal.hint);

  const stats = await page.evaluate(() => window.__spellbee.state().stats);
  check('確實是漏掉一個字（不是打完的）', stats.wordsMissed >= 1, `漏 ${stats.wordsMissed} 個`);

  /* ── 3. 撐得夠久 ── */
  console.log('\n2) 撐得夠久再淡出');
  await page.waitForTimeout(800);
  const mid = await page.evaluate(() => window.__spellbee.missReveal());
  check('八百毫秒後還看得到', mid.visible, `剩 ${mid.remainMs}ms`);

  await page.waitForTimeout(2000);
  const gone = await page.evaluate(() => window.__spellbee.missReveal());
  check('兩秒多之後自己收掉', !gone.visible, `剩 ${gone.remainMs}ms`);
  await context.close();
}

/* ── 4. 暫停時不該自己走完 ──────────────────────────────── */
console.log('\n3) 暫停時提示不會自己走完');
{
  const { context, page } = await openGame('group=w18&n=200&order=sequential&difficulty=hard&show=1');
  await waitForMiss(page);
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(() => window.__spellbee.missReveal().remainMs);
  await page.waitForTimeout(1500);
  const still = await page.evaluate(() => window.__spellbee.missReveal());
  check('暫停中提示還在', still.visible, `${paused}ms → ${still.remainMs}ms`);
  check('倒數幾乎沒有前進', Math.abs(paused - still.remainMs) < 300, `${paused} → ${still.remainMs}`);
  await context.close();
}

/* ── 5. 重開一場要收掉 ─────────────────────────────────── */
console.log('\n4) 重開一場不留上一場的字');
{
  const { context, page } = await openGame('group=w18&n=200&order=sequential&difficulty=hard&show=1');
  await waitForMiss(page);
  check('先確認提示是亮著的', await page.evaluate(() => window.__spellbee.missReveal().visible));

  await page.evaluate(() => window.__spellbee.restart());
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__spellbee.missReveal());
  check('重開之後提示收掉了', !after.visible, JSON.stringify(after));
  await context.close();
}

/* ── 6. 含空白的詞條 ───────────────────────────────────── */
console.log('\n5) 含空白的詞條要完整顯示');
{
  // Week 4 有 "alarm clock"
  const { context, page } = await openGame('group=w04&n=200&order=sequential&difficulty=hard&show=1');

  let shown = '';
  for (let i = 0; i < 40; i += 1) {
    const target = await page.evaluate(() => window.__spellbee.state()?.target);
    if (!target) break;
    if (target === 'alarm clock') {
      await waitForMiss(page);
      shown = await page.evaluate(() => window.__spellbee.missReveal().word);
      break;
    }
    // 不是那個字就快速打掉，往下一題走
    for (const ch of target) await page.keyboard.press(ch);
    await page.waitForTimeout(30);
  }
  check('空白沒有被吃掉', shown === 'alarm clock', shown || '沒等到那一題');
  await context.close();
}

await browser.close();

console.log('\n驗收');
check(
  '沒有未捕捉的例外',
  pageErrors.length === 0,
  pageErrors.slice(0, 3).join(' | ')
);
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
