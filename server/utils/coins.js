const BASE_COINS = 10;
const STREAK_BONUS_STEP = 5;
const STREAK_BONUS_EVERY = 5;

function calcCoinsForCorrectAnswer(streakAfterThisAnswer) {
  return BASE_COINS + Math.floor(streakAfterThisAnswer / STREAK_BONUS_EVERY) * STREAK_BONUS_STEP;
}

module.exports = { calcCoinsForCorrectAnswer };
