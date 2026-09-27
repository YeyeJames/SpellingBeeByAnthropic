/**
 * 手機直式＋螢幕鍵盤。
 *
 * iOS 叫出鍵盤時版面高度不變、鍵盤直接蓋在網頁上，只有 visualViewport 變矮。
 * Chromium 模擬不出來，所以假造一個 visualViewport，由測試決定鍵盤開關。
 *
 *   1. 鍵盤一開，畫布縮到看得到的範圍；蜂巢、戰場、工具列、聽力鍵都在鍵盤上面
 *   2. 鍵盤收起來，全部回到原本的樣子
 *   3. 小手機（iPhone SE）也一樣
 *   4. 暫停之後點一下畫面就繼續（手機沒有 Esc）
 *   5. 打完：鍵盤收起來、結算的按鈕沒有被工具列蓋住；「再打一場」把鍵盤叫回來
 *   6. 筆電：同樣的程式什麼都不會變（沒有 kb-open）
 *
 * 用法：node scripts/phone-test.mjs（要先開 dev server）
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`    [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME });
const pageErrors = [];

async function open({ width, height, touch = true, n = 200 }) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await context.addInitScript(() => {
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
    const vv = new EventTarget();
    Object.assign(vv, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
    window.__kb = (h) => { vv.height = h ?? innerHeight; vv.dispatchEvent(new Event('resize')); };
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/game?group=w04&n=${n}&show=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  await page.click('[data-order="sequential"]');
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  if (await page.isVisible('#tap-to-start')) await page.tap('#tap-to-start');
  return { page, context };
}

const kb = async (page, h) => {
  await page.evaluate((v) => { window.__kb(v ?? undefined); }, h ?? null);
  await page.waitForTimeout(300);
};

const geometry = (page) => page.evaluate(() => {
  const s = window.__spellbeeScene;
  const rect = (el) => el.getBoundingClientRect();
  const canvas = rect(document.querySelector('#game-root canvas'));
  const chrome = rect(document.getElementById('game-chrome'));
  const listen = rect(document.getElementById('listen-buttons'));
  return {
    kbOpen: document.body.classList.contains('kb-open'),
    canvasTop: canvas.top,
    canvasH: canvas.height,
    hiveBottom: s.hive.y + 63,
    laneY: s.laneY,
    chromeTop: chrome.top,
    chromeBottom: chrome.bottom,
    listenTop: listen.top,
    listenBottom: listen.bottom,
    controlsShown: getComputedStyle(document.querySelector('.chrome-controls')).display !== 'none'
  };
});

function checkAboveKeyboard(g, vis) {
  check('畫布縮到看得到的範圍', Math.abs(g.canvasTop) <= 1 && Math.abs(g.canvasH - vis) <= 2, `畫布 ${Math.round(g.canvasTop)}+${Math.round(g.canvasH)}，看得到 ${vis}`);
  check('工具列貼在鍵盤上緣', Math.abs(g.chromeBottom - vis) <= 2, `工具列 ${Math.round(g.chromeTop)}~${Math.round(g.chromeBottom)}`);
  check('蜂巢整個在工具列上面', g.hiveBottom <= g.chromeTop + 1, `蜂巢底 ${Math.round(g.hiveBottom)}、工具列 ${Math.round(g.chromeTop)}`);
  check('聽力鍵在鍵盤上面', g.listenBottom <= vis + 1 && g.listenTop >= g.chromeTop - 1, `${Math.round(g.listenTop)}~${Math.round(g.listenBottom)}`);
  check('打字時收起下面那排按鈕', !g.controlsShown);
}

console.log('\n1) iPhone 直式（430×800，鍵盤上面剩 440）');
{
  const { page, context } = await open({ width: 430, height: 800 });
  const before = await geometry(page);
  check('鍵盤還沒開：沒有 kb-open', !before.kbOpen);
  await kb(page, 440);
  const g = await geometry(page);
  check('鍵盤開了：kb-open', g.kbOpen);
  checkAboveKeyboard(g, 440);

  console.log('\n2) 鍵盤收起來');
  await kb(page);
  const back = await geometry(page);
  check('kb-open 拿掉', !back.kbOpen);
  check('畫布回到整個畫面', Math.abs(back.canvasH - 800) <= 2, `${Math.round(back.canvasH)}`);
  check('戰場回到原本的位置', Math.abs(back.laneY - before.laneY) <= 1, `${Math.round(back.laneY)} vs ${Math.round(before.laneY)}`);
  check('下面那排按鈕回來', back.controlsShown);

  console.log('\n4) 暫停之後點一下就繼續');
  await kb(page, 440);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); });
  await page.waitForTimeout(100);
  const paused = await page.evaluate(() => document.body.classList.contains('is-paused'));
  const text = await page.evaluate(() => getComputedStyle(document.getElementById('game-root'), '::after').content);
  check('切出去會暫停', paused);
  check('暫停字樣寫「點一下繼續」', /點一下繼續/.test(text), text);
  await page.tap('#game-root', { position: { x: 200, y: 150 } });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    paused: document.body.classList.contains('is-paused'),
    focused: !!document.activeElement?.classList.contains('touch-input')
  }));
  check('點一下畫面就繼續', !after.paused);
  check('鍵盤也叫回來了（輸入框有焦點）', after.focused);
  await context.close();
}

console.log('\n3) iPhone SE（375×560，鍵盤上面剩 300）');
{
  const { page, context } = await open({ width: 375, height: 560 });
  await kb(page, 300);
  checkAboveKeyboard(await geometry(page), 300);
  await context.close();
}

console.log('\n5) 打完：結算的按鈕按得到');
{
  const { page, context } = await open({ width: 430, height: 800, n: 3 });
  await kb(page, 440);
  for (let i = 0; i < 6; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') break;
    await page.keyboard.type(st.target, { delay: 30 });
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('#postgame:not([hidden])', { timeout: 15000 });
  const released = await page.evaluate(() => !document.activeElement?.classList.contains('touch-input'));
  check('打完就收起鍵盤', released);
  await kb(page); // iOS：輸入框沒有焦點，鍵盤就收起來
  await page.waitForTimeout(1200);
  const hit = await page.evaluate(() => [...document.querySelectorAll('#postgame-actions .btn-postgame')].map((b) => {
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { text: b.innerText.trim(), ok: !!top && b.contains(top), bottom: Math.round(r.bottom) };
  }));
  for (const b of hit) check(`「${b.text}」沒有被蓋住`, b.ok, `底 ${b.bottom}`);
  await page.tap('#postgame-again');
  await page.waitForTimeout(400);
  check('「再打一場」把鍵盤叫回來', await page.evaluate(() => !!document.activeElement?.classList.contains('touch-input')));
  await context.close();
}

console.log('\n6) 筆電：什麼都不會變');
{
  const { page, context } = await open({ width: 1280, height: 720, touch: false });
  await kb(page); // 看得到的＝整個視窗
  const g = await geometry(page);
  check('沒有 kb-open', !g.kbOpen);
  check('畫布鋪滿視窗', Math.abs(g.canvasH - 720) <= 2);
  check('下面那排按鈕都在', g.controlsShown);
  check('沒有隱形輸入框', await page.evaluate(() => !document.querySelector('.touch-input')));
  // 雙指放大不是鍵盤
  await page.evaluate(() => { window.visualViewport.scale = 2; window.__kb(360); });
  await page.waitForTimeout(300);
  check('放大時也不會縮', !(await geometry(page)).kbOpen);
  await context.close();
}

await browser.close();
console.log('\n驗收');
check('沒有瀏覽器錯誤', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
