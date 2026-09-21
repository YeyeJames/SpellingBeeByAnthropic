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
import { perfReport } from './perf.js';
import { latencyReport } from './latency.js';

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

  /*
   * 回饋頻道覆蓋率。
   *
   * 設計要求「所有聲音回饋都必須有對應的視覺回饋」，靜音時才玩得下去。
   * 與其靠我記得，不如讓機器檢查：每個事件被演出時，聲音端與畫面端
   * 各自登記一次，測試再去比對有沒有哪一邊缺席。
   */
  const channels = new Map();

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

    /** 影格統計：p50 / p95 / 最差影格 / 掉格次數。回傳算好的報告，不是原始計數器。 */
    perf() {
      return perfReport(ctx.getPerf());
    },

    /** keydown → 畫面畫出新狀態的延遲統計。手感的核心指標。 */
    latency() {
      return latencyReport(ctx.getLatency());
    },

    /** 每個事件在聲音端與畫面端各被演出幾次。靜音可玩性檢查用。 */
    feedbackCoverage() {
      const out = {};
      channels.forEach((v, k) => {
        out[k] = { ...v };
      });
      return out;
    },

    /** 分層背景音樂的現況：在不在播、幾拍、大小調、各層音量。 */
    bgm() {
      return ctx.bgm ? ctx.bgm.report() : null;
    },

    /** 音效延遲：keydown → 排進音訊佇列，外加裝置本身的輸出延遲。 */
    audioLatency() {
      return ctx.sfx ? ctx.sfx.latencyReport() : null;
    },

    isMuted() {
      return !!ctx.sfx?.isMuted();
    },

    setMuted(v) {
      return ctx.sfx?.setMuted(v);
    },

    masterGain() {
      return ctx.sfx?.masterGain();
    },

    showsWord() {
      return ctx.shouldShowWord();
    },

    /** 這一場的題庫（已經濾掉含空白／連字號、打不出來的詞條）。 */
    words() {
      return (ctx.words || []).map((w) => ({
        id: w.id,
        group: w.group,
        english: w.english,
        audio: w.audio?.type || 'tts'
      }));
    },

    /** 這一場有幾個字會播孩子自己錄的聲音。 */
    recordedCount() {
      return ctx.recordedCount || 0;
    },

    /** 排在後面等著的敵人。純畫面，邏輯上永遠只有一隻在推進。 */
    waitingLine() {
      const s = ctx.scene;
      if (!s || !s.waiting) return { visible: 0, onScreen: 0, xs: [], shift: 0 };
      const w = window.innerWidth;
      const shown = s.waiting.filter((slot) => slot.container.visible);
      return {
        visible: shown.length,
        onScreen: shown.filter((slot) => slot.container.x < w).length,
        xs: s.waiting.map((slot) => Math.round(slot.container.x)),
        shift: Number((s.waitShift || 0).toFixed(3))
      };
    },

    /**
     * 畫面上正在飄的分數字樣。
     *
     * 規則要從演出中長出來，而「演出有沒有真的發生」只能從這裡看——
     * 截圖比對抓不到 800ms 內就消失的東西。
     */
    floats() {
      const pool = ctx.scene?.effects?.pools?.floats;
      if (!pool) return [];
      return pool.items
        .filter((i) => i.active)
        .map((i) => ({ text: i.node.text, color: i.node.style?.color || '' }));
    },

    /**
     * 懲罰衝刺：畫面位置落後邏輯位置多少（progress 單位）。
     * 大於 0 代表蟲正在往前滑；歸零代表已經追上。
     */
    penaltyLag() {
      return ctx.scene?.penaltyLag ?? 0;
    },

    /** 漏字時亮出來的正確拼法。沒在顯示時 visible 是 false。 */
    missReveal() {
      const s = ctx.scene;
      if (!s) return { visible: false, word: '', hint: '' };
      return {
        visible: s.missRemainMs > 0,
        remainMs: Math.round(s.missRemainMs || 0),
        word: s.missText?.text || '',
        hint: s.missHint?.text || ''
      };
    },

    /** 這一場的出題順序設定，以及實際排出來的題目序列。 */
    order() {
      return ctx.order;
    },

    queueOrder() {
      const s = ctx.getState();
      return s ? s.queue.slice() : [];
    },

    /** 這次用的難度，以及（如果剛校準過）量到的手速。 */
    difficulty() {
      return { difficulty: ctx.difficulty, calibration: ctx.calibration || null };
    },

    /** 物件池使用量：常常回收代表池子開太小。 */
    effects() {
      return ctx.getEffectStats();
    },

    /** 輸入緩衝區狀態：排隊中幾個、曾經因為爆滿被丟掉幾個。 */
    queue() {
      const q = ctx.getQueue();
      return { size: q.size, dropped: q.dropped };
    },

    /** 測試鉤子：人為封鎖輸入一段時間，驗證按鍵會排隊而不是被吃掉。 */
    blockInput(ms) {
      return ctx.blockInput(ms);
    },

    imeSuspected() {
      return !!ctx.input?.isImeSuspected();
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
        latency: api.latency(),
        queue: api.queue(),
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

    _recordChannel(evName, channel) {
      let row = channels.get(evName);
      if (!row) {
        row = { sfx: 0, vfx: 0 };
        channels.set(evName, row);
      }
      row[channel] += 1;
    },

    _recordBattleEvent(ev) {
      pushEvent({
        t: Math.round(performance.now()),
        tick: ctx.getState()?.tick ?? -1,
        type: EV_NAME[ev.type] || `EV_${ev.type}`,
        a: ev.a,
        b: ev.b,
        c: ev.c
      });
    }
  };

  window.__spellbee = api;
  return api;
}
