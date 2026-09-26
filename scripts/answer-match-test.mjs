/**
 * 答案判定：兩本課本的每一個字，逐字檢查（docs/audit 步驟四，P4-1／4-A）。
 *
 * 要證明的事：
 *   1. 照正確拼法打，每一個字都判對
 *   2. 全形字母（注音輸入法切到全形時打出來的 ａｌａｒｍ）判對——看起來一樣的東西不能判錯
 *   3. 該錯的照樣錯：每一個字都試「少一個字母」「多一個字母」「換一個字母」，一個都不能變成對
 *   4. 片語：空白與連字號不算數（既有規則，不能被這次改動弄壞）
 *
 * 用法：node scripts/answer-match-test.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wordBank = require('../server/data/word-bank.js');
const { isAnswerCorrect } = await import('../public/js/shared/answer-match.js');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* 半形 → 全形：a~z、A~Z 對到 U+FF41 起、U+FF21 起；空白對到全形空白 U+3000 */
const toFullWidth = (s) => [...s].map((ch) => {
  const c = ch.charCodeAt(0);
  if (c >= 0x21 && c <= 0x7e) return String.fromCharCode(c + 0xfee0);
  if (ch === ' ') return '　';
  return ch;
}).join('');

const words = wordBank.listBanks().flatMap((b) => wordBank.getBank(b.id).words);
console.log(`兩本課本，共 ${words.length} 個字\n`);

console.log('1) 正確拼法');
{
  const bad = words.filter((w) => !isAnswerCorrect(w.english, w.english));
  check('每一個字照正確拼法打都判對', bad.length === 0, bad.slice(0, 5).map((w) => w.english).join(', '));
  const upper = words.filter((w) => !isAnswerCorrect(w.english.toUpperCase(), w.english));
  check('打成大寫也判對', upper.length === 0, upper.slice(0, 5).map((w) => w.english).join(', '));
  const padded = words.filter((w) => !isAnswerCorrect(`  ${w.english} `, w.english));
  check('前後多打空白也判對', padded.length === 0);
}

console.log('\n2) 全形字母');
{
  const bad = words.filter((w) => !isAnswerCorrect(toFullWidth(w.english), w.english));
  check('整個字用全形打，每一個字都判對', bad.length === 0, `${bad.length} 個判錯，例如 ${bad.slice(0, 3).map((w) => toFullWidth(w.english)).join(' ')}`);
  const mixed = words.filter((w) => !isAnswerCorrect(toFullWidth(w.english[0]) + w.english.slice(1), w.english));
  check('只有第一個字母是全形，也判對', mixed.length === 0, `${mixed.length} 個判錯`);
  const upperFull = words.filter((w) => !isAnswerCorrect(toFullWidth(w.english.toUpperCase()), w.english));
  check('全形大寫也判對', upperFull.length === 0, `${upperFull.length} 個判錯`);
  check('全形空白當成空白（片語）', isAnswerCorrect('alarm　clock', 'alarm clock'));
}

console.log('\n3) 該錯的照樣錯（每一個字都試）');
{
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let tried = 0;
  const wronglyRight = [];
  for (const w of words) {
    const e = w.english;
    const variants = new Set();
    for (let i = 0; i < e.length; i += 1) {
      if (e[i] === ' ' || e[i] === '-') continue;
      variants.add(e.slice(0, i) + e.slice(i + 1)); // 少一個
      const swap = letters[(letters.indexOf(e[i]) + 1) % 26];
      variants.add(e.slice(0, i) + swap + e.slice(i + 1)); // 換一個
    }
    variants.add(`${e}s`); // 多一個
    variants.add(`${e}e`);
    for (const v of variants) {
      if (v.replace(/[ -]/g, '') === e.replace(/[ -]/g, '')) continue; // 只差分隔符的本來就該對
      tried += 1;
      if (isAnswerCorrect(v, e) || isAnswerCorrect(toFullWidth(v), e)) wronglyRight.push(`${v}（${e}）`);
    }
  }
  check(`拼錯的 ${tried} 種打法（含全形版本），一個都沒有判對`, wronglyRight.length === 0, wronglyRight.slice(0, 5).join(', '));
  check('什麼都沒打：錯', !isAnswerCorrect('', 'alarm') && !isAnswerCorrect('　', 'alarm'));
  check('題目是空的：錯', !isAnswerCorrect('', ''));
}

console.log('\n4) 片語的既有規則');
{
  const phrases = words.filter((w) => /[ -]/.test(w.english));
  const noSep = phrases.filter((w) => !isAnswerCorrect(w.english.replace(/[ -]/g, ''), w.english));
  check(`${phrases.length} 個片語不打空白／連字號也判對`, noSep.length === 0, noSep.map((w) => w.english).join(', '));
  const swapped = phrases.filter((w) => !isAnswerCorrect(w.english.replace(/ /g, '-'), w.english));
  check('空白打成連字號也判對', swapped.length === 0);
  check('walkie-talkies 打成單數：錯', !isAnswerCorrect('walkie-talkie', 'walkie-talkies'));
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
