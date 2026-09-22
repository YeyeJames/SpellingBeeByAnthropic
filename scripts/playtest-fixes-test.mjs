/**
 * 兒子第一次實際試玩時發現的問題，逐條釘住。
 *
 * 這些都不是測試想出來的情境，是他坐在那裡玩出來的：
 *
 *   1. 「怎麼背景音樂還在？」——練習做完回到清單，BGM 一直循環。
 *      startBgm() 從頭到尾沒有對應的 stop。
 *   2. 「然後要怎麼回去？」——一場打完只有畫布中央一行字，沒有任何出口。
 *      唯一的路是工具列那顆刻意做小的「← 回練習」。
 *   3. 「練習了三次，錢怎麼還是只有 300？」——練習頁上有兩個長得一樣的
 *      🪙 數字：導覽列是存款總數，內頁那個只算這一回、每次歸零。
 *      他把後者當成存款。
 *   4. 連到 5 的「敵人減速」沒有感覺——他打得順，時間本來就充裕，
 *      速度慢一半看不出來。現在敵人身上會罩一層光環。
 *
 * 用法：node scripts/playtest-fixes-test.mjs
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

/* ── 1. 練習結束要停掉背景音樂 ───────────────────────────── */
console.log('1) 練習做完，背景音樂要停');
{
  /*
   * 不去跑完整場練習（要登入、要資料庫）。
   * 這一條的本質是「finishSession 有沒有呼叫 stopBgm」，直接從原始碼驗——
   * 比起搭一整套環境去繞到那一行，這樣不會有假的通過。
   */
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/js/practice.js', import.meta.url), 'utf8');
  const finish = src.slice(src.indexOf('function finishSession'), src.indexOf('function recordCompletionLocally'));
  check('finishSession 會停掉 BGM', /sound\.stopBgm\(\)/.test(finish));
  check('練習有啟動 BGM（不然上面那條是空的）', /sound\.startBgm\(\)/.test(src));
}

/* ── 2. 兩個金幣數字要分得開 ─────────────────────────────── */
console.log('2) 「本回賺到」與「存款總數」不能長得一樣');
{
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/practice.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/js/practice.js', import.meta.url), 'utf8');
  const nav = readFileSync(new URL('../public/partials/nav.html', import.meta.url), 'utf8');

  const sessionBadge = html.match(/id="session-coin-badge"[^>]*>([^<]*)</);
  check('內頁那個標成「本回」', !!sessionBadge && sessionBadge[1].includes('本回'), sessionBadge?.[1]);
  check('導覽列那個沒有「本回」（它是總數）', /data-nav-coins/.test(nav) && !/本回[^<]*data-nav-coins/.test(nav));
  check(
    '每次更新也都帶著「本回」，不會被蓋回去',
    (js.match(/sessionCoinBadge\.textContent\s*=\s*`本回/g) || []).length ===
      (js.match(/sessionCoinBadge\.textContent/g) || []).length,
    `${(js.match(/sessionCoinBadge\.textContent\s*=\s*`本回/g) || []).length} / ${(js.match(/sessionCoinBadge\.textContent/g) || []).length}`
  );
  /*
   * 結算那句話原本寫「總共賺到 N 枚」，但 N 只算這一場。
   * 「總共」兩個字放在只算一場的數字前面，就是他誤會的來源。
   */
  const finish = js.slice(js.indexOf('function finishSession'), js.indexOf('function recordCompletionLocally'));
  /*
   * 註解要先拿掉再比對。
   *
   * 那段程式的註解裡引用了舊文案（「本來只寫『總共賺到 N 枚』」），
   * 直接搜整段的話會搜到註解，等於在檢查註解而不是檢查程式——
   * 第一次跑就是這樣假失敗的。
   */
  const code = finish.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('結算不再把單場數字說成「總共賺到」', !/總共賺到/.test(code));
  check('結算有寫出存款總數', /getNavCoins\(\)/.test(code) && /存款總共/.test(code));
}

/* ── 3~4. 遊戲端 ─────────────────────────────────────────── */
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// w01 有 40 個字，連擊打得到 5（減速要用）
await page.goto(`${BASE}/game?group=w01&n=200&order=sequential&show=1&difficulty=easy`, {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

async function typeOne() {
  const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
  if (!ch) return null;
  await page.keyboard.press(ch === ' ' ? 'Space' : ch);
  return ch;
}

console.log('3) 敵人減速時，看得出來敵人被減速');
{
  const before = await page.evaluate(() => window.__spellbee.slowAura());
  check('平常沒有光環', before.visible === false, JSON.stringify(before));

  let st = null;
  for (let i = 0; i < 60; i += 1) {
    if (!(await typeOne())) break;
    st = await page.evaluate(() => window.__spellbee.state());
    if (st.dashMs > 0) break;
  }
  check('連到 5 真的觸發減速', st && st.dashMs > 0, `combo=${st?.combo}、dashMs=${st?.dashMs}`);

  const during = await page.evaluate(() => window.__spellbee.slowAura());
  check('減速期間敵人身上有光環', during.visible === true, JSON.stringify(during));

  // 效果結束之後要收掉，不然會一路亮到下一場
  await page.waitForFunction(() => window.__spellbee.state().dashMs === 0, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__spellbee.slowAura().visible === false, null, { timeout: 3000 });
  check('效果結束後光環收掉', true);
}

console.log('4) 一場打完之後，有看得見的出口');
{
  // 直接打完剩下的字
  for (let i = 0; i < 2000; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') break;
    if (!(await typeOne())) break;
  }
  const st = await page.evaluate(() => window.__spellbee.state());
  check('戰鬥真的結束了', st.status !== 'running', st.status);

  await page.waitForSelector('#postgame:not([hidden])', { timeout: 5000 }).catch(() => {});
  const post = await page.evaluate(() => {
    const el = document.getElementById('postgame');
    if (!el) return null;
    return {
      hidden: el.hidden,
      title: document.getElementById('postgame-title')?.textContent || '',
      rows: [...document.querySelectorAll('#postgame-stats .stat-row')].map((r) => r.textContent),
      actions: [...document.querySelectorAll('#postgame-actions .btn-postgame')].map((a) => ({
        text: a.textContent.trim(),
        href: a.getAttribute('href') || ''
      }))
    };
  });
  check('結算畫面出現了', post && post.hidden === false);
  check('寫出輸贏', /打完了|攻破/.test(post?.title || ''), post?.title);
  check('列出這一場的成績', (post?.rows.length || 0) >= 4, `${post?.rows.length} 列`);
  /*
   * 兩條出路都要在：再打一場（留下）與回練習（離開）。
   * 他問的是「怎麼回去」，所以離開那一條是重點。
   */
  const acts = post?.actions || [];
  check('有「再打一場」', acts.some((a) => a.text.includes('再打一場')), JSON.stringify(acts));
  check(
    '有回練習的出口，而且真的連到練習頁',
    acts.some((a) => a.href.includes('practice')),
    JSON.stringify(acts)
  );

  // 再打一場：結算要收掉，新的一場要真的開始
  await page.click('#postgame-again');
  await page.waitForFunction(
    () => document.getElementById('postgame').hidden && window.__spellbee.state()?.status === 'running',
    null,
    { timeout: 5000 }
  );
  check('按了再打一場，結算收掉、新的一場開始', true);

  /*
   * 上一場的拼字那一排不可以留到新的一場。
   * 重開時 clearMiss() 會歸零——這條就是在守那件事。
   */
  const trail = await page.evaluate(() => window.__spellbee.typedTrail());
  check('新的一場，拼字那一排是乾淨的', trail.text === '_', JSON.stringify(trail.text));
}

console.log('5) 結算蓋出來的時候，工具列還按得到');
{
  // 先把這一場打完，叫出結算
  for (let i = 0; i < 2000; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') break;
    if (!(await typeOne())) break;
  }
  await page.waitForSelector('#postgame:not([hidden])', { timeout: 5000 }).catch(() => {});

  /*
   * 這一條是被測試逼出來的：結算是整片 fixed inset:0，原本把工具列整條蓋住。
   * 工具列上有「剛剛怪怪的」——他覺得哪裡不對時按的錄影下載鍵。
   * 打完一場正是最想按那一顆的時刻，卻剛好是它被蓋住的時刻。
   */
  const blocked = await page.evaluate(() => {
    const out = {};
    for (const id of ['btn-replay-file', 'btn-restart', 'btn-mute']) {
      const el = document.getElementById(id);
      if (!el) { out[id] = 'missing'; continue; }
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out[id] = el.contains(top) ? 'ok' : (top?.id || top?.tagName || '?');
    }
    return out;
  });
  check('「剛剛怪怪的」沒有被結算蓋住', blocked['btn-replay-file'] === 'ok', JSON.stringify(blocked));
  check('靜音鈕沒有被結算蓋住', blocked['btn-mute'] === 'ok', JSON.stringify(blocked));

  // 結算自己的按鈕也不可以被工具列壓住——那兩顆是出口
  const exits = await page.evaluate(() =>
    [...document.querySelectorAll('#postgame-actions .btn-postgame')].map((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el.contains(top) || el === top ? 'ok' : (top?.id || top?.tagName || '?');
    })
  );
  check('結算的兩顆出口都按得到', exits.every((e) => e === 'ok'), JSON.stringify(exits));

  await page.click('#btn-restart');
  await page.waitForTimeout(300);
  const hidden = await page.evaluate(() => document.getElementById('postgame').hidden);
  check('從工具列重開，結算不會蓋在新的一場上面', hidden === true);
  const z = await page.evaluate(() => document.getElementById('game-chrome').style.zIndex);
  check('結算收掉後，工具列的 z-index 也還原', z === '', `z-index="${z}"`);
}

check('沒有 JS 例外', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
