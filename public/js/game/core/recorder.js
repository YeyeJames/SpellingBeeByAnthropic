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
      /*
       * 等級與重學名單也要存。
       *
       * 它們會改變這一場的結果（等級影響擊退與血量上限，名單影響經驗），
       * 不存的話，同一份錄影在他升級之後重播就會跑出不一樣的東西——
       * 而「剛剛怪怪的」那顆按鈕的全部價值，就是重播出來要跟他看到的一樣。
       *
       * 舊的錄影檔沒有這兩個欄位，replayLog 會退回 1 級與空名單，
       * 也就是 C2 之前的行為，所以舊檔重播的指紋不會變。
       */
      level: setup.level || 1,
      xp: setup.xp || 0,
      relearnIds: setup.relearnIds ? [...setup.relearnIds] : [],
      /*
       * 裝備。跟等級一樣會改變這一場的結果（擊退、血量、打錯的代價…），
       * 不存的話同一份錄影在他換裝之後重播就會跑出不一樣的東西。
       * 舊錄影檔沒有這個欄位，replayLog 會退回全裸，也就是 C5 之前的行為。
       */
      equipped: setup.equipped ? { ...setup.equipped } : null,
      /*
       * 這一關的特殊敵人（C6）。跟等級與裝備一樣會改變結果，
       * 不存的話同一份錄影在別的關卡重播就會配到不一樣的敵人。
       * 舊錄影檔沒有這個欄位 → 空陣列 → 全部是普通敵人，也就是 C6 之前的行為。
       */
      enemyTraits: setup.enemyTraits ? [...setup.enemyTraits] : [],
      xpFactor: Number(setup.xpFactor) > 0 ? Number(setup.xpFactor) : 1,
      // 三選一（C8）。舊錄影檔沒有 → 關的，也就是 C8 之前的行為
      perks: !!setup.perks,
      // 這一關的速度（C9）。舊錄影檔沒有 → 1
      speed: Number(setup.speed) > 0 ? Number(setup.speed) : 1,
      wordIds: setup.wordIds.slice()
    },
    // 每筆 [tick, kind, payload]，用陣列而不是物件，錄影檔才不會大得誇張
    entries: []
  };
}

/* 只能往後加：舊錄影檔的 1～3 不能改意思。4 = 三選一選了第幾張（C8） */
const KIND = { letter: 1, backspace: 2, listen: 3, perk: 4 };
const KIND_BACK = { 1: 'letter', 2: 'backspace', 3: 'listen', 4: 'perk' };
const LISTEN_CODE = { replay: 1, slow: 2, sentence: 3 };
const LISTEN_BACK = { 1: 'replay', 2: 'slow', 3: 'sentence' };

export function recordAction(log, tick, action) {
  const kind = KIND[action.kind];
  if (!kind) return;
  let payload = 0;
  if (action.kind === 'letter') payload = String(action.ch).toLowerCase().charCodeAt(0);
  else if (action.kind === 'listen') payload = LISTEN_CODE[action.listen] || 0;
  else if (action.kind === 'perk') payload = Number(action.pick) || 0;
  log.entries.push([tick, kind, payload]);
}

function entryToAction(entry) {
  const kind = KIND_BACK[entry[1]];
  if (kind === 'letter') return { kind: 'letter', ch: String.fromCharCode(entry[2]) };
  if (kind === 'backspace') return { kind: 'backspace' };
  if (kind === 'listen') return { kind: 'listen', listen: LISTEN_BACK[entry[2]] };
  if (kind === 'perk') return { kind: 'perk', pick: entry[2] };
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
    maxHp: log.setup.maxHp,
    // 舊錄影檔沒有這幾個欄位，退回 C2 之前的行為（1 級、空名單）
    level: log.setup.level || 1,
    xp: log.setup.xp || 0,
    relearnIds: log.setup.relearnIds || null,
    equipped: log.setup.equipped || null,
    enemyTraits: log.setup.enemyTraits || null,
    // 舊錄影檔沒有這個欄位 → 1 倍，也就是 C4 之前的行為
    xpFactor: log.setup.xpFactor || 1,
    perks: !!log.setup.perks,
    speed: log.setup.speed || 1
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
    /*
     * 三選一停在那裡、這一步又沒有「選了哪一張」的紀錄（錄影檔被截斷）：
     * 停下來。不然 stepBattle 在選卡時不會前進，這個迴圈會永遠轉下去。
     */
    if (state.perkOffer && !(ei < entries.length && entries[ei][0] === state.tick)) break;
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
