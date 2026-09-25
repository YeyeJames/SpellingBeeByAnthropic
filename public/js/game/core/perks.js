/**
 * 三選一的臨時能力（C8）。只在這一場有效，打完就沒了。
 *
 * 設計出處：docs/campaign-design.md 方案 C 與 §8，能力清單的來源是
 * docs/game-design.md §5。
 *
 * ── 跟裝備分工 ─────────────────────────────────────────────
 * 永久成長（等級、裝備）負責把難度曲線拉平，單場成長負責「這一場跟上一場
 * 不一樣」，**兩者不疊加同一個旋鈕**（§8）。裝備已經管了擊退、打錯的代價、
 * 血量、二次機會、連擊門檻、重聽、長字——所以這裡一張都不碰那些數字，
 * 全部是「改變規則」的效果。原本 15 張裡有 5 張已經做成商店飾品了
 * （回音水晶、玻璃蜂針、蜜糖節奏、二次機會、長字獵手），這裡不再重複。
 *
 * ── 三條鐵律 ───────────────────────────────────────────────
 * 1. **不可以減少要聽、要打的次數**（§1）。沒有任何一張會跳過字母或字。
 * 2. **不可以動經驗值。** 經驗是前端與伺服器各算一次、要一分不差的；
 *    能力如果改到經驗，伺服器就得知道他選了什麼，防作弊的那條線就破了。
 *    能力只動戰鬥手感與蜂蜜（蜂蜜本來就是前端回報、伺服器夾上限）。
 * 3. **不可以影響精熟度紀錄。** 幸運草讓連擊不歸零，但「這個字打錯過」
 *    照樣算打錯——那是學習紀錄，不是遊戲數值。
 *
 * ── 往速度的方向 ───────────────────────────────────────────
 * 家長實際觀察：兩兄弟「不會拼」的比例非常小，第二、三次就記住了。
 * 所以挑戰應該來自速度，順便練英打。閃電手與加速挑戰就是為這個而設的：
 * 一張獎勵打得快，一張讓他主動選擇「更快、但更賺」。
 */

export const PERKS = {
  lightning: {
    icon: '⚡',
    name: '閃電手',
    rule: '一個字打得夠快，這個字的蜂蜜 ×3'
  },
  rush: {
    icon: '🔥',
    name: '加速挑戰',
    rule: '蟲變快 25%，但蜂蜜 ×2',
    risk: true
  },
  firstStrike: {
    icon: '🎯',
    name: '首字重擊',
    rule: '每個字第一個字母打對，蟲直接退回一半'
  },
  rewind: {
    icon: '⏪',
    name: '倒帶',
    rule: '蟲第一次快到蜂巢時，自動彈回去'
  },
  freeze: {
    icon: '❄️',
    name: '冰凍針',
    rule: '一個字沒打錯就打完，下一隻蟲凍住 1 秒'
  },
  clover: {
    icon: '🍀',
    name: '幸運草',
    rule: '打錯的時候，連擊只掉一半、不會歸零'
  }
};

export const PERK_IDS = Object.keys(PERKS);
/* 事件只能帶數字，所以每一張有一個固定的代號。只能往後加，不能改順序——舊錄影檔靠它 */
export const PERK_CODE = Object.fromEntries(PERK_IDS.map((id, i) => [id, i + 1]));
export const PERK_BY_CODE = Object.fromEntries(PERK_IDS.map((id, i) => [i + 1, id]));

/*
 * 第幾隻蟲打掉之後給一次三選一。
 *
 * 原設計是「每 5 隻一次」，但一關 40 字會被打斷 8 次，太碎了；
 * game-design.md 說的是「每場約拿到 4～5 個」。所以最多 4 次，
 * 而且越後面間隔越長——開場很快就拿到第一張，那一下的新鮮感最重要。
 */
export const PERK_OFFER_AT = [5, 12, 19, 26];

/* 閃電手：「夠快」= 1.2 秒（聽的時間）+ 每個字母 0.45 秒 */
export const LIGHTNING = { baseMs: 1200, perLetterMs: 450, honeyFactor: 3 };
/* 加速挑戰：蟲的速度 ×1.25，蜂蜜 ×2 */
export const RUSH = { speedFactor: 1.25, honeyFactor: 2 };
/* 首字重擊：第一個字母打對，蟲的進度剩一半 */
export const FIRST_STRIKE_KEEP = 0.5;
/* 倒帶：蟲走到 85% 時彈回 40%，一場一次 */
export const REWIND = { triggerAt: 0.85, backTo: 0.4 };
/* 冰凍針：下一隻蟲凍住多久 */
export const FREEZE_MS = 1000;

/**
 * 抽三張（沒拿過的），用這一場專用的亂數。
 *
 * 專用亂數而不是主亂數：抽卡如果用主亂數，開了三選一之後整場的亂數序列
 * 都會跟著位移，同一顆種子在「有沒有三選一」兩種情況下會打出完全不同的一場，
 * 錄影檔與模擬器的比對就沒有意義了。
 */
export function drawOffer(rng, taken) {
  const pool = PERK_IDS.filter((id) => !taken.includes(id));
  const out = [];
  while (out.length < 3 && pool.length) {
    const i = rng.int(pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
