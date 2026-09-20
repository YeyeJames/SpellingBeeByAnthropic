/**
 * 難度校準。
 *
 * 模擬跑出來的結果很清楚：難度選錯的代價是災難性的。
 * 同一個孩子在 easy 是 10% 失敗率，在 hard 就是 100%——不是「比較難」，是完全不能玩。
 * 所以不能讓他自己猜，也不能預設丟他 normal 就開始。
 *
 * 作法是先用三個他一定會拼的短字量實際手速。這一段刻意不是聽寫：
 * 單字直接顯示在畫面上，因為這裡要量的是「打字有多快」，
 * 不是「聽不聽得懂」——把兩件事混在一起就什麼都量不準。
 *
 * 純計算放在 core/，才能在 Node 裡直接測。
 */

import { BALANCE } from './balance.js';

/** 校準用的字：短、常見、小學生一定拼得出來。 */
export const CALIBRATION_WORDS = ['cat', 'sun', 'book'];

/** 至少要這麼多筆間隔才算數，否則不敢下結論。 */
const MIN_SAMPLES = 4;

/**
 * 從每個字的按鍵時間戳算出「字母之間的間隔」。
 *
 * @param wordKeyTimes 二維陣列：每個字一列，列裡是每個按鍵的 performance.now()
 *
 * 每個字的第一次按鍵不算——那一段包含讀字與反應，不是打字速度。
 */
export function computeIntervals(wordKeyTimes) {
  const intervals = [];
  for (const times of wordKeyTimes) {
    for (let i = 1; i < times.length; i += 1) {
      const d = times[i] - times[i - 1];
      // 明顯不合理的值直接丟掉：連擊般的 20ms 或發呆十秒都不是他的常態手速
      if (d >= 30 && d <= 5000) intervals.push(d);
    }
  }
  return intervals;
}

function median(nums) {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * 依實測手速建議難度。
 *
 * 用中位數而不是平均：小孩中間卡住一次、或某個字母特別難找，
 * 平均會被一筆極端值拉走，中位數不會。
 */
export function suggestDifficulty(intervals) {
  const { slowerThanMs, fasterThanMs } = BALANCE.calibration;
  const medianMs = median(intervals);

  if (intervals.length < MIN_SAMPLES || medianMs === 0) {
    // 樣本不夠就不要亂猜，給預設值並標明沒把握
    return { medianMs, difficulty: BALANCE.defaultDifficulty, confident: false, samples: intervals.length };
  }

  let difficulty;
  if (medianMs > slowerThanMs) difficulty = 'easy';
  else if (medianMs < fasterThanMs) difficulty = 'hard';
  else difficulty = 'normal';

  return { medianMs, difficulty, confident: true, samples: intervals.length };
}

/** 給畫面用的說明文字。 */
export function describeSuggestion(result) {
  const cps = result.medianMs > 0 ? (1000 / result.medianMs).toFixed(1) : '—';
  const label = { easy: '輕鬆', normal: '標準', hard: '挑戰' }[result.difficulty] || result.difficulty;
  if (!result.confident) {
    return { label, detail: '沒量到足夠的資料，先給你標準難度，隨時可以改。' };
  }
  return {
    label,
    detail: `你的手速大約每秒 ${cps} 個字母（每個字母 ${Math.round(result.medianMs)} 毫秒）。`
  };
}
