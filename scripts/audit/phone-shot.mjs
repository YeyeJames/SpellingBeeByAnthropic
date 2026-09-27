// 手機直式＋螢幕鍵盤：截圖看看戰場有沒有被鍵盤蓋住。
// iOS 叫出鍵盤時「版面高度」不會變，只有 visualViewport 變矮——Chromium 模擬不出來，
// 所以這裡假造一個 visualViewport，再在截圖上把鍵盤那一塊塗灰，看得出被蓋住的地方。
//   node scripts/audit/phone-shot.mjs <輸出前綴> [寬] [高] [鍵盤以上剩多高]
import { chromium } from 'playwright-core';

const [out = 'phone', W = '430', H = '800', VIS = '440'] = process.argv.slice(2);
const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: +W, height: +H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
  const vv = new EventTarget();
  Object.assign(vv, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
  window.__kb = (h) => { vv.height = h ?? innerHeight; vv.dispatchEvent(new Event('resize')); };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/game?group=w04&n=200&show=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
await page.click('[data-order="sequential"]');
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
if (await page.isVisible('#tap-to-start')) await page.tap('#tap-to-start');
await page.evaluate((v) => window.__kb(v), +VIS);
await page.waitForTimeout(1500);
if (process.env.LONG) await page.evaluate(() => { window.__spellbeeScene.wordText.setText('entertainment'); });
const info = await page.evaluate((vis) => {
  const s = window.__spellbeeScene;
  const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
  const canvas = document.querySelector('#game-root canvas').getBoundingClientRect();
  return { vis, laneY: Math.round(s.laneY), hive: [Math.round(s.hive.y - 63), Math.round(s.hive.y + 63)], canvas: [Math.round(canvas.top), Math.round(canvas.bottom)], chrome: r('game-chrome'), listen: r('listen-buttons'), word: Math.round(s.wordText.y) };
}, +VIS);
// 把鍵盤那一塊塗灰
await page.evaluate((vis) => {
  const k = document.createElement('div');
  k.style.cssText = `position:fixed;left:0;right:0;top:${vis}px;bottom:0;background:rgba(120,120,130,.85);z-index:999;color:#fff;font:20px sans-serif;display:flex;align-items:center;justify-content:center`;
  k.textContent = '（螢幕鍵盤）';
  document.body.appendChild(k);
}, +VIS);
await page.screenshot({ path: `${out}.png` });
console.log(JSON.stringify(info), errors.length ? `errors: ${errors.join(' | ')}` : '');
await browser.close();
