/**
 * 戰鬥核心邏輯——完全不碰 Phaser、不碰 DOM、不看真實時間。
 *
 * 這個檔案是整個遊戲唯一的「規則來源」，而且是純的：
 *   - 同樣的種子 + 同樣的輸入序列 → 必然得到同樣的結果
 *   - 可以在 Node 裡直接跑，所以平衡模擬器能幾秒鐘跑一萬場
 *   - 邏輯的 bug 不會跟畫面的 bug 糾在一起
 *
 * 渲染端（battle-scene.js）只做兩件事：把 state 畫出來、把事件演成聲光。
 * 它絕對不可以反過來改 state。
 */

import { BALANCE, crossMsFor, knockbackMsFor } from './balance.js';
import { createRng, shuffleInPlace } from './rng.js';
import { isTypeableChar, isSeparator } from './charset.js';
import { XP, levelFromXp, levelRewards } from '../../shared/levels.js';
import { effectsFor } from '../../shared/equipment.js';
import { TRAITS, traitFor, ARMOR_LETTERS, DASH_EVERY_MS, DASH_PUSH_MS } from './enemy-trait.js';
import {
  PERK_CODE, PERK_OFFER_AT, LIGHTNING, RUSH, FIRST_STRIKE_KEEP, REWIND, FREEZE_MS, drawOffer
} from './perks.js';

/* 事件類型。用數字而不是字串，是為了讓事件緩衝區可以完全不配置記憶體。 */
export const EV = {
  WORD_START: 1,
  LETTER_OK: 2,
  LETTER_BAD: 3,
  BACKSPACE: 4,
  WORD_KILLED: 5,
  WORD_MISSED: 6,
  HP_LOST: 7,
  COMBO_UP: 8,
  COMBO_RESET: 9,
  LISTEN: 10,
  BATTLE_END: 11,
  /* Combo 里程碑：a = 第幾階（1 衝刺 / 2 蜜糖 / 3 狂蜂） */
  COMBO_BONUS: 12,
  /*
   * 升級。a = 新的等級。
   *
   * 等級在戰鬥中就會漲：打完一整場才顯示的話，中間那二十分鐘完全沒有
   * 進度感，而進度感正是 C2 要補的東西。伺服器收到成績後會用同一條公式
   * 重算一次，以它為準。
   */
  LEVEL_UP: 13,
  /*
   * 以前錯過、這次打對的字。a = wordIndex，b = 給了多少經驗。
   *
   * 這是 §6 的重點：一隻普通的蟲 5 XP，一個重學回來的字 25 XP。
   * 事件獨立一個型別，畫面才演得出「這一隻特別值錢」。
   */
  RELEARNED: 14,
  /*
   * 特殊敵人第一次出現（C6）。a = 特性代號（見 enemy-trait.js）。
   * 畫面收到就停半秒、放大牠、標出名字與一句話規則——§5 特別要求的，
   * 成本很低效果很大：他不用讀說明書就知道這隻不一樣。
   */
  TRAIT_INTRO: 15,
  /** 護甲碎了。a = wordIndex */
  ARMOR_BROKE: 16,
  /** 衝刺蟲往前衝了一段。a = 前進了幾毫秒的距離 */
  ENEMY_DASH: 17,
  /*
   * 經驗倍率（C4 複習關 ×3）在結算時一次補進去。a = 補了多少。
   * 戰鬥中照 1 倍即時算、最後才乘——跟伺服器 xpForBattle() 同一個順序，
   * 兩邊才會一分不差。
   */
  XP_BONUS: 18,
  /* 三選一（C8）。OFFER：a = 張數；TAKEN：a = 能力代號；FIRED：a = 代號，b = 數值 */
  PERK_OFFER: 19,
  PERK_TAKEN: 20,
  PERK_FIRED: 21
};

export const EV_NAME = Object.fromEntries(Object.entries(EV).map(([k, v]) => [v, k]));

/* 聽力動作代號，給 LISTEN 事件的參數用 */
export const LISTEN_KIND = { REPLAY: 1, SLOW: 2, SENTENCE: 3 };

/* 事件只能帶數字，所以特性也要有代號 */
export const TRAIT_CODE = {
  [TRAITS.ARMORED]: 1,
  [TRAITS.DASHER]: 2,
  [TRAITS.SILENT]: 3
};
export const TRAIT_BY_CODE = { 1: TRAITS.ARMORED, 2: TRAITS.DASHER, 3: TRAITS.SILENT };

/*
 * 事件緩衝區大小。
 *
 * 每個邏輯步產生的事件不會多（正常一步 0~2 個），64 是很寬鬆的上限。
 * 用固定大小的物件池而不是每次 push 新物件，是為了「戰鬥中不新建任何物件」——
 * 持續配置會讓 GC 在隨機的時間點介入，造成偶發掉格，
 * 那種 bug 玩的人只會說「有時候怪怪的」，最難查。
 */
const EVENT_CAPACITY = 64;

function createEventPool() {
  const pool = new Array(EVENT_CAPACITY);
  for (let i = 0; i < EVENT_CAPACITY; i += 1) pool[i] = { type: 0, a: 0, b: 0, c: 0 };
  return pool;
}

/*
 * 第三個欄位 c 是給「這件事實際加了多少蜂蜜」用的。
 *
 * 畫面要飄出 +1 / +2（狂蜂狀態加倍），而那個倍率只有這裡知道。讓渲染端
 * 自己照 BALANCE 算一次的話，狂蜂剛好在這一步結束時就會算錯——
 * 畫面上飄 +1、實際加了 +2，而那種錯沒有人會發現，只會讓分數看起來很怪。
 * 事件直接把數字帶出去最省事，也不可能對不起來。
 */
function emit(state, type, a = 0, b = 0, c = 0) {
  if (state.evCount >= EVENT_CAPACITY) return; // 滿了就丟棄，寧可少演出也不要配置記憶體
  const e = state.ev[state.evCount];
  e.type = type;
  e.a = a;
  e.b = b;
  e.c = c;
  state.evCount += 1;
}

/**
 * 建立一場戰鬥。
 *
 * @param {object[]} words  每個元素至少要有 { id, english }
 * @param {number}   seed   亂數種子；同一個種子必然重現同一場
 * @param {string}   order  'sequential' 照順序，'random' 洗牌
 */
export function createBattle({
  words,
  seed = 1,
  difficulty = BALANCE.defaultDifficulty,
  order = 'sequential',
  maxHp = BALANCE.maxHp,
  /*
   * 開打時的等級與累計經驗。
   *
   * 等級會改變戰鬥本身（擊退倍率、血量上限），所以它必須是「開場設定」的
   * 一部分、而且要進錄影檔——不進的話，同一份錄影在他升級之後重播就會
   * 跑出不一樣的結果，確定性與「剛剛怪怪的」那顆按鈕同時失效。
   *
   * 預設 1 級 = 擊退 1.0 倍、沒有額外血量，跟 C2 之前完全一樣，
   * 所以舊的錄影檔重播出來的指紋不會變。
   */
  level = 1,
  xp = 0,
  /*
   * 以前錯過的字（wordId 的集合）。打對這些字給 relearnBonus 經驗。
   *
   * 名單由伺服器在開打前給（它才知道 wordProgress），前端只負責照著算，
   * 這樣戰鬥中就能即時飄分。伺服器收到成績時會用自己那份名單重算。
   */
  relearnIds = null,
  /*
   * 裝備。{ weapon, armor, trinket }，值是 key 或 null。
   *
   * 跟等級一樣會改變戰鬥，所以它也是「開場設定」的一部分、也要進錄影檔。
   * 不給就是全裸（初始木蜂針＋薄蠟衣），效果全部是 1 倍，
   * 也就是 C5 之前的行為——舊錄影檔的指紋因此不會變。
   */
  equipped = null,
  /*
   * 這一關會出現哪些特殊敵人（C6）。空陣列 = 全部都是普通的，
   * 也就是 C6 之前的行為，所以舊錄影檔重播出來的指紋不會變。
   */
  enemyTraits = null,
  /*
   * 這一場的經驗倍率（C4）。複習關 ×3，其他都是 1。
   * 跟裝備一樣是開場設定、要進錄影檔；不給就是 1，舊錄影檔的指紋不會變。
   */
  xpFactor = 1,
  /*
   * 開不開三選一（C8）。只有戰役關卡開。
   * 不給就是關的，跟 C8 之前完全一樣——舊錄影檔、既有測試的指紋都不會變。
   */
  perks = false
} = {}) {
  if (!Array.isArray(words) || words.length === 0) {
    throw new Error('createBattle 需要至少一個單字');
  }

  const rng = createRng(seed);
  const queue = words.map((_, i) => i);
  if (order === 'random') shuffleInPlace(queue, rng);

  /*
   * 等級加成在這裡一次算好。
   *
   * 每一步再去查一次表也可以，但那等於把「等級」變成戰鬥迴圈裡的依賴；
   * 開場算好放進 state 之後，戰鬥邏輯只看到兩個數字，跟 C2 之前一樣單純。
   */
  const rewards = levelRewards(level);
  /*
   * 裝備效果一次算好，戰鬥迴圈只看到一組數字——跟等級加成同一個做法。
   * 迴圈裡完全不需要知道他裝了什麼。
   */
  const gear = effectsFor(equipped || {});
  /*
   * 血量：基礎 + 等級 + 護甲。
   * 玻璃蜂針的 hpOverride 蓋掉全部——那是它的賣點（擊退兩倍，但只有一顆血），
   * 所以要放在最後，不然加成會把它的風險抵銷掉，整件裝備就沒有意義了。
   */
  const effectiveMaxHp =
    gear.hpOverride != null
      ? Math.max(1, gear.hpOverride)
      : maxHp + rewards.bonusHp + gear.bonusHp;
  /*
   * 名單轉成 Set 才查得快，但外面傳進來的可能是陣列（錄影檔就是陣列）。
   * 空名單用 null 表示，戰鬥迴圈裡一個判斷就跳過，不必建空物件。
   */
  const relearnSet =
    relearnIds && relearnIds.size !== 0 && relearnIds.length !== 0
      ? relearnIds instanceof Set
        ? relearnIds
        : new Set(relearnIds)
      : null;

  const state = {
    // 設定（建立後不再變動）
    words,
    seed,
    difficulty,
    order,
    maxHp: effectiveMaxHp,
    /* 開場的等級與加成。等級會在戰鬥中上升，startLevel 保留開場那一個， */
    /* 因為擊退倍率與血量上限是開場就定好的——中途變動會讓重播對不起來。 */
    startLevel: level,
    startXp: xp,
    levelKnockback: rewards.knockbackFactor,
    /* 裝備換算出來的那一組數字（見 shared/equipment.js 的 effectsFor） */
    gear,
    /* 二次機會：這一場還剩幾次「漏字不扣血」 */
    freeMissesLeft: gear.freeMisses,
    /* 特殊敵人（C6）：這一關的特性池、當前這一隻的特性、以及它的狀態 */
    traitPool: Array.isArray(enemyTraits) ? enemyTraits.slice() : [],
    trait: TRAITS.NONE,
    armorLeft: 0,
    dashTimerMs: 0,
    /* 哪幾種已經介紹過了——同一場只停一次，不然每隻都停會很煩 */
    traitsSeen: [],
    relearnSet,

    // 亂數狀態：一起算進指紋，才能證明兩次跑法完全一致
    rng,

    // 進度
    queue,
    queueHead: 0,
    tick: 0,
    timeMs: 0,

    // 戰況
    hp: effectiveMaxHp,
    combo: 0,
    maxCombo: 0,
    honey: 0,
    /*
     * 經驗值。xp 是這一場賺到的，totalXp 是累計（開場那筆 + 這一場）。
     * 分開存是因為結算畫面要說「這一場賺了多少」，而經驗條畫的是累計。
     */
    xp: 0,
    totalXp: xp,
    level,
    xpFactor: Number(xpFactor) > 0 ? Number(xpFactor) : 1,
    status: 'running', // running | won | lost
    /*
     * 每個字這一場打得怎樣（C4）：0 沒遇到、1 乾淨打完、2 打完但有打錯、3 漏掉。
     *
     * 同一個字可能遇到兩次（漏掉的字會排回隊伍尾端），取**最差**的那一次：
     * 漏掉之後再補打對，這一場還是算「不會」——補打的時候正確拼法剛剛才亮過。
     * 結算時送給伺服器寫進 wordProgress，第 4 章與複習關的題目就是從那裡來的。
     */
    wordOutcome: words.map(() => 0),

    /*
     * 三選一（C8）。perkRng 是專用的亂數（理由見 perks.js 的 drawOffer）；
     * perkOffer 不是 null 的時候整場停住，等他選。
     */
    perksOn: !!perks,
    perkRng: createRng((seed ^ 0x9e3779b9) >>> 0),
    perks: [],
    perkOffer: null,
    perkOffersMade: 0,
    perkSpeed: 1,
    rewindUsed: false,
    freezeMs: 0,
    freezeNext: false,
    wordStartMs: 0,

    // 目前這個字
    wordIndex: -1,
    target: '', // 小寫化的答案
    typed: 0, // 已經打對幾個字母
    cleanWord: true, // 這個字到目前為止沒出過錯
    progress: 0, // 敵人推進 0~1，到 1 就抵達蜂巢
    crossMs: 0,

    /*
     * Combo 效果的剩餘時間（毫秒）。全部用邏輯步扣，不看真實時間——
     * 看真實時間的話重播就不會一致，模擬器也不可信。
     */
    dashMs: 0, // 蜂群衝刺：敵人減速
    frenzyMs: 0, // 狂蜂狀態：擊退與蜂蜜加成
    sweetNext: false, // 下一個字要不要套蜜糖時間
    sweetActive: false, // 目前這個字是不是蜜糖時間（給畫面看）

    // 統計
    stats: {
      correctLetters: 0,
      wrongLetters: 0,
      backspaces: 0,
      wordsKilled: 0,
      wordsMissed: 0,
      listens: 0,
      // 經驗值要伺服器能自己重算，所以把算式的每一項都獨立記下來
      longKills: 0,
      relearns: 0
    },

    // 事件緩衝區（渲染端每個影格讀完就歸零）
    ev: createEventPool(),
    evCount: 0
  };

  startNextWord(state);
  return state;
}

function startNextWord(state) {
  if (state.queueHead >= state.queue.length) {
    state.status = 'won';
    state.wordIndex = -1;
    awardClearXp(state);
    applyXpFactor(state);
    emit(state, EV.BATTLE_END, 1);
    return;
  }
  const wi = state.queue[state.queueHead];
  state.queueHead += 1;
  state.wordIndex = wi;
  state.target = String(state.words[wi].english || '').toLowerCase();
  state.typed = 0;
  state.cleanWord = true;
  state.progress = 0;
  state.crossMs = crossMsFor(state.target.length, state.difficulty);
  /*
   * 蜜糖時間：下一個單字的時間加倍。
   * 在這裡套用而不是在觸發當下，是因為觸發時當前那個字已經在跑了——
   * 設計書寫的是「下一個單字」。
   */
  state.sweetActive = state.sweetNext;
  if (state.sweetNext) {
    state.crossMs *= BALANCE.combo.sweetTimeFactor;
    state.sweetNext = false;
  }

  /*
   * 這一隻是什麼特性（C6）。
   *
   * 用「這是這一場的第幾隻」算出來，不抽亂數也不看時間——同一場重播
   * 必然配到同一批敵人，否則「剛剛怪怪的」那顆按鈕就沒有意義了。
   * queueHead 已經加過 1，所以減回去才是這一隻的序號。
   */
  state.trait = traitFor(state.traitPool, state.queueHead - 1, state.seed);

  // 閃電手要知道這個字是什麼時候出來的；冰凍針凍住的是「下一隻」
  state.wordStartMs = state.timeMs;
  if (state.freezeNext) {
    state.freezeMs = FREEZE_MS;
    state.freezeNext = false;
    // 凍住要看得到：不然他只會覺得「這隻怎麼不動」
    emit(state, EV.PERK_FIRED, PERK_CODE.freeze, FREEZE_MS);
  }
  state.armorLeft = state.trait === TRAITS.ARMORED ? ARMOR_LETTERS : 0;
  state.dashTimerMs = state.trait === TRAITS.DASHER ? DASH_EVERY_MS : 0;

  emit(state, EV.WORD_START, wi);

  /*
   * 第一次遇到某一種特殊敵人，停下來介紹一次（§5）。
   * 同一場只介紹一次——每隻都停會很煩，而他看過一次就記得了。
   */
  if (state.trait !== TRAITS.NONE && !state.traitsSeen.includes(state.trait)) {
    state.traitsSeen.push(state.trait);
    emit(state, EV.TRAIT_INTRO, TRAIT_CODE[state.trait] || 0, wi);
  }
}

/**
 * 擊退倍率 = 狂蜂狀態 × 等級加成。
 *
 * 兩者相乘而不是相加：狂蜂是「這幾秒特別強」，等級是「我本來就比較強」，
 * 相乘才會讓高等級的狂蜂真的更猛，也才符合「力量買的是容錯」——
 * 不管幾級，要打的字母數一個都沒少。
 */
function knockbackFactor(state) {
  const frenzy = state.frenzyMs > 0 ? BALANCE.combo.frenzyKnockbackFactor : 1;
  /*
   * 女王之刺的 comboKnockback：連擊中再多 +20%。
   * 從 2 連開始算——1 連是「打掉一個字」的常態，不該算成連擊獎勵。
   */
  const comboBonus = state.combo >= 2 ? state.gear.comboKnockback : 1;
  return frenzy * state.levelKnockback * state.gear.knockback * comboBonus;
}

/**
 * 加經驗，順便處理升級。
 *
 * 升級在戰鬥中就會發生——打完一整場才結算的話，中間那二十分鐘完全沒有
 * 進度感，而進度感正是 C2 要補的東西。
 */
function addXp(state, amount) {
  if (amount <= 0) return;
  state.xp += amount;
  state.totalXp += amount;
  const nextLevel = levelFromXp(state.totalXp).level;
  /*
   * 升級只改「顯示用」的等級，不改 levelKnockback 與 maxHp。
   *
   * 那兩個是開場就定好的（見 createBattle）：中途變動會讓同一份錄影檔在
   * 不同時間重播跑出不同結果，確定性與「剛剛怪怪的」那顆按鈕會同時失效。
   * 這一場的加成下一場才生效——對玩的人來說也比較好懂：
   * 「我升級了，下一場更強」，而不是打到一半突然變順。
   */
  while (state.level < nextLevel) {
    state.level += 1;
    emit(state, EV.LEVEL_UP, state.level);
  }
}

/** 狂蜂狀態期間蜂蜜兩倍。 */
function honeyFactor(state) {
  const frenzy = state.frenzyMs > 0 ? BALANCE.combo.frenzyHoneyFactor : 1;
  // 加速挑戰：蟲變快，蜂蜜 ×2（只動蜂蜜，不動經驗——見 perks.js 的鐵律）
  const rush = state.perkSpeed !== 1 ? RUSH.honeyFactor : 1;
  return frenzy * rush;
}

function hasPerk(state, id) {
  return state.perksOn && state.perks.includes(id);
}

/**
 * 該給三選一了嗎（C8）。在打掉一隻蟲、下一隻已經出來之後判斷——
 * 他選的時候看得到下一隻蟲在哪裡，但牠是停住的。
 */
function maybeOfferPerks(state) {
  if (!state.perksOn || state.status !== 'running' || state.perkOffer) return;
  if (!PERK_OFFER_AT.includes(state.stats.wordsKilled)) return;
  const offer = drawOffer(state.perkRng, state.perks);
  if (!offer.length) return;
  state.perkOffer = offer;
  state.perkOffersMade += 1;
  emit(state, EV.PERK_OFFER, offer.length);
}

/**
 * Combo 到門檻時發動效果。
 *
 * 三個效果都只讓「這一局更好打」，沒有任何一個會減少要打的字母數——
 * 爽度可以用時間換，學習次數不能折抵（見 balance.js 的說明）。
 */
function applyComboMilestone(state) {
  const c = BALANCE.combo;
  /*
   * 蜜糖節奏會把三個門檻整組換掉（5/10/15 → 4/8/12）。
   * 沒戴就用 balance.js 的原值，所以沒有飾品時行為跟 C5 之前一模一樣。
   */
  const at = state.gear.comboAt || [c.dashAt, c.sweetTimeAt, c.frenzyAt];
  if (state.combo === at[0]) {
    state.dashMs = c.dashMs;
    emit(state, EV.COMBO_BONUS, 1, state.combo);
    return;
  }
  if (state.combo === at[1]) {
    state.sweetNext = true;
    emit(state, EV.COMBO_BONUS, 2, state.combo);
    return;
  }
  if (state.combo >= at[2] && (state.combo - at[2]) % c.frenzyRepeatEvery === 0) {
    state.frenzyMs = c.frenzyMs;
    emit(state, EV.COMBO_BONUS, 3, state.combo);
  }
}

/**
 * 打完整組的經驗：完成獎勵 + 完美倍率。
 *
 * 這一段一定要跟伺服器的 xpForBattle() 算出完全一樣的數字。
 * 少了它，畫面上會顯示 173 XP、伺服器卻記 300——而那種不一致的症狀
 * 最難解釋：打完看到一個數字，重新整理之後變成另一個。
 *
 * （第一版就是這樣漏掉的：前端只逐字加，完成獎勵與完美倍率只寫在伺服器那邊。）
 */
function awardClearXp(state) {
  addXp(state, state.words.length * XP.perWordOnClear);
  const s = state.stats;
  const perfect = s.wordsMissed === 0 && s.wrongLetters === 0;
  if (!perfect) return;
  /*
   * 倍率套在「這一場賺到的全部經驗」上，所以算的是差額再補進去。
   * 用 Math.round 跟 xpForBattle() 同一個做法，才不會差一分。
   */
  addXp(state, Math.round(state.xp * XP.perfectFactor) - state.xp);
}

/**
 * 連擊中斷。🍀 幸運草（C8）：只掉一半、不歸零。
 *
 * 只動連擊。cleanWord 照樣是 false——「這個字打錯過」是學習紀錄
 * （結算時寫進精熟度），不是遊戲數值，能力不可以碰它。
 */
function breakCombo(state) {
  if (state.combo === 0) return;
  if (hasPerk(state, 'clover')) {
    state.combo = Math.floor(state.combo / 2);
    emit(state, EV.PERK_FIRED, PERK_CODE.clover, state.combo);
    if (state.combo === 0) emit(state, EV.COMBO_RESET);
    return;
  }
  state.combo = 0;
  emit(state, EV.COMBO_RESET);
}

/**
 * 經驗倍率（C4 複習關 ×3），輸贏都算。
 *
 * 跟完美倍率同一個做法：算出乘完的總額、把差額補進去，用 Math.round，
 * 與伺服器 xpForBattle() 的「先完美、再倍率」順序一樣——一分都不能差，
 * 不然重新整理之後經驗條會跳。
 */
function applyXpFactor(state) {
  if (state.xpFactor === 1) return;
  const bonus = Math.round(state.xp * state.xpFactor) - state.xp;
  if (bonus <= 0) return;
  addXp(state, bonus);
  emit(state, EV.XP_BONUS, bonus);
}

/** 把敵人往前推 ms 毫秒的距離（打錯、重聽的代價都走這裡）。 */
function pushEnemy(state, ms) {
  state.progress += ms / state.crossMs;
}

function killWord(state) {
  const len = state.target.length;
  const hf = honeyFactor(state);
  let gained = BALANCE.honey.perKill * hf;
  if (len >= BALANCE.honey.longWordFrom) {
    // 長字獵手：長字的蜂蜜加倍（經驗也加倍，見下面）
    gained += BALANCE.honey.longWordBonus * hf * state.gear.longWordFactor;
  }
  state.honey += gained;
  state.stats.wordsKilled += 1;

  /*
   * ⚡ 閃電手：打得夠快，這個字的蜂蜜 ×3（C8）。
   * 「夠快」從這個字出來的那一刻算，含聽的時間——見 perks.js 的 LIGHTNING。
   */
  if (hasPerk(state, 'lightning')
    && state.timeMs - state.wordStartMs <= LIGHTNING.baseMs + LIGHTNING.perLetterMs * len) {
    const extra = gained * (LIGHTNING.honeyFactor - 1);
    state.honey += extra;
    gained += extra;
    emit(state, EV.PERK_FIRED, PERK_CODE.lightning, extra);
  }
  // ❄️ 冰凍針：這個字沒打錯就打完，下一隻蟲凍住
  if (hasPerk(state, 'freeze') && state.cleanWord) state.freezeNext = true;

  /*
   * 經驗值：擊殺 + 長字，兩者都不吃狂蜂倍率。
   *
   * 蜂蜜吃倍率是因為它是「這一場的爽度」，經驗不吃是因為它是「長期的成長」——
   * 讓狂蜂也加倍的話，最划算的玩法會變成「想辦法一直維持狂蜂」，
   * 而那跟把不會的字學會完全無關。
   */
  let xpGained = XP.perKill;
  const isLong = len >= XP.longWordFrom;
  if (isLong) {
    // 長字獵手同樣讓長字的經驗加倍
    xpGained += XP.longWordBonus * state.gear.longWordFactor;
    state.stats.longKills += 1;
  }

  /*
   * ⭐ 以前錯過、這次打對。§6 的重點：普通的蟲 5 XP，這種 25 XP。
   *
   * 打完就從名單移除，同一場之內重複遇到（漏掉的字會排回隊伍尾端）
   * 不會再給一次——不然最賺的玩法會變成「故意漏掉再補打」。
   */
  const wordId = state.words[state.wordIndex]?.id;
  if (state.relearnSet && wordId && state.relearnSet.has(wordId)) {
    state.relearnSet.delete(wordId);
    state.stats.relearns += 1;
    xpGained += XP.relearnBonus;
    emit(state, EV.RELEARNED, state.wordIndex, XP.relearnBonus);
  }
  addXp(state, xpGained);

  if (state.cleanWord) {
    state.combo += 1;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    emit(state, EV.COMBO_UP, state.combo);
    // 里程碑要在 startNextWord 之前結算，蜜糖時間才套得到下一個字
    applyComboMilestone(state);
  }

  state.wordOutcome[state.wordIndex] = Math.max(
    state.wordOutcome[state.wordIndex] || 0,
    state.cleanWord ? 1 : 2
  );
  emit(state, EV.WORD_KILLED, state.wordIndex, len, gained);
  startNextWord(state);
  maybeOfferPerks(state);
}

function missWord(state) {
  /*
   * 二次機會：這一場第一次漏字不扣血。
   *
   * 字還是會排回隊伍尾端、連擊還是會斷、正確拼法還是會亮出來——
   * 學習的部分一個都沒少（§1），少掉的只有那一顆血。
   */
  const forgiven = state.freeMissesLeft > 0;
  if (forgiven) state.freeMissesLeft -= 1;
  else state.hp -= 1;

  state.stats.wordsMissed += 1;
  state.wordOutcome[state.wordIndex] = 3;
  emit(state, EV.WORD_MISSED, state.wordIndex, forgiven ? 1 : 0);
  // 被赦免時不發 HP_LOST：血沒掉，畫面不該演成掉血
  if (!forgiven) emit(state, EV.HP_LOST, state.hp);

  breakCombo(state);

  // 漏掉的字排回隊伍尾端——本場之內立刻再遇到一次，這是學習底線的一部分
  state.queue.push(state.wordIndex);

  if (state.hp <= 0) {
    state.status = 'lost';
    state.wordIndex = -1;
    applyXpFactor(state);
    emit(state, EV.BATTLE_END, 0);
    return;
  }
  startNextWord(state);
}

/**
 * 往前跑一個固定邏輯步。
 *
 * 呼叫端負責累積真實時間並決定要跑幾步（見 clock.js），
 * 這裡永遠只前進 BALANCE.logicStepMs，這樣重播才會一致。
 */
export function stepBattle(state) {
  if (state.status !== 'running') return state;
  // 三選一的畫面開著：整場停住，時間也不走（C8）
  if (state.perkOffer) return state;

  state.tick += 1;
  state.timeMs += BALANCE.logicStepMs;

  // Combo 效果倒數
  if (state.dashMs > 0) state.dashMs = Math.max(0, state.dashMs - BALANCE.logicStepMs);
  if (state.frenzyMs > 0) state.frenzyMs = Math.max(0, state.frenzyMs - BALANCE.logicStepMs);

  // 蜂群衝刺期間敵人走得慢一半；加速挑戰（C8）快 25%
  const speed = (state.dashMs > 0 ? BALANCE.combo.dashSpeedFactor : 1) * state.perkSpeed;
  /*
   * ❄️ 冰凍針（C8）：凍住的時候蟲不動，衝刺蟲也不衝。
   * 只停這一隻蟲，連擊效果的倒數照走——凍住的是蟲，不是時間。
   */
  if (state.freezeMs > 0) {
    state.freezeMs = Math.max(0, state.freezeMs - BALANCE.logicStepMs);
    return state;
  }
  state.progress += (BALANCE.logicStepMs * speed) / state.crossMs;

  // ⏪ 倒帶（C8）：第一次快到蜂巢時彈回去，一場一次
  if (hasPerk(state, 'rewind') && !state.rewindUsed && state.progress >= REWIND.triggerAt) {
    state.progress = REWIND.backTo;
    state.rewindUsed = true;
    emit(state, EV.PERK_FIRED, PERK_CODE.rewind, 0);
  }

  /*
   * 衝刺蟲：每兩秒自己往前衝一小段（§5）。
   *
   * 它照樣吃蜂群衝刺的減速——那是玩家用連擊換來的，不該對某一種敵人失效。
   * 衝的那一下要發事件，畫面才震得起來；看不見的前進只會讓他覺得
   * 「遊戲怪怪的」（重聽那次已經學過這一課了）。
   */
  if (state.trait === TRAITS.DASHER && state.status === 'running') {
    state.dashTimerMs -= BALANCE.logicStepMs * speed;
    if (state.dashTimerMs <= 0) {
      state.dashTimerMs += DASH_EVERY_MS;
      pushEnemy(state, DASH_PUSH_MS);
      emit(state, EV.ENEMY_DASH, DASH_PUSH_MS);
    }
  }

  if (state.progress >= 1) {
    state.progress = 1;
    missWord(state);
  }
  return state;
}

/**
 * 套用一個玩家動作。
 *
 * action 形狀：
 *   { kind: 'letter', ch: 'a' }
 *   { kind: 'backspace' }
 *   { kind: 'listen', listen: 'replay' | 'slow' | 'sentence' }
 */
export function applyAction(state, action) {
  if (state.status !== 'running' || !action) return state;

  /*
   * 三選一的畫面開著：只收「選哪一張」，其他一律不收（C8）。
   * 他選卡的時候手可能還在打字——那些字母不能被算成打錯。
   */
  if (state.perkOffer) {
    if (action.kind !== 'perk') return state;
    const id = state.perkOffer[Number(action.pick)];
    if (!id) return state;
    state.perks.push(id);
    state.perkOffer = null;
    if (id === 'rush') state.perkSpeed = RUSH.speedFactor;
    emit(state, EV.PERK_TAKEN, PERK_CODE[id]);
    return state;
  }

  switch (action.kind) {
    case 'letter': {
      const ch = String(action.ch || '').toLowerCase();
      // 空白與連字號也是正常字元——課本有 "alarm clock" 這種詞條，見 charset.js
      if (!isTypeableChar(ch)) return state;

      /*
       * 打對了幾個字元。通常是 1，遇到「跳過分隔符」的情況會是 2。
       *
       * 正常遊玩時畫面上看不到單字（這是聽寫遊戲）。他聽到 "alarm clock"
       * 很可能直接打 alarmclock——然後卡在第六個字元，而畫面不會告訴他
       * 少了一個空白。那是最糟的一種卡關：看不出原因。
       *
       * 所以分隔符（空白、連字號）不強制：按了就算對，不按而直接打下一個
       * 字母也算對。要打空白的人打得出來，沒想到的人不會被卡住。
       * 拼字本身一個字母都沒有放水——放寬的只有「兩個字中間那一下」。
       */
      let consumed = 0;
      if (ch === state.target[state.typed]) {
        consumed = 1;
      } else if (
        isSeparator(state.target[state.typed]) &&
        ch === state.target[state.typed + 1]
      ) {
        consumed = 2;
      }

      if (consumed > 0) {
        state.typed += consumed;
        state.stats.correctLetters += 1;
        const letterHoney = BALANCE.honey.perCorrectLetter * honeyFactor(state);
        state.honey += letterHoney;
        // 經驗不吃狂蜂倍率（理由見 killWord）
        addXp(state, XP.perCorrectLetter);

        /*
         * 護甲蟲：前兩個字母打不動牠（§5）。
         *
         * 注意**字母照樣算對、照樣往前推進**——打掉的只有擊退，不是進度。
         * 這是 §1 的鐵律：特殊敵人不可以改變要打的字母數，只能改變
         * 「打對之後有多少好處」。外殼碎掉之後就跟一般敵人一樣了。
         */
        if (state.armorLeft > 0) {
          state.armorLeft -= consumed;
          if (state.armorLeft <= 0) {
            state.armorLeft = 0;
            emit(state, EV.ARMOR_BROKE, state.wordIndex);
          }
        } else {
          // 擊退：往回推，但不會推到畫面外。狂蜂狀態期間三倍
          state.progress -= (knockbackMsFor(state.difficulty) * knockbackFactor(state)) / state.crossMs;
          if (state.progress < 0) state.progress = 0;
          /*
           * 🎯 首字重擊（C8）：第一下就打對，蟲的進度只剩一半。
           * 放在這個分支裡是刻意的：護甲蟲的外殼擋的就是擊退，它也一起被擋。
           */
          if (hasPerk(state, 'firstStrike') && state.typed === consumed && state.cleanWord) {
            state.progress *= FIRST_STRIKE_KEEP;
            emit(state, EV.PERK_FIRED, PERK_CODE.firstStrike, 0);
          }
        }
        emit(state, EV.LETTER_OK, state.typed, state.target.length, letterHoney);

        if (state.typed >= state.target.length) killWord(state);
      } else {
        /*
         * 打錯不清空已經打對的內容。
         *
         * 這個字母單純不被接受，繼續打正確的即可。清空重來對小孩來說
         * 是「前功盡棄」，很容易直接放棄——挫折要來自敵人逼近，不是來自懲罰。
         */
        state.stats.wrongLetters += 1;
        state.cleanWord = false;
        // 護甲降低打錯的代價（上限 −50%，在 equipment.js 夾住）
        pushEnemy(state, BALANCE.wrongLetterPenaltyMs * state.gear.penalty);
        emit(state, EV.LETTER_BAD, ch.charCodeAt(0));
        breakCombo(state);
        if (state.progress >= 1) {
          state.progress = 1;
          missWord(state);
        }
      }
      return state;
    }

    case 'backspace': {
      if (state.typed > 0) {
        state.typed -= 1;
        state.stats.backspaces += 1;
        emit(state, EV.BACKSPACE, state.typed);
      }
      return state;
    }

    case 'listen': {
      const base = BALANCE.listenCostMs[action.listen];
      if (base == null) return state;
      /*
       * 靜音蟲：這個字只唸一次，重聽鍵對牠沒有用（§5）。
       *
       * 直接不理會，而且**不收代價**——收了代價卻沒唸，那是懲罰他按按鈕，
       * 他會學到「不要亂按」而不是「這隻不能重聽」。
       * 畫面會把重聽鍵變灰並說明原因（見 battle-scene.js）。
       */
      if (state.trait === TRAITS.SILENT) return state;
      // 回音水晶讓重聽便宜一半——目的是讓他敢多聽一次，而不是少打字母
      const cost = base * state.gear.listen;
      state.stats.listens += 1;
      pushEnemy(state, cost);
      emit(state, EV.LISTEN, LISTEN_KIND[String(action.listen).toUpperCase()] || 0);
      if (state.progress >= 1) {
        state.progress = 1;
        missWord(state);
      }
      return state;
    }

    default:
      return state;
  }
}

/** 渲染端讀完事件之後呼叫，把緩衝區歸零。 */
export function clearEvents(state) {
  state.evCount = 0;
}

/**
 * 狀態指紋（FNV-1a）。
 *
 * 確定性測試靠它：同一個種子跑兩次，指紋必須一模一樣。
 * 浮點數先量化到 1e-6，避免不同 JS 引擎最後一位的差異造成假警報。
 */
export function fingerprint(state) {
  let h = 0x811c9dc5;
  const mix = (n) => {
    h ^= n >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const mixFloat = (f) => mix(Math.round(f * 1e6));

  mix(state.tick);
  mix(state.rng.s);
  mix(state.hp);
  mix(state.combo);
  mix(state.maxCombo);
  mix(state.honey);
  mix(state.queueHead);
  mix(state.queue.length);
  mix(state.wordIndex + 1);
  mix(state.typed);
  mix(state.cleanWord ? 1 : 0);
  // Combo 效果會改變結果，所以也要進指紋，否則重播比對會放過它們
  mixFloat(state.dashMs);
  mixFloat(state.frenzyMs);
  // 三選一（C8）只在開著的時候混進指紋：沒開的一場指紋跟 C8 之前完全一樣
  if (state.perksOn) {
    mix(state.perks.length);
    for (const id of state.perks) mix(PERK_CODE[id] || 0);
    mix(state.perkOffer ? state.perkOffer.length : 0);
    mix(state.rewindUsed ? 1 : 0);
    mixFloat(state.freezeMs);
  }
  mix(state.sweetNext ? 1 : 0);
  mixFloat(state.progress);
  mixFloat(state.timeMs);
  mix(state.status.length);
  for (let i = 0; i < state.status.length; i += 1) mix(state.status.charCodeAt(i));
  const s = state.stats;
  mix(s.correctLetters);
  mix(s.wrongLetters);
  mix(s.backspaces);
  mix(s.wordsKilled);
  mix(s.wordsMissed);
  mix(s.listens);
  /*
   * 經驗值也要進指紋。
   *
   * 它不影響這一場的物理，但它是重播必須重現的結果之一——漏掉的話，
   * 「重播出來的指紋一樣」就不再代表「這一場真的一模一樣」了。
   * 等級加成（擊退、血量）本來就會透過 progress 與 hp 反映出來。
   */
  mix(s.longKills);
  mix(s.relearns);
  mix(state.xp);
  mix(state.level);
  // 二次機會剩幾次會改變後面的結果，所以也要進指紋
  mix(state.freeMissesLeft);
  /*
   * 特殊敵人的狀態也會改變結果（護甲還剩幾層、衝刺還有多久），
   * 不進指紋的話「重播出來一樣」就不再代表「這一場真的一模一樣」。
   */
  mix(TRAIT_CODE[state.trait] || 0);
  mix(state.armorLeft);
  mixFloat(state.dashTimerMs);
  return h >>> 0;
}

/** 給除錯用的精簡快照，不含 words 這種大東西。 */
export function snapshot(state) {
  return {
    tick: state.tick,
    timeMs: Math.round(state.timeMs),
    status: state.status,
    hp: state.hp,
    maxHp: state.maxHp,
    combo: state.combo,
    honey: state.honey,
    // 等級與經驗：HUD 的經驗條與升級演出都看這幾個
    level: state.level,
    startLevel: state.startLevel,
    xp: state.xp,
    totalXp: state.totalXp,
    levelKnockback: Number(state.levelKnockback.toFixed(3)),
    // 裝備：給 HUD、除錯與測試看。gear 本身是純數字，不含裝備名稱
    gear: { ...state.gear },
    freeMissesLeft: state.freeMissesLeft,
    /* 特殊敵人：給 HUD、除錯與測試看 */
    trait: state.trait,
    armorLeft: state.armorLeft,
    traitPool: state.traitPool.slice(),
    traitsSeen: state.traitsSeen.slice(),
    progress: Number(state.progress.toFixed(4)),
    crossMs: Math.round(state.crossMs),
    wordIndex: state.wordIndex,
    target: state.target,
    typed: state.typed,
    remaining: state.queue.length - state.queueHead,
    // Combo 效果的現況，給畫面與測試看
    dashMs: Math.round(state.dashMs),
    frenzyMs: Math.round(state.frenzyMs),
    sweetNext: state.sweetNext,
    sweetActive: state.sweetActive,
    /* 三選一（C8）：給畫面、除錯與測試看 */
    perksOn: state.perksOn,
    perks: state.perks.slice(),
    perkOffer: state.perkOffer ? state.perkOffer.slice() : null,
    perkSpeed: state.perkSpeed,
    freezeMs: Math.round(state.freezeMs),
    stats: { ...state.stats },
    fingerprint: fingerprint(state)
  };
}
