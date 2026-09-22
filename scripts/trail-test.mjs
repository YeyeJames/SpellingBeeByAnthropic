/**
 * 血條下方那一排「已經拼對的字母」。
 *
 * 為什麼要有這一排：打錯字母不會清掉已經打對的部分（battle.js 刻意的，
 * 清空重來對小孩來說是前功盡棄）。但這件好事畫面上完全看不出來——
 * 按錯一下，閃紅、蟲往前衝，然後那個錯的字母到底算不算數？
 * 他現在該從第幾個字母接下去？沒有任何東西回答得了，只能從頭猜。
 *
 * 要證明的事：
 *   1. 沒有題目文字的時候也看得到（這才是真正的聽寫模式，也是它存在的理由）
 *   2. 打對一個，那一排就長一個
 *   3. 打錯：字**不變**（進度真的留著），但要閃紅——不然看不出按鍵有讀到
 *   4. 紅色會自己退掉，不會一路紅到下一次按鍵
 *   5. 退格會縮回去
 *   6. 換字歸零
 *   7. 不洩題：那一排永遠只有他打過的字母，後面不補格子
 *      （補了等於告訴他這個字有幾個字母，而長度也是題目的一部分）
 *   8. 位置真的在血條下面，而且在畫面內
 *
 * 用法：node scripts/trail-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

const EXPECTED_503 = ['/api/words/recorded', '/api/game/access', '/api/game/result'];

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
});
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && EXPECTED_503.some((u) => (m.location()?.url || '').includes(u))) return;
  if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
});

// easy + 200 個字：不會有蟲在測試中途走到蜂巢把局面打斷
await page.goto(`${BASE}/game?group=w01&n=200&order=sequential&difficulty=easy`, {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

const trail = () => page.evaluate(() => window.__spellbee.typedTrail());
const state = () => page.evaluate(() => window.__spellbee.state());

async function typeOne() {
  const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
  if (!ch) return null;
  await page.keyboard.press(ch === ' ' ? 'Space' : ch);
  return ch;
}

/*
 * 強制關掉題目文字。
 *
 * 無頭 Chromium 一個英文語音都沒有，所以自動規則會判定「沒語音就顯示單字」，
 * 題目會一直寫在畫面正中間。那樣測等於沒測到重點：這一排的意義就是
 * 「看不到單字的時候，他靠什麼知道自己打到哪裡」。
 */
await page.evaluate(() => window.__spellbee.setShowWord(false));
const showing = await page.evaluate(() => window.__spellbee.showsWord());

console.log('1) 沒有題目文字時也看得到');
check('題目文字確實關掉了', showing === false, `showsWord=${showing}`);
{
  const t = await trail();
  check('開場只有一個底線（下一個打這裡）', t.text === '_', JSON.stringify(t.text));
}

/* ── 2. 打對就長出來 ──────────────────────────────────── */
console.log('2) 打對一個就長一個');
{
  const typed = [];
  for (let i = 0; i < 3; i += 1) {
    const ch = await typeOne();
    typed.push(ch);
    const t = await trail();
    const want = typed.join('').toUpperCase() + '_';
    check(`打對第 ${i + 1} 個字母 → ${want}`, t.text === want, JSON.stringify(t.text));
  }
}

/* ── 3~4. 打錯：字不變，但要閃紅 ───────────────────────── */
console.log('3) 打錯：已經打對的留著，但看得出按鍵有讀到');
{
  const before = (await trail()).text;
  const expected = await page.evaluate(() => window.__spellbee.expectedLetter());
  // 隨便找一個不是正解的字母
  const wrong = 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => c !== expected);
  const typedBefore = (await state()).typed;

  await page.keyboard.press(wrong);

  const after = await trail();
  const typedAfter = (await state()).typed;
  check('打錯不清空已經打對的部分', after.text === before, `${before} → ${after.text}`);
  check('打錯不會讓進度倒退', typedAfter === typedBefore, `${typedBefore} → ${typedAfter}`);
  check('打錯時整排閃紅（否則看不出按鍵有讀到）', after.flashing === true);
  check('閃的是紅色', after.color === '#f87171', after.color);

  console.log('4) 紅色會自己退掉');
  await page.waitForFunction(() => window.__spellbee.typedTrail().flashing === false, null, {
    timeout: 3000
  });
  const back = await trail();
  check('退回原本的琥珀色', back.color === '#f5b301', back.color);
  check('退色之後字仍然在', back.text === before, JSON.stringify(back.text));
}

/* ── 5. 退格 ──────────────────────────────────────────── */
console.log('5) 退格會縮回去');
{
  const before = (await trail()).text;
  await page.keyboard.press('Backspace');
  const after = await trail();
  check(
    '退一格，那一排短一個字母',
    after.text.length === before.length - 1 && before.startsWith(after.text.slice(0, -1)),
    `${before} → ${after.text}`
  );
  check('退格後結尾仍然是底線', after.text.endsWith('_'), after.text);
}

/* ── 6~7. 打完一個字：歸零，而且過程中從不洩題 ─────────── */
console.log('6) 換字歸零，而且全程不洩題');
{
  const wordIndexBefore = (await state()).wordIndex;
  let leaked = '';
  /*
   * 一邊打一邊比對：那一排的長度永遠等於「已經打對的數量 + 1（底線）」。
   * 只要多出一個字元，就代表畫面在替他補後面還沒打的格子。
   */
  for (let guard = 0; guard < 40; guard += 1) {
    const s = await state();
    if (s.wordIndex !== wordIndexBefore) break;
    const t = await trail();
    if (t.text.length !== s.typed + 1) {
      leaked = `typed=${s.typed} 但畫面是 ${JSON.stringify(t.text)}`;
      break;
    }
    if (!(await typeOne())) break;
  }
  check('全程只顯示打過的字母，後面不補格子', leaked === '', leaked);

  const after = await state();
  check('這個字真的打完了', after.wordIndex === wordIndexBefore + 1, `${wordIndexBefore} → ${after.wordIndex}`);
  const t = await trail();
  check('換字之後歸零成一個底線', t.text === '_', JSON.stringify(t.text));
}

/* ── 8. 位置 ──────────────────────────────────────────── */
console.log('7) 位置在血條下面，而且在畫面內');
{
  /*
   * 直接問渲染端要座標，不用截圖比對。
   * 截圖對「有沒有掉出畫面」這種事太脆弱：字型差一點點就整批要重錄基準圖。
   */
  const geom = await page.evaluate(() =>
    window.__spellbee.trailGeometry ? window.__spellbee.trailGeometry() : null
  );
  if (!geom) {
    check('拿得到那一排的位置', false, 'debug API 沒有 trailGeometry()');
  } else {
    check('在血條下面', geom.y > geom.hpY, `trail y=${geom.y}、血條 y=${geom.hpY}`);
    check('左緣跟血條切齊', Math.abs(geom.x - (geom.hpX - 11)) < 2, `trail x=${geom.x}、第一顆血點 x=${geom.hpX}`);
    check('沒有掉出畫面', geom.y > 0 && geom.y < geom.viewH && geom.x > 0, JSON.stringify(geom));
  }
}

check('沒有 JS 例外', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
