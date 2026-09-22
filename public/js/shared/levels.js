/**
 * 等級與經驗值的規則。只有這一份。
 *
 * 跟 answer-match.js 一樣，瀏覽器與伺服器共用同一個檔案。理由也一樣：
 * 畫面上要即時看到經驗條在漲（不能等伺服器回來），但真正算數的是伺服器
 * 那一份。兩邊各寫一次遲早會不一致，而症狀是最難解釋的那種——
 * 打完看到「升到 7 級」，重新整理之後又變回 6 級。
 *
 * 這個檔案不可以碰 DOM、Phaser 或任何 Node 專有的東西。
 *
 * ── 設計出處 ──────────────────────────────────────────────
 * docs/campaign-design.md §6。其中最重要的一條是「第一次打對以前錯過的字」
 * 給 20 XP：一隻普通的蟲是 5 XP，一個上次打錯、這次打對的字是 25 XP，
 * 差五倍。這條讓「把不會的字學會」變成遊戲裡賺最快的行為。
 *
 * 他不需要懂這個設計，他只會發現「打那些字特別賺」，然後自己去打。
 */

/* ── 經驗值來源（§6） ───────────────────────────────────── */

export const XP = {
  perCorrectLetter: 1,
  perKill: 5,
  longWordFrom: 7, // 幾個字母以上算長字
  longWordBonus: 5,

  /*
   * ⭐ 第一次打對以前錯過的字。
   *
   * 「以前錯過」的判定在伺服器（wordProgress 有每個字的 lastResult 與
   * timesIncorrect），開打前隨著 /api/game/access 一起送下來，
   * 戰鬥中就能即時算、即時飄分。伺服器收到成績時會用自己那份名單重算一次。
   */
  relearnBonus: 20,

  // 打完整組。關卡表還沒做（C3），暫時用「字數」代替「關數」——見下面的註解
  perWordOnClear: 2,

  // 完美通關（一個字都沒漏、一個字母都沒打錯）
  perfectFactor: 1.5
};

/* ── 等級曲線 ───────────────────────────────────────────── */

/*
 * 升一級要多少經驗：base + step × (level - 1)。
 *
 * 用線性遞增而不是指數：指數曲線在後期會需要好幾場才升一級，而「升級」
 * 是這個系統唯一的正回饋。對一個小四生來說，十歲的耐心撐不過「打了三場
 * 還是 12 級」。線性的代價是後期升得太快，但那是 C3 關卡表要處理的問題
 * （後面的關給的經驗也會變多），不是曲線要處理的。
 *
 * 實際感受（用 Week 1 那種 40 字的組、全對大約 400 XP 估）：
 *   第一場打完大約 6 級，第二場到 9 級，第三場 11 級左右。
 *   驗收標準是「打三場看得到等級成長」，這個曲線滿足它。
 */
const XP_BASE = 60;
const XP_STEP = 25;

/** 從 level 升到 level+1 需要多少經驗。 */
export function xpToNextLevel(level) {
  const l = Math.max(1, Math.floor(level) || 1);
  return XP_BASE + XP_STEP * (l - 1);
}

/**
 * 累計經驗換算成等級與「這一級內的進度」。
 *
 * 回傳 { level, into, need }：into/need 就是經驗條要畫的東西。
 * 用迴圈而不是解二次方程式：等級不會大到讓迴圈變成問題（100 級也只是
 * 一百次加法），而迴圈跟 xpToNextLevel() 永遠不可能對不起來——
 * 封閉解一旦跟曲線走散，就是那種「差一點點」永遠查不出來的 bug。
 */
export function levelFromXp(totalXp) {
  let xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  let need = xpToNextLevel(level);
  while (xp >= need) {
    xp -= need;
    level += 1;
    need = xpToNextLevel(level);
    // 保險絲：資料壞掉時不要變成無窮迴圈
    if (level > 999) break;
  }
  return { level, into: xp, need };
}

/** 練到某一級總共需要累積多少經驗（等級的下限）。 */
export function xpForLevel(level) {
  let total = 0;
  for (let l = 1; l < Math.max(1, Math.floor(level) || 1); l += 1) {
    total += xpToNextLevel(l);
  }
  return total;
}

/* ── 等級給什麼（§6「等級給什麼」） ─────────────────────── */

/*
 * ⚠️ 這裡的血量加成跟 campaign-design.md §6 寫的不一樣，是刻意的。
 *
 * §6 原本寫「每 5 級 +1 血，上限 +4」。我用模擬器（20 字一場、每格 200 場）
 * 量過之後發現那會直接把遊戲的挑戰性做掉：
 *
 *   Lv11（大約打三場之後）的失敗率
 *     +1 血、擊退 x1.20 ……… med/normal 1.5%、fast/hard 2.0%
 *     +0 血、擊退 x1.20 ……… med/normal 11.5%、fast/hard 10.0%
 *     Lv1 基準           ……… med/normal 13.5%、fast/hard 15.0%
 *
 * 也就是說：**擊退加成是溫和的，血量加成才是把難度抹平的那一個。**
 * 多一條命等於多一次「完全打不出來」的機會，而那正是唯一的失敗條件。
 *
 * §6 的數字本來是搭配 C3 的 100 關關卡表設計的——後面的關會更難，
 * 所以力量成長有東西去抵銷。但 C3 還沒做，現在放進去就是單純把遊戲變簡單，
 * 而他本來就已經嫌太簡單了（一次就過關）。
 *
 * 所以：擊退照 §6 的 +2%/級 不動（它本來就是「容錯」而不是「答案」，
 * 而且量出來的曲線很漂亮：Lv1 13.5% → Lv11 11.5% → Lv21 7.5% → Lv31 5.0%），
 * 血量延後到 20 級才給第一點、上限 +2。等 C3 的關卡表進來再回頭調。
 */
const HP_FIRST_AT = 20;
const HP_EVERY = 10;
const HP_MAX_BONUS = 2;

/* 每一級擊退 +2%。這是「力量買的是容錯，不是答案」的具體實作（§1）：
   打字的次數一個都沒少，只是每一下把蟲推得遠一點。 */
const KNOCKBACK_PER_LEVEL = 0.02;

export function levelRewards(level) {
  const l = Math.max(1, Math.floor(level) || 1);
  const hpSteps = l < HP_FIRST_AT ? 0 : 1 + Math.floor((l - HP_FIRST_AT) / HP_EVERY);
  return {
    bonusHp: Math.min(HP_MAX_BONUS, hpSteps),
    // 1 級是 1.0（完全等於 C2 之前的平衡），之後每級 +2%
    knockbackFactor: 1 + KNOCKBACK_PER_LEVEL * (l - 1),
    // 下一點血在幾級——HUD 與結算要講得出「再練到幾級會多一條命」
    nextHpAt: hpSteps >= HP_MAX_BONUS ? null : l < HP_FIRST_AT ? HP_FIRST_AT : HP_FIRST_AT + hpSteps * HP_EVERY
  };
}

/* ── 一場打完拿多少經驗 ─────────────────────────────────── */

/**
 * 從一場戰鬥的統計算出經驗值。
 *
 * 前端在戰鬥中就是照這個公式即時累加的（見 core/battle.js），
 * 伺服器收到成績後用同一個函式重算一次。參數刻意只收「伺服器驗得到的
 * 東西」——字母數、擊殺數、長字數、重學數——不收前端算好的總分。
 *
 * @param {object} s
 * @param {number} s.correctLetters 打對幾個字母
 * @param {number} s.kills          打掉幾隻
 * @param {number} s.longKills      其中幾隻是長字
 * @param {number} s.relearns       幾個是「以前錯過、這次打對」的字
 * @param {number} s.wordCount      這一組總共幾個字
 * @param {boolean} s.won           有沒有打完整組
 * @param {boolean} s.perfect       零失誤（沒漏字、沒打錯字母）
 */
export function xpForBattle(s = {}) {
  const correctLetters = Math.max(0, Number(s.correctLetters) || 0);
  const kills = Math.max(0, Number(s.kills) || 0);
  const longKills = Math.max(0, Math.min(kills, Number(s.longKills) || 0));
  const relearns = Math.max(0, Math.min(kills, Number(s.relearns) || 0));
  const wordCount = Math.max(0, Number(s.wordCount) || 0);

  let xp =
    correctLetters * XP.perCorrectLetter +
    kills * XP.perKill +
    longKills * XP.longWordBonus +
    relearns * XP.relearnBonus;

  /*
   * 完成獎勵。
   *
   * §6 寫的是「關數 × 2」，但關卡表要等 C3 才有。在那之前用「字數 × 2」：
   * 同樣有「內容越多給越多」的性質，而且不會憑空生出一個假的關數——
   * 等 C3 的關卡表進來，這一行換成關數即可，其他都不用動。
   */
  if (s.won) xp += wordCount * XP.perWordOnClear;

  // 完美通關的倍率套在全部經驗上，而且只有真的打完才算
  if (s.won && s.perfect) xp = Math.round(xp * XP.perfectFactor);

  return Math.max(0, Math.round(xp));
}
