/**
 * 打擊音的音階。
 *
 * 放在 core/ 而不是跟音效實作綁在一起，因為這是純計算，而且它承載了
 * 一個設計主張，值得被測試釘住：
 *
 *   打完 7 個字母是一段完整的上行音階，第 8 個字母正好回到高八度。
 *
 * 小孩因此會用耳朵記住一個單字有多長——這是遊戲性與學習性真正接在一起的
 * 地方，不是裝飾。所以它有單元測試，不能被人不小心改掉。
 */

/** 大調音階的半音位置，七個音一循環。 */
export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

/** C4。選中音域是因為它在小喇叭與筆電喇叭上都聽得清楚。 */
export const BASE_FREQ = 261.63;

/** Combo 愈高整段愈往上移調，聽起來愈亢奮。 */
export const COMBO_SHIFTS = [
  { at: 15, semitones: 7 },
  { at: 10, semitones: 4 },
  { at: 5, semitones: 2 }
];

/** 第 i 個字母（從 0 起算）對應的半音數。 */
export function semitoneForIndex(i) {
  const n = Math.max(0, Math.floor(i));
  return MAJOR_STEPS[n % 7] + 12 * Math.floor(n / 7);
}

/** Combo 目前該移調幾個半音。 */
export function comboShift(combo) {
  for (const s of COMBO_SHIFTS) {
    if (combo >= s.at) return s.semitones;
  }
  return 0;
}

/** 半音數換算成頻率。 */
export function freqFor(semitones) {
  return BASE_FREQ * Math.pow(2, semitones / 12);
}
