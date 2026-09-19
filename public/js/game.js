/**
 * 遊戲頁進入點。
 *
 * 職責是把零件接起來：拿單字 → 建戰鬥狀態 → 開 Phaser → 綁輸入 →
 * 裝除錯 API 與 F3 疊加層。所有規則都在 core/ 裡，這裡不做任何遊戲判斷。
 *
 * 這一頁刻意跟現有的練習頁完全分開（新網址 /game），
 * 所以遊戲做到一半也不會影響小孩每天在用的東西。
 */

import { loadPhaser } from './game/load-phaser.js';
import { createBattle, applyAction } from './game/core/battle.js';
import { createRecorder, recordAction, serializeLog } from './game/core/recorder.js';
import { createInput, isTouchDevice } from './game/input.js';
import { createInputQueue, enqueueInput, drainInput, clearInputQueue } from './game/input-queue.js';
import { createLatency, markApplied, markRendered, resetLatency } from './game/latency.js';
import { installDebugApi } from './game/debug-api.js';
import { createOverlay } from './game/overlay.js';
import { createPerf, resetPerf } from './game/perf.js';
import { createBattleScene } from './game/battle-scene.js';

const params = new URLSearchParams(location.search);

/** 種子：網址給就用給的，否則隨機開一個並顯示出來，方便回報問題時附上。 */
function initialSeed() {
  const fromUrl = Number(params.get('seed'));
  if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl >>> 0;
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

const ctx = {
  words: [],
  state: null,
  log: null,
  seed: initialSeed(),
  difficulty: params.get('difficulty') || 'normal',
  order: params.get('order') === 'random' ? 'random' : 'sequential',
  paused: false,
  scene: null,
  phaserGame: null,
  perf: createPerf(),
  latency: createLatency(),
  queue: createInputQueue(),
  // 測試用：人為讓遊戲有一段「不接受輸入」的空窗，驗證按鍵不會被吃掉
  blockedUntil: 0,

  getState: () => ctx.state,
  getLog: () => ctx.log,
  getSeed: () => ctx.seed,
  getPerf: () => ctx.perf,
  getLatency: () => ctx.latency,
  getQueue: () => ctx.queue,
  isPaused: () => ctx.paused,
  getClockSteps: () => ctx.scene?.clock.lastSteps ?? 0,
  getClockDropped: () => ctx.scene?.clock.droppedMs ?? 0,
  getEffectStats: () =>
    ctx.scene?.effects?.stats() ?? { stingers: 0, fragments: 0, splashes: 0, recycled: 0 },

  onSceneReady(scene) {
    ctx.scene = scene;
    // 給測試腳本探測畫面內部用；正式遊玩完全不碰它
    window.__spellbeeScene = scene;
    ctx.debug.ready = true;
  },

  /** 現在收不收得下輸入。1.3 加了擊殺頓挫之後，這裡會再多一個條件。 */
  acceptingInput() {
    return (
      !!ctx.state &&
      ctx.state.status === 'running' &&
      !ctx.paused &&
      performance.now() >= ctx.blockedUntil
    );
  },

  /**
   * 收到一個玩家動作。
   *
   * 能收就立刻套用，不等下一個邏輯步——邏輯是 120Hz，等步界最多多 8.3ms，
   * 加上等畫面更新就會吃掉「keydown → 畫面回饋 ≤ 16ms」的預算。
   * 收不下就排隊，等空窗結束再照原順序補上，而且保留原本的時間戳。
   */
  sendAction(action, t0 = performance.now()) {
    if (!ctx.state) return false;
    if (!ctx.acceptingInput()) {
      return enqueueInput(ctx.queue, action, t0);
    }
    applyNow(action, t0);
    return true;
  },

  /** 每個影格開頭呼叫：把空窗期間排隊的按鍵補上。 */
  drainQueue() {
    if (ctx.queue.size === 0) return 0;
    return drainInput(ctx.queue, (slot) => {
      if (!ctx.acceptingInput()) return false;
      applyNow(slot, slot.t0);
      return true;
    });
  },

  /** 畫面已經把新狀態畫出來了，結算這一格的延遲樣本。 */
  markRendered(now) {
    markRendered(ctx.latency, now);
  },

  /**
   * 封鎖輸入 ms 毫秒。
   *
   * 真實的用途是擊殺頓挫：世界凍結的那 80ms 不該把按鍵直接套用在
   * 看不見的畫面上，而是先排隊、解凍後照順序補上。測試也用同一個入口
   * 來人為製造空窗，驗證按鍵確實沒有被吃掉。
   */
  blockInput(ms) {
    ctx.blockedUntil = performance.now() + Number(ms || 0);
    return ctx.blockedUntil;
  },

  restart(opts = {}) {
    ctx.seed = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    if (opts.difficulty) ctx.difficulty = opts.difficulty;
    if (opts.order) ctx.order = opts.order;
    startBattle();
    return ctx.seed;
  }
};

function applyNow(action, t0) {
  recordAction(ctx.log, ctx.state.tick, action);
  applyAction(ctx.state, action);
  markApplied(ctx.latency, t0);
}

ctx.debug = installDebugApi(ctx);

function startBattle() {
  ctx.state = createBattle({
    words: ctx.words,
    seed: ctx.seed,
    difficulty: ctx.difficulty,
    order: ctx.order
  });
  ctx.log = createRecorder({
    seed: ctx.seed,
    difficulty: ctx.difficulty,
    order: ctx.order,
    maxHp: ctx.state.maxHp,
    wordIds: ctx.words.map((w) => w.id)
  });
  ctx.paused = false;
  ctx.blockedUntil = 0;
  ctx.scene?.effects?.reset();
  clearInputQueue(ctx.queue);
  resetPerf(ctx.perf);
  resetLatency(ctx.latency);
  document.body.classList.remove('is-paused');
  updateHud();
}

function updateHud() {
  const el = document.getElementById('seed-label');
  if (el) el.textContent = `種子 ${ctx.seed}`;
}

/** 下載目前這一場的錄影檔。小孩按「剛剛怪怪的」就是按這個。 */
function downloadLog() {
  if (!ctx.log) return;
  const blob = new Blob([serializeLog(ctx.log)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spellbee-replay-${ctx.seed}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function fetchWords() {
  /*
   * 這個端點不需要登入、也不碰資料庫（單字庫是寫死的靜態資料），
   * 所以遊戲頁在資料庫掛掉時仍然打得開，自動化測試也不必先登入。
   *
   * ?part=all 拿全部 100 個字。測試要連打數百個字母時用得到——
   * 一場打得完就不必中途重開，統計才不會被重置切斷。
   */
  const part = params.get('part') || '1';
  const query = part === 'all' ? '' : `?part=${encodeURIComponent(part)}`;
  const res = await fetch(`/api/wordbank${query}`);
  if (!res.ok) throw new Error(`拿不到單字庫（${res.status}）`);
  const data = await res.json();
  return data.words;
}

function setPaused(next) {
  ctx.paused = next;
  document.body.classList.toggle('is-paused', ctx.paused);
}

async function boot() {
  const errorEl = document.getElementById('game-error');
  const imeEl = document.getElementById('ime-warning');
  const tapEl = document.getElementById('tap-to-start');

  try {
    const [words] = await Promise.all([fetchWords(), loadPhaser()]);
    // Phase 1 只要少量單字就夠驗證手感，不用一次上 25 個
    const limit = Number(params.get('n')) || 20;
    ctx.words = words.slice(0, limit);
    if (ctx.words.length === 0) throw new Error('單字庫是空的');

    startBattle();

    const overlay = createOverlay(ctx);
    const input = createInput({
      onAction: (action, t0) => ctx.sendAction(action, t0),
      onPause: (info) => setPaused(info?.force ? true : !ctx.paused),
      onToggleOverlay: () => overlay.toggle(),
      onImeSuspected: () => {
        if (imeEl) imeEl.hidden = false;
      },
      onImeCleared: () => {
        if (imeEl) imeEl.hidden = true;
      }
    });
    ctx.input = input;

    /*
     * 觸控裝置：沒有使用者的點擊，iOS/iPadOS 不會叫出螢幕鍵盤，
     * 等於完全不能玩。所以先擋一層「點一下開始」，順便當成暫停解除。
     */
    if (isTouchDevice()) {
      document.body.classList.add('is-touch');
      if (tapEl) {
        tapEl.hidden = false;
        const start = () => {
          input.focusForTyping();
          tapEl.hidden = true;
        };
        tapEl.addEventListener('click', start);
        tapEl.addEventListener('touchstart', start, { passive: true });
      }
      // 點畫面任何地方都把鍵盤叫回來（切出去再回來時很常需要）
      document.getElementById('game-root')?.addEventListener('click', () => {
        input.focusForTyping();
      });
      // iPad 上把三個聽力鍵放回螢幕
      document.querySelectorAll('[data-listen]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          ctx.sendAction({ kind: 'listen', listen: btn.dataset.listen });
          input.focusForTyping();
        });
      });
    }

    document.getElementById('btn-replay-file')?.addEventListener('click', downloadLog);
    document.getElementById('btn-restart')?.addEventListener('click', () => {
      ctx.restart();
      input.focusForTyping();
    });

    ctx.phaserGame = new window.Phaser.Game({
      type: window.Phaser.AUTO,
      parent: 'game-root',
      backgroundColor: '#10131f',
      scale: {
        mode: window.Phaser.Scale.RESIZE,
        autoCenter: window.Phaser.Scale.CENTER_BOTH
      },
      scene: createBattleScene(ctx)
    });

    document.body.classList.remove('page-loading');
  } catch (err) {
    document.body.classList.remove('page-loading');
    if (errorEl) errorEl.textContent = `無法開始遊戲：${err.message}`;
    console.error(err);
  }
}

boot();
