/**
 * 輸入錄製與重播。
 *
 * 遊戲的 bug 很多是偶發的，而偶發的 bug 用「你再試一次看看」根本抓不到。
 * 所以每一個玩家動作都連同它發生的邏輯步一起記下來，搭配固定時間步與
 * 可設種子的亂數，一場戰鬥就能一模一樣重跑。
 *
 * 這件事順便解決了一個很實際的問題：小孩說不出來剛剛發生什麼事，
 * 他只會說「剛剛怪怪的」。有了錄影檔，他按一下按鈕，我就能完整重現他看到的畫面。
 */

import { createBattle, applyAction, stepBattle, clearEvents, fingerprint } from './battle.js';

export const LOG_VERSION = 1;

/**
 * 開始錄製。
 * setup 必須包含重建同一場戰鬥所需的全部資訊（不含單字內容本身，只存 id）。
 */
export function createRecorder(setup) {
  return {
    version: LOG_VERSION,
    createdAt: new Date().toISOString(),
    setup: {
      seed: setup.seed,
      difficulty: setup.difficulty,
      order: setup.order,
      maxHp: setup.maxHp,
      wordIds: setup.wordIds.slice()
    },
    // 每筆 [tick, kind, payload]，用陣列而不是物件，錄影檔才不會大得誇張
    entries: []
  };
}

const KIND = { letter: 1, backspace: 2, listen: 3 };
const KIND_BACK = { 1: 'letter', 2: 'backspace', 3: 'listen' };
const LISTEN_CODE = { replay: 1, slow: 2, sentence: 3 };
const LISTEN_BACK = { 1: 'replay', 2: 'slow', 3: 'sentence' };

export function recordAction(log, tick, action) {
  const kind = KIND[action.kind];
  if (!kind) return;
  let payload = 0;
  if (action.kind === 'letter') payload = String(action.ch).toLowerCase().charCodeAt(0);
  else if (action.kind === 'listen') payload = LISTEN_CODE[action.listen] || 0;
  log.entries.push([tick, kind, payload]);
}

function entryToAction(entry) {
  const kind = KIND_BACK[entry[1]];
  if (kind === 'letter') return { kind: 'letter', ch: String.fromCharCode(entry[2]) };
  if (kind === 'backspace') return { kind: 'backspace' };
  if (kind === 'listen') return { kind: 'listen', listen: LISTEN_BACK[entry[2]] };
  return null;
}

/**
 * 重播一份錄影檔，回傳跑完的狀態。
 *
 * words 要由呼叫端依 setup.wordIds 準備好（順序必須一致）。
 * 這個函式在瀏覽器與 Node 都能跑，確定性測試與平衡模擬器都用它。
 *
 * @param {number} maxTicks 保險絲：錄影檔壞掉時不要無窮迴圈
 */
export function replayLog(log, words, { maxTicks = 60 * 120 * 30 } = {}) {
  const state = createBattle({
    words,
    seed: log.setup.seed,
    difficulty: log.setup.difficulty,
    order: log.setup.order,
    maxHp: log.setup.maxHp
  });

  const entries = log.entries;
  let ei = 0;
  const lastTick = entries.length > 0 ? entries[entries.length - 1][0] : 0;

  while (state.status === 'running' && state.tick <= maxTicks) {
    // 先套用這一步該發生的所有輸入，再前進一步——順序固定，重播才會一致
    while (ei < entries.length && entries[ei][0] === state.tick) {
      applyAction(state, entryToAction(entries[ei]));
      ei += 1;
    }
    clearEvents(state);
    if (state.status !== 'running') break;
    // 輸入放完之後就沒事可做了，再跑下去只是等敵人撞進來；讓它跑完收尾
    if (ei >= entries.length && state.tick > lastTick + 120 * 60) break;
    stepBattle(state);
    clearEvents(state);
  }

  return state;
}

/** 重播並回傳指紋，確定性測試直接比對這個數字。 */
export function replayFingerprint(log, words) {
  return fingerprint(replayLog(log, words));
}

export function serializeLog(log) {
  return JSON.stringify(log);
}

export function parseLog(text) {
  const log = JSON.parse(text);
  if (log.version !== LOG_VERSION) {
    throw new Error(`錄影檔版本不符：${log.version}，目前支援 ${LOG_VERSION}`);
  }
  return log;
}
