/**
 * 分析檔健檢：找「沒有報錯、但悄悄算錯」的地方（docs/audit 步驟八）。
 *
 * 家長在報告頁按「下載分析檔」，把檔案交給我，我跑這一支。
 * 它只讀檔案，不連任何資料庫、不改任何東西。
 *
 * 每一項的結果是：
 *   ✅ 沒問題
 *   ⚠️ 要注意：資料看起來不對，可能是 bug，要追
 *   ℹ️ 資訊：不是錯，但值得知道（例如有幾場沒有錄影檔）
 *
 * 用法：node scripts/export-check.mjs spellbee-analysis-2026-10-10.json
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const wordBank = require('../server/data/word-bank.js');
const { calcCoinsForCorrectAnswer } = require('../server/utils/coins.js');
const { isAnswerCorrect } = await import('../public/js/shared/answer-match.js');

const OK = '✅';
const WARN = '⚠️';
const INFO = 'ℹ️';

function dupes(rows) {
  const seen = new Set();
  const out = new Set();
  for (const r of rows) {
    if (!r.opId) continue;
    if (seen.has(r.opId)) out.add(r.opId);
    seen.add(r.opId);
  }
  return [...out];
}
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

/** 回傳 [{ nickname, findings: [{ level, title, detail }] }] */
export function checkExport(data) {
  if (!data || data.kind !== 'spellbee-export' || !Array.isArray(data.profiles)) {
    throw new Error('這不是拼字蜂的分析檔（kind 不對）');
  }
  return data.profiles.map((p) => {
    const f = [];
    const add = (level, title, detail = '') => f.push({ level, title, detail });
    const bankId = wordBank.resolveBankId(p.wordBankId);
    const bank = new Set(wordBank.getBank(bankId).words.map((w) => w.id));
    const attempts = p.attempts || [];

    // 1. 金幣、蜂蜜、經驗
    const neg = ['coins', 'honey', 'xp'].filter((k) => Number(p[k]) < 0);
    if (neg.length) add(WARN, '有負的數字', neg.map((k) => `${k}=${p[k]}`).join('、'));
    else add(OK, '金幣、蜂蜜、經驗都不是負的', `金幣 ${p.coins}、蜂蜜 ${p.honey}、經驗 ${p.xp}`);
    if (p.stats && p.stats.bestStreak < p.stats.currentStreak) add(WARN, '最高連勝比目前連勝還小', JSON.stringify(p.stats));

    // 2. 每一題用現在的規則重判一次
    const rejudge = [];
    let fullWidth = 0;
    let fullWidthWrong = 0;
    for (const a of attempts) {
      const w = wordBank.getWordById(a.wordId);
      if (!w) continue;
      const ans = String(a.userAnswer || '');
      const isFull = ans !== ans.normalize('NFKC');
      if (isFull) {
        fullWidth += 1;
        if (!a.correct && isAnswerCorrect(ans, w.english)) fullWidthWrong += 1;
      }
      const now = isAnswerCorrect(ans, w.english);
      if (now !== !!a.correct && !isFull) rejudge.push(`${w.english}：打「${ans}」當時判${a.correct ? '對' : '錯'}`);
    }
    if (rejudge.length) add(WARN, `有 ${rejudge.length} 題用現在的規則重判，結果不一樣`, rejudge.slice(0, 5).join('；'));
    else add(OK, `${attempts.length} 題用現在的規則重判，結果都一樣`);
    if (fullWidth) {
      add(INFO, `有 ${fullWidth} 題是用全形字打的（注音輸入法切到全形）`,
        fullWidthWrong ? `其中 ${fullWidthWrong} 題拼對了卻被判錯（4-A 上線之前的）` : '都有判對');
    }

    // 3. 別本課本的字
    const foreignAtt = attempts.filter((a) => !bank.has(a.wordId));
    const foreignWp = (p.wordProgress || []).filter((r) => !bank.has(r.wordId));
    if (foreignAtt.length) add(WARN, `有 ${foreignAtt.length} 題練的是別本課本的字`, [...new Set(foreignAtt.map((a) => a.wordId))].slice(0, 5).join('、'));
    else add(OK, '練的都是自己那一本的字');
    if (foreignWp.length) add(INFO, `精熟度裡有 ${foreignWp.length} 個別本課本的字`, '多半是以前的舊紀錄（step2 的 Q2）；遊戲玩法不受影響');

    // 4. 重複記帳
    const d = { 作答: dupes(attempts), 遊戲成績: dupes(p.gameResults || []), 小遊戲: dupes(p.minigamePlays || []), 練完一組: dupes(p.groupCompletions || []) };
    const dd = Object.entries(d).filter(([, v]) => v.length);
    if (dd.length) add(WARN, '同一筆記了兩次', dd.map(([k, v]) => `${k} ${v.length} 筆`).join('、'));
    else add(OK, '沒有同一筆記兩次（作答、遊戲、小遊戲、練完一組）');

    // 5. 金幣重算（只有在分析檔涵蓋了整段歷史時才比得起來）
    const lifetime = p.stats?.totalWordsPracticed;
    if (lifetime && lifetime === attempts.length) {
      const sorted = [...attempts].sort((x, y) => new Date(x.attemptedAt) - new Date(y.attemptedAt));
      let streak = 0;
      let earned = 0;
      for (const a of sorted) { streak = a.correct ? streak + 1 : 0; if (a.correct) earned += calcCoinsForCorrectAnswer(streak); }
      const plays = (p.minigamePlays || []).reduce((s, x) => s + (x.cost || 0), 0);
      add(INFO, '照作答紀錄重算：賺了多少金幣', `賺 ${earned}、小遊戲花 ${plays}、造型另外算；現在有 ${p.coins}`);
    }

    // 6. 戰役：贏了卻沒記到過關
    const highest = p.campaign?.highestCleared || 0;
    const wonLevels = (p.gameResults || []).filter((g) => g.mode === 'level' && g.won).map((g) => g.level);
    const lost = [...new Set(wonLevels.filter((n) => n > highest))];
    if (lost.length) add(WARN, '有關卡打贏了，但戰役進度沒有記到', `第 ${lost.join('、')} 關（進度是第 ${highest} 關）`);
    else if (wonLevels.length) add(OK, `戰役：打贏的關都有記到（進度第 ${highest} 關）`);

    // 7. 錄影檔
    const games = p.gameResults || [];
    const logs = p.battleLogs || [];
    const logIds = new Set(logs.map((l) => l.opId));
    const noLog = games.filter((g) => !logIds.has(g.opId)).length;
    if (games.length) add(INFO, `${games.length} 場遊戲裡，${games.length - noLog} 場有錄影檔（${pct(games.length - noLog, games.length)}）`, noLog ? '沒有的多半是關頁面太快、錄影檔還沒送出' : '');
    const bad = logs.filter((l) => l.summary && l.summary.error);
    if (bad.length) add(WARN, `${bad.length} 份錄影檔分析失敗`, bad.slice(0, 3).map((l) => l.summary.error).join('；'));
    const stuck = logs.filter((l) => l.summary && l.summary.status === 'running' && (l.entries || []).length > 20);
    if (stuck.length) add(WARN, `${stuck.length} 場錄影檔停在「還在打」`, '可能是卡住或中途離開，要看錄影檔');

    // 8. 小遊戲：沒買卻有玩
    const owned = new Set(p.ownedItemKeys || []);
    const ghost = (p.minigamePlays || []).filter((x) => !owned.has(x.itemKey));
    if (ghost.length) add(WARN, `有 ${ghost.length} 次小遊戲是沒買的`, [...new Set(ghost.map((x) => x.itemKey))].join('、'));

    // 9. 時間紀錄
    const leaves = (p.events || []).filter((e) => e.kind === 'page_leave');
    const huge = leaves.filter((e) => Number(e.data?.ms) > 3 * 60 * 60 * 1000);
    if (huge.length) add(INFO, `有 ${huge.length} 次「停在同一頁超過 3 小時」`, '報告裡會被夾到 3 小時；多半是頁面開著沒關');

    return { nickname: p.nickname, bank: bankId, findings: f };
  });
}

export function formatReport(data, results) {
  const lines = [`分析檔健檢（範圍 ${data.days} 天，匯出時間 ${data.exportedAt}）`, ''];
  for (const r of results) {
    lines.push(`■ ${r.nickname}（${r.bank}）`);
    for (const x of r.findings) lines.push(`  ${x.level} ${x.title}${x.detail ? `：${x.detail}` : ''}`);
    lines.push('');
  }
  const warns = results.reduce((a, r) => a + r.findings.filter((x) => x.level === WARN).length, 0);
  lines.push(warns ? `${WARN} 共 ${warns} 項要追` : `${OK} 沒有要追的`);
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.log('用法：node scripts/export-check.mjs <分析檔.json>');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  console.log(formatReport(data, checkExport(data)));
}
