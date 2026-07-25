const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 簡化版 5-box Leitner：答對進到下一格，答錯回到第 0 格立即複習
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
