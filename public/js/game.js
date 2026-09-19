/**
 * 遊戲頁進入點（Phase 1.1）。
 *
 * 職責是把零件接起來：拿單字 → 建戰鬥狀態 → 開 Phaser → 綁鍵盤 →
 * 裝除錯 API 與 F3 疊加層。所有規則都在 core/ 裡，這裡不做任何遊戲判斷。
 *
 * 這一頁刻意跟現有的練習頁完全分開（新網址 /game），
 * 所以遊戲做到一半也不會影響小孩每天在用的東西。
 */

import { loadPhaser } from './game/load-phaser.js';
import { createBattle, applyAction } from './game/core/battle.js';
import { createRecorder, recordAction, serializeLog } from './game/core/recorder.js';
import { createInput } from './game/input.js';
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

  getState: () => ctx.state,
  getLog: () => ctx.log,
  getSeed: () => ctx.seed,
  getPerf: () => ctx.perf,
  isPaused: () => ctx.paused,
  getClockSteps: () => ctx.scene?.clock.lastSteps ?? 0,
  getClockDropped: () => ctx.scene?.clock.droppedMs ?? 0,

  onSceneReady(scene) {
    ctx.scene = scene;
    ctx.debug.ready = true;
  },

  sendAction(action) {
    if (!ctx.state || ctx.state.status !== 'running' || ctx.paused) return false;
    /*
     * 立刻套用，不等下一個邏輯步。
     *
     * 邏輯是 120Hz，等步界最多會多 8.3ms，加上等畫面更新就可能吃掉
     * 「keydown → 畫面回饋 ≤ 16ms」的預算。錄影檔記在「目前這一步」，
     * 重播時也是在同一步的步前套用，兩邊順序一致。
     */
    recordAction(ctx.log, ctx.state.tick, action);
    applyAction(ctx.state, action);
    return true;
  },

  restart(opts = {}) {
    ctx.seed = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    if (opts.difficulty) ctx.difficulty = opts.difficulty;
    if (opts.order) ctx.order = opts.order;
    startBattle();
    return ctx.seed;
  }
};

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
  resetPerf(ctx.perf);
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
  // 這個端點不需要登入、也不碰資料庫（單字庫是寫死的靜態資料），
  // 所以遊戲頁在資料庫掛掉時仍然打得開，自動化測試也不必先登入。
  const res = await fetch('/api/wordbank?part=1');
  if (!res.ok) throw new Error(`拿不到單字庫（${res.status}）`);
  const data = await res.json();
  return data.words;
}

async function boot() {
  const errorEl = document.getElementById('game-error');
  try {
    const [words] = await Promise.all([fetchWords(), loadPhaser()]);
    // Phase 1 只要少量單字就夠驗證手感，不用一次上 25 個
    const limit = Number(params.get('n')) || 20;
    ctx.words = words.slice(0, limit);
    if (ctx.words.length === 0) throw new Error('單字庫是空的');

    startBattle();

    const overlay = createOverlay(ctx);
    createInput({
      onAction: (action) => ctx.sendAction(action),
      onPause: () => {
        ctx.paused = !ctx.paused;
        document.body.classList.toggle('is-paused', ctx.paused);
      },
      onToggleOverlay: () => overlay.toggle()
    });

    document.getElementById('btn-replay-file')?.addEventListener('click', downloadLog);
    document.getElementById('btn-restart')?.addEventListener('click', () => ctx.restart());

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
