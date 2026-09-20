/**
 * 所有平衡數值集中在這一個檔案。
 *
 * 規矩：戰鬥相關的數字一律寫在這裡，不准散落在場景或 UI 程式碼裡。
 * 調一次平衡如果要翻十個檔案，實際上就不會有人去調。
 *
 * 這個檔案同時被瀏覽器與 Node（平衡模擬器）載入，所以不能碰 DOM 或 Phaser。
 */

export const BALANCE = {
  /* ── 時間基準 ─────────────────────────────────────────── */

  // 邏輯固定以 120Hz 前進，與畫面更新率脫鉤。
  // 固定時間步是重播、視覺回歸、模擬器三件事共同的前提。
  logicStepMs: 1000 / 120,

  // 一個影格最多補跑多少毫秒的邏輯。分頁切走再切回來時會累積大量時間，
  // 沒有上限就會一次跑上千步（死亡螺旋），畫面卡住甚至當掉。
  maxCatchUpMs: 250,

  /* ── 戰鬥基本數值 ─────────────────────────────────────── */

  maxHp: 3,

  /*
   * 敵人橫越畫面的時間 = baseMs + perLetterMs × 字母數。
   *
   * 時間跟著單字長度走，不是固定值。用固定值的話短字太鬆、長字必死，
   * 小孩會學到「看到長字就放棄」。以 account（7 字母）為例，
   * 三個難度分別是 11.0 / 6.7 / 4.0 秒。
   *
   * 這組數字不是憑感覺定的，是 scripts/sim.mjs 掃描 108 組候選值跑出來的
   * （每組 9 種手速×難度組合、每格 120 場）。原本三個難度共用 3000ms 的
   * baseMs，結果難度之間拉不開：快手速在三個難度都零失誤，因為光是那 3 秒
   * 就足夠聽完並開始打。讓 baseMs 也跟著難度縮短之後才分得開。
   *
   * 目前的失敗率（每格 200 場）：
   *   slow/easy 11.7%　medium/normal 20.0%　fast/hard 23.3%
   *   slow/hard 100%（明顯不相稱，這正是 1.6 難度校準要解決的）
   */
  difficulty: {
    easy: { baseMs: 3600, perLetterMs: 1050 },
    normal: { baseMs: 2400, perLetterMs: 620 },
    hard: { baseMs: 1300, perLetterMs: 380 }
  },
  defaultDifficulty: 'normal',

  // 打對一個字母把敵人推回去多少：該難度「一個字母份」的 15%。
  // 比例刻意壓低——擊退如果能完全抵銷逼近，時間限制就形同虛設，
  // 但完全沒有擊退又感覺不到「我打對了」。
  knockbackRatioPerLetter: 0.15,

  // 打錯一個字母，敵人前進相當於 1 秒的距離
  wrongLetterPenaltyMs: 1000,

  // 重聽的代價（敵人前進相當於幾毫秒的距離）
  listenCostMs: {
    replay: 1500,
    slow: 2500,
    sentence: 2000
  },

  /* ── 連擊 ─────────────────────────────────────────────── */

  // Phase 1 只累積與顯示，效果從 Phase 2 才實作
  combo: {
    dashAt: 5,
    sweetTimeAt: 10,
    frenzyAt: 15
  },

  /* ── 蜂蜜 ─────────────────────────────────────────────── */

  honey: {
    perCorrectLetter: 1,
    perKill: 5,
    longWordFrom: 7, // 幾個字母以上算長字
    longWordBonus: 5
  },

  /* ── 難度校準（1.6 使用） ─────────────────────────────── */

  calibration: {
    sampleWords: 3,
    // 平均每字母按鍵間隔（毫秒）落在哪一段，就建議哪個難度
    slowerThanMs: 700, // 比這個慢 → 建議 easy
    fasterThanMs: 350 // 比這個快 → 建議 hard
  }
};

/** 某個長度的單字，在某個難度下敵人要花多久橫越畫面。 */
export function crossMsFor(letterCount, difficulty = BALANCE.defaultDifficulty) {
  const d = BALANCE.difficulty[difficulty] || BALANCE.difficulty[BALANCE.defaultDifficulty];
  return d.baseMs + d.perLetterMs * letterCount;
}

/** 打對一個字母的擊退量（毫秒），與難度和字長無關地維持手感一致。 */
export function knockbackMsFor(difficulty = BALANCE.defaultDifficulty) {
  const d = BALANCE.difficulty[difficulty] || BALANCE.difficulty[BALANCE.defaultDifficulty];
  return d.perLetterMs * BALANCE.knockbackRatioPerLetter;
}
