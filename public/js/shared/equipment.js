/**
 * 裝備。規則只有這一份，瀏覽器與伺服器共用（跟 levels.js、answer-match.js 一樣）。
 *
 * 設計出處：docs/campaign-design.md §7，而 §1 是它必須遵守的鐵律：
 *
 *   **力量買的是容錯，不是答案。**
 *   敵人的血量永遠等於單字的字母數，任何裝備都不會改變它。
 *
 * 所以下面每一件裝備動到的都是「同樣的字更好打」——擊退遠一點、打錯沒那麼
 * 痛、重聽便宜一點——沒有任何一件會讓他少打一個字母。攻擊力如果改成
 * 「每擊傷害更高」，他就能在完全不會拼 necessary 的情況下打贏它，
 * 那等於花錢買「不用學」。
 *
 * ── 幣別 ──────────────────────────────────────────────────
 * 裝備用**蜂蜜**買，不是金幣。兩種幣各自對應一種模式：
 *   🪙 金幣：練習模式賺的，買造型（主題、配件、小遊戲）
 *   🍯 蜂蜜：遊戲模式賺的，買裝備
 * 這樣兩邊都有意義，而且遊戲裡那個一直在跳的蜂蜜數字終於有了去處——
 * 在這之前它只是一場的分數，打完就沒了。
 *
 * ── 等級門檻 ──────────────────────────────────────────────
 * §6 寫的「每 10 / 20 / 30 級解鎖商店新一階的裝備」在這裡實作。
 * 這不只是節奏控制，是必要的：模擬器量過，全套頂裝的失敗率是 0%
 * （見 §7 下面那張表）。門檻讓力量跟著時間長出來，而不是一次買齊。
 */

/* 三個欄位，每個欄位同時只能裝一件 */
export const SLOTS = ['weapon', 'armor', 'trinket'];

export const SLOT_LABELS = {
  weapon: '武器（蜂針）',
  armor: '護甲（蜂蠟）',
  trinket: '飾品'
};

/*
 * 裝備表。
 *
 * effect 裡的欄位就是戰鬥核心認得的那幾個旋鈕，全部是 balance.js 已經有的
 * 東西（§1 特別點名這件事：不需要新的戰鬥數學）。
 *
 * minLevel 是解鎖等級。tier 1 是初始裝備，不用買也不用解鎖。
 */
export const GEAR = [
  /* ── 武器（蜂針）：擊退 ─────────────────────────────── */
  {
    key: 'weapon_wood',
    slot: 'weapon',
    tier: 1,
    name: '木蜂針',
    description: '一開始就有的蜂針。',
    cost: 0,
    minLevel: 1,
    effect: { knockback: 1 }
  },
  {
    key: 'weapon_iron',
    slot: 'weapon',
    tier: 2,
    name: '鐵蜂針',
    description: '打對一個字母，把蟲推得更遠（擊退 +25%）。',
    cost: 300,
    minLevel: 10,
    effect: { knockback: 1.25 }
  },
  {
    key: 'weapon_wax',
    slot: 'weapon',
    tier: 3,
    name: '蜂蠟複合針',
    description: '擊退 +50%。',
    cost: 900,
    minLevel: 20,
    effect: { knockback: 1.5 }
  },
  {
    key: 'weapon_queen',
    slot: 'weapon',
    tier: 4,
    name: '女王之刺',
    description: '擊退 +80%，連擊中再 +20%。',
    cost: 2500,
    minLevel: 30,
    // comboKnockback 是「連擊 >= 2 時額外再乘」，見 battle.js
    effect: { knockback: 1.8, comboKnockback: 1.2 }
  },

  /* ── 護甲（蜂蠟）：打錯的代價 ───────────────────────── */
  {
    key: 'armor_thin',
    slot: 'armor',
    tier: 1,
    name: '薄蠟衣',
    description: '一開始就有的蠟衣。',
    cost: 0,
    minLevel: 1,
    effect: { penalty: 1 }
  },
  {
    key: 'armor_thick',
    slot: 'armor',
    tier: 2,
    name: '厚蠟甲',
    description: '打錯的時候蟲前進得比較少（懲罰 −20%）。',
    cost: 300,
    minLevel: 10,
    effect: { penalty: 0.8 }
  },
  {
    key: 'armor_hive',
    slot: 'armor',
    tier: 3,
    name: '蜂巢裝甲',
    description: '打錯懲罰 −35%，而且多一顆血。',
    cost: 900,
    minLevel: 20,
    effect: { penalty: 0.65, bonusHp: 1 }
  },
  {
    key: 'armor_royal',
    slot: 'armor',
    tier: 4,
    name: '王室鎧',
    description: '打錯懲罰 −50%（上限），而且多一顆血。',
    cost: 2500,
    minLevel: 30,
    /*
     * §7 原案這裡是「血量 +2」，改成 +1。
     *
     * 理由跟 levels.js 裡那段一樣，而且這次更嚴重：等級到 30 級已經給了
     * +2，護甲再給 +2 就是 3+2+2 = 7 顆血。模擬器量過，光是「+2 血」
     * 這一項就能把失敗率從 17.5% 壓到 2.5%，再加上頂級武器是 0.0%。
     *
     * 血量是這個遊戲唯一的失敗條件，多一顆就是多一次「完全不會拼」的機會。
     * 減傷 50% 已經是 §1 明訂的上限、也是這件裝備的主賣點，血量不需要疊。
     */
    effect: { penalty: 0.5, bonusHp: 1 }
  },

  /* ── 飾品：特殊規則（同時只能戴一個） ───────────────── */
  /*
   * 飾品刻意比武器護甲便宜。
   *
   * §7 的註解講得很清楚：第一個飾品帶來的「原來還可以這樣玩」比 +25% 擊退
   * 有感得多，所以要讓他很早就買得起一個。門檻也放在 10 級（跟 tier 2 同時）。
   */
  {
    key: 'trinket_echo',
    slot: 'trinket',
    tier: 2,
    name: '回音水晶',
    description: '再聽一次的代價減半，敢多聽一次了。',
    cost: 500,
    minLevel: 10,
    effect: { listen: 0.5 }
  },
  {
    key: 'trinket_glass',
    slot: 'trinket',
    tier: 2,
    name: '🔥 玻璃蜂針',
    description: '擊退變兩倍，但你只有一顆血。高風險高回報。',
    cost: 600,
    minLevel: 10,
    // hpOverride 蓋掉所有血量加成，包含等級與護甲給的
    effect: { knockback: 2, hpOverride: 1 }
  },
  {
    key: 'trinket_rhythm',
    slot: 'trinket',
    tier: 3,
    name: '蜜糖節奏',
    description: '連擊門檻從 5 / 10 / 15 降成 4 / 8 / 12。',
    cost: 800,
    minLevel: 20,
    effect: { comboAt: [4, 8, 12] }
  },
  {
    key: 'trinket_secondchance',
    slot: 'trinket',
    tier: 3,
    name: '二次機會',
    description: '每一場第一次漏掉字不會扣血。',
    cost: 800,
    minLevel: 20,
    effect: { freeMisses: 1 }
  },
  {
    key: 'trinket_hunter',
    slot: 'trinket',
    tier: 4,
    name: '長字獵手',
    description: '7 個字母以上的長字，蜂蜜與經驗都加倍。',
    cost: 1200,
    minLevel: 30,
    effect: { longWordFactor: 2 }
  }
];

const BY_KEY = new Map(GEAR.map((g) => [g.key, g]));

export function gearByKey(key) {
  return BY_KEY.get(key) || null;
}

/** 每個欄位的初始裝備（tier 1）。不用買、不會被賣掉。 */
export const DEFAULT_EQUIPPED = {
  weapon: 'weapon_wood',
  armor: 'armor_thin',
  trinket: null
};

export function isStarterGear(key) {
  const g = gearByKey(key);
  return !!g && g.tier === 1;
}

/**
 * 戰鬥核心認得的那一組數字。
 *
 * 把「裝了哪幾件」換算成一組純數字，戰鬥迴圈就只看到這幾個值，
 * 完全不需要知道裝備是什麼——跟等級加成同一個做法。
 *
 * @param {object} equipped { weapon, armor, trinket }，值是 key 或 null
 */
export function effectsFor(equipped = {}) {
  const out = {
    knockback: 1,
    comboKnockback: 1,
    penalty: 1,
    bonusHp: 0,
    hpOverride: null,
    listen: 1,
    comboAt: null,
    freeMisses: 0,
    longWordFactor: 1
  };

  for (const slot of SLOTS) {
    const g = gearByKey(equipped[slot]);
    if (!g) continue;
    const e = g.effect || {};
    // 倍率相乘（兩件都給擊退加成時要疊起來），加成相加
    if (e.knockback) out.knockback *= e.knockback;
    if (e.comboKnockback) out.comboKnockback *= e.comboKnockback;
    if (e.penalty != null) out.penalty *= e.penalty;
    if (e.listen != null) out.listen *= e.listen;
    if (e.bonusHp) out.bonusHp += e.bonusHp;
    if (e.freeMisses) out.freeMisses += e.freeMisses;
    if (e.longWordFactor) out.longWordFactor *= e.longWordFactor;
    if (e.comboAt) out.comboAt = e.comboAt.slice();
    if (e.hpOverride != null) out.hpOverride = e.hpOverride;
  }

  /*
   * 減傷上限 50%（§1 明訂）。
   *
   * 打錯的懲罰如果能被裝備降到接近零，「小心打」就沒有意義了，
   * 他會養成亂按的習慣——而亂按正是拼字最不該養成的習慣。
   */
  if (out.penalty < 0.5) out.penalty = 0.5;

  return out;
}

/**
 * 這件裝備現在買不買得起、解不解得開。
 * 伺服器與商店畫面用同一個判斷，不會出現「畫面說能買、按下去說不行」。
 */
export function gearAvailability(g, { level = 1, honey = 0, owned = [] } = {}) {
  const ownedSet = owned instanceof Set ? owned : new Set(owned);
  const isOwned = ownedSet.has(g.key) || g.tier === 1;
  return {
    owned: isOwned,
    unlocked: level >= g.minLevel,
    affordable: honey >= g.cost,
    levelNeeded: g.minLevel,
    canBuy: !isOwned && level >= g.minLevel && honey >= g.cost
  };
}
