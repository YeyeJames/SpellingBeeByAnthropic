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
import { BALANCE } from './game/core/balance.js';
import { levelFromXp } from './shared/levels.js';
import { createRecorder, recordAction, serializeLog } from './game/core/recorder.js';
import { createInput, isTouchDevice } from './game/input.js';
import { createInputQueue, enqueueInput, drainInput, clearInputQueue } from './game/input-queue.js';
import { createLatency, markApplied, markRendered, resetLatency } from './game/latency.js';
import { installDebugApi } from './game/debug-api.js';
import { createOverlay } from './game/overlay.js';
import { createPerf, resetPerf } from './game/perf.js';
import { createBattleScene } from './game/battle-scene.js';
import { createSfx } from './game/sfx.js';
import { createBgm } from './game/bgm.js';
import { runCalibration } from './game/calibrate.js';
import { createSoundBridge } from './game/sound-events.js';
import {
  playWordAudio,
  speakSentence,
  stopSpeaking,
  listEnglishVoices,
  warmUpSpeech
} from './audio-player.js';
import { buildRules, buildQuickRules } from './game/rules.js';
import { newId } from './local-store.js';
import { readPref, writePref } from './prefs.js';
import { getCachedUser } from './auth.js';

const params = new URLSearchParams(location.search);

/** 種子：網址給就用給的，否則隨機開一個並顯示出來，方便回報問題時附上。 */
function initialSeed() {
  const fromUrl = Number(params.get('seed'));
  if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl >>> 0;
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

/*
 * 這三個是「這個孩子的」設定，存在帳號名下（見 prefs.js）。
 * 本來存在共用的那一份，Allen 一進遊戲就沿用 Pierce 的難度、連校準都跳過。
 */
const DIFFICULTY_KEY = 'gameDifficulty';
const ORDER_KEY = 'gameOrder';
const SHOW_WORD_KEY = 'gameShowWord';

/**
 * 出題順序。
 *
 * 網址指定就用網址的，而且跳過開場畫面——自動化測試靠這個，
 * 規則跟難度一樣。沒指定就記住上次選的，當作開場畫面的預設。
 */
function storedOrder() {
  const fromUrl = params.get('order');
  if (fromUrl === 'random' || fromUrl === 'sequential') return fromUrl;
  const saved = readPref(ORDER_KEY);
  return saved === 'random' || saved === 'sequential' ? saved : null;
}

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
  const saved = readPref(DIFFICULTY_KEY);
  return saved || null;
}

const ctx = {
  words: [],
  state: null,
  log: null,
  seed: initialSeed(),
  difficulty: storedDifficulty() || 'normal',
  order: storedOrder() || 'sequential',
  groupLabel: '',
  // 進遊戲之前這一組的最高分，結算拿它比「破紀錄了沒」
  bestBefore: 0,
  /*
   * 等級、累計經驗、以前錯過的字（C2）。
   * 由 /api/game/access 帶下來；拿不到就是 1 級、空名單，等同 C2 之前的行為。
   */
  level: 1,
  xp: 0,
  relearnIds: null,
  /* 裝備（C5）。拿不到就是全裸，也就是 C5 之前的行為 */
  equipped: null,
  honey: 0,
  /*
   * 戰役關卡（C3）。?level=N 時才有值；其餘情況是 null，
   * 也就是原本「直接打某一組」的玩法，完全不受影響。
   */
  /*
   * 用哪一本課本。
   *
   * 從本地快取的帳號讀（純 localStorage，不連網、也不會把人導走——
   * 遊戲頁刻意不強制登入，資料庫掛掉時它還是要打得開）。
   * 伺服器的回應（access / campaign）帶了就以它為準。
   */
  wordBankId: getCachedUser()?.wordBankId || null,
  campaignLevel: Number(params.get('level')) || null,
  campaignInfo: null,
  levelLimit: null,
  /* 這一關的特殊敵人（C6）。不是戰役關卡就是 null = 全部普通敵人 */
  enemyTraits: null,
  lastSilent: null,
  levelLocked: false,
  paused: false,
  scene: null,
  phaserGame: null,
  perf: createPerf(),
  latency: createLatency(),
  queue: createInputQueue(),
  // 測試用：人為讓遊戲有一段「不接受輸入」的空窗，驗證按鍵不會被吃掉
  blockedUntil: 0,
  sfx: null,
  bgm: null,
  soundBridge: null,
  // 每一場一個 id，分數回報用它去重（同一場重送不會被加兩次）
  battleId: newId(),
  // 這次開機以來已經打完的每一場錄影（當下這一場在 ctx.log）
  sessionLogs: [],
  /*
   * 要不要把單字寫在畫面上。
   * null = 照自動規則（靜音或沒語音就顯示）；true/false = 他自己按過按鈕。
   */
  showWord: readPref(SHOW_WORD_KEY) === null ? null : readPref(SHOW_WORD_KEY) === '1',

  /** 一場結束。畫面端在 BATTLE_END 時呼叫。 */
  onBattleEnd(state, won) {
    reportResult(state, won);
    // 戰役關卡另外記一筆：過了就解開下一關（C3）
    if (ctx.campaignLevel) reportLevelClear(state, won);
    showPostgame(state, won);
  },

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

  /** 每一格由畫面端呼叫，把進度寫回上方那一條。 */
  syncHud: (state) => syncHud(state),

  /*
   * 靜音蟲：重聽鍵對牠沒有用，所以要看得出來（C6 / §5）。
   *
   * 不把按鈕藏起來——藏起來的話畫面會跳動，而且他會以為功能壞了。
   * 變灰 + 加一句說明，他按下去之前就知道為什麼。
   */
  syncListenButtons(state) {
    const silent = state?.trait === 'silent';
    if (silent === ctx.lastSilent) return;
    ctx.lastSilent = silent;
    document.querySelectorAll('[data-listen]').forEach((btn) => {
      btn.classList.toggle('is-disabled', silent);
      btn.title = silent ? '這隻是靜音蟲，只唸一次，重聽沒有用' : '';
    });
  },

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
    /*
     * 明確按過按鈕就聽他的。
     *
     * 自動規則（靜音或沒語音才顯示）本身是對的，但它把「看得到字」藏在
     * 一個講的是聲音的按鈕後面——沒有喇叭的電腦上，他看到的是一片空白，
     * 而唯一的解法是去按「靜音」，那完全沒有道理，也沒有人猜得到。
     */
    if (ctx.showWord === true) return true;
    /*
     * 靜音的時候不接受「不顯示」。
     *
     * 「靜音也要能玩」是硬性要求，而單字是唯一只存在於聲音裡的資訊——
     * 靜音又不顯示等於完全沒得玩。這不是假設：多按一下就會進到那個狀態，
     * 而畫面上不會有任何說明，他只會覺得遊戲壞了。
     */
    if (ctx.sfx?.isMuted()) return true;
    if (ctx.showWord === false) return false;
    return !ctx.voicesAvailable;
  },

  /** 自動規則現在會給什麼答案（按鈕的預設值從這裡來）。 */
  autoShowWord() {
    if (ctx.sfx?.isMuted()) return true;
    return !ctx.voicesAvailable;
  },

  /**
   * 設定要不要顯示單字。
   * @param v true/false 是明確指定，null 是交還給自動規則
   */
  setShowWord(v) {
    ctx.showWord = v === null ? null : !!v;
    if (v === null) writePref(SHOW_WORD_KEY, null);
    else writePref(SHOW_WORD_KEY, ctx.showWord ? '1' : '0');
    ctx.refreshAudioButtons?.();
    return ctx.showWord;
  },

  /**
   * 唸出目前這個字。
   *
   * 有真人錄音就播錄音——孩子特地為唸錯的字錄了自己的聲音，
   * 遊戲裡卻還用機器語音唸，那個錄音等於白錄。playWordAudio 會自己
   * 處理「錄音抓不到就退回 TTS」。
   *
   * 靜音時什麼都不做（畫面會改成顯示文字）。沒有 TTS 語音但有錄音時
   * 仍然要播：那個字聽得到，不該被當成整台裝置沒有聲音。
   *
   * @param mode 'normal' | 'slow' | 'sentence'
   */
  speakCurrentWord(mode = 'normal') {
    if (ctx.sfx?.isMuted()) return;
    const s = ctx.state;
    if (!s || s.status !== 'running') return;
    const word = ctx.words[s.wordIndex];
    if (!word) return;

    const recorded = word.audio?.type === 'recorded';
    if (!recorded && !ctx.voicesAvailable) return;

    if (mode === 'sentence') {
      // 例句沒有錄音，只有單字本身有
      if (ctx.voicesAvailable) speakSentence(word.exampleSentence || word.english);
      return;
    }
    playWordAudio(word, { slow: mode === 'slow' });
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
    /*
     * 結算畫面要收掉。
     *
     * 重開有兩條路——結算上的「再打一場」與工具列的「重開一場」。
     * 只在前者收的話，從工具列重開會讓結算蓋在新的一場上面，整場看不見也打不到。
     */
    const post = document.getElementById('postgame');
    if (post) post.hidden = true;
    setChromeAbovePostgame(false);
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
    order: ctx.order,
    /*
     * 等級與重學名單來自 /api/game/access。
     *
     * 拿不到（離線、沒登入、資料庫在睡）就是 1 級、空名單——也就是 C2 之前
     * 的行為。遊戲本來就刻意做成「資料庫掛了也打得開」，等級不該是例外：
     * 少了成長很可惜，打不開是災難。
     */
    level: ctx.level,
    xp: ctx.xp,
    relearnIds: ctx.relearnIds,
    equipped: ctx.equipped,
    enemyTraits: ctx.enemyTraits
  });
  /*
   * 換一場之前先把上一場收進這次開機的檔案櫃。
   *
   * 原本 ctx.log 是直接覆蓋掉的，所以他連玩三場，我只拿得到第三場——
   * 而「他玩了幾場」「第一場玩完了沒」正是最想知道的事。
   */
  if (ctx.log && ctx.log.entries.length > 0) ctx.sessionLogs.push(ctx.log);
  ctx.log = createRecorder({
    seed: ctx.seed,
    difficulty: ctx.difficulty,
    order: ctx.order,
    /*
     * 錄的是「基礎血量」，不是加成後的。
     *
     * ctx.state.maxHp 已經含了等級給的血；連同 level 一起錄下去的話，
     * 重播時加成會被套兩次。錄基礎值，等級的部分由 level 在重播時自己算。
     */
    maxHp: BALANCE.maxHp,
    level: ctx.level,
    xp: ctx.xp,
    relearnIds: ctx.relearnIds,
    equipped: ctx.equipped,
    enemyTraits: ctx.enemyTraits,
    wordIds: ctx.words.map((w) => w.id)
  });
  ctx.paused = false;
  ctx.blockedUntil = 0;
  ctx.battleId = newId();
  stopSpeaking();
  // 音樂跟著戰鬥起停。start 只在第一次真的開始播，之後重複呼叫沒有副作用
  ctx.bgm?.start();
  ctx.soundBridge?.reset();
  ctx.scene?.effects?.reset();
  ctx.scene?.clearMiss?.();
  clearInputQueue(ctx.queue);
  resetPerf(ctx.perf);
  resetLatency(ctx.latency);
  document.body.classList.remove('is-paused');
  updateHud();
}

const DIFFICULTY_LABELS = { easy: '輕鬆', normal: '標準', hard: '挑戰' };
const ORDER_LABELS = { sequential: '照順序', random: '打亂' };

/*
 * 進度列的快取。
 *
 * 這兩個數字每一格都要對一次，但幾乎每一格都沒變。不比對就直接寫 textContent
 * 的話，等於每秒配置六十次字串——之前量過，那種每格配置正是造成 GC 頓挫的原因。
 */
let lastKilled = -1;
let lastMissed = -1;

/**
 * 每一格由 battle-scene 呼叫。只有數字真的變了才動 DOM。
 *
 * 原本只寫「打完 3 / 14」。少了兩個他其實更在意的數字：漏掉幾個、
 * 還剩幾個。「還剩幾個」尤其重要——那是他判斷「要不要撐完這一場」的依據。
 * 漏掉的字會排回隊伍尾端，所以剩下的數量不等於 總數 − 打完，要另外算。
 */
function syncHud(state) {
  if (!state) return;
  const { wordsKilled, wordsMissed } = state.stats;
  if (wordsKilled === lastKilled && wordsMissed === lastMissed) return;
  lastKilled = wordsKilled;
  lastMissed = wordsMissed;

  const el = document.getElementById('progress-label');
  if (!el) return;
  const total = ctx.words.length;
  // 還沒登場的 + 正在打的那一隻
  const left = Math.max(0, state.queue.length - state.queueHead + (state.wordIndex >= 0 ? 1 : 0));
  el.innerHTML =
    `✅ 打完 ${wordsKilled} / ${total}` +
    `　<span class="miss">❌ 漏掉 ${wordsMissed}</span>` +
    `　<span class="left">還剩 ${left} 個</span>`;
}

function updateHud() {
  const el = document.getElementById('seed-label');
  if (el) el.textContent = `種子 ${ctx.seed}`;

  // 現在練的是哪一組。沒有這個，畫面上就只剩一個一個冒出來的字
  const gl = document.getElementById('group-label');
  if (gl) {
    gl.textContent = ctx.groupLabel
      ? `${ctx.groupLabel}・${ctx.words.length} 字・${ORDER_LABELS[ctx.order]}`
      : '';
  }

  // 強制重畫進度（換一場時計數歸零，但快取還停在上一場的數字）
  lastKilled = -1;
  lastMissed = -1;
  syncHud(ctx.state);

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

/*
 * 玩法說明。
 *
 * 規則本來只存在於程式碼裡——按 ↑ 會重聽，但「重聽要付什麼代價」畫面上
 * 一個字都沒有。他按了、敵人突然衝了一段，他不知道是自己按的還是遊戲壞了。
 * 看不懂的規則等於不存在。
 *
 * 打開時一定要暫停：規則有六段，讀完至少二十秒，沒暫停的話讀一讀就死了。
 */
let rulesWasPaused = false;

function renderRules() {
  const body = document.getElementById('rules-body');
  if (!body || body.dataset.difficulty === ctx.difficulty) return;
  body.dataset.difficulty = ctx.difficulty;
  body.innerHTML = buildRules(ctx.difficulty)
    .map(
      (sec) =>
        `<section class="rules-section"><h3>${sec.icon} ${escapeHtml(sec.title)}</h3><ul>` +
        sec.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('') +
        '</ul></section>'
    )
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function rulesOpen() {
  return document.getElementById('rules-panel')?.hidden === false;
}

function toggleRules(force) {
  const el = document.getElementById('rules-panel');
  if (!el) return;
  const next = force === undefined ? el.hidden : force;
  if (next) {
    renderRules();
    // 記住原本暫停了沒有：他可能本來就停在暫停畫面讀東西，關掉說明不該把他推回戰鬥
    rulesWasPaused = ctx.paused;
    setPaused(true);
    el.hidden = false;
  } else {
    el.hidden = true;
    if (!rulesWasPaused) setPaused(false);
    ctx.input?.focusForTyping();
  }
}

/** 下載目前這一場的錄影檔。小孩按「剛剛怪怪的」就是按這個。 */
function downloadLog() {
  if (!ctx.log) return;
  /*
   * 匯出這次開機以來的**每一場**，不是只有當下這一場。
   *
   * 給 scripts/analyze-log.mjs 吃。多存幾場的成本是幾十 KB，
   * 但少存的代價是「他玩了幾場、有沒有玩完」這種問題根本答不出來。
   */
  const battles = ctx.log.entries.length > 0 ? [...ctx.sessionLogs, ctx.log] : [...ctx.sessionLogs];
  const bundle = {
    kind: 'session',
    createdAt: new Date().toISOString(),
    group: params.get('group') || null,
    groupLabel: ctx.groupLabel || null,
    battles
  };
  const blob = new Blob([serializeLog(bundle)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  a.download = `spellbee-${params.get('group') || 'game'}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/*
 * 這個帳號用哪一本課本。
 *
 * 兩個孩子各有各的單字庫。/api/wordbank 刻意不需要登入（資料庫掛掉時
 * 遊戲仍然打得開），所以它看不到 req.user——課本只能由這邊帶過去。
 * 拿不到就不帶，伺服器會給預設那一本，跟以前一樣。
 */
function bankParam() {
  return ctx.wordBankId ? `bank=${encodeURIComponent(ctx.wordBankId)}` : '';
}
function bankQuery() {
  const p = bankParam();
  return p ? `&${p}` : '';
}

/**
 * 這一關要打哪些字（C3）。
 *
 * 回 null 代表拿不到（沒登入、離線、關卡鎖著），呼叫端會退回一般的
 * group/part 流程——遊戲的底線是「資料庫掛了也打得開」，戰役不該是例外。
 * 關卡鎖著時把訊息顯示出來，不然他只會看到一場莫名其妙的普通戰鬥。
 */
async function fetchLevelWordIds(level) {
  try {
    const res = await fetch(`/api/campaign/level/${encodeURIComponent(level)}`, {
      credentials: 'same-origin'
    });
    if (res.status === 403) {
      const data = await res.json().catch(() => ({}));
      showLevelLocked(data);
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    ctx.campaignInfo = data.level || null;
    // 伺服器知道他真正用哪一本，以它為準
    if (data.wordBankId) ctx.wordBankId = data.wordBankId;
    // 關卡指定的出題順序蓋過記住的偏好——第 2 章的重點就是「這次是亂的」
    if (data.order) ctx.order = data.order;
    ctx.levelLimit = data.limit || null;
    // 這一關會出現哪些特殊敵人（C6）
    ctx.enemyTraits = data.level?.enemyTraits || null;
    return data.wordIds || null;
  } catch (err) {
    return null;
  }
}

/** 從單字庫撈出指定的那些 id，順序照伺服器給的。 */
async function wordsFromIds(ids) {
  // 只拿自己那一本課本的字（bankQuery 見下面）
  const res = await fetch(`/api/wordbank?part=all${bankQuery()}`);
  if (!res.ok) throw new Error(`拿不到單字庫（${res.status}）`);
  const data = await res.json();
  const byId = new Map(data.words.map((w) => [w.id, w]));
  const picked = ids.map((id) => byId.get(id)).filter((w) => w && w.typeable !== false);
  if (!picked.length) throw new Error('這一關沒有可以打的字');
  ctx.groupLabel = ctx.campaignInfo
    ? `第 ${ctx.campaignInfo.level} 關・${ctx.campaignInfo.subtitle}`
    : '戰役';
  return picked;
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
  /*
   * 戰役關卡（C3）：?level=N。
   *
   * 哪幾組、幾個字、什麼順序全部由伺服器決定（見 routes/campaign.js）——
   * 前端自己挑的話，他打第 3 關卻送「第 100 關過了」上來，整條戰役就沒意義了。
   * 拿不到（離線、資料庫在睡）就退回原本的 group/part 那條路，
   * 遊戲本來就設計成資料庫掛掉也打得開。
   */
  if (ctx.campaignLevel) {
    const ids = await fetchLevelWordIds(ctx.campaignLevel);
    if (ids) return wordsFromIds(ids);
  }

  const group = params.get('group');
  const part = params.get('part') || '1';
  let query = '';
  if (group) query = `?group=${encodeURIComponent(group)}`;
  else if (part !== 'all') query = `?part=${encodeURIComponent(part)}`;

  const res = await fetch(`/api/wordbank${query}${query ? '&' : '?'}${bankParam()}`);
  if (!res.ok) throw new Error(`拿不到單字庫（${res.status}）`);
  const data = await res.json();

  /*
   * 一組就是一組，不再濾掉任何字。
   *
   * 以前 "alarm clock" 這種含空白的詞條進不了遊戲（只收 a~z），於是同一組
   * 在練習頁是 49 個字、在遊戲裡是 46 個。兩個數字對不起來很難解釋，
   * 而且那幾個字他在遊戲裡永遠練不到。現在空白鍵就是一個字母，
   * 見 core/charset.js。
   */
  const typeable = data.words.filter((w) => w.typeable !== false);
  if (typeable.length === 0) throw new Error(`這一組沒有可以打的字（${group || part}）`);

  /*
   * 畫面上要寫「Week 6」而不是「w06」。
   * ?part=all 會橫跨很多組（測試在用），那就誠實寫「全部」，
   * 不要挑第一個字的組別當標題——那會是錯的。
   */
  const ids = new Set(typeable.map((w) => w.group));
  if (ids.size === 1) {
    const found = (data.groups || []).find((g) => g.id === typeable[0].group);
    ctx.groupLabel = found ? found.label : typeable[0].group || '';
  } else {
    ctx.groupLabel = '全部';
  }

  /*
   * 補上「哪些字有真人錄音」。
   *
   * 這支要登入、要資料庫，所以失敗是可以接受的——拿不到就全部用機器語音，
   * 遊戲照玩。不能因為這一步讓整個遊戲開不起來：/api/wordbank 刻意設計成
   * 不碰資料庫，就是為了資料庫掛掉時還能玩。
   */
  const recorded = await fetchRecordedIds();
  ctx.recordedCount = 0;
  return typeable.map((w) => {
    const hasRecording = recorded.has(w.id);
    if (hasRecording) ctx.recordedCount += 1;
    return {
      ...w,
      _id: w.id, // playWordAudio 用 _id 組音檔網址
      audio: { type: hasRecording ? 'recorded' : 'tts' }
    };
  });
}

/*
 * 解鎖關卡：這一組在練習模式完整做完兩次了嗎？
 *
 * 目的不是防弊，是**順序**：練習模式看得到中文、例句，答完還會把正確拼法
 * 亮出來；遊戲模式是考試。沒看過就直接考，他只會一直被沒見過的字打死。
 *
 * 問不到答案時（沒登入、資料庫掛了、離線）一律放行。理由很實際：
 * 這種時候他連練習都練不了，再把遊戲也鎖起來等於整個 app 不能用，
 * 而那個代價遠大於「偶爾跳過順序玩一場」。
 */
async function fetchGroupAccess(group) {
  if (!group) return { unlocked: true, reason: 'no-group' };
  try {
    const res = await fetch(`/api/game/access?group=${encodeURIComponent(group)}`, {
      credentials: 'same-origin'
    });
    if (!res.ok) return { unlocked: true, reason: `status-${res.status}` };
    const data = await res.json();
    return { ...data, reason: 'checked' };
  } catch (err) {
    return { unlocked: true, reason: 'offline' };
  }
}

/**
 * 結算畫面。
 *
 * 他第一次打完的第一句話是「然後要怎麼回去」——原本打完只有畫布中央
 * 一行字，出口是上方工具列那顆小小的「← 回練習」，而那一排是刻意做小的
 * （平常不會看）。成就感最高的那一刻卻是唯一沒有出口的地方。
 *
 * 所以這裡做三件事：講結果、講成績、把下一步直接攤開。
 */
/*
 * 結算蓋出來的時候，把下面那條工具列抬到它上面。
 *
 * 結算是整片 position:fixed inset:0，會把工具列整條蓋住——而工具列上有
 * 「剛剛怪怪的」，那是他覺得哪裡不對時按的錄影下載鍵。打完一場正是最想按
 * 那一顆的時刻，卻剛好是它被蓋住的時刻。靜音與回練習同理。
 *
 * 只動結算這一個畫面：開場那一片本來就該擋住工具列（那時候按「重開一場」
 * 會在戰鬥還沒建立的情況下重開）。
 */
function setChromeAbovePostgame(on) {
  const chrome = document.getElementById('game-chrome');
  if (chrome) chrome.style.zIndex = on ? '25' : '';
}

/*
 * 蜂蜜存款那一列，等伺服器回來才填得出來。
 *
 * 結算畫面是戰鬥一結束就畫的（不能等網路——等了就變成盯著空白畫面），
 * 而存款總額只有伺服器知道。所以先留一列寫「同步中…」，回來再補上。
 * 一直沒回來（離線）就維持原樣，至少這一場賺了多少還是看得到。
 */
function updatePostgameHoney(total) {
  const el = document.getElementById('postgame-honey-total');
  // 標題已經寫了「蜂蜜存款」，這裡只放數字，不要重複兩次「存款」
  if (el) el.textContent = `🍯 ${total}`;
}

function showPostgame(state, won) {
  const el = document.getElementById('postgame');
  if (!el || !state) return;

  el.classList.toggle('is-lost', !won);
  document.getElementById('postgame-title').textContent = won
    ? '🎉 全部打完了！'
    : '💥 蜂巢被攻破了';
  document.getElementById('postgame-group').textContent = ctx.groupLabel
    ? `${ctx.groupLabel}・${ORDER_LABELS[ctx.order] || ''}`
    : '';

  const s = state.stats;
  const letters = s.correctLetters + s.wrongLetters;
  const accuracy = letters > 0 ? Math.round((s.correctLetters / letters) * 100) : 0;
  /*
   * 破紀錄要單獨標出來。
   *
   * 「再打一場」需要一個理由，而「上次 820，這次 910」就是那個理由——
   * 比任何文案都有效。第一次玩沒有舊紀錄，那就不要假裝有。
   */
  const best = ctx.bestBefore || 0;
  const isBest = state.honey > best;

  /*
   * 每一列是 { 標題, 數字, 要不要highlight, 後綴 }。
   *
   * highlight 與「破紀錄」原本是同一個旗標，結果經驗值那幾列也被寫上
   * 「（破紀錄！）」——經驗每一場都在漲，那三個字放在它旁邊完全沒有意義。
   * 分開之後，要亮的就亮，該講的話各自講各自的。
   */
  const rows = [
    { label: '🍯 這場蜂蜜', value: String(state.honey), hot: isBest, note: isBest ? '破紀錄！' : '' },
    /*
     * 蜂蜜存款（C5）。
     *
     * 存款總額只有伺服器知道，而結算畫面是戰鬥一結束就畫的（等網路就變成
     * 盯著空白畫面）。所以先留這一列、等回應回來再填（updatePostgameHoney）。
     * 沒有它的話，他只看得到單場賺多少，看不出離下一件裝備還有多遠——
     * 而那正是再打一場的理由。
     */
    { label: '🏦 蜂蜜存款', value: '同步中…', id: 'postgame-honey-total' },
    { label: '🐝 打掉的字', value: `${s.wordsKilled} 個` },
    { label: '💨 漏掉的字', value: `${s.wordsMissed} 個` },
    { label: '🎯 字母正確率', value: `${accuracy}%` }
  ];
  if (best > 0) {
    rows.push({ label: isBest ? '🏆 原本最高' : '🏆 最高紀錄', value: String(best) });
  }

  /*
   * 戰役關卡（C3）：星等。
   * 由伺服器判（打贏 1 顆、正確率 ≥90% 2 顆、零失誤 3 顆），所以先留位置。
   */
  if (ctx.campaignLevel) {
    rows.push({
      label: `🗺️ 第 ${ctx.campaignLevel} 關`,
      value: '結算中…',
      id: 'postgame-level',
      hot: won
    });
  }

  /*
   * 經驗值與等級（C2）。
   *
   * 「賺到多少經驗」要跟「離下一級還差多少」放在一起——只寫賺了多少，
   * 他不會知道那算多還是少；寫出還差多少，下一場就有了一個具體的目標。
   */
  const lv = levelFromXp(state.totalXp);
  const leveled = state.level > state.startLevel;
  rows.push({ label: '⬆️ 這場經驗', value: `+${state.xp} XP`, hot: leveled });
  rows.push({
    label: leveled ? `🎉 升到 ${state.level} 級` : `📈 等級 ${state.level}`,
    value: `還差 ${Math.max(0, lv.need - lv.into)} XP`,
    hot: leveled,
    note: leveled ? `升了 ${state.level - state.startLevel} 級` : ''
  });
  /*
   * 重學回來的字單獨一列。
   *
   * 這是整個經驗設計想要他多做的行為（一個 25 XP，普通的字 5 XP），
   * 所以做到了就要在結算上被看見。一個都沒有的時候不列——
   * 列一個 0 出來只是噪音。
   */
  if (s.relearns > 0) {
    rows.push({
      label: '⭐ 學回來的字',
      value: `${s.relearns} 個`,
      hot: true,
      note: '以前錯過的'
    });
  }

  const box = document.getElementById('postgame-stats');
  if (box) {
    box.innerHTML = rows
      .map(
        (r) =>
          `<div class="stat-row${r.hot ? ' is-best' : ''}"><span>${escapeHtml(r.label)}${
            r.note ? `（${escapeHtml(r.note)}）` : ''
          }</span><b${r.id ? ` id="${r.id}"` : ''}>${escapeHtml(r.value)}</b></div>`
      )
      .join('');
  }

  /*
   * 紀錄往上推。
   *
   * 不推的話，同一次開機打第二場時比的還是「進遊戲之前」那個舊紀錄——
   * 他會在明明沒有超過剛剛那場的情況下又看到一次「破紀錄」。
   */
  if (isBest) ctx.bestBefore = state.honey;

  /*
   * 戰役關卡打完，出口要回地圖不是回練習——他是從地圖來的。
   * 不是戰役關卡就維持原樣（回練習挑別組）。
   */
  const practiceLink = document.getElementById('postgame-practice');
  if (practiceLink) {
    if (ctx.campaignLevel) {
      practiceLink.textContent = '🗺️ 回戰役地圖';
      practiceLink.setAttribute('href', '/campaign.html');
    } else {
      practiceLink.textContent = '🎧 回練習挑別組';
      practiceLink.setAttribute('href', '/practice.html');
    }
  }

  const again = document.getElementById('postgame-again');
  if (again) {
    again.onclick = () => {
      el.hidden = true;
      ctx.sfx?.unlock();
      // 換一顆新種子：同一組不會每次都照同樣的順序打
      ctx.restart();
    };
  }
  el.hidden = false;
  setChromeAbovePostgame(true);
}

/**
 * 打完一關（C3）。
 *
 * 只送關號與結果，星等與「解不解得開下一關」都由伺服器判斷——
 * 前端說了算的話，改個網址就能把一百關一次跳完。
 */
async function reportLevelClear(state, won) {
  const s = state.stats;
  const letters = s.correctLetters + s.wrongLetters;
  try {
    const res = await fetch('/api/campaign/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        opId: `${ctx.seed}:${ctx.battleId}`,
        level: ctx.campaignLevel,
        won,
        score: state.honey,
        accuracy: letters > 0 ? s.correctLetters / letters : 0
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    updatePostgameLevel(data, won);
  } catch (err) {
    /* 記不到就算了，不要擋住結算畫面 */
  }
}

/**
 * 結算畫面上的關卡結果，等伺服器回來才填得出來（星等是它判的）。
 * 順便把「下一關」的按鈕換上去——打完最想做的就是接著打下一關。
 */
function updatePostgameLevel(data, won) {
  const el = document.getElementById('postgame-level');
  if (el) {
    el.textContent = won
      ? `${'★'.repeat(data.stars || 1)}${'☆'.repeat(3 - (data.stars || 1))}`
      : '沒過';
  }
  if (!won || !data.advanced || !data.nextLevel) return;
  const again = document.getElementById('postgame-again');
  if (!again) return;
  /*
   * 過關之後「再打一場」就不是他想要的了——他要的是下一關。
   * 把主要按鈕換成前進，重打同一關還是可以從地圖回去。
   */
  again.textContent = `➡️ 第 ${data.nextLevel} 關`;
  again.onclick = () => {
    location.href = `/game?level=${data.nextLevel}`;
  };
}

/**
 * 打完一場，把分數記在這個帳號底下。
 *
 * 失敗就算了——分數沒記到很可惜，但絕對不該讓結算畫面卡住或跳錯誤。
 * opId 讓伺服器去重，重送同一場不會被加兩次。
 */
async function reportResult(state, won) {
  const group = params.get('group');
  if (!group || !state) return;
  const s = state.stats;
  const letters = s.correctLetters + s.wrongLetters;
  try {
    const res = await fetch('/api/game/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        opId: `${ctx.seed}:${ctx.battleId}`,
        groupId: group,
        score: state.honey,
        accuracy: letters > 0 ? s.correctLetters / letters : 0,
        won,
        wordsKilled: s.wordsKilled,
        wordsMissed: s.wordsMissed,
        /*
         * 經驗值的算式材料。刻意不送前端算好的總分——
         * 送了等於讓瀏覽器自己決定要升幾級。伺服器用同一個
         * shared/levels.js 重算，而且每一項都夾在這一組的上限之內。
         */
        correctLetters: s.correctLetters,
        wrongLetters: s.wrongLetters,
        longKills: s.longKills,
        relearns: s.relearns
      })
    });
    if (res.ok) {
      const data = await res.json();
      /*
       * 以伺服器為準。
       *
       * 前端在戰鬥中是用同一條公式即時算的，正常情況下兩邊一樣；
       * 但「重送的那一場」伺服器會回 duplicate 且不再加經驗，
       * 這時候就必須聽它的，否則重整一次經驗又會對不上。
       */
      if (typeof data.xp === 'number') {
        ctx.xp = data.xp;
        ctx.level = Number(data.level) || ctx.level;
      }
      /*
       * 蜂蜜存款（C5）。伺服器記完之後把新的總額回來，結算畫面要寫出
       * 「這一場賺了多少、總共存了多少」——只寫單場的話他看不出自己
       * 離下一件裝備還有多遠，而那正是再打一場的理由。
       */
      if (typeof data.honey === 'number') {
        ctx.honey = data.honey;
        updatePostgameHoney(data.honey);
      }
      return data;
    }
  } catch (err) {
    /* 記不到分數就算了，不要擋住結算畫面 */
  }
  return null;
}

/** 有真人錄音的單字 id。拿不到就回空集合，代表全部用機器語音。 */
async function fetchRecordedIds() {
  try {
    const res = await fetch('/api/words/recorded', { credentials: 'same-origin' });
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set(data.wordIds || []);
  } catch (err) {
    return new Set();
  }
}

function setPaused(next) {
  ctx.paused = next;
  document.body.classList.toggle('is-paused', ctx.paused);
}

/**
 * 這一組還沒解鎖。
 *
 * 不是丟一句「不能玩」就算了——要講清楚還差幾次，而且直接給一顆按鈕
 * 帶他去練習模式。看得到目標才有動力，而不是撞到一道沒有出口的牆。
 */
function showLocked(access) {
  const el = document.getElementById('locked-panel');
  document.body.classList.remove('page-loading');
  if (!el) return;
  const need = access.completionsNeeded ?? access.unlockAfter ?? 2;
  document.getElementById('locked-group').textContent = access.group?.label || '這一組';
  document.getElementById('locked-detail').textContent =
    `已經在練習模式完整做完 ${access.practiceCompletions || 0} 次，` +
    `還要再 ${need} 次才能玩遊戲。`;
  el.hidden = false;
}

/**
 * 這一關還沒解開（C3）。
 *
 * 借用「組別沒解鎖」那一塊畫面——兩者是同一件事的兩種說法，
 * 長得一樣他就不用重新認一次。但按鈕要帶去戰役地圖，不是練習頁。
 */
function showLevelLocked(data) {
  const el = document.getElementById('locked-panel');
  document.body.classList.remove('page-loading');
  if (!el) return;
  document.getElementById('locked-group').textContent = `第 ${ctx.campaignLevel} 關`;
  document.getElementById('locked-detail').textContent =
    data.nextLevel ? `先去把第 ${data.nextLevel} 關打過。` : '先從第 1 關開始。';
  const back = el.querySelector('.btn-locked-back');
  if (back) {
    back.textContent = '看戰役地圖';
    back.setAttribute('href', '/campaign.html');
  }
  el.hidden = false;
  ctx.levelLocked = true;
}

async function boot() {
  const errorEl = document.getElementById('game-error');
  const imeEl = document.getElementById('ime-warning');
  const tapEl = document.getElementById('tap-to-start');

  try {
    /*
     * 先問這一組開不開得起來，再去載 Phaser 與單字。
     * 鎖著的話載了也用不到，而且那是幾百 KB。
     */
    const access = await fetchGroupAccess(params.get('group'));
    if (!access.unlocked) {
      showLocked(access);
      return;
    }
    /*
     * 開打前的最高分先記下來。
     *
     * 結算要說「破紀錄了」，就得知道紀錄是多少——而打完之後伺服器回的
     * bestScore 已經把這一場算進去了，拿它來比永遠都是平手。
     */
    ctx.bestBefore = Number(access.bestScore) || 0;
    if (access.wordBankId) ctx.wordBankId = access.wordBankId;
    // C2：等級與重學名單。離線或拿不到時維持 1 級、空名單
    ctx.level = Number(access.level) || 1;
    ctx.xp = Number(access.xp) || 0;
    ctx.relearnIds = Array.isArray(access.relearnIds) ? access.relearnIds : null;
    ctx.equipped = access.equipped || null;
    ctx.honey = Number(access.honey) || 0;

    const [words] = await Promise.all([fetchWords(), loadPhaser()]);
    // 關卡鎖著的話上面已經把說明畫出來了，不要再開一場空的戰鬥
    if (ctx.levelLocked) return;
    /*
     * 一場幾個字。
     *
     * 網址的 ?n= 最優先（測試在用），其次是關卡自己的上限（混合關會把
     * 好幾組加起來，一場打不完），都沒有才用預設。
     *
     * ⚠️ 戰役關卡的「沒有上限」是 null，意思是**整組都要打**，
     * 不是「用預設的 20」。掉進 20 的話：
     *   - 地圖上寫「Week 1・40 字」，實際只打得到 20 個——畫面在說謊
     *   - 第一章的工作是「把整本課本走過一遍」，而每一關都少一半，
     *     等於有一半的字他在戰役裡永遠碰不到（campaign-test 第 2 節
     *     那條「一組單字都不能漏」測的是關卡表，測不到這裡）
     * 所以戰役關卡沒有上限時，上限就是這一關的全部字數。
     */
    const defaultLimit = ctx.campaignLevel ? words.length : 20;
    const limit = Number(params.get('n')) || ctx.levelLimit || defaultLimit;
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
    ctx.bgm = createBgm(ctx.sfx);
    ctx.soundBridge = createSoundBridge(ctx.sfx, ctx.debug);

    const overlay = createOverlay(ctx);
    const input = createInput({
      onAction: (action, t0) => {
        // 瀏覽器要求先有使用者手勢才准發聲，第一個按鍵正好就是
        ctx.sfx.unlock();
        // 語音引擎也要一起叫醒，否則 iOS 上第一個單字的開頭會被切掉
        warmUpSpeech();
        return ctx.sendAction(action, t0);
      },
      onToggleMute: () => {
        const muted = ctx.sfx.setMuted(!ctx.sfx.isMuted());
        if (muted) stopSpeaking();
        document.getElementById('btn-mute')?.dispatchEvent(new Event('refresh'));
        return muted;
      },
      onPause: (info) => {
        // 說明開著的時候，Esc 的意思是「關掉說明」而不是「繼續戰鬥」
        if (rulesOpen()) return toggleRules(false);
        return setPaused(info?.force ? true : !ctx.paused);
      },
      onToggleRules: () => toggleRules(),
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

    /*
     * 聲音與顯示單字這兩個開關，**開場畫面與遊戲外框各有一組**。
     *
     * 只放在外框那一排是不夠的：等他找到按鈕，第一隻蟲已經撞進蜂巢了。
     * 兩組按鈕改同一份狀態，所以每次變更都要把兩邊一起重畫——
     * 不然他會看到兩顆按鈕講相反的話。
     */
    const muteBtns = ['btn-mute', 'pregame-mute'].map((id) => document.getElementById(id));
    const showWordBtns = ['btn-show-word', 'pregame-show-word'].map((id) => document.getElementById(id));

    /*
     * 按鈕上寫的是**現在的狀態**，不是「按下去會變成什麼」。
     * 小孩看按鈕是看現況，寫成動作他會反過來理解。
     */
    function refreshAudioButtons() {
      const muted = !!ctx.sfx?.isMuted();
      muteBtns.forEach((b) => {
        if (!b) return;
        b.textContent = muted ? '🔇 已靜音' : '🔊 聲音';
        b.classList.toggle('is-on', !muted);
      });
      const shows = ctx.shouldShowWord();
      showWordBtns.forEach((b) => {
        if (!b) return;
        b.textContent = shows ? '👁 顯示單字' : '🙈 不顯示單字';
        b.classList.toggle('is-on', shows);
        /*
         * 靜音時這顆關不掉（見 shouldShowWord）。與其讓他按了沒反應，
         * 不如直接變灰並說明原因——按了沒反應比按不下去更讓人困惑。
         */
        b.disabled = muted;
        b.title = muted ? '靜音的時候一定要顯示單字，不然聽不到也看不到' : '';
      });
    }
    ctx.refreshAudioButtons = refreshAudioButtons;
    refreshAudioButtons();

    function toggleMute() {
      ctx.sfx.unlock();
      const muted = ctx.sfx.setMuted(!ctx.sfx.isMuted());
      if (muted) stopSpeaking();
      refreshAudioButtons();
      return muted;
    }

    function toggleShowWord() {
      // 從目前實際的狀態往反方向切，不管那個狀態是自動來的還是他自己設的
      ctx.setShowWord(!ctx.shouldShowWord());
    }

    muteBtns.forEach((b) => b?.addEventListener('click', toggleMute));
    // F2 走的是 input.js 的 onToggleMute，它會 dispatch 這個事件回來重畫
    document.getElementById('btn-mute')?.addEventListener('refresh', refreshAudioButtons);

    showWordBtns.forEach((b) =>
      b?.addEventListener('click', () => {
        toggleShowWord();
        ctx.input?.focusForTyping();
      })
    );

    // 換人玩就按這個。網址帶 calibrate=1 重新進來，流程跟第一次一樣
    document.getElementById('btn-recalibrate')?.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('calibrate', '1');
      location.href = url.toString();
    });

    document.getElementById('btn-rules')?.addEventListener('click', () => toggleRules(true));
    document.getElementById('rules-close')?.addEventListener('click', () => toggleRules(false));
    // 點說明以外的地方也能關（小孩不一定會去找那顆按鈕）
    document.getElementById('rules-panel')?.addEventListener('click', (e) => {
      if (e.target.id === 'rules-panel') toggleRules(false);
    });

    document.getElementById('btn-replay-file')?.addEventListener('click', downloadLog);
    // 重開一場也走開場畫面：換一場正是他會想換出題順序的時候
    document.getElementById('btn-restart')?.addEventListener('click', () => {
      showPregame(() => {
        ctx.restart();
        input.focusForTyping();
      });
    });

    /*
     * 開場畫面：先講清楚這一場是什麼，再讓他選出題順序。
     *
     * 網址指定 order 就整個跳過（所有自動化測試靠這個，規則跟難度一樣）。
     * 兩顆按鈕本身就是開始鍵——再多一個「確定」對小孩只是多一次點擊。
     */
    const pregameEl = document.getElementById('pregame');
    function showPregame(onChosen) {
      if (params.get('order') || !pregameEl) {
        onChosen();
        return;
      }
      document.getElementById('pregame-group').textContent = ctx.groupLabel || '練習';
      // 自己錄的音要看得到，不然他不會知道遊戲裡到底有沒有用上
      document.getElementById('pregame-count').textContent =
        ctx.recordedCount > 0
          ? `總共 ${ctx.words.length} 個字（其中 ${ctx.recordedCount} 個唸的是你自己錄的聲音）`
          : `總共 ${ctx.words.length} 個字`;
      /*
       * 最容易誤會的三件事，每一場都放一次。
       * 難度可能在校準之後才決定，所以這裡才生成，不是載入時。
       */
      const quick = document.getElementById('pregame-rules');
      if (quick) {
        quick.innerHTML = buildQuickRules(ctx.difficulty)
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join('');
      }
      pregameEl.querySelectorAll('[data-order]').forEach((btn) => {
        // 把上次選的標起來：他會知道上一場是怎麼打的
        btn.classList.toggle('is-last', btn.dataset.order === storedOrder());
        btn.onclick = () => {
          ctx.order = btn.dataset.order;
          writePref(ORDER_KEY, ctx.order);
          pregameEl.hidden = true;
          ctx.sfx.unlock(); // 這一下點擊就是瀏覽器要的使用者手勢
          onChosen();
        };
      });
      pregameEl.hidden = false;
    }

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
            writePref(DIFFICULTY_KEY, result.difficulty);
            ctx.calibration = result;
          }
          // 校準時他已經按過鍵了，音訊可以解鎖
          ctx.sfx.unlock();
          showPregame(begin);
        }
      });
    } else {
      document.body.classList.remove('page-loading');
      showPregame(begin);
    }
  } catch (err) {
    document.body.classList.remove('page-loading');
    if (errorEl) errorEl.textContent = `無法開始遊戲：${err.message}`;
    console.error(err);
  }
}

boot();
