/**
 * 家長報告的每一個數字，都跟手算的答案對一遍（docs/audit 步驟七）。
 *
 * 做法：直接放一批「答案已知」的資料進資料庫（每一筆都寫明它該被算進哪一格），
 * 再跟 /api/telemetry/report 的結果、以及報告頁畫出來的文字逐項比對。
 * 另外驗：7 天／30 天的範圍真的把舊資料排除、兩個帳號的資料不會混在一起。
 *
 * 用法：node scripts/report-math-test.mjs（自己起伺服器）
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
installFakeDb(createFakeDb(store, { uniqueIndexes: {} }));
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

async function register(nickname, wordBankId) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, wordBankId })
  });
  return { cookie: r.headers.get('set-cookie').split(';')[0], user: (await r.json()).user };
}
const pierce = await register('Pierce', 'g3a');
const allen = await register('Allen', 'allen');
const pid = store.users.find((u) => u.nickname === 'Pierce')._id;
const aid = store.users.find((u) => u.nickname === 'Allen')._id;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3600 * 1000);
const push = (name, row) => { (store[name] = store[name] || []).push(row); };

/* ── 放一批答案已知的資料（Pierce） ─────────────────────────
 * 「近」＝3 天內（7 天、30 天都算）；「中」＝20 天前（只有 30 天算）；「遠」＝60 天前（都不算）
 */
// 練習：近 10 題（7 對）、中 4 題（1 對）、遠 5 題（全對）
for (let i = 0; i < 10; i += 1) push('attempts', { userId: pid, wordId: `p1-${i}`, correct: i < 7, attemptedAt: ago(1) });
for (let i = 0; i < 4; i += 1) push('attempts', { userId: pid, wordId: `p2-${i}`, correct: i < 1, attemptedAt: ago(20) });
for (let i = 0; i < 5; i += 1) push('attempts', { userId: pid, wordId: `p3-${i}`, correct: true, attemptedAt: ago(60) });
// 練完一組：近 2、中 1、遠 3
for (const d of [1, 2, 20, 60, 61, 62]) push('groupCompletions', { userId: pid, groupId: 'p1', completedAt: ago(d) });
// 遊戲成績：
//  近：第 3 關 輸、輸、贏（第一次就輸）；第 4 關 贏（第一次就過）；複習關 贏；組別 輸
//  中：第 5 關 贏
//  遠：第 6 關 輸
const game = (mode, level, won, when) => push('gameResults', { userId: pid, mode, level, won, finishedAt: when });
game('level', 3, false, ago(3, 3)); game('level', 3, false, ago(3, 2)); game('level', 3, true, ago(3, 1));
game('level', 4, true, ago(2)); game('review', null, true, ago(2)); game('group', null, false, ago(1));
game('level', 5, true, ago(20));
game('level', 6, false, ago(60));
push('campaignProgress', { userId: pid, highestCleared: 5 });
// 錄影檔分析（報告只讀 summary）：
//  近 A：msPerKey 300、漏 slow1 unknown1（unknown 的字是 w01-lamp）
//  近 B：msPerKey 500、漏 idle2
//  中 C：msPerKey 900、漏 unknown1（w01-lamp）
//  遠 D：msPerKey 100（不算）
const log = (at, msPerKey, missReasons, words) => push('battleLogs', { userId: pid, at, summary: { msPerKey, firstKeyMs: msPerKey * 2, missReasons, words } });
log(ago(1), 300, { slow: 1, unknown: 1, idle: 0 }, [['w01-lamp', 'missed', 'unknown'], ['w01-bed', 'missed', 'slow']]);
log(ago(2), 500, { slow: 0, unknown: 0, idle: 2 }, [['w01-cat', 'missed', 'idle'], ['w01-dog', 'missed', 'idle']]);
log(ago(20), 900, { slow: 0, unknown: 1, idle: 0 }, [['w01-lamp', 'missed', 'unknown']]);
log(ago(60), 100, { slow: 5, unknown: 5, idle: 5 }, []);
// 行為事件：
//  近：練習頁停 10 分（兩次 6+4）、商店 3 分；三選一 3 次（400ms 選 lightning、2000ms 選 rush、900ms 選 lightning）
//  中：練習頁 20 分；三選一 1 次（5000ms 選 freeze）
//  遠：商店 99 分
const ev = (kind, page, data, at) => push('events', { userId: pid, kind, page, data, at });
ev('page_leave', 'practice', { ms: 6 * 60000 }, ago(1)); ev('page_leave', 'practice', { ms: 4 * 60000 }, ago(2));
ev('page_leave', 'shop', { ms: 3 * 60000 }, ago(1));
ev('page_leave', 'practice', { ms: 20 * 60000 }, ago(20));
ev('page_leave', 'shop', { ms: 99 * 60000 }, ago(60));
ev('perk_pick', 'game', { picked: 'lightning', ms: 400 }, ago(1));
ev('perk_pick', 'game', { picked: 'rush', ms: 2000 }, ago(1));
ev('perk_pick', 'game', { picked: 'lightning', ms: 900 }, ago(2));
ev('perk_pick', 'game', { picked: 'freeze', ms: 5000 }, ago(20));
ev('page_view', 'practice', {}, ago(1)); // 不影響任何數字
// 小遊戲：近 3 次（接金幣 2、打蟲 1），中 1 次（接金幣），遠 2 次
const play = (itemKey, when) => push('minigamePlays', { userId: pid, itemKey, playedAt: when });
play('minigame_coincatch', ago(1)); play('minigame_coincatch', ago(2)); play('minigame_whack', ago(2));
play('minigame_coincatch', ago(20)); play('minigame_beeflap', ago(60)); play('minigame_beeflap', ago(61));

// Allen：只有一題練習，用來驗「兩個帳號不會混在一起」
push('attempts', { userId: aid, wordId: 'a-p1-x', correct: false, attemptedAt: ago(1) });

/* ── 手算的答案 ──────────────────────────────────────────── */
const EXPECT = {
  7: {
    practice: { sessions: 2, answers: 10, accuracy: 0.7 },
    games: { played: 6, won: 3, byMode: { level: 4, review: 1, group: 1 } },
    campaign: { highestCleared: 5, played: 2, firstTryFail: 0.5, hardestFirst: { level: 3, tries: 3, won: true } },
    typing: [{ msPerKey: 400, battles: 2 }], // 兩場都在同一週（中位數 = (300+500)/2），除非剛好跨週
    misses: { slow: 1, unknown: 1, idle: 2, total: 4, topUnknown: [{ id: 'w01-lamp', times: 1 }] },
    time: { practice: 10 * 60000, shop: 3 * 60000, totalMs: 13 * 60000 },
    perks: { decisions: 3, medianMs: 900, fastShare: 2 / 3, picked: { lightning: 2, rush: 1 } },
    minigames: { plays: 3, byKey: { minigame_coincatch: 2, minigame_whack: 1 }, perPractice: 1.5 }
  },
  30: {
    practice: { sessions: 3, answers: 14, accuracy: 8 / 14 },
    games: { played: 7, won: 4 },
    campaign: { played: 3, firstTryFail: 1 / 3 },
    misses: { slow: 1, unknown: 2, idle: 2, total: 5, topUnknown: [{ id: 'w01-lamp', times: 2 }] },
    time: { practice: 30 * 60000, shop: 3 * 60000 },
    perks: { decisions: 4, medianMs: 1450, fastShare: 2 / 4, picked: { lightning: 2, rush: 1, freeze: 1 } },
    minigames: { plays: 4, perPractice: 4 / 3 }
  }
};

const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
async function report(days) {
  const r = await fetch(`${BASE}/api/telemetry/report?days=${days}`, { headers: { cookie: pierce.cookie } }).then((x) => x.json());
  return { all: r, p: r.reports.find((x) => x.nickname === 'Pierce'), a: r.reports.find((x) => x.nickname === 'Allen') };
}

console.log('1) 最近 7 天：逐項對手算的答案');
{
  const { p, a } = await report(7);
  const e = EXPECT[7];
  check('練習：練完 2 組、答 10 題、答對 70%', p.practice.sessions === 2 && p.practice.answers === 10 && near(p.practice.accuracy, 0.7), JSON.stringify(p.practice));
  check('遊戲：6 場、贏 3', p.games.played === 6 && p.games.won === 3, JSON.stringify(p.games));
  check('遊戲分類：戰役 4、複習 1、組別 1', JSON.stringify(p.games.byMode) === JSON.stringify(e.games.byMode), JSON.stringify(p.games.byMode));
  check('戰役進度：第 5 關', p.campaign.highestCleared === 5);
  check('戰役：打過 2 關、第一次就輸 50%（第 3 關輸、第 4 關過）', p.campaign.played === 2 && near(p.campaign.firstTryFail, 0.5), JSON.stringify(p.campaign));
  check('打最多次的是第 3 關（3 次、最後過了）', p.campaign.hardest[0]?.level === 3 && p.campaign.hardest[0]?.tries === 3 && p.campaign.hardest[0]?.won === true, JSON.stringify(p.campaign.hardest[0]));
  const tw = p.typing.reduce((s, t) => s + t.battles, 0);
  const oneWeek = p.typing.length === 1;
  check('英打：2 場' + (oneWeek ? '、中位數 400 毫秒／鍵' : '（跨了週：各週分開算）'),
    tw === 2 && (oneWeek ? p.typing[0].msPerKey === 400 : p.typing.every((t) => [300, 500].includes(t.msPerKey))), JSON.stringify(p.typing));
  check('漏字：來不及 1、不會拼 1、沒動作 2、共 4', p.misses.slow === 1 && p.misses.unknown === 1 && p.misses.idle === 2 && p.misses.total === 4, JSON.stringify(p.misses));
  check('最常不會拼：w01-lamp 1 次', p.misses.topUnknown[0]?.id === 'w01-lamp' && p.misses.topUnknown[0]?.times === 1);
  check('時間：練習 10 分、商店 3 分、共 13 分', p.time.byPage.practice === e.time.practice && p.time.byPage.shop === e.time.shop && p.time.totalMs === e.time.totalMs, JSON.stringify(p.time));
  check('三選一：3 次、中位數 0.9 秒、2/3 在一秒內', p.perks.decisions === 3 && p.perks.medianMs === 900 && near(p.perks.fastShare, 2 / 3), JSON.stringify(p.perks));
  check('三選一選了什麼：閃電手 2、加速 1', JSON.stringify(p.perks.picked) === JSON.stringify(e.perks.picked), JSON.stringify(p.perks.picked));
  check('小遊戲：3 次（接金幣 2、打蟲 1）、每練完一組玩 1.5 次', p.minigames.plays === 3 && JSON.stringify(p.minigames.byKey) === JSON.stringify(e.minigames.byKey) && near(p.minigames.perPractice, 1.5), JSON.stringify(p.minigames));
  check('Allen 那一份：只有他自己的 1 題、答對 0%', a.practice.answers === 1 && a.practice.accuracy === 0 && a.games.played === 0, JSON.stringify(a.practice));
}

console.log('\n2) 最近 30 天：20 天前的算進來、60 天前的不算');
{
  const { p } = await report(30);
  check('練習：3 組、14 題、答對 8/14', p.practice.sessions === 3 && p.practice.answers === 14 && near(p.practice.accuracy, 8 / 14), JSON.stringify(p.practice));
  check('遊戲：7 場、贏 4', p.games.played === 7 && p.games.won === 4, JSON.stringify(p.games));
  check('戰役：打過 3 關、第一次就輸 1/3', p.campaign.played === 3 && near(p.campaign.firstTryFail, 1 / 3), JSON.stringify(p.campaign));
  check('漏字：不會拼變 2、共 5；w01-lamp 2 次', p.misses.unknown === 2 && p.misses.total === 5 && p.misses.topUnknown[0]?.times === 2, JSON.stringify(p.misses));
  check('時間：練習 30 分（60 天前商店的 99 分不算）', p.time.byPage.practice === 30 * 60000 && p.time.byPage.shop === 3 * 60000, JSON.stringify(p.time.byPage));
  check('三選一：4 次、中位數 1.45 秒、一半在一秒內', p.perks.decisions === 4 && p.perks.medianMs === 1450 && near(p.perks.fastShare, 0.5), JSON.stringify(p.perks));
  check('小遊戲：4 次、每組 4/3 次', p.minigames.plays === 4 && near(p.minigames.perPractice, 4 / 3), JSON.stringify(p.minigames));
  const w = p.typing.reduce((s, t) => s + t.battles, 0);
  check('英打：3 場（60 天前的不算）', w === 3, JSON.stringify(p.typing));
}

console.log('\n3) 範圍的邊界');
{
  const { all } = await report(0);
  check('天數 0 或亂填：退回 1～90 之間', all.days >= 1 && all.days <= 90, String(all.days));
  const { all: big } = await report(9999);
  check('天數太大：最多 90 天', big.days === 90, String(big.days));
}

console.log('\n4) 報告頁畫出來的字');
{
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext();
  const [n, v] = pierce.cookie.split('=');
  await ctx.addCookies([{ name: n, value: v, url: BASE }]);
  await ctx.addInitScript((u) => localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u)), pierce.user);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/report.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rkid', { timeout: 10000 });
  await page.selectOption('#report-days', '7');
  await sleep(1200);
  const txt = await page.evaluate(() => [...document.querySelectorAll('.rkid')].find((k) => k.querySelector('h2')?.textContent === 'Pierce')?.innerText || '');
  check('練完 2 組、答了 10 題、答對 70%', /練習完\s*2\s*組、答了\s*10\s*題，答對\s*70%/.test(txt));
  check('遊戲打了 6 場、贏 3 場（戰役 4、複習關 1、練習後的遊戲 1）', /遊戲打了\s*6\s*場、贏\s*3\s*場（戰役 4、複習關 1、練習後的遊戲 1）/.test(txt));
  check('戰役打到第 5 關、第一次就輸 50%', /戰役打到第\s*5\s*關/.test(txt) && /第一次就輸的比例\s*50%/.test(txt));
  check('打最多次：第 3 關（3 次）', /第 3 關（3 次）/.test(txt));
  check('漏字的三個數字', /來不及\s*1 個/.test(txt) && /不會拼\s*1 個/.test(txt) && /沒動作\s*2 個/.test(txt));
  check('時間：練習 10 分、商店 3 分', /練習\s*10 分/.test(txt) && /商店\s*3 分/.test(txt));
  check('三選一：3 次、0.9 秒、67% 一秒內', /選了\s*3\s*次，一般花\s*0\.9\s*秒選；67%\s*是一秒內就選好/.test(txt));
  check('小遊戲：3 次、每組 1.5 次', /玩了\s*3\s*次/.test(txt) && /玩\s*1\.5\s*次小遊戲/.test(txt));
  check('下載分析檔的連結跟著範圍變成 7 天', (await page.getAttribute('#report-export', 'href')) === '/api/telemetry/export?days=7');
  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await browser.close();
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
