/**
 * 除錯 API——把遊戲內部狀態開一個唯讀的窗口出來。
 *
 * 這不是「順便加的開發者功能」，而是整個測試策略的地基：
 *   - 自動化玩家 bot 靠它知道現在該打哪個字母
 *   - 延遲量測靠它對時間戳
 *   - 靜音可玩性檢查靠它把聲音事件與視覺事件對帳
 *   - F3 疊加層就是它的前端
 *
 * 掛在 window.__spellbee 底下。外部只能讀與觸發明確開放的動作，
 * 不能直接改戰鬥狀態——狀態的唯一來源永遠是 battle.js。
 */

import { snapshot, fingerprint, EV_NAME } from './core/battle.js';

const EVENT_LOG_CAPACITY = 500;

export function installDebugApi(ctx) {
  /*
   * 事件環狀緩衝區：最後 500 個事件常駐記憶體。
   * 出錯時連同當下狀態一起 dump，不用事先猜要印什麼 log。
   */
  const eventLog = new Array(EVENT_LOG_CAPACITY);
  let eventLogHead = 0;
  let eventLogCount = 0;

  function pushEvent(entry) {
    eventLog[eventLogHead] = entry;
    eventLogHead = (eventLogHead + 1) % EVENT_LOG_CAPACITY;
    if (eventLogCount < EVENT_LOG_CAPACITY) eventLogCount += 1;
  }

  function readEventLog() {
    const out = [];
    const start = (eventLogHead - eventLogCount + EVENT_LOG_CAPACITY) % EVENT_LOG_CAPACITY;
    for (let i = 0; i < eventLogCount; i += 1) {
      out.push(eventLog[(start + i) % EVENT_LOG_CAPACITY]);
    }
    return out;
  }

  const api = {
    // 版本號：bot 與測試腳本可以據此確認接的是預期的介面
    version: 1,
    ready: false,

    /** 目前的戰鬥快照（含指紋）。bot 每一步都讀它。 */
    state() {
      const s = ctx.getState();
      return s ? snapshot(s) : null;
    },

    /** 現在該打哪一個字母。bot 的核心，也是人工排查時最常看的東西。 */
    expectedLetter() {
      const s = ctx.getState();
      if (!s || s.status !== 'running') return null;
      return s.target[s.typed] || null;
    },

    fingerprint() {
      const s = ctx.getState();
      return s ? fingerprint(s) : null;
    },

    /** 影格統計：p50 / p95 / 最差影格 / 掉格次數。 */
    perf() {
      return ctx.getPerf();
    },

    /** 最後 500 個事件（含邏輯事件與演出事件），用來對帳與查偶發問題。 */
    events() {
      return readEventLog();
    },

    /** 目前這一場的錄影檔，可以存成檔案之後重播。 */
    log() {
      return ctx.getLog();
    },

    /** 重新開一場。bot 跑多場時用，也方便手動重試。 */
    restart(opts) {
      return ctx.restart(opts);
    },

    /** 直接送一個動作進去，不經過鍵盤。給單元式的自動測試用。 */
    send(action) {
      return ctx.sendAction(action);
    },

    /** 出事時一次把現場都倒出來。 */
    dump() {
      return {
        state: api.state(),
        perf: api.perf(),
        events: readEventLog(),
        log: ctx.getLog()
      };
    },

    // 內部使用：渲染端把事件餵進來
    _record(type, detail) {
      pushEvent({
        t: Math.round(performance.now()),
        tick: ctx.getState()?.tick ?? -1,
        type,
        ...detail
      });
    },

    _recordBattleEvent(ev) {
      pushEvent({
        t: Math.round(performance.now()),
        tick: ctx.getState()?.tick ?? -1,
        type: EV_NAME[ev.type] || `EV_${ev.type}`,
        a: ev.a,
        b: ev.b
      });
    }
  };

  window.__spellbee = api;
  return api;
}
