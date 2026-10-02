/**
 * 直接換難度（開場與結算各一排），不用重測手速。
 *
 *   1. 開場：三顆都在，目前的難度亮著
 *   2. 按別的難度：亮的那顆跟著換、開場畫面還在（不會直接開打）、記住了
 *   3. 開打：這一場真的是新的難度（戰鬥狀態、工具列都是）
 *   4. 結算：也有一排，亮的是這一場的難度；換了之後按「再打一場」就是新的難度
 *   5. 重新整理：不會再跳校準，開場亮的是最後選的
 *   6. 校準畫面的三顆難度鈕不受影響（量完照樣選得到）
 *
 * 用法：node scripts/difficulty-pick-test.mjs（要先開 dev server）
 */

import { chromium } from 'playwright-core';
import { crossMsFor } from '../public/js/game/core/balance.js';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const KEY = 'sb:v2:shared:gameDifficulty';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`    [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];

const picks = (page, box) => page.evaluate((id) => [...document.querySelectorAll(`#${id} [data-pick-difficulty]`)].map((b) => ({
  d: b.dataset.pickDifficulty, text: b.textContent.trim(), on: b.classList.contains('is-on'), visible: b.offsetParent !== null
})), box);
const lit = (list) => list.filter((p) => p.on).map((p) => p.d).join(',');
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
/*
 * 戰鬥狀態沒有直接寫難度，但蟲走完全程要多久（crossMs）是照難度算的：
 * 跟三種難度各算一次，最接近的那個就是這一場實際用的難度。
 */
const battle = async (page) => {
  const r = await page.evaluate(() => {
    const st = window.__spellbee.state();
    return {
      ctx: window.__spellbee.difficulty().difficulty,
      crossMs: st.crossMs,
      len: st.target.length,
      label: document.getElementById('difficulty-label').textContent
    };
  });
  const diffs = ['easy', 'normal', 'hard'].map((d) => [d, Math.abs(crossMsFor(r.len, d) - r.crossMs)]);
  r.state = diffs.sort((a, b) => a[1] - b[1])[0][0];
  return r;
};

const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript((k) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem(k, JSON.stringify('normal'));
    sessionStorage.setItem('seeded', '1');
  }
}, KEY);
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));

console.log('\n1) 開場：三顆都在');
await page.goto(`${BASE}/game?group=w04&n=3&show=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
let p = await picks(page, 'pregame-difficulty');
check('輕鬆、標準、挑戰三顆都看得到', p.length === 3 && p.every((x) => x.visible) && p.map((x) => x.text).join('') === '輕鬆標準挑戰', p.map((x) => x.text).join('／'));
check('亮的是目前的難度（標準）', lit(p) === 'normal', lit(p));

console.log('\n2) 按「挑戰」');
await page.click('#pregame-difficulty [data-pick-difficulty="hard"]');
p = await picks(page, 'pregame-difficulty');
check('亮的換成挑戰', lit(p) === 'hard', lit(p));
check('開場畫面還在（不會直接開打）', await page.isVisible('#pregame'));
check('開場的規則還在', ((await page.textContent('#pregame-rules')) || '').trim().length > 0);
check('記住了', (await stored(page)) === 'hard');

console.log('\n3) 開打');
await page.click('[data-order="sequential"]');
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
let b = await battle(page);
check('這一場是挑戰', b.ctx === 'hard' && b.state === 'hard', JSON.stringify(b));
check('工具列寫「難度 挑戰」', /挑戰/.test(b.label), b.label);

console.log('\n4) 結算');
for (let i = 0; i < 6; i += 1) {
  const st = await page.evaluate(() => window.__spellbee.state());
  if (st.status !== 'running') break;
  await page.keyboard.type(st.target, { delay: 30 });
  await page.waitForTimeout(300);
}
await page.waitForSelector('#postgame:not([hidden])', { timeout: 15000 });
p = await picks(page, 'postgame-difficulty');
check('結算也有三顆', p.length === 3 && p.every((x) => x.visible));
check('亮的是這一場的難度（挑戰）', lit(p) === 'hard', lit(p));
await page.click('#postgame-difficulty [data-pick-difficulty="easy"]');
p = await picks(page, 'postgame-difficulty');
check('亮的換成輕鬆', lit(p) === 'easy', lit(p));
check('結算畫面還在', await page.isVisible('#postgame'));
check('工具列立刻寫「難度 輕鬆」', /輕鬆/.test(await page.textContent('#difficulty-label')));
await page.click('#postgame-again');
await page.waitForTimeout(300);
b = await battle(page);
check('「再打一場」是輕鬆', b.ctx === 'easy' && b.state === 'easy', JSON.stringify(b));

console.log('\n5) 重新整理');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
check('沒有再跳校準', await page.evaluate(() => document.getElementById('calibrate').hidden));
p = await picks(page, 'pregame-difficulty');
check('開場亮的是最後選的（輕鬆）', lit(p) === 'easy', lit(p));
await context.close();

console.log('\n6) 校準畫面不受影響');
{
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pg = await c2.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(`${BASE}/game?group=w04&n=3`, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('#calibrate:not([hidden])', { timeout: 15000 });
  for (const w of ['cat', 'sun', 'book']) await pg.keyboard.type(w, { delay: 120 });
  await pg.waitForSelector('#calibrate-choice:not([hidden])', { timeout: 10000 });
  await pg.click('#calibrate-choice [data-difficulty="hard"]');
  await pg.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  const q = await picks(pg, 'pregame-difficulty');
  check('校準選了挑戰，開場亮的就是挑戰', lit(q) === 'hard', lit(q));
  await c2.close();
}

await browser.close();
console.log('\n驗收');
check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
