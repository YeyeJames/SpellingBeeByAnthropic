/**
 * 練習模式：看完答案按 Enter 就是「下一題」。
 *
 *   1. 打完按 Enter：送出、出現答案，但**不會**順便跳題
 *   2. 再按一次 Enter：下一題，輸入框可以直接打字
 *   3. 答案剛出來就按（連按兩下）：不跳題
 *   4. 按住 Enter 不放（連發）：不會一路跳題，也不會把空白答案送出去
 *   5. 下一題剛出來就按 Enter：不會把空白答案送出去
 *   6. 用滑鼠按「下一題」照舊
 *   7. 整組都用 Enter 做完：每一題都記到、不多不少
 *
 * 用法：node scripts/practice-enter-test.mjs（自己起伺服器）
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const store = {};
installFakeDb(createFakeDb(store, {
  uniqueIndexes: {
    attempts: ['userId', 'opId'], groupCompletions: ['userId', 'opId'], gameResults: ['userId', 'opId'],
    eventBatches: ['userId', 'opId'], groupProgress: ['userId', 'groupId'], wordProgress: ['userId', 'wordId']
  }
}));
const PORT = 9000 + Math.floor(Math.random() * 900);
process.env.PORT = String(PORT);
const realLog = console.log;
const realErr = console.error;
console.log = () => {};
console.error = () => {};
require('../server/index.js');
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i += 1) {
  if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) break;
  await sleep(100);
}
console.log = realLog;
console.error = realErr;
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
const bail = (err) => {
  console.log(`  [FAIL] 測試中途出錯 — ${err && err.message ? err.message.split('\n')[0] : err}`);
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const wordBank = require('../server/data/word-bank.js');
await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce', wordBankId: 'g3a' })
});
const pid = String(store.users.find((u) => u.nickname === 'Pierce')._id);
const mine = (name) => (store[name] || []).filter((r) => String(r.userId) === pid);
const target = wordBank.listGroups('g3a')[0];

const browser = await chromium.launch({ executablePath: CHROME });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.profile-tile', { timeout: 10000 });
await page.click('.profile-tile:has-text("Pierce")');
await page.waitForURL(/practice/, { timeout: 10000 });
await page.waitForSelector('#part-picker .part-btn', { timeout: 10000 });
await sleep(400);
await page.click(`#part-picker .part-btn:has(.part-title:text-is("${target.label}"))`);
await page.check('input[name="order"][value="sequential"]');
const sessionResp = page.waitForResponse((r) => r.url().includes('/api/practice/session') && r.request().method() === 'POST');
await page.click('#start-practice-btn');
const words = (await (await sessionResp).json()).words;

const state = () => page.evaluate(() => ({
  progress: document.getElementById('progress-label').textContent.trim(),
  revealed: !document.getElementById('reveal-panel').classList.contains('hidden'),
  inputEnabled: !document.getElementById('answer-input').disabled,
  focused: document.activeElement?.id === 'answer-input'
}));
const at = (i) => `${i + 1} / ${words.length}`;

console.log('1) 打完按 Enter：送出，但不跳題');
await page.waitForSelector('#answer-input:not([disabled])');
await sleep(500);
await page.keyboard.type(words[0].english);
await page.keyboard.press('Enter');
await sleep(100);
let s = await state();
check('出現答案', s.revealed);
check('還在第 1 題', s.progress === at(0), s.progress);

console.log('\n3) 答案剛出來就按：不跳題');
await page.keyboard.press('Enter');
await sleep(50);
s = await state();
check('還在第 1 題（連按兩下）', s.progress === at(0) && s.revealed, s.progress);

console.log('\n2) 再按一次 Enter：下一題');
await sleep(500);
await page.keyboard.press('Enter');
await sleep(150);
s = await state();
check('到了第 2 題', s.progress === at(1), s.progress);
check('答案收起來', !s.revealed);
check('輸入框可以直接打字', s.inputEnabled && s.focused);

console.log('\n5) 下一題剛出來就按 Enter：不送出空白答案');
await page.keyboard.press('Enter');
await sleep(100);
s = await state();
check('沒有送出', !s.revealed && s.inputEnabled, JSON.stringify(s));

console.log('\n4) 按住 Enter 不放');
await sleep(500);
await page.keyboard.type(words[1].english);
await page.keyboard.down('Enter'); // 送出
await sleep(500);
await page.keyboard.down('Enter'); // 連發（repeat）
await page.keyboard.down('Enter');
await page.keyboard.up('Enter');
await sleep(150);
s = await state();
check('連發不會跳題', s.progress === at(1) && s.revealed, s.progress);

console.log('\n6) 用滑鼠按「下一題」照舊');
await page.click('#next-btn');
await sleep(150);
s = await state();
check('到了第 3 題', s.progress === at(2), s.progress);

console.log('\n7) 剩下的全部用 Enter 做完');
for (let i = 2; i < words.length; i += 1) {
  await page.waitForSelector('#answer-input:not([disabled])');
  await sleep(450);
  await page.keyboard.type(i % 3 ? words[i].english : 'zz');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#reveal-panel:not(.hidden)', { timeout: 5000 });
  await sleep(450);
  await page.keyboard.press('Enter');
}
await page.waitForSelector('#summary-panel:not(.hidden)', { timeout: 10000 });
check('練完出現總結', true);
for (let i = 0; i < 60 && mine('attempts').length < words.length; i += 1) await sleep(200);
await sleep(600);
const atts = mine('attempts');
check('每一題都記到，不多不少', atts.length === words.length, `${atts.length} / ${words.length}`);
check('沒有送出空白答案', atts.every((a) => a.userAnswer && a.userAnswer.trim()), atts.filter((a) => !a.userAnswer?.trim()).length + ' 筆空白');
check('答錯的只有故意打錯的那幾題', atts.filter((a) => !a.correct).length === words.filter((_, i) => i >= 2 && i % 3 === 0).length);

await browser.close();
check('沒有瀏覽器錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
