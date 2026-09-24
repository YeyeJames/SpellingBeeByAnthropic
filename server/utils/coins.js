/**
 * 練習模式答對一題給幾個金幣。
 *
 * ── 連勝加成為什麼要有上限 ──────────────────────────────────
 * 本來沒有上限，而 `stats.currentStreak` 是**跨場次累積**的（只有答錯才歸零，
 * 練習結束不會重置）。兩件事加起來就變成：金幣每一場都比上一場多，而且永遠
 * 不會停。
 *
 *   第 1 輪 30 字全對 →   705 金幣（每字 24）
 *   第 4 輪 30 字全對 → 3,405 金幣（每字 114）
 *   第 8 輪 30 字全對 → 7,005 金幣（每字 234）
 *
 * 而整間店六樣東西加起來 660 金幣——第一輪還沒練完就全部買得起了。
 *
 * 這是他自己講出來的：「商店東西可以調高單價，賺錢太快了」。
 * 他說得對，但真正的原因不是單價，是這個加成沒有天花板。只調單價的話，
 * 過幾輪又會被指數追上，然後再調一次——那是修不完的。
 *
 * ── 為什麼只封頂「獎金」，不封頂「連勝」 ──────────────────
 * 連勝本身是他在乎的數字（檔案頁有最佳連勝紀錄），砍掉會把他的成績也砍掉。
 * 所以連勝照樣一直往上累積，只有換成金幣的那一段到了上限就停。
 */

const BASE_COINS = 10;
const STREAK_BONUS_STEP = 5;
const STREAK_BONUS_EVERY = 5;

/*
 * 加成到連勝 20 就停：最多每題 10 + 20 = 30 金幣。
 *
 * 選 20 的理由是它剛好在一輪之內達得到（一組 25～40 字），所以他練完一輪
 * 就摸得到天花板，不必先累積好幾天；但前 20 題的爬升又夠明顯，
 * 「連續答對有好處」這件事還是感覺得到。
 */
const STREAK_BONUS_CAP_AT = 20;
const MAX_STREAK_BONUS =
  Math.floor(STREAK_BONUS_CAP_AT / STREAK_BONUS_EVERY) * STREAK_BONUS_STEP;

function calcCoinsForCorrectAnswer(streakAfterThisAnswer) {
  const bonus = Math.floor(streakAfterThisAnswer / STREAK_BONUS_EVERY) * STREAK_BONUS_STEP;
  return BASE_COINS + Math.min(bonus, MAX_STREAK_BONUS);
}

module.exports = {
  calcCoinsForCorrectAnswer,
  BASE_COINS,
  STREAK_BONUS_CAP_AT,
  MAX_STREAK_BONUS
};
