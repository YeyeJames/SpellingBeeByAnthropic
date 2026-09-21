/**
 * 錄影檔 → 分析報告的整條鏈路。
 *
 * 這支測試的價值在於**它知道正確答案**：由腳本照著一個寫死的劇本玩
 * （第幾個字重聽幾次、故意打錯哪三個鍵、故意漏掉哪一個字），
 * 然後檢查分析工具有沒有把同一件事還原出來。
 *
 * 為什麼值得測：
 *   1. 匯出如果只留最後一場，「他玩了幾場、第一場玩完沒」就永遠答不出來，
 *      而且不會有任何錯誤——報告照樣印得漂漂亮亮，只是少了一半資料
 *   2. 分析靠的是重播。重播一旦跟實際遊玩對不起來，報告就是在說謊，
 *      而我會拿那些數字去改設計
 *
 * 用法：node scripts/analyze-test.mjs
 */

import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 劇本：這幾個數字就是「正確答案」 ──────────────────── */
const SCRIPT = {
  listenKeys: ['ArrowUp', 'ArrowDown'], // 重聽兩次，兩種不同的
  wrongKeys: ['q', 'z', 'x'], // 故意打錯三次
  battles: 2
};

const tmp = mkdtempSync(join(tmpdir(), 'spellbee-log-'));
const logPath = join(tmp, 'session.json');

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true
});
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
});
const page = await context.newPage();
await page.goto(`${BASE}/game?group=w18&n=200&order=sequential&show=1&difficulty=easy`, {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

const state = () => page.evaluate(() => window.__spellbee.state());
async function typeWord(delay = 50) {
  const target = await page.evaluate(() => window.__spellbee.state()?.target || '');
  for (const ch of target) {
    await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    if (delay) await page.waitForTimeout(delay);
  }
  return target;
}

console.log('1) 照劇本玩一次');

// 第一個字：乾淨打完
const word1 = await typeWord();
await page.waitForTimeout(80);

// 第二個字：先重聽，再故意打錯，然後打完
const word2 = await page.evaluate(() => window.__spellbee.state()?.target || '');
for (const key of SCRIPT.listenKeys) {
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
}
for (const key of SCRIPT.wrongKeys) {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
}
await typeWord();
await page.waitForTimeout(80);

// 第三個字：完全不動，讓它撞進蜂巢（製造漏字）
await page.waitForFunction(() => window.__spellbee.state().stats.wordsMissed > 0, null, { timeout: 45000 });
await page.waitForTimeout(150);
const battle1 = await state();
console.log(`     第 1 場：打掉 ${battle1.stats.wordsKilled}、漏 ${battle1.stats.wordsMissed}、錯 ${battle1.stats.wrongLetters}`);

// 重開一場——這一步就是在驗「上一場有沒有被留下來」
await page.evaluate(() => window.__spellbee.restart({ difficulty: 'easy' }));
await page.waitForTimeout(300);
for (let i = 0; i < 3; i += 1) {
  const s = await state();
  if (!s || s.status !== 'running') break;
  await typeWord();
  await page.waitForTimeout(60);
}

const download = page.waitForEvent('download', { timeout: 15000 });
await page.click('#btn-replay-file');
await (await download).saveAs(logPath);
await browser.close();

/* ── 跑分析 ────────────────────────────────────────────── */
console.log('\n2) 分析工具讀得回來');
const raw = execFileSync('node', ['scripts/analyze-log.mjs', logPath, '--json'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024
});
const parsed = JSON.parse(raw);
const battles = parsed.battles;

check('匯出留住了每一場，不是只有最後一場', battles.length === SCRIPT.battles, `${battles.length} 場`);

const all = battles.flatMap((b) => b.attempts);
const listens = all.flatMap((a) => a.listens);
const wrong = all.flatMap((a) => a.wrongDetail);
const missed = all.filter((a) => a.result === 'missed');

console.log('\n3) 還原出來的跟實際做的要一致');
check(
  `重聽次數還原正確（${SCRIPT.listenKeys.length} 次）`,
  listens.length === SCRIPT.listenKeys.length,
  listens.join('、') || '（沒有）'
);
check('兩種不同的重聽都分得出來', new Set(listens).size === 2, [...new Set(listens)].join('、'));

check(
  `打錯次數還原正確（${SCRIPT.wrongKeys.length} 次）`,
  wrong.length === SCRIPT.wrongKeys.length,
  `${wrong.length} 次`
);
check(
  '打錯的鍵還原正確',
  wrong.map((w) => w.typed).join(',') === SCRIPT.wrongKeys.join(','),
  wrong.map((w) => w.typed).join(',')
);
/*
 * 三次都打在同一個位置（第一個字母），因為打錯不會推進進度。
 * 這一條同時驗到「期待的字母」有沒有算對——那是報告裡最實用的一欄。
 */
check(
  '錯在哪個位置、應該是什麼字母，都對得上',
  wrong.every((w) => w.pos === 0 && w.expected === word2[0]),
  wrong.map((w) => `pos${w.pos}→${w.expected}`).join(',')
);
check('打錯的字認得出來', all.some((a) => a.english === word2 && a.wrongLetters === 3), word2);

check('漏字有被記到', missed.length >= 1, `${missed.length} 次`);
check('乾淨打完的第一個字認得出來',
  all.some((a) => a.english === word1 && a.result === 'killed' && a.wrongLetters === 0), word1);

/* ── 節奏統計的取樣規則 ────────────────────────────────── */
console.log('\n4) 節奏統計不能把「聽單字的時間」算進去');
const b1 = battles[0];
/*
 * 每個字的第一個字母之前那一段包含「聽完新單字」，對人來說是好幾秒。
 * 算進基準線的話，基準線會被拉高，而「打錯之後有沒有變慢」的倍率
 * 就會被系統性低估——也就是傾向誤判成「他沒注意到」。
 */
const totalLetters = b1.attempts.reduce((n, a) => n + a.correctLetters, 0);
check(
  '基準線的樣本數少於總字母數（開頭那一下有被排除）',
  b1.letterGaps.length < totalLetters,
  `間隔樣本 ${b1.letterGaps.length} < 字母 ${totalLetters}`
);
check(
  '基準線裡沒有異常長的間隔（聽單字的時間沒混進來）',
  b1.letterGaps.every((g) => g < 8000),
  `最長 ${Math.round(Math.max(0, ...b1.letterGaps))}ms`
);
check('打錯之後的間隔另外收，沒跟基準線混在一起',
  b1.gapsAfterWrong.length === SCRIPT.wrongKeys.length, `${b1.gapsAfterWrong.length} 筆`);

/* ── 報告本身印得出來 ──────────────────────────────────── */
console.log('\n5) 人看的報告印得出來');
const text = execFileSync('node', ['scripts/analyze-log.mjs', logPath], { encoding: 'utf8' });
check('有「他有沒有玩完」這一段', text.includes('他有沒有玩完'));
check('有「他有沒有注意到打錯」這一段', text.includes('注意到'));
check('有「哪些字他不會」這一段', text.includes('哪些字他不會'));
check('漏掉的字有列出來', text.includes('❌'));
check(
  '樣本不足時不下結論',
  !text.includes('🔴') || /樣本/.test(text),
  '樣本少卻給了紅燈結論'
);
check('最後有提醒哪兩件事只能用眼睛看', text.includes('用眼睛看才知道'));

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
