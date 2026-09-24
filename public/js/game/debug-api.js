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
      const r = ctx.sfx?.setMuted(v);
      // 靜音會改變「顯示單字」那顆按鈕的狀態（靜音時它是鎖住的），要一起重畫
      ctx.refreshAudioButtons?.();
      return r;
    },

    masterGain() {
      return ctx.sfx?.masterGain();
    },

    showsWord() {
      return ctx.shouldShowWord();
    },

    /** 測試用：true/false 明確指定，null 交還給自動規則（靜音或沒語音才顯示）。 */
    setShowWord(v) {
      return ctx.setShowWord(v);
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
     * 血條下面那一排「已經拼對的字母」。
     *
     * flashing 是打錯時的紅色閃爍還在不在——那是「這一下沒算進去」的唯一提示，
     * 只看文字內容檢查不到它（打錯時文字本來就不該變）。
     */
    typedTrail() {
      const s = ctx.scene;
      if (!s || !s.trailText) return { text: '', flashing: false, color: '' };
      return {
        text: s.trailText.text || '',
        flashing: (s.trailBadMs || 0) > 0,
        color: s.trailText.style?.color || ''
      };
    },

    /**
     * 等級與經驗（C2）。
     *
     * level 是戰鬥中即時算的（打到一半升級就會變），startLevel 是開打時的；
     * knockback 是等級給的擊退倍率——「力量買的是容錯」那條原則，
     * 驗的就是它有沒有真的生效、而且沒有減少要打的字母數。
     */
    levelState() {
      const s = ctx.getState();
      if (!s) return null;
      return {
        level: s.level,
        startLevel: s.startLevel,
        xp: s.xp,
        totalXp: s.totalXp,
        maxHp: s.maxHp,
        knockback: Number(s.levelKnockback.toFixed(3)),
        relearns: s.stats.relearns,
        longKills: s.stats.longKills,
        // 還沒被打掉的重學字還剩幾個
        relearnLeft: s.relearnSet ? s.relearnSet.size : 0
      };
    },

    /**
     * 裝備換算出來的那一組數字（C5）。
     *
     * 測試靠它驗「力量買的是容錯，不是答案」：knockback 可以變大，
     * 但要打的字母數必須完全不變。
     */
    gearState() {
      const s = ctx.getState();
      if (!s) return null;
      return {
        equipped: ctx.equipped ? { ...ctx.equipped } : null,
        honey: ctx.honey,
        maxHp: s.maxHp,
        freeMissesLeft: s.freeMissesLeft,
        ...s.gear
      };
    },

    /**
     * 特殊敵人（C6）：當前這一隻的特性、護甲還剩幾層、這一場介紹過哪幾種。
     * 測試靠它驗「特性真的生效」與「§1：字母數一個都沒少」。
     */
    traitState() {
      const s = ctx.getState();
      if (!s) return null;
      return {
        trait: s.trait,
        armorLeft: s.armorLeft,
        pool: s.traitPool.slice(),
        seen: s.traitsSeen.slice()
      };
    },

    /** 特殊敵人的教學停格現在寫著什麼（沒在顯示時 visible 是 false）。 */
    traitIntro() {
      const s = ctx.scene;
      if (!s || !s.traitTitle) return { visible: false, title: '', rule: '' };
      return {
        visible: (s.traitIntroMs || 0) > 0,
        title: s.traitTitle.text || '',
        rule: s.traitRule?.text || ''
      };
    },

    /** 升級橫幅現在寫著什麼（沒在顯示時是空字串）。 */
    levelUpBanner() {
      const s = ctx.scene;
      if (!s || !s.levelUpText) return { visible: false, text: '' };
      return {
        visible: (s.levelUpRemainMs || 0) > 0,
        text: s.levelUpText.text || ''
      };
    },

    /**
     * 敵人身上的減速光環在不在。
     *
     * 連到 5 的獎勵是「敵人速度 −50%、3 秒」，但打得順的時候時間本來就充裕，
     * 慢一半根本感覺不出來。光環是唯一看得見的證據，所以要驗得到。
     */
    slowAura() {
      const s = ctx.scene;
      if (!s || !s.slowAura) return { visible: false, alpha: 0 };
      const alpha = s.slowAura.fillAlpha ?? 0;
      return { visible: alpha > 0.01, alpha: Number(alpha.toFixed(3)) };
    },

    /**
     * 那一排的座標，以及第一顆血點的座標。
     * 用來驗「真的在血條下面、真的在畫面內」——比截圖比對耐得住字型變動。
     */
    trailGeometry() {
      const s = ctx.scene;
      if (!s || !s.trailText || !s.hpDots?.length) return null;
      return {
        x: Math.round(s.trailText.x),
        y: Math.round(s.trailText.y),
        hpX: Math.round(s.hpDots[0].x),
        hpY: Math.round(s.hpDots[0].y),
        viewW: Math.round(s.scale.width),
        viewH: Math.round(s.scale.height)
      };
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
