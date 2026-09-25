/**
 * 兩個孩子、一台電腦：用 Allen 的帳號把每一頁都走一遍。
 *
 * ── 為什麼要有這支 ─────────────────────────────────────────
 * 這幾天孩子踩到的 bug 幾乎都是同一種：
 *
 *   - 戰役第 1 關打不開（part=all 安靜地回 0 筆）
 *   - 建帳號時「用哪一本單字庫」底下一片空白
 *   - Allen 選了自己的課本，進去看到的是 Pierce 的單字
 *   - Allen 沿用 Pierce 的難度，連手速校準都跳過
 *
 * 每一次，**旁邊的都有測、而且都是綠的**——壞掉的是孩子真正點到的那一支。
 * 原因也每次都一樣：測試把「需要登入的 API」用假的回應頂掉，而假的比真的
 * 少一個欄位、或根本沒碰到頁面真正呼叫的那一支。
 *
 * 所以這一支**不假造任何 API**：
 *   - 起的是真的 server/index.js（同一套路由、同一份靜態檔），只有資料庫
 *     換成記憶體版
 *   - 帳號是在畫面上點「新增帳號」建的，登入 cookie 是真的
 *   - 兩個孩子用**同一個瀏覽器**（同一份 localStorage）——bug 就住在那裡
 *
 * ── 走的順序 ───────────────────────────────────────────────
 *   1. Pierce 先用：量手速選「挑戰」、在練習頁選一組、看單字庫、打戰役
 *      （把他會留下的東西都留下來）
 *   2. 同一台電腦換 Allen 建帳號
 *   3. Allen 走每一頁：畫面上不可以出現任何一個只屬於 Pierce 的字、
 *      不可以沿用 Pierce 的任何設定
 *   4. 最後檢查 localStorage：共用區只能有「這台電腦」的東西
 *
 * 用法：node scripts/two-kids-test.mjs（自己起伺服器，不需要 3100 那台）
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 起真的伺服器，只換掉資料庫 ─────────────────────────── */
const store = {};
installFakeDb(createFakeDb(store, {
  uniqueIndexes: {
    attempts: ['userId', 'opId'],
    groupCompletions: ['userId', 'opId'],
    gameResults: ['userId', 'opId'],
    campaignProgress: ['userId']
  }
}));
const PORT = 3000 + Math.floor(Math.random() * 1000) + 3000;
process.env.PORT = String(PORT);
// 伺服器啟動時會印好幾行（連線成功、session 退回記憶體……），這裡不需要
const realLog = console.log;
const realErr = console.error;
console.log = () => {};
console.error = () => {};
require('../server/index.js');
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i += 1) {
  const ok = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 100));
}
console.log = realLog;
console.error = realErr;
/*
 * server/index.js 為了不讓網站整個掛掉，會把未捕捉的例外吞掉繼續跑。
 * 這對網站是對的，對測試是錯的：測試自己的逾時也會被吞掉，
 * 結果就是整支卡住、永遠不結束（第一次跑就是這樣）。
 * 所以在這裡把它們接過來：記一條失敗、印出來、直接結束。
 */
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
const bail = (err) => {
  console.log(`  [FAIL] 測試中途出錯 — ${err && err.message ? err.message.split('\n')[0] : err}`);
  console.log('\n測試中途出錯');
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const wordBank = require('../server/data/word-bank.js');
const allenWords = new Set(wordBank.getBank('allen').words.map((w) => w.english.toLowerCase()));
/*
 * 「只屬於 Pierce 的字」：在 Allen 那一本裡**任何地方**都沒出現過的字，
 * 而且夠長（六個字母以上），不會跟介面文字撞到。
 *
 * 「任何地方」包含例句。第一版只排除 Allen 的單字本身，結果把 kitten、
 * street、bridge 報成外洩——那是 Allen 自己 mischief、procession、
 * engineer 的例句裡的字。偵測器誤報的話，這支測試會叫人去修沒壞的東西。
 */
const allenText = new Set(
  wordBank.getBank('allen').words
    .flatMap((w) => `${w.english} ${w.exampleSentence || ''}`.toLowerCase().match(/[a-z]+/g) || [])
);
const pierceOnly = wordBank.getBank('g3a').words
  .map((w) => w.english.toLowerCase())
  .filter((w) => w.length >= 6 && /^[a-z]+$/.test(w) && !allenText.has(w));

function pierceWordsIn(text) {
  const words = new Set(text.toLowerCase().match(/[a-z]{6,}/g) || []);
  return pierceOnly.filter((w) => words.has(w));
}

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url().replace(BASE, '')}: ${e.message}`));

async function createAccount(name, bankOwner) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.new-profile', { timeout: 10000 });
  await page.click('.new-profile');
  await page.fill('#new-nickname', name);
  await page.click(`.bank-option:has(.bank-name:text-is("${bankOwner}"))`);
  await page.click('#new-profile-create');
  await page.waitForURL('**/practice.html', { timeout: 10000 });
  return page.evaluate(() => JSON.parse(localStorage.getItem('sb:v2:shared:currentUser')));
}

async function textOf(path, readySelector) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  if (readySelector) await page.waitForSelector(readySelector, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page.evaluate(() => document.body.innerText);
}

/** 量手速：照畫面上的字打，打完選一個難度。 */
async function calibrate(choice) {
  await page.waitForSelector('#calibrate:not([hidden])', { timeout: 15000 });
  for (let i = 0; i < 3; i += 1) {
    const word = (await page.textContent('#calibrate-word')).trim().toLowerCase();
    await page.keyboard.type(word, { delay: 120 });
    await page.waitForTimeout(200);
  }
  await page.waitForSelector('#calibrate-choice:not([hidden])', { timeout: 5000 });
  await page.click(`#calibrate-choice [data-difficulty="${choice}"]`);
}

/* ── 1. Pierce 先用 ─────────────────────────────────────── */
console.log('1) Pierce 先用這台電腦（留下他會留下的東西）');
const pierce = await createAccount('Pierce', 'Pierce');
check('Pierce 的帳號是 Grade 3A', pierce?.wordBankId === 'g3a', String(pierce?.wordBankId));

await textOf('/practice.html', '#part-picker .part-btn');
await page.click('#part-picker .part-btn:has(.part-title:text-is("Week 1"))');
await textOf('/wordbank.html', '.word-row, .wb-row, li');

await page.goto(`${BASE}/game?level=1`, { waitUntil: 'domcontentloaded' });
await calibrate('hard');
await page.waitForSelector('#pregame:not([hidden])', { timeout: 10000 }).catch(() => {});
const pierceDifficulty = await page.evaluate((id) =>
  JSON.parse(localStorage.getItem(`sb:v2:u:${id}:gameDifficulty`)), pierce._id);
check('Pierce 量完手速，難度記在他名下', pierceDifficulty === 'hard', String(pierceDifficulty));

/* ── 2. 同一台電腦換 Allen ─────────────────────────────── */
console.log('\n2) 同一台電腦，換 Allen 建帳號');
const allen = await createAccount('Allen', 'Allen');
check('Allen 的帳號是 Grade 4D', allen?.wordBankId === 'allen', String(allen?.wordBankId));
check('登入的真的換成 Allen 了', allen?._id && allen._id !== pierce._id);

/* ── 3. Allen 走每一頁 ─────────────────────────────────── */
console.log('\n3) Allen 走每一頁：看不到 Pierce 的字、拿不到 Pierce 的設定');

const practiceText = await textOf('/practice.html', '#part-picker .part-btn');
const titles = await page.$$eval('#part-picker .part-title', (els) => els.map((e) => e.textContent.trim()));
check('練習頁：組別是 Allen 的 4 個 Part', titles.length === 4 && titles.every((t) => t.startsWith('Part')),
  titles.join('、'));
check('練習頁：沒有 Pierce 的 Week', !/Week \d/.test(practiceText));
const preselected = await page.$$eval('#part-picker .part-btn.selected .part-title',
  (els) => els.map((e) => e.textContent.trim()));
check('練習頁：沒有預選 Pierce 上次選的組', preselected.length === 0, preselected.join('、') || '（沒有預選）');

// 真的開一場練習，看伺服器發下來的字
const sessionResp = page.waitForResponse((r) => r.url().includes('/api/practice/session'), { timeout: 10000 })
  .catch(() => null);
await page.click('#part-picker .part-btn:has(.part-title:text-is("Part 1"))');
await page.click('#start-practice-btn').catch(() => {});
const sess = await sessionResp;
const sessWords = sess ? (await sess.json()).words || [] : [];
check('練習 Part 1：發下來的全是 Allen 的字',
  sessWords.length > 0 && sessWords.every((w) => allenWords.has(w.english.toLowerCase())),
  sessWords.length ? `${sessWords.length} 字，第一個 ${sessWords[0].english}` : '（沒有開成一場）');

const wbText = await textOf('/wordbank.html', 'body');
const wbLeak = pierceWordsIn(wbText);
check('單字庫頁：一個 Pierce 的字都沒有', wbLeak.length === 0, wbLeak.slice(0, 5).join(', '));
check('單字庫頁：看得到 Allen 自己的字', wbText.toLowerCase().includes('acquaint'));

const campText = await textOf('/campaign.html', 'body');
check('戰役頁：沒有 Pierce 的關卡', !/Week \d/.test(campText));
check('戰役頁：講清楚為什麼還打不了', campText.includes('每週單字'));

const profText = await textOf('/profile.html', 'body');
const profLeak = pierceWordsIn(profText);
check('檔案頁：沒有 Pierce 的字', profLeak.length === 0, profLeak.slice(0, 5).join(', '));

await textOf('/shop.html', 'body');

/*
 * ⭐ 最關鍵的一條：Allen 打遊戲要先量**他自己的**手速。
 * 共用的時候他會直接拿到 Pierce 的「挑戰」，而且因為「已經有難度了」，
 * 校準畫面根本不會出現。
 */
await page.goto(`${BASE}/game?part=1`, { waitUntil: 'domcontentloaded' });
const allenCalibrates = await page.waitForSelector('#calibrate:not([hidden])', { timeout: 15000 })
  .then(() => true).catch(() => false);
check('⭐ 遊戲頁：Allen 要先量自己的手速（不沿用 Pierce 的「挑戰」）', allenCalibrates);
if (allenCalibrates) {
  await calibrate('easy');
  await page.waitForTimeout(300);
}
const after = await page.evaluate(([p, a]) => ({
  pierce: JSON.parse(localStorage.getItem(`sb:v2:u:${p}:gameDifficulty`)),
  allen: JSON.parse(localStorage.getItem(`sb:v2:u:${a}:gameDifficulty`))
}), [pierce._id, allen._id]);
check('Allen 選的難度記在他名下', after.allen === 'easy', String(after.allen));
check('Pierce 的難度沒有被蓋掉', after.pierce === 'hard', String(after.pierce));

/* ── 4. localStorage 的共用區 ──────────────────────────── */
/*
 * 這一條是防以後改壞的。
 *
 * 任何新的「這個孩子的設定」只要不小心又存進 shared，這裡就會紅——
 * 不必等孩子踩到。允許的只有真的屬於「這台電腦」的東西。
 */
console.log('\n4) 共用區只能有「這台電腦」的東西');
const DEVICE_KEYS = new Set([
  'currentUser', // 現在是誰登入（本來就是這台電腦的狀態）
  'navHtml4', // 導覽列樣板
  'shopItems', // 商店目錄，每個人都一樣
  'preferredVoiceURI' // 語音引擎選哪個聲音：裝置的事，不是孩子的事
]);
const sharedKeys = await page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith('sb:v2:shared:')).map((k) => k.slice('sb:v2:shared:'.length)));
const stray = sharedKeys.filter((k) => !DEVICE_KEYS.has(k) && !k.startsWith('navHtml'));
check('共用區沒有任何「孩子的設定」', stray.length === 0,
  stray.length ? `多出來的：${stray.join(', ')}` : sharedKeys.join(', '));

check('\n整趟沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
