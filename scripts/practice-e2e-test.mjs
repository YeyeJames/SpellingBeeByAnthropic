/**
 * 練習從頭到尾（docs/audit 步驟四，Q11）。
 *
 * 其他練習測試不是只測伺服器，就是只測畫面（伺服器回應是假造的）。
 * 這一支用真的伺服器＋真的瀏覽器，照孩子的操作把一整組做完，每一步都對伺服器的帳：
 *   1. 選人 → 選組 → 開始：畫面的「🔒 再練完 1 次」跟伺服器一致
 *   2. 一題一題打：有對有錯（含片語、打大寫、多打空白）
 *   3. 每一題都記進伺服器，對錯判得跟畫面一樣，一題都不多不少
 *   4. 金幣：畫面、伺服器、公式三邊一樣
 *   5. 練完一組：畫面立刻解鎖，伺服器也記了一次；按「玩遊戲」真的進得去
 *   6. 答錯的字進了複習；按複習拿到的就是那幾個字
 *   7. 練到一半重新整理：答過的題目有記到，不會重複計分
 *   8. 總結畫面（4-B）：剛解鎖時說「解鎖了」、有「去玩這一組的遊戲」；複習練完則沒有
 *
 * 用法：node scripts/practice-e2e-test.mjs（自己起伺服器）
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
  console.log('\n測試中途出錯');
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const { calcCoinsForCorrectAnswer } = require('../server/utils/coins.js');
const wordBank = require('../server/data/word-bank.js');

await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce', wordBankId: 'g3a' })
});
const me = () => store.users.find((u) => u.nickname === 'Pierce');
const pid = String(me()._id);
const mine = (name) => (store[name] || []).filter((r) => String(r.userId) === pid);

/*
 * 練哪一組：要有片語的那一組，才驗得到「片語照正常方式打」。
 * 從單字庫裡找，不寫死組別 id（課本以後補字時不用改測試）。
 */
const groups = wordBank.listGroups('g3a');
const target = groups.find((g) => wordBank.wordsByGroup(g.id).some((w) => /[ -]/.test(w.english)));
const groupWords = wordBank.wordsByGroup(target.id);
console.log(`練「${target.label}」（${target.id}，${groupWords.length} 字，含片語）\n`);

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

/* ── 1. 進來、選組 ─────────────────────────────────────── */
console.log('1) 選人、選組');
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.profile-tile', { timeout: 10000 });
await page.click('.profile-tile:has-text("Pierce")');
await page.waitForURL(/practice/, { timeout: 10000 });
await page.waitForSelector('#part-picker .part-btn', { timeout: 10000 });
await sleep(400);
await page.click(`#part-picker .part-btn:has(.part-title:text-is("${target.label}"))`);
await sleep(200);
const lockedText = await page.textContent('#go-game-btn');
check('還沒練過：遊戲按鈕鎖著，寫著還差 1 次', /🔒/.test(lockedText) && /1/.test(lockedText), lockedText);
await page.check('input[name="order"][value="sequential"]');

/* ── 2. 一題一題打 ─────────────────────────────────────── */
console.log('\n2) 整組做完（有對有錯）');
const sessionResp = page.waitForResponse((r) => r.url().includes('/api/practice/session') && r.request().method() === 'POST');
await page.click('#start-practice-btn');
const words = (await (await sessionResp).json()).words;
check('（前提）照順序、整組都在', words.length === groupWords.length && words[0]._id === groupWords[0].id, `${words.length} 字`);

/*
 * 怎麼答：每 4 題錯 1 題；片語故意不打空白、有一題打大寫、有一題前後多空白。
 * 這些「怎麼打」都應該算對（判定規則見 shared/answer-match.js）。
 */
const plan = words.map((w, i) => {
  if (i % 4 === 3) return { w, typed: `${w.english}x`, correct: false };
  if (/[ -]/.test(w.english)) return { w, typed: w.english.replace(/[ -]/g, ''), correct: true };
  if (i === 1) return { w, typed: w.english.toUpperCase(), correct: true };
  if (i === 2) return { w, typed: `  ${w.english} `, correct: true };
  return { w, typed: w.english, correct: true };
});
let shownRight = 0;
let revealMismatch = 0;
let coinsExpected = 0;
let streak = me().stats.currentStreak || 0;
for (let i = 0; i < plan.length; i += 1) {
  await page.waitForSelector('#answer-input:not([disabled])', { timeout: 10000 });
  await page.fill('#answer-input', plan[i].typed);
  await page.click('#submit-answer-btn');
  await page.waitForSelector('#reveal-panel:not(.hidden)', { timeout: 5000 });
  const result = await page.textContent('#reveal-result');
  const saidRight = /答對/.test(result);
  if (saidRight) shownRight += 1;
  if (saidRight !== plan[i].correct) revealMismatch += 1;
  streak = plan[i].correct ? streak + 1 : 0;
  if (plan[i].correct) coinsExpected += calcCoinsForCorrectAnswer(streak);
  await page.click('#next-btn');
}
check('畫面上的對錯全部跟預期一樣（含片語不打空白、大寫、多空白）', revealMismatch === 0, `${revealMismatch} 題不一樣`);
await page.waitForSelector('#summary-panel:not(.hidden)', { timeout: 10000 });
const summary = await page.textContent('#summary-text');
check('練完出現總結', new RegExp(`${words.length} 個單字`).test(summary), summary.trim());

/* ── 3. 伺服器的帳 ─────────────────────────────────────── */
console.log('\n3) 伺服器的帳');
for (let i = 0; i < 60 && mine('attempts').length < words.length; i += 1) await sleep(200);
await sleep(600);
const atts = mine('attempts');
check('每一題都記到，不多不少', atts.length === words.length, `${atts.length} / ${words.length}`);
check('沒有重複的作答', new Set(atts.map((a) => a.opId)).size === atts.length);
const serverRight = atts.filter((a) => a.correct).length;
check('伺服器判的對錯跟畫面一樣', serverRight === shownRight, `伺服器 ${serverRight}、畫面 ${shownRight}`);
const byWord = new Map(atts.map((a) => [a.wordId, a.correct]));
check('每一題都記在對的字底下、對錯一致', plan.every((p) => byWord.get(p.w._id) === p.correct));
const u = me();
check('統計：總題數、答對、答錯', u.stats.totalWordsPracticed === words.length && u.stats.totalCorrect === serverRight
  && u.stats.totalIncorrect === words.length - serverRight, JSON.stringify(u.stats));
const wp = mine('wordProgress');
check('每個字都有精熟度紀錄', wp.length === words.length, `${wp.length}`);
check('答錯的字留在第 0 格、答對的往上一格', plan.every((p) => {
  const row = wp.find((r) => r.wordId === p.w._id);
  return row && (p.correct ? row.boxLevel >= 1 : row.boxLevel === 0);
}));

/* ── 4. 金幣 ──────────────────────────────────────────── */
console.log('\n4) 金幣：畫面、伺服器、公式');
check('伺服器的金幣＝照公式算', u.coins === coinsExpected, `伺服器 ${u.coins}、公式 ${coinsExpected}`);
const navCoins = Number(((await page.textContent('[data-nav-coins]')) || '').replace(/[^\d]/g, ''));
check('導覽列的金幣＝伺服器', navCoins === u.coins, `畫面 ${navCoins}`);
const m = /賺到 (\d+) 枚/.exec(summary);
check('總結寫的「這次賺到」＝伺服器', m && Number(m[1]) === u.coins, m && m[1]);

/* ── 5. 解鎖 ──────────────────────────────────────────── */
console.log('\n5) 練完一次就解鎖');
const unlockedText = await page.textContent('#go-game-btn');
check('畫面立刻解鎖', /玩遊戲/.test(unlockedText) && !/🔒/.test(unlockedText), unlockedText);
for (let i = 0; i < 30 && !mine('groupProgress').some((g) => g.groupId === target.id && g.practiceCompletions >= 1); i += 1) await sleep(200);
const gp = mine('groupProgress').find((g) => g.groupId === target.id);
check('伺服器也記了一次', gp?.practiceCompletions === 1, JSON.stringify(gp && { c: gp.practiceCompletions }));
// 「解鎖了沒」不存在資料庫裡，是從次數算出來的：用畫面問的同一支 API 確認
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
const prog = await fetch(`${BASE}/api/practice/progress`, { headers: { cookie } }).then((r) => r.json());
check('伺服器也認為解鎖了', prog.progress?.[target.id]?.unlocked === true, JSON.stringify(prog.progress?.[target.id]));
check('「練完一組」只記一次', mine('groupCompletions').length === 1);
// 總結畫面（4-B）：剛解鎖要說出來，而且可以直接去玩；原本的「再玩一次」還在
check('總結畫面寫「這一組的遊戲解鎖了」', await page.isVisible('#summary-unlock'));
check('總結畫面有「去玩這一組的遊戲」', await page.isVisible('#summary-game-btn'));
check('原本的「再玩一次」還在', await page.isVisible('#play-again-btn'));
await page.click('#summary-game-btn');
await page.waitForURL(/\/game/, { timeout: 10000 });
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 }).catch(() => {});
// 新帳號第一次玩會先做手速校準，所以不等「開打」：只看有沒有被鎖住
await sleep(1500);
const gameState = await page.evaluate(() => ({
  url: location.pathname + location.search,
  locked: !!document.getElementById('locked-panel') && !document.getElementById('locked-panel').hidden
}));
check('按下去真的進得了這一組的遊戲（沒有被鎖）', gameState.url.includes(`group=${target.id}`) && !gameState.locked, JSON.stringify(gameState));
const wrongCount = plan.filter((p) => !p.correct).length;

/* ── 6. 複習 ──────────────────────────────────────────── */
console.log('\n6) 答錯的字進了複習');
await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#part-picker .part-btn', { timeout: 10000 });
await sleep(1200);
/*
 * 剛答錯的字在第 0 格，第 0 格的間隔是 10 分鐘（server/utils/spacedRepetition.js）：
 * 練習頁的複習要 10 分鐘後才看得到它們。這裡記下現況（docs/audit/step4 的 P4-2），
 * 再把時間往後撥 10 分鐘，驗複習本身。
 */
check('（現況）剛練完：練習頁的複習按鈕還沒出現', await page.isHidden('#review-practice-btn'));
for (const r of mine('wordProgress')) r.nextReviewAt = new Date(Date.now() - 1000 * (r.boxLevel === 0 ? 1 : -86400));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#part-picker .part-btn', { timeout: 10000 });
await sleep(1200);
const reviewText = await page.textContent('#review-practice-btn');
check('10 分鐘後：複習按鈕的數字＝答錯的題數', await page.isVisible('#review-practice-btn') && reviewText.includes(`(${wrongCount})`),
  `${reviewText.trim()}（答錯 ${wrongCount}）`);
const reviewResp = page.waitForResponse((r) => r.url().includes('/api/practice/session') && r.request().method() === 'POST');
await page.click('#review-practice-btn');
const reviewWords = (await (await reviewResp).json()).words || [];
const wrongIds = new Set(plan.filter((p) => !p.correct).map((p) => p.w._id));
check('按複習拿到的就是答錯的那幾個字', reviewWords.length === wrongCount && reviewWords.every((w) => wrongIds.has(w._id)),
  `${reviewWords.length} 字`);

/* ── 7. 練到一半重新整理 ─────────────────────────────── */
console.log('\n7) 練到一半重新整理');
{
  const before = mine('attempts').length;
  for (let i = 0; i < 2; i += 1) {
    await page.waitForSelector('#answer-input:not([disabled])', { timeout: 10000 });
    await page.fill('#answer-input', reviewWords[i].english);
    await page.click('#submit-answer-btn');
    await page.waitForSelector('#reveal-panel:not(.hidden)', { timeout: 5000 });
    await page.click('#next-btn');
  }
  await sleep(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#part-picker .part-btn', { timeout: 10000 });
  await sleep(1500);
  const after = mine('attempts').length;
  check('重新整理前答的兩題都有記到', after === before + 2, `${after - before} 題`);
  check('沒有重複計分', new Set(mine('attempts').map((a) => a.opId)).size === mine('attempts').length);
  check('練完一組的次數沒有因為半途離開而增加', mine('groupCompletions').length === 1);
}

/* ── 8. 複習練完：總結畫面不該有「去玩遊戲」 ─────────── */
console.log('\n8) 複習練完的總結畫面');
{
  const resp = page.waitForResponse((r) => r.url().includes('/api/practice/session') && r.request().method() === 'POST');
  await page.click('#review-practice-btn');
  const rw = (await (await resp).json()).words || [];
  for (const w of rw) {
    await page.waitForSelector('#answer-input:not([disabled])', { timeout: 10000 });
    await page.fill('#answer-input', w.english);
    await page.click('#submit-answer-btn');
    await page.waitForSelector('#reveal-panel:not(.hidden)', { timeout: 5000 });
    await page.click('#next-btn');
  }
  await page.waitForSelector('#summary-panel:not(.hidden)', { timeout: 10000 });
  check(`（前提）複習 ${rw.length} 個字練完了`, rw.length > 0);
  check('複習的總結沒有「解鎖了」', await page.isHidden('#summary-unlock'));
  check('複習的總結沒有「去玩這一組的遊戲」', await page.isHidden('#summary-game-btn'));
  check('「再玩一次」照樣在', await page.isVisible('#play-again-btn'));
  const box = await page.evaluate(() => {
    const p = document.getElementById('summary-panel').getBoundingClientRect();
    const b = document.getElementById('play-again-btn').getBoundingClientRect();
    return { panelBottom: p.bottom, btnBottom: b.bottom };
  });
  check('按鈕在畫面裡（沒有跑出面板）', box.btnBottom <= box.panelBottom + 1, JSON.stringify(box));
}

check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
