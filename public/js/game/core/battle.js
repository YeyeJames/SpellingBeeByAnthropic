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
  BATTLE_END: 11
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
  for (let i = 0; i < EVENT_CAPACITY; i += 1) pool[i] = { type: 0, a: 0, b: 0 };
  return pool;
}

function emit(state, type, a = 0, b = 0) {
  if (state.evCount >= EVENT_CAPACITY) return; // 滿了就丟棄，寧可少演出也不要配置記憶體
  const e = state.ev[state.evCount];
  e.type = type;
  e.a = a;
  e.b = b;
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
  maxHp = BALANCE.maxHp
} = {}) {
  if (!Array.isArray(words) || words.length === 0) {
    throw new Error('createBattle 需要至少一個單字');
  }

  const rng = createRng(seed);
  const queue = words.map((_, i) => i);
  if (order === 'random') shuffleInPlace(queue, rng);

  const state = {
    // 設定（建立後不再變動）
    words,
    seed,
    difficulty,
    order,
    maxHp,

    // 亂數狀態：一起算進指紋，才能證明兩次跑法完全一致
    rng,

    // 進度
    queue,
    queueHead: 0,
    tick: 0,
    timeMs: 0,

    // 戰況
    hp: maxHp,
    combo: 0,
    maxCombo: 0,
    honey: 0,
    status: 'running', // running | won | lost

    // 目前這個字
    wordIndex: -1,
    target: '', // 小寫化的答案
    typed: 0, // 已經打對幾個字母
    cleanWord: true, // 這個字到目前為止沒出過錯
    progress: 0, // 敵人推進 0~1，到 1 就抵達蜂巢
    crossMs: 0,

    // 統計
    stats: {
      correctLetters: 0,
      wrongLetters: 0,
      backspaces: 0,
      wordsKilled: 0,
      wordsMissed: 0,
      listens: 0
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
  emit(state, EV.WORD_START, wi);
}

/** 把敵人往前推 ms 毫秒的距離（打錯、重聽的代價都走這裡）。 */
function pushEnemy(state, ms) {
  state.progress += ms / state.crossMs;
}

function killWord(state) {
  const len = state.target.length;
  state.honey += BALANCE.honey.perKill;
  if (len >= BALANCE.honey.longWordFrom) state.honey += BALANCE.honey.longWordBonus;
  state.stats.wordsKilled += 1;

  if (state.cleanWord) {
    state.combo += 1;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    emit(state, EV.COMBO_UP, state.combo);
  }

  emit(state, EV.WORD_KILLED, state.wordIndex, len);
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
  state.progress += BALANCE.logicStepMs / state.crossMs;

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
        state.honey += BALANCE.honey.perCorrectLetter;
        // 擊退：往回推，但不會推到畫面外
        state.progress -= knockbackMsFor(state.difficulty) / state.crossMs;
        if (state.progress < 0) state.progress = 0;
        emit(state, EV.LETTER_OK, state.typed, state.target.length);

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
  return h >>> 0;
}

/** 給除錯用的精簡快照，不含 words 這種大東西。 */
export function snapshot(state) {
  return {
    tick: state.tick,
    timeMs: Math.round(state.timeMs),
    status: state.status,
    hp: state.hp,
    combo: state.combo,
    honey: state.honey,
    progress: Number(state.progress.toFixed(4)),
    crossMs: Math.round(state.crossMs),
    wordIndex: state.wordIndex,
    target: state.target,
    typed: state.typed,
    remaining: state.queue.length - state.queueHead,
    stats: { ...state.stats },
    fingerprint: fingerprint(state)
  };
}
