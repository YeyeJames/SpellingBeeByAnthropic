/**
 * 固定時間步時鐘。
 *
 * 畫面更新率會變（60Hz、120Hz、分頁切走時掉到 1Hz），但邏輯必須永遠
 * 以固定步伐前進，否則同一串輸入在不同機器上會跑出不同結果，重播就失效了。
 *
 * 作法是標準的累積器：把真實經過的時間存起來，夠一步就跑一步。
 */

import { BALANCE } from './balance.js';

export function createClock() {
  return {
    accumulatorMs: 0,
    // 這個影格實際跑了幾步，debug overlay 會顯示
    lastSteps: 0,
    // 因為超過補跑上限而丟掉的時間，累積起來代表卡頓嚴重
    droppedMs: 0
  };
}

/**
 * 餵入這個影格經過的真實毫秒數，回傳應該跑幾個邏輯步。
 *
 * 超過 maxCatchUpMs 的部分直接丟棄：分頁切走再回來會累積好幾秒，
 * 真的照跑會一次跑上千步（死亡螺旋），畫面等於當掉。
 * 寧可讓遊戲時間「少走一段」，也不要卡住——而且那種情況本來就會自動暫停。
 */
export function advanceClock(clock, deltaMs) {
  let dt = deltaMs;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  if (dt > BALANCE.maxCatchUpMs) {
    clock.droppedMs += dt - BALANCE.maxCatchUpMs;
    dt = BALANCE.maxCatchUpMs;
  }
  clock.accumulatorMs += dt;

  let steps = 0;
  while (clock.accumulatorMs >= BALANCE.logicStepMs) {
    clock.accumulatorMs -= BALANCE.logicStepMs;
    steps += 1;
  }
  clock.lastSteps = steps;
  return steps;
}

/**
 * 邏輯步之間的插值比例（0~1）。
 *
 * 邏輯 120Hz、畫面可能 60Hz 或 144Hz，直接畫邏輯狀態會有輕微抖動。
 * 渲染端用這個比例把敵人位置補間，看起來才滑順。
 */
export function alpha(clock) {
  return clock.accumulatorMs / BALANCE.logicStepMs;
}
