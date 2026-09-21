/**
 * 敵人排隊測試（Phase 2.1）。
 *
 * 設計書：「畫面上同時有 3~5 隻敵人排隊（製造視覺壓力），但只有最前面
 * 那隻是當前目標——因為聽寫一次只能聽一個字。」
 *
 * 所以這是純畫面的東西，而純畫面的東西最容易在改版面時悄悄壞掉：
 * 之前把入侵口留在 0.76 以右，1440 寬的螢幕上就有兩隻排到畫面外，
 * 只剩三隻看得到，壓力少了一半而且沒有任何錯誤訊息。
 *
 * 要證明的事：
 *   1. 畫面上真的同時看得到好幾隻，而且都在畫面內
 *   2. 戰鬥邏輯沒有被動到——排隊的敵人不會影響任何數值
 *   3. 打掉一個字，整排會往前踏一步
 *   4. 快打完時排隊的會一隻一隻消失，不會憑空多出來
 *   5. 小螢幕上也看得到足夠多隻
 *
 * 用法：node scripts/enemy-queue-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

/* 設計書要求同時看得到 3~5 隻（含當前目標）。 */
const MIN_ON_SCREEN = 3;

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

async function openGame(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(() => {
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/game?group=w18&n=200&order=sequential&show=1&difficulty=easy`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { context, page };
}

/** 把目前這個字整個打完。 */
async function killWord(page) {
  const word = await page.evaluate(() => window.__spellbee.state()?.target);
  if (!word) return null;
  for (const ch of word) await page.keyboard.press(ch);
  await page.waitForTimeout(120);
  return word;
}

/* ── 1~3. 桌機 ──────────────────────────────────────────── */
console.log('1) 畫面上同時看得到好幾隻');
{
  const { context, page } = await openGame(1440, 810);

  const line = await page.evaluate(() => ({
    line: window.__spellbee.waitingLine(),
    remaining: window.__spellbee.state().remaining,
    total: window.__spellbee.words().length
  }));
  check('有排隊的敵人', line.line.visible > 0, `${line.line.visible} 隻`);
  check(
    `含當前目標至少 ${MIN_ON_SCREEN} 隻在畫面內`,
    line.line.onScreen + 1 >= MIN_ON_SCREEN,
    `排隊 ${line.line.onScreen} 隻在畫面內＋當前目標，站位 ${line.line.xs.join(',')}`
  );
  check(
    '排隊的數量不超過還沒登場的字數',
    line.line.visible <= line.remaining,
    `排隊 ${line.line.visible}、還沒登場 ${line.remaining}`
  );

  console.log('\n2) 邏輯完全沒被動到');
  /*
   * 排隊是畫面的事。如果它不小心影響了戰鬥狀態，指紋就會變——
   * 而現在的時間公式與失敗率是模擬器掃出來的，動到邏輯整組都要重跑。
   */
  /*
   * 先暫停再比。戰鬥跑著的時候指紋本來就一直在變（裡面有 tick 與推進度），
   * 那樣比對只會證明「時間有在走」，證明不了排隊有沒有影響狀態。
   */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.__spellbee.fingerprint());
  await page.evaluate(() => {
    // 直接把排隊的敵人藏起來，不該影響任何狀態
    window.__spellbeeScene.waiting.forEach((s) => s.container.setVisible(false));
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__spellbee.fingerprint());
  check('藏掉排隊的敵人，戰鬥指紋不變', before === after, `${before} vs ${after}`);
  await page.keyboard.press('Escape'); // 解除暫停

  console.log('\n3) 打掉一個字，整排往前踏一步');
  await page.evaluate(() => window.__spellbee.restart());
  await page.waitForTimeout(200);
  const word = await killWord(page);
  const stepped = await page.evaluate(() => window.__spellbee.waitingLine().shift);
  check(`打完「${word}」之後整排在往前走`, stepped > 0, `位移 ${stepped}`);

  /*
   * 等它自己收斂，不要用固定的秒數去猜。
   * 無頭瀏覽器一秒跑不到六十格，用「等 500ms 應該就好了」會變成
   * 在測這台機器畫幾格，不是在測這段動畫會不會停。
   */
  const settled = await page
    .waitForFunction(() => window.__spellbee.waitingLine().shift === 0, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('最後會踏回定位（不會卡在半路）', settled,
    `位移停在 ${await page.evaluate(() => window.__spellbee.waitingLine().shift)}`);

  console.log('\n4) 快打完時排隊的會一隻一隻消失');
  // 一路打到剩不到四個字
  for (let i = 0; i < 20; i += 1) {
    const r = await page.evaluate(() => window.__spellbee.state()?.remaining ?? 0);
    if (r <= 3) break;
    if (!(await killWord(page))) break;
  }
  const near = await page.evaluate(() => ({
    remaining: window.__spellbee.state().remaining,
    visible: window.__spellbee.waitingLine().visible
  }));
  check(
    '排隊數量跟著剩餘字數走',
    near.visible === Math.min(4, near.remaining),
    `還剩 ${near.remaining} 個字、排了 ${near.visible} 隻`
  );

  await context.close();
}

/* ── 5. 小螢幕 ──────────────────────────────────────────── */
console.log('\n5) 小螢幕上也要看得到足夠多隻');
for (const [w, h] of [
  [1280, 720],
  [1024, 768]
]) {
  const { context, page } = await openGame(w, h);
  const line = await page.evaluate(() => window.__spellbee.waitingLine());
  check(
    `${w}×${h}：含當前目標至少 ${MIN_ON_SCREEN} 隻在畫面內`,
    line.onScreen + 1 >= MIN_ON_SCREEN,
    `排隊 ${line.onScreen} 隻在畫面內，站位 ${line.xs.join(',')}`
  );
  await context.close();
}

/* ── 6. 美術：三種外形與三層視差 ────────────────────────── */
console.log('\n6) 三種敵人外形與三層背景');
{
  const { context, page } = await openGame(1440, 810);

  const art = await page.evaluate(() => {
    const sc = window.__spellbeeScene;
    return {
      artOk: sc.enemyArtOk,
      hasImage: !!sc.enemyBody.setTexture,
      layers: sc.bgLayers.length,
      layerKeys: sc.bgLayers.map((l) => l.texture.key),
      tilePos: sc.bgLayers.map((l) => l.tilePositionX)
    };
  });
  check('SVG 素材有載到', art.artOk, String(art.artOk));
  check('敵人是貼圖不是幾何圖形', art.hasImage);
  check('背景有三層', art.layers === 3, `${art.layers} 層`);
  check(
    '三層用的是三張不同的貼圖',
    new Set(art.layerKeys).size === 3,
    art.layerKeys.join(',')
  );

  // 視差：三層必須以不同速度移動，否則只是一張圖在平移
  await page.waitForTimeout(900);
  const moved = await page.evaluate(
    (before) => window.__spellbeeScene.bgLayers.map((l, i) => l.tilePositionX - before[i]),
    art.tilePos
  );
  check('三層都有在動', moved.every((d) => d > 0), moved.map((d) => d.toFixed(1)).join(', '));
  check(
    '速度不一樣（這才叫視差）',
    moved[0] < moved[1] && moved[1] < moved[2],
    moved.map((d) => d.toFixed(1)).join(' < ')
  );

  /*
   * 換字時外形要跟著換。
   * w13a 的第一個字是 knee（4 字元，甲蟲），後面有比較長的字。
   */
  const kinds = new Set();
  for (let i = 0; i < 8; i += 1) {
    const k = await page.evaluate(() => window.__spellbeeScene.enemyKind);
    kinds.add(k);
    if (!(await killWord(page))) break;
  }
  check('一場之內會出現不只一種敵人', kinds.size >= 2, [...kinds].join(','));

  check('沒有未捕捉的例外（這一段）', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await context.close();
}

await browser.close();

console.log('\n驗收');
check('沒有未捕捉的例外', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
