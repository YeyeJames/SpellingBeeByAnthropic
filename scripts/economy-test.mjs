/**
 * 金幣經濟：賺得到、花得完、但花不完一次。
 *
 * ── 這支測試是從他自己講的一句話來的 ──────────────────────
 * 「商店東西可以調高單價，賺錢太快了。」
 *
 * 他說得對，但原因不是單價。`stats.currentStreak` 是跨場次累積的
 * （只有答錯才歸零，練習結束不會重置），而連勝加成原本沒有上限，
 * 所以金幣是指數成長的：
 *
 *   第 1 輪 30 字全對 →   705　第 4 輪 → 3,405　第 8 輪 → 7,005
 *
 * 而整間店當時 660 塊。只調單價的話，過幾輪又會被追上，然後再調一次——
 * 那是修不完的。所以這裡釘的是**形狀**（會不會停下來），不只是數字。
 *
 * ── 另外兩件也一起釘 ──────────────────────────────────────
 * 他同一輪測試講的另外兩句：
 *   「接金幣小遊戲大受歡迎」→ 小遊戲不可以變成印鈔機（它不給真金幣）
 *   「怎麼沒看到等級？」    → 等級要在遊戲外面看得到
 *
 * 用法：node scripts/economy-test.mjs
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { calcCoinsForCorrectAnswer, MAX_STREAK_BONUS, BASE_COINS } = require('../server/utils/coins.js');
const { SHOP_ITEMS } = require('../server/data/shop-items.js');

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 一輪練習賺多少：從 startStreak 開始連對 n 題。 */
function round(startStreak, n) {
  let s = startStreak;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    s += 1;
    total += calcCoinsForCorrectAnswer(s);
  }
  return { total, endStreak: s };
}

/* ── 1. 加成會停下來 ────────────────────────────────────── */
console.log('1) 連勝加成有天花板（原本沒有，這是「賺錢太快」的真正原因）');
{
  const perWord = [1, 20, 50, 200, 1000, 100000].map((s) => calcCoinsForCorrectAnswer(s));
  check('連勝再高，每題也不會超過上限',
    perWord.every((c) => c <= BASE_COINS + MAX_STREAK_BONUS),
    `連勝 1/20/50/200/1000/100000 → ${perWord.join(', ')}`);
  check('最高就是基礎 + 上限', perWord[perWord.length - 1] === BASE_COINS + MAX_STREAK_BONUS,
    `${perWord[perWord.length - 1]} = ${BASE_COINS} + ${MAX_STREAK_BONUS}`);
  check('連勝越多還是越賺（加成沒有被砍掉，只是會停）',
    calcCoinsForCorrectAnswer(1) < calcCoinsForCorrectAnswer(20),
    `${calcCoinsForCorrectAnswer(1)} → ${calcCoinsForCorrectAnswer(20)}`);
}

/* ── 1.5 練習頁的公式要跟伺服器一模一樣 ─────────────────────
 * 練習頁會先照公式把金幣加上去，伺服器回來再校正。兩邊差一點，
 * 校正時金幣就倒退——伺服器加了上限、練習頁那份沒跟著改時就是這樣。
 */
console.log('1.5) 練習頁與伺服器的公式逐題一致');
{
  const { coinsForCorrectAnswer: client } = await import('../public/js/shared/coins.js');
  const diff = [];
  for (let s = 0; s <= 200; s += 1) if (client(s) !== calcCoinsForCorrectAnswer(s)) diff.push(s);
  check('連勝 0～200 每一題都一樣', diff.length === 0, diff.length ? `連勝 ${diff.slice(0, 5).join(',')} 不一樣` : '');
  const { readFileSync } = await import('node:fs');
  const practiceJs = readFileSync(new URL('../public/js/practice.js', import.meta.url), 'utf8');
  check('練習頁沒有自己再寫一份公式', !/10 \+ Math\.floor\(session\.streak/.test(practiceJs));
}

/* ── 2. 一輪一輪練下去，收入要持平，不是一路翻倍 ──────────── */
console.log('2) 練越多輪，一輪的收入要持平');
{
  let s = 0;
  const rounds = [];
  for (let r = 0; r < 8; r += 1) {
    const x = round(s, 30);
    rounds.push(x.total);
    s = x.endStreak;
  }
  const last4 = rounds.slice(4);
  check('第 5～8 輪收入完全一樣（已經到天花板）',
    new Set(last4).size === 1, rounds.join(' → '));
  /*
   * 這一條是這支測試存在的理由。舊的公式在這裡會是 9.9 倍。
   */
  check('第 8 輪不會比第 1 輪多出一倍以上',
    rounds[7] / rounds[0] < 2, `${rounds[0]} → ${rounds[7]}（${(rounds[7] / rounds[0]).toFixed(1)} 倍）`);
}

/* ── 3. 商店要花得完，但花不完一次 ──────────────────────── */
console.log('3) 商店的價格跟收入對得上');
{
  const oneRound = round(999, 30).total; // 天花板之後的一輪
  const total = SHOP_ITEMS.reduce((a, i) => a + i.cost, 0);
  const cheapest = Math.min(...SHOP_ITEMS.map((i) => i.cost));

  /*
   * 最便宜的要在一輪之內買得到。
   * 全部都買不起的話，就是他在裝備區遇到的那個問題再來一次——
   * 錢賺得到卻花不掉（§9.5）。
   */
  check('最便宜的一輪練習就買得到', cheapest <= oneRound, `${cheapest} vs 一輪 ${oneRound}`);
  /*
   * 但整間店不可以一輪就掃光。買東西要有取捨，才會有期待。
   */
  check('整間店買不完（要存好幾輪）', total > oneRound * 3,
    `整間店 ${total}，一輪 ${oneRound}（約 ${(total / oneRound).toFixed(1)} 輪）`);
  check('價格有高有低（有便宜的可以馬上拿，也有要存的）',
    Math.max(...SHOP_ITEMS.map((i) => i.cost)) >= cheapest * 3,
    SHOP_ITEMS.map((i) => i.cost).sort((a, b) => a - b).join(' / '));
}

/* ── 4. 小遊戲不可以是印鈔機 ─────────────────────────────── */
console.log('4) 接金幣小遊戲（他最愛的那個）不會給真金幣');
{
  /*
   * 這個很重要：他最常玩的東西如果會產出金幣，那整個經濟就跟拼字脫鉤了——
   * 練拼字變成賺錢最慢的方法。目前是對的，這一條是防止以後改壞。
   */
  const { readFileSync } = await import('node:fs');
  const shopJs = readFileSync(new URL('../public/js/shop.js', import.meta.url), 'utf8');
  check('結算有明講「不會加到真正的金幣」', shopJs.includes('不會加到真正的金幣'));

  /*
   * 只看結束處理函式**自己的**函式體。
   *
   * 第一版是從 'coincatch-ended' 往後抓幾百個字元再比對，結果抓到了下面
   * 完全無關的購買失敗處理（那裡本來就該呼叫 setNavCoins）——測試紅了，
   * 但程式是對的。範圍抓錯的測試比沒有測試更糟，它會叫人去改沒壞的東西。
   */
  const body = /function onMinigameEnded\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(shopJs);
  check('找得到小遊戲的結束處理', !!body);
  check('它只寫字，不碰金幣',
    !!body && !/(setNavCoins|currentUser\.coins|enqueue|api\.)/.test(body[1]),
    body ? body[1].trim().slice(0, 80) : '');

  /*
   * 小遊戲本身也不可以碰錢。
   *
   * 商店的小遊戲會一直加（家長希望商店「非常豐富」），每一個新遊戲都是
   * 一次「不小心讓分數變成錢」的機會。這裡掃全部的遊戲模組：
   * 不可以呼叫任何 API、不可以碰金幣——它們只回報分數給商店。
   */
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../public/js/game/minigames/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'registry.js');
  const touching = files.filter((f) => {
    const src = readFileSync(new URL(f, dir), 'utf8');
    // 不直接比對 coins 這個字：接金幣畫面上掉下來的金幣就叫 this.coins，那不是錢
    return /(fetch\(|\bapi\.|\/api\/|currentUser|setNavCoins|enqueue|localStorage)/.test(src);
  });
  check(`全部 ${files.length} 個小遊戲都不碰錢、不打 API`, files.length >= 3 && touching.length === 0,
    touching.length ? `有問題的：${touching.join(', ')}` : files.join(', '));
}

/* ── 5. 等級在遊戲外面看得到 ─────────────────────────────── */
console.log('5) 「怎麼沒看到等級？」——導覽列要寫出來');
{
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  const USER = {
    _id: 'u-econ', nickname: '測試', coins: 720, xp: 900,
    activeTheme: 'sports', ownedItemKeys: [],
    avatar: { baseCharacter: 'rookie', accessories: [] }
  };
  await ctx.route('**/api/auth/me*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: USER }) }));
  await ctx.route('**/api/shop/items*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
  await ctx.addInitScript((u) => {
    try {
      localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u));
    } catch (e) { /* 無痕模式 */ }
  }, USER);

  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-nav-level]', { timeout: 8000 }).catch(() => {});

  const nav = await page.evaluate(() => {
    const el = document.querySelector('[data-nav-level]');
    return { exists: !!el, hidden: el ? el.hidden : null, text: el ? el.textContent : '' };
  });
  const { levelFromXp } = await import('../public/js/shared/levels.js');
  const expected = levelFromXp(USER.xp).level;

  check('導覽列有等級章', nav.exists);
  check('打過遊戲的人看得到', nav.hidden === false, `hidden=${nav.hidden}`);
  check('等級跟 shared/levels.js 算的一樣',
    nav.text.includes(String(expected)), `${nav.text}（應該是 Lv ${expected}）`);

  /*
   * 還沒打過遊戲的人不要看到一個永遠不動的 Lv 1——那只是多一個
   * 看不懂的東西。等他第一次打完遊戲，這個章才出現。
   */
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const NEWBIE = { ...USER, _id: 'u-newbie', xp: 0 };
  await ctx2.route('**/api/auth/me*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: NEWBIE }) }));
  await ctx2.route('**/api/shop/items*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
  await ctx2.addInitScript((u) => {
    try {
      localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u));
    } catch (e) { /* 無痕模式 */ }
  }, NEWBIE);
  await page2.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('[data-nav-coins]', { timeout: 8000 }).catch(() => {});
  const newbie = await page2.evaluate(() => {
    const el = document.querySelector('[data-nav-level]');
    return el ? el.hidden : null;
  });
  check('還沒打過遊戲的人不顯示', newbie === true, `hidden=${newbie}`);

  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await browser.close();
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
