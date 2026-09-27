// 手機直式＋螢幕鍵盤：三選一、結算、暫停畫面有沒有被鍵盤蓋住（截圖＋量位置）。
//   node scripts/audit/phone-panels.mjs <輸出前綴>
import { chromium } from 'playwright-core';

const [out = 'panel', W = '430', H = '800', VIS = '440'] = process.argv.slice(2);
const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: +W, height: +H }, hasTouch: true, isMobile: true });
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
  const vv = new EventTarget();
  Object.assign(vv, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
  window.__kb = (h) => { vv.height = h ?? innerHeight; vv.dispatchEvent(new Event('resize')); };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/game?group=w04&n=3&show=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
await page.click('[data-order="sequential"]');
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
if (await page.isVisible('#tap-to-start')) await page.tap('#tap-to-start');
await page.evaluate((v) => { window.__kb(v); }, +VIS);
await page.waitForTimeout(400);

const inside = (sel) => page.evaluate(([s, vis]) => {
  const els = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null);
  const lim = document.body.classList.contains('kb-open') ? vis : innerHeight;
  return els.map((e) => { const b = e.getBoundingClientRect(); return { text: e.innerText.trim().slice(0, 12), top: Math.round(b.top), bottom: Math.round(b.bottom), ok: b.top >= 0 && b.bottom <= lim + 1 }; });
}, [sel, +VIS]);
const shade = () => page.evaluate((vis) => {
  const k = document.createElement('div');
  k.style.cssText = `position:fixed;left:0;right:0;top:${vis}px;bottom:0;background:rgba(120,120,130,.85);z-index:999`;
  document.body.appendChild(k);
  return () => k.remove();
}, +VIS);

// 1. 暫停：切到別的 App
await page.evaluate(() => { window.dispatchEvent(new Event('blur')); });
await page.waitForTimeout(200);
const pausedText = await page.evaluate(() => getComputedStyle(document.getElementById('game-root'), '::after').content);
await page.tap('#game-root', { position: { x: 200, y: 150 } });
await page.waitForTimeout(200);
const resumed = await page.evaluate(() => !document.body.classList.contains('is-paused'));
console.log(JSON.stringify({ pausedText, resumedByTap: resumed }));

// 2. 三選一（面板內容假造，只看版面）
await page.evaluate(() => {
  const p = document.getElementById('perk-panel');
  document.getElementById('perk-cards').innerHTML = ['🛡️ 護盾', '⚡ 連擊加倍', '🍯 蜂蜜加成'].map((n, i) =>
    `<button class="perk-card"><span class="perk-icon">${n.split(' ')[0]}</span><span><b>${n.split(' ')[1]}</b><br>下一次被撞不會扣血，這一場有效</span><span class="perk-key">按 ${i + 1}</span></button>`).join('');
  p.hidden = false;
});
console.log('perk', JSON.stringify(await inside('#perk-panel > strong, .perk-card')));
await shade();
await page.screenshot({ path: `${out}-perk.png` });
await page.evaluate(() => { document.getElementById('perk-panel').hidden = true; document.body.lastElementChild.remove(); });

// 3. 打完三個字，看結算
for (let i = 0; i < 6; i += 1) {
  const st = await page.evaluate(() => window.__spellbee.state());
  if (st.status !== 'running') break;
  await page.keyboard.type(st.target, { delay: 30 });
  await page.waitForTimeout(300);
}
await page.waitForSelector('#postgame:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(1500);
const kbReleased = await page.evaluate(() => !document.activeElement?.classList.contains('touch-input'));
console.log('postgame 收起鍵盤', kbReleased);
// 模擬 iOS：輸入框沒有焦點，鍵盤就收起來
if (kbReleased) await page.evaluate(() => { window.__kb(); });
await page.waitForTimeout(500);
console.log('postgame', JSON.stringify(await inside('#postgame-title, #postgame-actions .btn-postgame')));
const scrollable = await page.evaluate(() => { const p = document.getElementById('postgame'); return { scrollH: p.scrollHeight, clientH: p.clientHeight }; });
console.log('postgame scroll', JSON.stringify(scrollable));
if (!kbReleased) await shade();
await page.screenshot({ path: `${out}-post.png` });
// 再打一場：鍵盤要回來
await page.tap('#postgame-again');
await page.waitForTimeout(500);
console.log('再打一場後輸入框拿回焦點', await page.evaluate(() => !!document.activeElement?.classList.contains('touch-input')));
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
