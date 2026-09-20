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
import { createSfx } from './game/sfx.js';
import { runCalibration } from './game/calibrate.js';
import { createSoundBridge } from './game/sound-events.js';
import { speakWord, speakSentence, stopSpeaking, listEnglishVoices } from './audio-player.js';
import { readShared, writeShared } from './local-store.js';

const params = new URLSearchParams(location.search);

/** 種子：網址給就用給的，否則隨機開一個並顯示出來，方便回報問題時附上。 */
function initialSeed() {
  const fromUrl = Number(params.get('seed'));
  if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl >>> 0;
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

const DIFFICULTY_KEY = 'gameDifficulty';

/**
 * 這次要用哪個難度。
 *
 * 優先序：網址指定 > 上次校準或手動選的 > 沒有（代表要先校準）。
 * 網址優先是給測試用的——所有自動化測試都明確指定難度，
 * 才不會每次都被校準畫面擋住。
 */
function storedDifficulty() {
  const fromUrl = params.get('difficulty');
  if (fromUrl) return fromUrl;
  const saved = readShared(DIFFICULTY_KEY);
  return saved || null;
}

const ctx = {
  words: [],
  state: null,
  log: null,
  seed: initialSeed(),
  difficulty: storedDifficulty() || 'normal',
  order: params.get('order') === 'random' ? 'random' : 'sequential',
  paused: false,
  scene: null,
  phaserGame: null,
  perf: createPerf(),
  latency: createLatency(),
  queue: createInputQueue(),
  // 測試用：人為讓遊戲有一段「不接受輸入」的空窗，驗證按鍵不會被吃掉
  blockedUntil: 0,
  sfx: null,
  soundBridge: null,

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

  /**
   * 要不要把單字顯示在畫面上。
   *
   * 預設不顯示——這是聽寫遊戲，壓力應該來自敵人逼近而不是讀字。
   * 但單字是唯一只存在於聲音裡的資訊，所以靜音、或這台裝置根本沒有
   * 英文語音時就退回顯示文字，否則等於不能玩。?show=1 可以強制顯示
   * （自動化測試靠它，無頭瀏覽器沒有安裝任何語音）。
   */
  shouldShowWord() {
    if (params.get('show') === '1') return true;
    if (ctx.sfx?.isMuted()) return true;
    return !ctx.voicesAvailable;
  },

  /**
   * 唸出目前這個字。沒有語音或靜音時什麼都不做——那兩種情況畫面會改成顯示文字。
   * @param mode 'normal' | 'slow' | 'sentence'
   */
  speakCurrentWord(mode = 'normal') {
    if (!ctx.voicesAvailable || ctx.sfx?.isMuted()) return;
    const s = ctx.state;
    if (!s || s.status !== 'running') return;
    const word = ctx.words[s.wordIndex];
    if (!word) return;
    if (mode === 'sentence') speakSentence(word.exampleSentence || word.english);
    else speakWord(word.english, { slow: mode === 'slow' });
  },

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
      applyNow(slot, slot.t0, true);
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

/**
 * 把動作套用到狀態，並立刻發聲。
 *
 * @param fromQueue 這個按鍵是頓挫期間排隊、現在才補上的嗎？
 *
 * 排隊補上的按鍵不列入延遲統計。它們被延後是設計好的行為（世界凍結時
 * 不該把輸入打在看不見的畫面上），把那段等待算成「延遲」會讓數字看起來
 * 像效能有問題，實際上量到的是頓挫本身的長度。它們另外計數，不會被藏起來。
 */
function applyNow(action, t0, fromQueue = false) {
  recordAction(ctx.log, ctx.state.tick, action);
  applyAction(ctx.state, action);
  if (fromQueue) ctx.latency.deferred += 1;
  else markApplied(ctx.latency, t0);
  /*
   * 聲音在這裡就發出去，不等下一個影格。
   *
   * 邏輯 120Hz、畫面 60Hz，等到影格開頭才發聲等於平白多吃半格到一格的延遲，
   * 而聲音的預算只有 20ms——打擊音晚一點點，手感就散了。
   */
  ctx.soundBridge?.flush(ctx.state, fromQueue ? null : t0);
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
  stopSpeaking();
  ctx.soundBridge?.reset();
  ctx.scene?.effects?.reset();
  clearInputQueue(ctx.queue);
  resetPerf(ctx.perf);
  resetLatency(ctx.latency);
  document.body.classList.remove('is-paused');
  updateHud();
}

const DIFFICULTY_LABELS = { easy: '輕鬆', normal: '標準', hard: '挑戰' };

function updateHud() {
  const el = document.getElementById('seed-label');
  if (el) el.textContent = `種子 ${ctx.seed}`;

  /*
   * 難度一定要顯示出來。
   *
   * 記住上次的選擇本身沒問題，但不顯示就會變成：同一台電腦換人玩時，
   * 下一個人默默繼承上一個人的難度。爸爸測完換小孩玩，小孩就會拿到
   * 為大人手速調的設定——模擬顯示那是 100% 失敗率，不是「比較難」。
   */
  const dl = document.getElementById('difficulty-label');
  if (dl) dl.textContent = `難度 ${DIFFICULTY_LABELS[ctx.difficulty] || ctx.difficulty}`;
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
   * ?group=w01 指定一組（Part 1~4 是 p1~p4，每週單字是 w01~w10）。
   * ?part=all 拿全部。測試要連打數百個字母時用得到——
   * 一場打得完就不必中途重開，統計才不會被重置切斷。
   */
  const group = params.get('group');
  const part = params.get('part') || '1';
  let query = '';
  if (group) query = `?group=${encodeURIComponent(group)}`;
  else if (part !== 'all') query = `?part=${encodeURIComponent(part)}`;

  const res = await fetch(`/api/wordbank${query}`);
  if (!res.ok) throw new Error(`拿不到單字庫（${res.status}）`);
  const data = await res.json();

  /*
   * 課本裡有 "alarm clock"、"a couple of" 這種含空白或連字號的詞條。
   * 它們在單字表上要看得到，但不能當打字題目——遊戲只收 a~z，
   * 孩子打到一半會發現那個空白按不出來。所以在這裡濾掉，
   * 而不是在資料裡刪掉它們。
   */
  const typeable = data.words.filter((w) => w.typeable !== false);
  if (typeable.length === 0) throw new Error(`這一組沒有可以打的字（${group || part}）`);
  return typeable;
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

    /*
     * 語音清單在某些瀏覽器是非同步載入的，第一次讀會是空的。
     * 等一小段再判斷，才不會誤以為這台裝置沒有語音而永遠顯示單字。
     */
    ctx.voicesAvailable = listEnglishVoices().length > 0;
    if (!ctx.voicesAvailable && 'speechSynthesis' in window) {
      setTimeout(() => {
        ctx.voicesAvailable = listEnglishVoices().length > 0;
      }, 600);
    }

    ctx.sfx = createSfx({ onPlayed: (name) => ctx.debug._record('sfx', { name }) });
    ctx.soundBridge = createSoundBridge(ctx.sfx, ctx.debug);

    const overlay = createOverlay(ctx);
    const input = createInput({
      onAction: (action, t0) => {
        // 瀏覽器要求先有使用者手勢才准發聲，第一個按鍵正好就是
        ctx.sfx.unlock();
        return ctx.sendAction(action, t0);
      },
      onToggleMute: () => {
        const muted = ctx.sfx.setMuted(!ctx.sfx.isMuted());
        if (muted) stopSpeaking();
        document.getElementById('btn-mute')?.dispatchEvent(new Event('refresh'));
        return muted;
      },
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
          ctx.sfx.unlock(); // 這一下點擊同時也是解鎖音訊的使用者手勢
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

    const muteBtn = document.getElementById('btn-mute');
    function refreshMuteBtn() {
      if (muteBtn) muteBtn.textContent = ctx.sfx.isMuted() ? '🔇 已靜音' : '🔊 聲音';
    }
    refreshMuteBtn();
    muteBtn?.addEventListener('refresh', refreshMuteBtn);
    muteBtn?.addEventListener('click', () => {
      ctx.sfx.unlock();
      const muted = ctx.sfx.setMuted(!ctx.sfx.isMuted());
      if (muted) stopSpeaking();
      refreshMuteBtn();
    });

    // 換人玩就按這個。網址帶 calibrate=1 重新進來，流程跟第一次一樣
    document.getElementById('btn-recalibrate')?.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('calibrate', '1');
      location.href = url.toString();
    });

    document.getElementById('btn-replay-file')?.addEventListener('click', downloadLog);
    document.getElementById('btn-restart')?.addEventListener('click', () => {
      ctx.restart();
      input.focusForTyping();
    });

    /*
     * 先決定難度再開場。
     *
     * 模擬的結果很清楚：難度選錯不是「比較難」，是完全不能玩
     * （同一個孩子 easy 10% 失敗率、hard 100%）。所以第一次玩一定先量手速，
     * 之後記住選擇；?calibrate=1 可以重新量。
     */
    const needsCalibration = params.get('calibrate') === '1' || !storedDifficulty();
    const begin = () => {
      startBattle();
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
    };

    if (needsCalibration) {
      document.body.classList.remove('page-loading');
      runCalibration({
        onDone: (result) => {
          if (result?.difficulty) {
            ctx.difficulty = result.difficulty;
            writeShared(DIFFICULTY_KEY, result.difficulty);
            ctx.calibration = result;
          }
          // 校準時他已經按過鍵了，音訊可以解鎖
          ctx.sfx.unlock();
          begin();
        }
      });
    } else {
      begin();
    }
  } catch (err) {
    document.body.classList.remove('page-loading');
    if (errorEl) errorEl.textContent = `無法開始遊戲：${err.message}`;
    console.error(err);
  }
}

boot();
