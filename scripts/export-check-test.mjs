/**
 * 分析檔健檢本身要抓得到問題（scripts/export-check.mjs）。
 *
 * 一份乾淨的分析檔要全部 ✅；再故意埋一批已知的錯，每一個都要被標成 ⚠️（或 ℹ️）。
 *
 * 用法：node scripts/export-check-test.mjs
 */

import { checkExport, formatReport } from './export-check.mjs';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const t = (m) => new Date(Date.UTC(2026, 9, 1, 10, m)).toISOString();
function cleanProfile() {
  return {
    nickname: 'Pierce', wordBankId: 'g3a', xp: 500, coins: 120, honey: 300,
    ownedItemKeys: ['minigame_coincatch'], ownedGear: [], equipped: null,
    stats: { totalWordsPracticed: 3, totalCorrect: 2, totalIncorrect: 1, currentStreak: 1, bestStreak: 1 },
    campaign: { highestCleared: 2, stars: {} },
    attempts: [
      { opId: 'a1', wordId: 'p1-account', userAnswer: 'account', correct: true, attemptedAt: t(1) },
      { opId: 'a2', wordId: 'p1-addition', userAnswer: 'adition', correct: false, attemptedAt: t(2) },
      { opId: 'a3', wordId: 'p1-announce', userAnswer: 'announce', correct: true, attemptedAt: t(3) }
    ],
    gameResults: [
      { opId: 'g1', mode: 'level', level: 1, won: true },
      { opId: 'g2', mode: 'level', level: 2, won: true },
      { opId: 'g3', mode: 'group', level: null, won: false }
    ],
    battleLogs: [
      { opId: 'g1', summary: { status: 'won' }, entries: [] },
      { opId: 'g2', summary: { status: 'won' }, entries: [] },
      { opId: 'g3', summary: { status: 'lost' }, entries: [] }
    ],
    groupCompletions: [{ opId: 'c1', groupId: 'p1' }],
    minigamePlays: [{ opId: 'm1', itemKey: 'minigame_coincatch', cost: 150 }],
    wordProgress: [{ wordId: 'p1-account', boxLevel: 1 }],
    events: [{ kind: 'page_leave', page: 'practice', data: { ms: 60000 } }]
  };
}
const wrap = (p) => ({ kind: 'spellbee-export', version: 1, days: 30, exportedAt: t(0), profiles: [p] });
const levels = (res) => res[0].findings;
const has = (res, level, re) => levels(res).some((x) => x.level === level && re.test(x.title + x.detail));

console.log('1) 乾淨的分析檔');
{
  const res = checkExport(wrap(cleanProfile()));
  const warns = levels(res).filter((x) => x.level === '⚠️');
  check('沒有任何 ⚠️', warns.length === 0, warns.map((w) => w.title).join('；'));
  check('每一場都有錄影檔（100%）', has(res, 'ℹ️', /100%/));
  check('排版得出來', /沒有要追的/.test(formatReport(wrap(cleanProfile()), res)));
}

console.log('\n2) 故意埋的錯，每一個都要抓到');
const cases = [
  ['金幣是負的', (p) => { p.coins = -50; }, '⚠️', /負的/],
  ['最高連勝比目前連勝小', (p) => { p.stats.currentStreak = 9; p.stats.bestStreak = 3; }, '⚠️', /最高連勝/],
  ['一題當時判錯、其實拼對', (p) => { p.attempts[0].correct = false; }, '⚠️', /重判.*不一樣/],
  ['全形字母被判錯（4-A 之前的樣子）', (p) => { p.attempts[2].userAnswer = 'ａｎｎｏｕｎｃｅ'; p.attempts[2].correct = false; }, 'ℹ️', /全形.*1 題拼對了卻被判錯/],
  ['練到別本課本的字（step2 的 S1）', (p) => { p.attempts.push({ opId: 'a9', wordId: 'a-p1-acquaint', userAnswer: 'acquaint', correct: true, attemptedAt: t(9) }); }, '⚠️', /別本課本/],
  ['同一筆作答記了兩次', (p) => { p.attempts.push({ ...p.attempts[0] }); }, '⚠️', /記了兩次.*作答/],
  ['同一場成績記了兩次', (p) => { p.gameResults.push({ ...p.gameResults[0] }); }, '⚠️', /記了兩次.*遊戲成績/],
  ['打贏了第 3 關卻沒記到過關', (p) => { p.gameResults.push({ opId: 'g4', mode: 'level', level: 3, won: true }); }, '⚠️', /沒有記到.*第 3 關/],
  ['錄影檔分析失敗', (p) => { p.battleLogs[0].summary = { error: 'boom' }; }, '⚠️', /分析失敗/],
  ['錄影檔停在還在打', (p) => { p.battleLogs[0].summary = { status: 'running' }; p.battleLogs[0].entries = Array(30).fill([1, 1, 97]); }, '⚠️', /還在打/],
  ['沒買的小遊戲有玩', (p) => { p.minigamePlays.push({ opId: 'm2', itemKey: 'minigame_whack', cost: 150 }); }, '⚠️', /沒買的/],
  ['有一場沒有錄影檔', (p) => { p.battleLogs.pop(); }, 'ℹ️', /3 場遊戲裡，2 場有錄影檔/],
  ['停在同一頁超過 3 小時', (p) => { p.events.push({ kind: 'page_leave', page: 'shop', data: { ms: 5 * 3600 * 1000 } }); }, 'ℹ️', /超過 3 小時/],
  ['精熟度裡有別本課本的字', (p) => { p.wordProgress.push({ wordId: 'a-p1-acquaint', boxLevel: 0 }); }, 'ℹ️', /精熟度.*別本課本/]
];
for (const [name, mutate, level, re] of cases) {
  const p = cleanProfile();
  mutate(p);
  const res = checkExport(wrap(p));
  check(name, has(res, level, re), levels(res).filter((x) => x.level !== '✅').map((x) => `${x.level}${x.title}`).join('；'));
}

console.log('\n3) 不是分析檔');
{
  let threw = false;
  try { checkExport({ hello: 1 }); } catch (e) { threw = /不是拼字蜂的分析檔/.test(e.message); }
  check('給錯的檔案：講清楚不是分析檔', threw);
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
