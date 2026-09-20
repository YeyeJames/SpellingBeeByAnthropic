/**
 * 聽寫答案的判定規則。
 *
 * 這個檔案同時被瀏覽器與伺服器用（伺服器用動態 import 載進來）。
 * 兩邊各寫一次的話遲早會不一致，而不一致的症狀是最難解釋的那種：
 * 畫面立刻說「答對了」，金幣卻沒有加——因為前端與後端對同一個答案
 * 判了不同的結果。所以規則只能有一份。
 *
 * ── 分隔符不算數 ───────────────────────────────────────────
 * 課本有 "alarm clock"、"a couple of"、"high-pitched" 這種詞條。
 * 聽寫的時候他看不到單字，只聽得到發音，所以「那裡到底有沒有空白」
 * 不是拼字能力的問題，是猜的。遊戲那邊已經不強制（見 game/core/battle.js），
 * 練習這邊也一樣——否則同一個孩子、同一個字，在遊戲裡算對、在練習裡算錯，
 * 而練習才是影響金幣與統計的那一邊。
 *
 * 放寬的只有分隔符。拼字本身一個字母都不能錯。
 */

import { isSeparator } from '../game/core/charset.js';

export function normalizeAnswer(str) {
  return String(str == null ? '' : str)
    .trim()
    .toLowerCase();
}

/** 把空白與連字號拿掉——判定時它們不算數。 */
function stripSeparators(str) {
  let out = '';
  for (const ch of str) {
    if (!isSeparator(ch)) out += ch;
  }
  return out;
}

/**
 * 答案對不對。
 *
 * @param {string} userAnswer 他打的
 * @param {string} english    正確答案
 */
export function isAnswerCorrect(userAnswer, english) {
  const answer = normalizeAnswer(userAnswer);
  const target = normalizeAnswer(english);
  // 空的題目不可能答對，否則什麼都不打就會被判對
  if (!target) return false;
  if (answer === target) return true;
  return stripSeparators(answer) === stripSeparators(target);
}
