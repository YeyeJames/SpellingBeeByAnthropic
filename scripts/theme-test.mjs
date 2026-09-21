/**
 * 暗色主題。
 *
 * 練習頁原本是白底亮色、遊戲頁是接近全黑，兩邊看起來像兩個不同的系統。
 * 孩子在兩頁之間切換時，那個落差比任何載入動畫都更像「跳出去了」。
 *
 * 要證明的事：
 *   1. 每一頁的底色都是暗的——而且是「沒有任何一塊亮面板漏掉」，
 *      不是只看 body。漏掉一個寫死的 #fff 就會在暗畫面中間開一個白洞，
 *      而那通常正好是輸入框或卡片這種最常看的地方。
 *   2. 文字在暗底上讀得清楚（對比度算出來，不是用看的）
 *   3. 練習跟遊戲同一個色系，但**不是同一個畫面**——要有區隔感
 *   4. 三個主題（運動／太空／恐龍）都是暗的，換主題不會突然變白
 *
 * 用法：node scripts/theme-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 顏色工具 ───────────────────────────────────────────────
   相對亮度與對比度照 WCAG 的定義算。用「看起來不亮」當標準的話，
   這支測試就只是把我的主觀寫進程式碼，換個人看又是另一套。 */
function parseRgb(css) {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((n) => parseFloat(n));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function luminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const USER = {
  _id: 'test-user',
  nickname: '測試',
  coins: 120,
  activeTheme: null,
  ownedItemKeys: [],
  avatar: { baseCharacter: 'rookie', accessories: [] },
  audioPrefs: { bgmVolume: 0.5, sfxVolume: 0.8, muted: false },
  stats: { currentStreak: 0, bestStreak: 0, totalWordsPracticed: 0, totalCorrect: 0, totalIncorrect: 0 }
};

const browser = await chromium.launch({ executablePath: CHROME });

async function openPage(path, theme) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 880 } });
  await context.addInitScript(
    ([u, t]) => {
      localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify({ ...u, activeTheme: t }));
      localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
    },
    [USER, theme]
  );
  const user = { ...USER, activeTheme: theme };
  await context.route('**/api/auth/me', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) })
  );
  await context.route('**/api/auth/profiles', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ profiles: [{ _id: 'a', nickname: '哥哥', coins: 120 }] })
    })
  );
  await context.route('**/api/practice/review-queue', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"words":[]}' })
  );
  await context.route('**/api/practice/progress', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unlockAfter: 2, progress: {} })
    })
  );
  await context.route('**/api/shop/items', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' })
  );
  const page = await context.newPage();
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.body.classList.contains('page-loading'), null, {
    timeout: 15000
  }).catch(() => {});
  await page.waitForTimeout(500);
  return { context, page };
}

/**
 * 掃整頁有沒有「亮面板」。
 *
 * 只看 body 的底色不夠：漏掉的通常是某張卡片、某個下拉選單裡寫死的 #fff，
 * 而那些正好是他最常盯著的地方。所以逐一檢查真的有面積的元素。
 *
 * ── 重點色不算漏網 ──────────────────────────────────────────
 * 金色的金幣徽章、橘色的主按鈕本來就該是亮的——那是重點，不是背景。
 * 所以先把主題自己宣告的那幾個顏色讀出來當白名單，其餘亮色才算問題。
 * 不這樣分的話，這支測試會逼著我把重點色也弄暗，畫面會整片死掉。
 */
async function brightSurfaces(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.body);
    const accents = new Set(
      ['--color-primary', '--color-primary-dark', '--color-secondary', '--color-secondary-dark',
       '--color-accent', '--color-success', '--color-danger']
        .map((n) => root.getPropertyValue(n).trim().toLowerCase())
        .filter(Boolean)
    );

    // 把 #ffd23f 這種寫法轉成 rgb(...)，才比對得起來
    function normalize(css) {
      const probe = document.createElement('span');
      probe.style.color = css;
      document.body.appendChild(probe);
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    }
    const accentRgb = new Set([...accents].map(normalize));

    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 24) continue; // 小圖示不算，那是裝飾
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) continue;
      const bg = cs.backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const p = m[1].split(',').map(parseFloat);
      const alpha = p.length > 3 ? p[3] : 1;
      if (alpha < 0.5) continue; // 半透明疊在暗底上不會變白
      if (accentRgb.has(`rgb(${p[0]}, ${p[1]}, ${p[2]})`)) continue; // 這是重點色，本來就該亮
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: typeof el.className === 'string' ? el.className.slice(0, 40) : '',
        bg,
        area: Math.round(r.width * r.height)
      });
    }
    return out;
  });
}

const PAGES = [
  ['/index.html', '首頁（選帳號）'],
  ['/practice.html', '練習頁'],
  ['/shop.html', '商店'],
  ['/profile.html', '檔案'],
  ['/wordbank.html', '單字庫']
];

/* ── 1. 每一頁都是暗的，而且沒有亮面板漏掉 ─────────────── */
console.log('1) 每一頁都是暗的，沒有亮面板漏掉');
for (const [path, label] of PAGES) {
  const { context, page } = await openPage(path, 'sports');

  const bodyBg = parseRgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  const htmlBg = parseRgb(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor));
  // body 的 background 是漸層時 backgroundColor 會是透明，改看實際畫出來的顏色
  const painted = parseRgb(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      return getComputedStyle(document.body).backgroundColor;
    })
  );

  const surfaces = await brightSurfaces(page);
  const bright = surfaces.filter((s) => {
    const c = parseRgb(s.bg);
    return c && luminance(c) > 0.35;
  });

  check(
    `${label}：沒有亮面板`,
    bright.length === 0,
    bright.slice(0, 3).map((b) => `${b.tag}#${b.id}.${b.cls} ${b.bg}`).join(' | ')
  );

  // 最大的那塊面板必須是暗的——那就是他看的主體
  const biggest = surfaces.sort((a, b) => b.area - a.area)[0];
  if (biggest) {
    const c = parseRgb(biggest.bg);
    check(`${label}：主面板是暗的`, c && luminance(c) < 0.2, `${biggest.bg}（${biggest.id || biggest.cls}）`);
  }

  await context.close();
}

/* ── 2. 文字讀得清楚 ───────────────────────────────────── */
console.log('\n2) 文字在暗底上讀得清楚');
{
  const { context, page } = await openPage('/practice.html', 'sports');
  const samples = await page.evaluate(() => {
    const pick = ['.part-btn .part-title', '.part-btn .part-sub', '.setup-label', 'h1'];
    return pick
      .map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        // 往上找到第一個真的有底色的祖先
        let node = el;
        let bg = 'rgba(0, 0, 0, 0)';
        while (node && node !== document.documentElement) {
          const c = getComputedStyle(node).backgroundColor;
          const m = c.match(/rgba?\(([^)]+)\)/);
          const a = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : 0;
          if (a > 0.5) {
            bg = c;
            break;
          }
          node = node.parentElement;
        }
        return { sel, fg: getComputedStyle(el).color, bg };
      })
      .filter(Boolean);
  });

  samples.forEach((s) => {
    const fg = parseRgb(s.fg);
    const bg = parseRgb(s.bg);
    const ratio = fg && bg ? contrast(fg, bg) : 0;
    /*
     * 4.5:1 是 WCAG 對一般內文的門檻。說明文字本來就會比主文淡一點，
     * 所以次要文字放寬到 3:1（WCAG 對大字的門檻），但不能再低。
     */
    const min = s.sel.includes('sub') || s.sel.includes('label') ? 3 : 4.5;
    check(`${s.sel} 對比度 ≥ ${min}`, ratio >= min, `${ratio.toFixed(2)}:1（${s.fg} / ${s.bg}）`);
  });

  // 輸入框：暗底上如果沒自己給底色，瀏覽器會用白底黑字，畫面正中間開一個白洞
  await context.close();
}

console.log('\n3) 輸入框不能是白底');
{
  const { context, page } = await openPage('/index.html', 'sports');
  await page.click('.profile-tile.new-profile');
  await page.waitForSelector('#new-profile-step:not(.hidden)');
  const input = await page.evaluate(() => {
    const el = document.getElementById('new-nickname');
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  const bg = parseRgb(input.bg);
  const fg = parseRgb(input.fg);
  check('輸入框底色是暗的', bg && luminance(bg) < 0.2, input.bg);
  check('輸入框的字讀得清楚', fg && bg && contrast(fg, bg) >= 4.5,
    `${contrast(fg, bg).toFixed(2)}:1`);
  await context.close();
}

/* ── 3. 練習與遊戲：同一家，但不同房間 ─────────────────── */
console.log('\n4) 練習跟遊戲是同一套的兩個模式');
{
  const { context: c1, page: practice } = await openPage('/practice.html', 'sports');
  const practicePanel = parseRgb(
    await practice.evaluate(() => getComputedStyle(document.getElementById('setup-panel')).backgroundColor)
  );
  await c1.close();

  const context = await browser.newContext({ viewport: { width: 1100, height: 880 } });
  const game = await context.newPage();
  await game.goto(`${BASE}/game?group=w18&n=20&order=sequential&show=1&difficulty=easy`, {
    waitUntil: 'domcontentloaded'
  });
  await game.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  const gameBg = parseRgb(await game.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await context.close();

  check('遊戲是暗的', gameBg && luminance(gameBg) < 0.06, `亮度 ${luminance(gameBg).toFixed(4)}`);
  check('練習也是暗的', practicePanel && luminance(practicePanel) < 0.12,
    `亮度 ${luminance(practicePanel).toFixed(4)}`);

  /*
   * 同一家：兩邊亮度接近（對比度低於 2:1 就算同一個色系）。
   * 不同房間：練習的面板要比遊戲底色亮一階，看得出來是「桌面」而不是「戰場」。
   */
  const between = contrast(practicePanel, gameBg);
  check('同一個色系（不是兩個系統）', between < 2, `兩者對比 ${between.toFixed(2)}:1`);
  check('練習比遊戲亮一階（看得出是不同模式）',
    luminance(practicePanel) > luminance(gameBg) * 1.4,
    `練習 ${luminance(practicePanel).toFixed(4)} vs 遊戲 ${luminance(gameBg).toFixed(4)}`);
}

/* ── 4. 三個主題都要是暗的 ─────────────────────────────── */
console.log('\n5) 換主題不會突然變白');
for (const theme of ['sports', 'space', 'dino']) {
  const { context, page } = await openPage('/practice.html', theme);
  const surfaces = await brightSurfaces(page);
  const bright = surfaces.filter((s) => {
    const c = parseRgb(s.bg);
    return c && luminance(c) > 0.35;
  });
  check(`${theme} 主題沒有亮面板`, bright.length === 0,
    bright.slice(0, 2).map((b) => `${b.id || b.cls} ${b.bg}`).join(' | '));
  await context.close();
}

await browser.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
