const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * 簡化版 5-box Leitner：答對進到下一格，答錯回到第 0 格，10 分鐘後再複習。
 *
 * 這一行註解本來寫「立即複習」，跟下面的 10 分鐘不一致（docs/audit/step4 的 P4-2）。
 * 家長決定維持 10 分鐘：練習頁的「複習到期單字」照這個時間表。
 * 戰役的「複習關」刻意不同——第 0 格馬上就算（見 models/WordProgress.js 的 weakWords），
 * 因為那是卡關時的出口，不能在他最需要的時候消失。
 */
const BOX_INTERVALS_MS = [10 * MINUTE, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY];
const MAX_BOX = BOX_INTERVALS_MS.length - 1;

function nextBoxLevel(currentBox, correct) {
  if (correct) return Math.min((currentBox || 0) + 1, MAX_BOX);
  return 0;
}

function nextReviewAt(boxLevel, now = new Date()) {
  return new Date(now.getTime() + BOX_INTERVALS_MS[boxLevel]);
}

module.exports = { nextBoxLevel, nextReviewAt, MAX_BOX };
