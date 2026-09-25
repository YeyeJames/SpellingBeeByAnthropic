/**
 * 練習答對一題給幾個金幣——前端與伺服器共用的那一份。
 *
 * ── 為什麼要共用 ───────────────────────────────────────────
 * 練習頁為了讓畫面立刻有反應，會先照公式把金幣加上去，伺服器回來再校正。
 * 兩邊的公式只要差一點，校正時金幣就會「變少」——孩子回報過的
 * 「本來 700 多，又變成 680」就是這一類問題。
 *
 * 伺服器那份（server/utils/coins.js）加了連勝獎金上限之後，練習頁自己那份
 * 沒有跟著改：連勝超過 20 題時畫面多給、伺服器少給，一校正就倒退。
 * 所以練習頁改用這一份，economy-test 驗證它跟伺服器那份逐題一致。
 */

export const BASE_COINS = 10;
export const STREAK_BONUS_STEP = 5;
export const STREAK_BONUS_EVERY = 5;
export const STREAK_BONUS_CAP_AT = 20;
const MAX_STREAK_BONUS = Math.floor(STREAK_BONUS_CAP_AT / STREAK_BONUS_EVERY) * STREAK_BONUS_STEP;

export function coinsForCorrectAnswer(streakAfterThisAnswer) {
  const bonus = Math.floor(streakAfterThisAnswer / STREAK_BONUS_EVERY) * STREAK_BONUS_STEP;
  return BASE_COINS + Math.min(bonus, MAX_STREAK_BONUS);
}
