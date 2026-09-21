/**
 * 分層背景音樂（Phase 2.4）。
 *
 * 設計書要的不是「一首 loop」，是**音樂直接反映戰況**：連擊起來音樂變厚，
 * 剩一條命轉小調而且變快。他會在音樂變厚的時候知道自己正在連擊，
 * 這比看數字強。
 *
 * 四層（鼓／貝斯／和聲／旋律），Phase 2 先做前兩層——那是永遠在的底。
 * 和聲與旋律的「位置」已經留好（含音量自動化與狀態對應），
 * Phase 3 補上發音器就會自己接上，不用改架構。
 *
 * 全部 Web Audio 合成：零音檔、零載入、可即時變調，也沒有版權問題。
 *
 * ── 為什麼不自己開 AudioContext ──────────────────────────
 * 共用 sfx 的那一個。開第二個會有第二套時鐘，節拍跟打擊音就對不準；
 * 而且「一鍵靜音」必須同時關掉音效與音樂，那是同一個 master。
 *
 * ── 排程方式 ────────────────────────────────────────────
 * 不用 setInterval 直接發聲——那會被瀏覽器節流，節拍會飄。
 * 標準做法是「前瞻排程」：計時器只負責把未來一小段時間內的音符
 * 用精確的 AudioContext 時間排進去，實際發聲由音訊執行緒負責。
 */

import { BASE_FREQ } from './core/scale.js';

/* 每拍切成兩個八分音符，一小節八格。 */
const STEPS_PER_BAR = 8;
const BASE_BPM = 96;

/* 前瞻排程：每 25ms 醒來一次，把接下來 120ms 的音符排好。 */
const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;

/*
 * 和弦進行：四小節一循環。
 *
 * 大調 I–vi–IV–V，小調 i–VI–iv–v。數字是離主音幾個半音。
 * 每個 biome 一組進行是 Phase 5 的事，這裡先用同一組。
 */
const ROOTS_MAJOR = [0, 9, 5, 7];
const ROOTS_MINOR = [0, 8, 5, 7];

/*
 * 四層。Phase 2 只有前兩層有發音器，後兩層是留好的位置。
 * minCombo 是「連擊到多少才加進來」，對應設計書的表。
 */
const LAYERS = [
  { key: 'drums', label: '鼓', minCombo: 0, gain: 0.9, ready: true },
  { key: 'bass', label: '貝斯', minCombo: 0, gain: 0.8, ready: true },
  // ready:false = 位置留好了，但還沒有發音器（Phase 3 補）。
  // 不標這個旗標的話，report 會顯示和聲層音量 0.7 卻完全沒有聲音——
  // 那種「看起來做完了其實沒有」正是最該避免的假象。
  { key: 'harmony', label: '和聲', minCombo: 5, gain: 0.7, ready: false },
  { key: 'melody', label: '旋律', minCombo: 10, gain: 0.6, ready: false }
];

/** 半音轉頻率（跟打擊音用同一個基準音，兩者才不會打架）。 */
function freq(semitone) {
  return BASE_FREQ * Math.pow(2, semitone / 12);
}

export function createBgm(sfx) {
  let ctx = null;
  let destination = null;
  let layerGain = null; // 每一層自己的音量節點
  let noiseBuffer = null;

  let timer = null;
  let playing = false;
  let step = 0; // 從開始播到現在第幾格
  let nextStepTime = 0; // 下一格該在什麼時候發聲（AudioContext 時間）
  let scheduled = 0; // 排過幾個音符，測試用

  // 戰況
  let combo = 0;
  let lowHp = false;
  let ducked = false; // 暫停時壓掉音量，但不停排程（回來才不會亂拍）

  function ensure() {
    if (ctx) return true;
    const bus = sfx?.audioBus?.();
    if (!bus) return false;
    ctx = bus.ctx;
    destination = bus.destination;

    layerGain = LAYERS.map(() => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(destination);
      return g;
    });

    const len = Math.floor(ctx.sampleRate * 0.2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function bpm() {
    // 剩一條命時快 5%：壓力要聽得出來
    return lowHp ? BASE_BPM * 1.05 : BASE_BPM;
  }

  function stepSeconds() {
    return 60 / bpm() / (STEPS_PER_BAR / 4);
  }

  /** 某一層現在該是多大聲。 */
  function targetGain(i) {
    if (!playing || ducked) return 0;
    const layer = LAYERS[i];
    if (!layer.ready) return 0; // 還沒有發音器，給音量只會變成假象
    if (combo < layer.minCombo) return 0;
    return layer.gain;
  }

  function applyGains(ramp = 0.6) {
    if (!layerGain) return;
    const now = ctx.currentTime;
    for (let i = 0; i < layerGain.length; i += 1) {
      const g = layerGain[i].gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(targetGain(i), now + ramp);
    }
  }

  /* ── 發音器 ─────────────────────────────────────────── */

  function kick(at) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.11);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.9, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(g);
    g.connect(layerGain[0]);
    osc.start(at);
    osc.stop(at + 0.26);
    scheduled += 1;
  }

  function hat(at, strong) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    const peak = strong ? 0.16 : 0.07;
    const dur = strong ? 0.07 : 0.04;
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(layerGain[0]);
    src.start(at, 0, dur + 0.02);
    scheduled += 1;
  }

  function bass(at, semitone, dur) {
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    // 低兩個八度：這是襯底，不能跟打擊音搶同一個音域
    osc.frequency.setValueAtTime(freq(semitone - 24), at);
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(lp);
    lp.connect(g);
    g.connect(layerGain[1]);
    osc.start(at);
    osc.stop(at + dur + 0.03);
    scheduled += 1;
  }

  /** 把某一格的音符排進去。 */
  function scheduleStep(n, at) {
    const muted = sfx?.isMuted?.();
    // 靜音時只讓格子往前走，不建任何音訊節點——省掉完全聽不到的運算
    if (muted || ducked) return;

    const inBar = n % STEPS_PER_BAR;
    const bar = Math.floor(n / STEPS_PER_BAR) % 4;
    const roots = lowHp ? ROOTS_MINOR : ROOTS_MAJOR;
    const root = roots[bar];

    // 鼓
    if (inBar === 0 || inBar === 4) kick(at);
    if (inBar % 2 === 1) hat(at, inBar === 3 || inBar === 7);

    // 貝斯：小節頭踩根音，第五格踩五度，句尾補一下
    const sd = stepSeconds();
    if (inBar === 0) bass(at, root, sd * 1.8);
    else if (inBar === 4) bass(at, root + 7, sd * 1.4);
    else if (inBar === 6) bass(at, root, sd * 0.8);
  }

  function tick() {
    if (!playing || !ctx) return;
    const until = ctx.currentTime + LOOKAHEAD_S;
    let guard = 0;
    while (nextStepTime < until && guard < 64) {
      scheduleStep(step, nextStepTime);
      nextStepTime += stepSeconds();
      step += 1;
      guard += 1;
    }
  }

  return {
    available() {
      return ensure();
    },

    /** 開始播。必須在使用者手勢之後（瀏覽器規定）。 */
    start() {
      if (!ensure()) return false;
      if (playing) return true;
      playing = true;
      step = 0;
      nextStepTime = ctx.currentTime + 0.08;
      applyGains(0.8);
      if (timer === null) timer = setInterval(tick, TICK_MS);
      tick();
      return true;
    },

    stop(ramp = 0.5) {
      playing = false;
      applyGains(ramp);
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },

    /**
     * 把戰況餵進來。呼叫端每格都可以呼叫，值沒變就不做事。
     * @param {{combo:number, hp:number, maxHp:number, paused:boolean}} s
     */
    setState(s) {
      if (!ctx) return;
      const nextCombo = Number(s?.combo) || 0;
      const nextLow = Number(s?.hp) === 1;
      const nextDuck = !!s?.paused;
      if (nextCombo === combo && nextLow === lowHp && nextDuck === ducked) return;
      combo = nextCombo;
      lowHp = nextLow;
      ducked = nextDuck;
      applyGains(ducked ? 0.15 : 0.6);
    },

    /** 測試與除錯用。 */
    report() {
      return {
        available: !!ctx,
        playing,
        bpm: Math.round(bpm()),
        mode: lowHp ? 'minor' : 'major',
        step,
        scheduled,
        ducked,
        layers: LAYERS.map((l, i) => ({
          key: l.key,
          minCombo: l.minCombo,
          ready: l.ready,
          gain: layerGain ? Number(layerGain[i].gain.value.toFixed(3)) : 0,
          target: Number(targetGain(i).toFixed(3))
        }))
      };
    }
  };
}

export { LAYERS as BGM_LAYERS };
