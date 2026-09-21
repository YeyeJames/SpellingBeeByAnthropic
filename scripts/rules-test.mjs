/**
 * 玩法說明。
 *
 * 規則本來只存在於程式碼裡：按 ↑ 會重聽，但「重聽要付什麼代價」畫面上一個
 * 字都沒有。他按了、敵人突然衝了一段，他不知道是自己按的還是遊戲壞了。
 * **看不懂的規則等於不存在。**
 *
 * 要證明的事：
 *   1. 說明打得開（按鈕、F1），而且關得掉（按鈕、Esc、點旁邊）
 *   2. 開著的時候一定是暫停的——規則有六段，沒暫停讀一讀就死了
 *   3. 每一條代價與加成都真的寫出來，而且數字跟 balance.js 一致
 *      （寫死的文案在平衡一調之後就變成謊言，而且不會有任何錯誤）
 *   4. 難度不同，說明裡的數字要跟著不同
 *   5. 字級真的夠大——這是要給小四生看的
 *   6. 開場畫面也放了濃縮版，每一場都會看到一次
 *
 * 用法：node scripts/rules-test.mjs
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

// 說明裡的數字必須跟這份設定一致，不是照抄一段文案
const { BALANCE, knockbackMsFor } = await import('../public/js/game/core/balance.js');

const browser = await chromium.launch({ executablePath: CHROME });
const consoleErrors = [];

/* hidden 屬性一加上去元素就不可見，waitForSelector 預設等的是「可見」，會等到天荒地老 */
const waitClosed = (page) =>
  page.waitForFunction(() => document.getElementById('rules-panel').hidden === true, null, { timeout: 5000 });

async function openGame(difficulty = 'normal') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((d) => {
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify(d));
  }, difficulty);
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && EXPECTED_503.some((u) => (m.location()?.url || '').includes(u))) return;
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`${BASE}/game?group=w18&n=200&order=sequential&show=1&difficulty=${difficulty}`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  return { context, page };
}

/* ── 1~2. 開關與暫停 ───────────────────────────────────── */
console.log('1) 打得開、關得掉，而且開著就是暫停');
{
  const { context, page } = await openGame();

  check('平常是收起來的', await page.evaluate(() => document.getElementById('rules-panel').hidden));

  await page.click('#btn-rules');
  await page.waitForSelector('#rules-panel:not([hidden])', { timeout: 5000 });
  check('按鈕打得開', true);
  check('打開的同時暫停了', await page.evaluate(() => document.body.classList.contains('is-paused')));

  // 真的停住了才算暫停——只加一個 class 不算
  const t1 = await page.evaluate(() => window.__spellbee.state().tick);
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => window.__spellbee.state().tick);
  check('戰鬥真的停住（不是只加了一個樣式）', t1 === t2, `${t1} → ${t2}`);

  await page.keyboard.press('Escape');
  await waitClosed(page);
  check('Esc 關得掉', true);
  check('關掉之後繼續打', !(await page.evaluate(() => document.body.classList.contains('is-paused'))));

  await page.keyboard.press('F1');
  await page.waitForSelector('#rules-panel:not([hidden])', { timeout: 5000 });
  check('F1 也打得開', true);
  await page.click('#rules-close');
  await waitClosed(page);
  check('「知道了」關得掉', true);

  /*
   * 本來就停在暫停畫面時，關掉說明不該把他推回戰鬥。
   * 他很可能正是因為暫停下來想查規則才打開說明的。
   */
  await page.keyboard.press('Escape'); // 先暫停
  await page.keyboard.press('F1');
  await page.waitForSelector('#rules-panel:not([hidden])', { timeout: 5000 });
  await page.keyboard.press('Escape'); // 關掉說明
  await waitClosed(page);
  check('本來就暫停的話，關掉說明還是暫停',
    await page.evaluate(() => document.body.classList.contains('is-paused')));

  await context.close();
}

/* ── 3. 每一條都要寫出來，數字要對 ─────────────────────── */
console.log('\n2) 代價與加成都寫出來，而且數字跟 balance.js 一致');
{
  const { context, page } = await openGame('normal');
  await page.click('#btn-rules');
  await page.waitForSelector('#rules-panel:not([hidden])', { timeout: 5000 });
  const text = await page.locator('#rules-body').innerText();

  const c = BALANCE.combo;
  const h = BALANCE.honey;
  const listen = BALANCE.listenCostMs;
  const d = BALANCE.difficulty.normal;

  // 聽力的三個代價
  check(`再聽一次的代價寫出來了（${listen.replay}ms）`,
    text.includes('再聽一次') && text.includes(`${listen.replay / 1000} 秒`), '');
  check(`放慢唸的代價寫出來了（${listen.slow}ms）`,
    text.includes('放慢唸') && text.includes(`${listen.slow / 1000} 秒`), '');
  check(`唸例句的代價寫出來了（${listen.sentence}ms）`,
    text.includes('唸例句') && text.includes(`${listen.sentence / 1000} 秒`), '');

  // 連擊三階的門檻與效果
  check(`連擊 ${c.dashAt} 的效果寫出來了`, text.includes(`連擊 ${c.dashAt}`) && text.includes('蜂群衝刺'));
  check(`連擊 ${c.sweetTimeAt} 的效果寫出來了`, text.includes(`連擊 ${c.sweetTimeAt}`) && text.includes('蜜糖時間'));
  check(`連擊 ${c.frenzyAt} 的效果寫出來了`, text.includes(`連擊 ${c.frenzyAt}`) && text.includes('狂蜂狀態'));
  check('說清楚打錯就歸零', /打錯.*歸零/.test(text.replace(/\n/g, '')), '');
  check('說清楚加成不會幫你少打字母', text.includes('少打字母'), '');

  // 分數怎麼算
  check(`打對一個字母 +${h.perCorrectLetter}`, text.includes(`+${h.perCorrectLetter}`));
  check(`打掉一隻蟲 +${h.perKill}`, text.includes(`+${h.perKill}`));
  check(`${h.longWordFrom} 個字母以上有額外分數`, text.includes(`${h.longWordFrom} 個字母以上`));

  // 時間公式。同樣只比對數字，不比對格式
  check('寫出基礎時間', text.includes(String(d.baseMs / 1000)), `找 ${d.baseMs / 1000}`);
  check('寫出每個字母加多少時間', text.includes(String(d.perLetterMs / 1000)),
    `找 ${d.perLetterMs / 1000}`);
  check(`打錯一個字母前進 ${BALANCE.wrongLetterPenaltyMs}ms`,
    text.includes(`${BALANCE.wrongLetterPenaltyMs / 1000} 秒`), '');
  check(`扣完 ${BALANCE.maxHp} 顆血就結束`, text.includes(`${BALANCE.maxHp} 顆`), '');

  // 按鍵
  check('寫出三個聽力鍵', text.includes('↑') && text.includes('↓') && text.includes('→'));
  check('寫出 Backspace 可以刪字母', text.includes('Backspace'));
  check('說明空白與連字號可打可不打', /空白.*連字號/.test(text.replace(/\n/g, '')), '');

  /* ── 5. 字要夠大 ─────────────────────────────────────── */
  console.log('\n3) 字級要夠大（小四生看的）');
  const style = await page.evaluate(() => {
    const li = document.querySelector('.rules-section li');
    const h3 = document.querySelector('.rules-section h3');
    const cs = getComputedStyle(li);
    return {
      li: parseFloat(cs.fontSize),
      lineHeight: parseFloat(cs.lineHeight),
      h3: parseFloat(getComputedStyle(h3).fontSize)
    };
  });
  check('內文至少 18px', style.li >= 18, `${style.li}px`);
  check('行距至少字級的 1.5 倍', style.lineHeight >= style.li * 1.5,
    `${style.lineHeight}px / ${style.li}px`);
  check('段落標題比內文大', style.h3 > style.li, `${style.h3}px`);

  const sections = await page.locator('.rules-section').count();
  check('分成好幾段，不是一整塊', sections >= 5, `${sections} 段`);

  /*
   * 關閉鍵要一直看得到。
   * 說明比一個畫面長，關閉鍵如果在最底下，他讀到一半想關掉還得先捲到底。
   */
  const closeVisible = await page.evaluate(() => {
    const btn = document.getElementById('rules-close');
    const r = btn.getBoundingClientRect();
    return {
      inView: r.top >= 0 && r.bottom <= window.innerHeight + 1,
      sticky: getComputedStyle(btn).position === 'sticky'
    };
  });
  check('沒有捲動也看得到關閉鍵', closeVisible.inView && closeVisible.sticky,
    JSON.stringify(closeVisible));

  await context.close();
}

/* ── 4. 難度不同，數字要不同 ───────────────────────────── */
console.log('\n4) 換難度，說明裡的數字要跟著換');
{
  const { context, page } = await openGame('hard');
  await page.click('#btn-rules');
  await page.waitForSelector('#rules-panel:not([hidden])', { timeout: 5000 });
  const text = await page.locator('#rules-body').innerText();

  const hard = BALANCE.difficulty.hard;
  const normal = BALANCE.difficulty.normal;
  check('標題寫出現在是挑戰難度', text.includes('挑戰'), '');
  check('用的是挑戰難度的基礎時間', text.includes(`${hard.baseMs / 1000} 秒`), '');
  check('不是標準難度的數字',
    !text.includes(`${normal.baseMs / 1000} 秒 + 每個字母`),
    '');
  /*
   * 只比對數字本身，不比對「怎麼寫成秒」。
   * 連格式化也照抄一次的話，這條就變成拿同一個函式驗自己，永遠會過。
   */
  const kb = Number((Math.round(knockbackMsFor('hard')) / 1000).toFixed(2));
  check(`擊退量跟著難度走（${Math.round(knockbackMsFor('hard'))}ms）`,
    text.includes(String(kb)), `找 ${kb}`);

  await context.close();
}

/* ── 6. 開場畫面的濃縮版 ───────────────────────────────── */
console.log('\n5) 開場畫面也要放濃縮版');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // 不帶 order=，開場畫面才會出現
  await page.goto(`${BASE}/game?group=w18&n=200&show=1&difficulty=normal`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });

  const quick = await page.locator('#pregame-rules').innerText();
  check('講了重聽要付代價', quick.includes('再聽') && quick.includes('前進'), quick.split('\n')[0]);
  check('講了連擊怎麼算', quick.includes('連擊'), quick);
  check('告訴他完整規則按哪裡', quick.includes('F1'), quick);

  const size = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('#pregame-rules p')).fontSize)
  );
  check('濃縮版也至少 16px', size >= 16, `${size}px`);

  await context.close();
}

await browser.close();
console.log('\n驗收');
check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
