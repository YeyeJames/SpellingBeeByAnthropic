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
  RELEARNED: 14
};

export const EV_NAME = Object.fromEntries(Object.entries(EV).map(([k, v]) => [v, k]));

/* 聽力動作代號，給 LISTEN 事件的參數用 */
export const LISTEN_KIND = { REPLAY: 1, SLOW: 2, SENTENCE: 3 };

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
  relearnIds = null
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
  const effectiveMaxHp = maxHp + rewards.bonusHp;
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
    status: 'running', // running | won | lost

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
  emit(state, EV.WORD_START, wi);
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
  return frenzy * state.levelKnockback;
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
  return state.frenzyMs > 0 ? BALANCE.combo.frenzyHoneyFactor : 1;
}

/**
 * Combo 到門檻時發動效果。
 *
 * 三個效果都只讓「這一局更好打」，沒有任何一個會減少要打的字母數——
 * 爽度可以用時間換，學習次數不能折抵（見 balance.js 的說明）。
 */
function applyComboMilestone(state) {
  const c = BALANCE.combo;
  if (state.combo === c.dashAt) {
    state.dashMs = c.dashMs;
    emit(state, EV.COMBO_BONUS, 1, state.combo);
    return;
  }
  if (state.combo === c.sweetTimeAt) {
    state.sweetNext = true;
    emit(state, EV.COMBO_BONUS, 2, state.combo);
    return;
  }
  if (state.combo >= c.frenzyAt && (state.combo - c.frenzyAt) % c.frenzyRepeatEvery === 0) {
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

/** 把敵人往前推 ms 毫秒的距離（打錯、重聽的代價都走這裡）。 */
function pushEnemy(state, ms) {
  state.progress += ms / state.crossMs;
}

function killWord(state) {
  const len = state.target.length;
  const hf = honeyFactor(state);
  let gained = BALANCE.honey.perKill * hf;
  if (len >= BALANCE.honey.longWordFrom) gained += BALANCE.honey.longWordBonus * hf;
  state.honey += gained;
  state.stats.wordsKilled += 1;

  /*
   * 經驗值：擊殺 + 長字，兩者都不吃狂蜂倍率。
   *
   * 蜂蜜吃倍率是因為它是「這一場的爽度」，經驗不吃是因為它是「長期的成長」——
   * 讓狂蜂也加倍的話，最划算的玩法會變成「想辦法一直維持狂蜂」，
   * 而那跟把不會的字學會完全無關。
   */
  let xpGained = XP.perKill;
  const isLong = len >= XP.longWordFrom;
  if (isLong) xpGained += XP.longWordBonus;
  if (isLong) state.stats.longKills += 1;

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

  emit(state, EV.WORD_KILLED, state.wordIndex, len, gained);
  startNextWord(state);
}

function missWord(state) {
  state.hp -= 1;
  state.stats.wordsMissed += 1;
  emit(state, EV.WORD_MISSED, state.wordIndex);
  emit(state, EV.HP_LOST, state.hp);

  if (state.combo !== 0) {
    state.combo = 0;
    emit(state, EV.COMBO_RESET);
  }

  // 漏掉的字排回隊伍尾端——本場之內立刻再遇到一次，這是學習底線的一部分
  state.queue.push(state.wordIndex);

  if (state.hp <= 0) {
    state.status = 'lost';
    state.wordIndex = -1;
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

  state.tick += 1;
  state.timeMs += BALANCE.logicStepMs;

  // Combo 效果倒數
  if (state.dashMs > 0) state.dashMs = Math.max(0, state.dashMs - BALANCE.logicStepMs);
  if (state.frenzyMs > 0) state.frenzyMs = Math.max(0, state.frenzyMs - BALANCE.logicStepMs);

  // 蜂群衝刺期間敵人走得慢一半
  const speed = state.dashMs > 0 ? BALANCE.combo.dashSpeedFactor : 1;
  state.progress += (BALANCE.logicStepMs * speed) / state.crossMs;

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
        // 擊退：往回推，但不會推到畫面外。狂蜂狀態期間三倍
        state.progress -= (knockbackMsFor(state.difficulty) * knockbackFactor(state)) / state.crossMs;
        if (state.progress < 0) state.progress = 0;
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
        pushEnemy(state, BALANCE.wrongLetterPenaltyMs);
        emit(state, EV.LETTER_BAD, ch.charCodeAt(0));
        if (state.combo !== 0) {
          state.combo = 0;
          emit(state, EV.COMBO_RESET);
        }
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
      const cost = BALANCE.listenCostMs[action.listen];
      if (cost == null) return state;
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
    stats: { ...state.stats },
    fingerprint: fingerprint(state)
  };
}
