/**
 * 戰鬥音效（Phase 1.4）。
 *
 * 全部用 Web Audio 即時合成：零音檔、零載入時間、可即時變調，也沒有版權問題。
 *
 * 核心是「打擊音音高遞增」：第一個字母 C、第二個 D、第三個 E⋯
 * 打完七個字母正好是一段完整的上行音階，第八個回到八度。
 * 這不只是好聽——小孩會用耳朵記住一個單字有多長，
 * 這是遊戲性與學習性真正接在一起的地方。
 *
 * 刻意不沿用練習頁的 sound-manager.js：那個模組會 import api.js，
 * 而遊戲頁要在沒有登入、甚至資料庫掛掉時也能玩。
 */

import { readShared, writeShared } from '../local-store.js';
import { semitoneForIndex, comboShift, freqFor } from './core/scale.js';

const MUTE_KEY = 'gameMuted';
const VOLUME_KEY = 'gameSfxVolume';
const BGM_VOLUME_KEY = 'gameBgmVolume';

export function createSfx({ onPlayed } = {}) {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let bgmBus = null;
  let noiseBuffer = null;
  let muted = readShared(MUTE_KEY) === '1';
  /*
   * 注意 Number(null) === 0。
   *
   * readShared 對沒存過的鍵回傳 null，直接丟進 Number() 會得到 0——
   * 那是一個「合法」的音量值，於是每個第一次玩的人都會拿到完全靜音的遊戲，
   * 而且因為沒有任何錯誤訊息，這種 bug 幾乎不可能靠看程式碼發現。
   * 音效測試就是這樣抓到的：主音量在靜音之前就已經是 0。
   */
  const storedVolume = readShared(VOLUME_KEY);
  let volume = storedVolume === null || storedVolume === '' ? 0.7 : Number(storedVolume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) volume = 0.7;

  // 背景音樂預設比音效小：音樂是襯底，打擊回饋才是主角
  const storedBgm = readShared(BGM_VOLUME_KEY);
  let bgmVolume = storedBgm === null || storedBgm === '' ? 0.35 : Number(storedBgm);
  if (!Number.isFinite(bgmVolume) || bgmVolume < 0 || bgmVolume > 1) bgmVolume = 0.35;

  /* 排程延遲樣本：keydown 到我們真的把聲音排進去，中間隔了多久 */
  const latency = { samples: [], worst: 0 };

  function ensureCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx({ latencyHint: 'interactive' });
      /*
       * 音訊匯流排分兩條。
       *
       *   master ── 靜音與總音量（一鍵靜音要同時關掉音效與音樂）
       *     ├─ sfxBus ── 音效
       *     └─ bgmBus ── 背景音樂
       *
       * 設計書要求 BGM 與 SFX 分開調整，所以不能全部直接接上 master。
       * 而兩者共用同一個 AudioContext：開第二個 context 會有第二套時鐘，
       * 節拍跟打擊音就對不準了，而且瀏覽器對 context 數量有限制。
       */
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = volume;
      sfxBus.connect(master);

      bgmBus = ctx.createGain();
      bgmBus.gain.value = bgmVolume;
      bgmBus.connect(master);

      // 噪音來源只做一次，之後每次播放都重用這塊 buffer
      const len = Math.floor(ctx.sampleRate * 0.4);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    }
    // 瀏覽器在使用者互動前不准發聲，所以每次都確認一下狀態
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 一個帶包絡的振盪音。 */
  function tone({ freq, at, dur, type = 'triangle', gain = 0.22, slideTo = null }) {
    const c = ensureCtx();
    if (!c || muted) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(sfxBus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** 一段帶濾波的噪音，用來做噴濺與風聲。 */
  function noise({ at, dur, gain = 0.18, from = 2400, to = 300, q = 1 }) {
    const c = ensureCtx();
    if (!c || muted || !noiseBuffer) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(sfxBus);
    src.start(at, 0, Math.min(dur, noiseBuffer.duration));
  }

  /** 記一筆「按鍵 → 排程完成」的延遲，並通知除錯層這個聲音播了。 */
  function played(name, t0) {
    if (t0 != null) {
      const ms = performance.now() - t0;
      latency.samples.push(ms);
      if (latency.samples.length > 1024) latency.samples.shift();
      if (ms > latency.worst) latency.worst = ms;
    }
    onPlayed?.(name);
  }

  return {
    /** 有沒有真的拿到 AudioContext（無頭瀏覽器有時候沒有音效裝置）。 */
    available() {
      return !!ensureCtx();
    },

    /** 必須在使用者手勢裡呼叫，否則瀏覽器不准發聲。 */
    unlock() {
      const c = ensureCtx();
      return !!c && c.state === 'running';
    },

    /**
     * 打對一個字母：音階往上走一階。
     * @param index 這是第幾個字母（從 0 起算）
     */
    letter(index, combo, t0) {
      const shift = comboShift(combo);
      const c = ensureCtx();
      if (!c) return;
      const at = c.currentTime;
      tone({
        freq: freqFor(semitoneForIndex(index) + shift),
        at,
        dur: 0.14,
        type: 'triangle',
        gain: 0.2
      });
      // 疊一個高八度的短音，讓打擊更「脆」
      tone({
        freq: freqFor(semitoneForIndex(index) + shift + 12),
        at,
        dur: 0.06,
        type: 'sine',
        gain: 0.07
      });
      played('letter', t0);
    },

    /** 打錯：低沉短促的 buzz。 */
    wrong(t0) {
      const c = ensureCtx();
      if (!c) return;
      const at = c.currentTime;
      tone({ freq: 138, at, dur: 0.16, type: 'square', gain: 0.16, slideTo: 92 });
      played('wrong', t0);
    },

    /** 擊殺：破裂 + 蜂蜜噴濺。 */
    kill(wordLength, t0) {
      const c = ensureCtx();
      if (!c) return;
      const at = c.currentTime;
      // 用這個字最後一個音往上收尾，聽起來像「完成了一段」
      const top = semitoneForIndex(Math.max(0, wordLength - 1));
      tone({ freq: freqFor(top + 12), at, dur: 0.18, type: 'triangle', gain: 0.24 });
      tone({ freq: freqFor(top + 16), at: at + 0.05, dur: 0.22, type: 'sine', gain: 0.16 });
      noise({ at, dur: 0.26, gain: 0.16, from: 2600, to: 420 });
      played('kill', t0);
    },

    /** 漏字扣血：低頻心跳。 */
    hpLost(t0) {
      const c = ensureCtx();
      if (!c) return;
      const at = c.currentTime;
      tone({ freq: 78, at, dur: 0.3, type: 'sine', gain: 0.3, slideTo: 48 });
      tone({ freq: 62, at: at + 0.16, dur: 0.34, type: 'sine', gain: 0.22, slideTo: 40 });
      played('hpLost', t0);
    },

    /**
     * 重聽：一聲往下掉的風聲，提醒「這有代價」。
     *
     * 原本是 600→2200 的上行掃頻——上行聽起來像「得到了什麼」，
     * 跟實際發生的事（蟲往前衝、你被扣時間）完全相反。改成下行，
     * 再壓一個低頻的悶響當「往前撞」的重量。長度對齊畫面上的衝刺動畫，
     * 兩者才像同一件事而不是兩件事。
     */
    listen(t0) {
      const c = ensureCtx();
      if (!c) return;
      const at = c.currentTime;
      noise({ at, dur: 0.32, gain: 0.11, from: 2000, to: 420, q: 2 });
      tone({ freq: 150, at, dur: 0.26, type: 'sine', gain: 0.16 });
      played('listen', t0);
    },

    /** Combo 達標：三階疊加，一階比一階厚。 */
    combo(tier, t0) {
      const c = ensureCtx();
      if (!c) return;
      const at = c.currentTime;
      const root = tier >= 15 ? 7 : tier >= 10 ? 4 : 2;
      tone({ freq: freqFor(root + 12), at, dur: 0.2, type: 'triangle', gain: 0.18 });
      tone({ freq: freqFor(root + 16), at: at + 0.06, dur: 0.2, type: 'triangle', gain: 0.15 });
      if (tier >= 10) {
        tone({ freq: freqFor(root + 19), at: at + 0.12, dur: 0.24, type: 'sine', gain: 0.14 });
      }
      played('combo', t0);
    },

    /**
     * Combo 里程碑：三階疊加音，一階比一階厚。
     *
     * 設計書寫的是「一階比一階厚」，所以厚度不是靠音量堆出來的——
     * 是靠**音的數量**：第一階兩個音、第二階三個音、第三階四個音加一層噪音爆。
     * 音量堆只會變吵，音堆起來才會變厚。
     *
     * @param tier 1 衝刺 / 2 蜜糖 / 3 狂蜂
     */
    comboTier(tier, t0) {
      const c = ensureCtx();
      if (!c) return;
      const at = c.currentTime;
      // 大三和弦往上疊：根音、三度、五度、八度
      const CHORDS = {
        1: [0, 4, 7],
        2: [0, 4, 7, 12],
        3: [0, 4, 7, 12, 16]
      };
      const notes = CHORDS[tier] || CHORDS[1];
      notes.forEach((semi, i) => {
        tone({
          freq: freqFor(semi + (tier - 1) * 2),
          at: at + i * 0.045,
          dur: 0.5 + tier * 0.12,
          type: tier >= 3 ? 'sawtooth' : 'triangle',
          gain: 0.12 + tier * 0.02
        });
      });
      // 第三階再加一層上行噪音，做出「整個場面變了」的份量
      if (tier >= 3) noise({ at, dur: 0.45, gain: 0.1, from: 300, to: 3600, q: 0.8 });
      played(`combo${tier}`, t0);
    },

    /** 一場結束。 */
    finish(won, t0) {
      const c = ensureCtx();
      if (!c) return;
      const at = c.currentTime;
      const steps = won ? [0, 4, 7, 12] : [12, 8, 5, 0];
      steps.forEach((s, i) => {
        tone({
          freq: freqFor(won ? s : s - 12),
          at: at + i * 0.13,
          dur: 0.26,
          type: 'triangle',
          gain: 0.22
        });
      });
      played(won ? 'win' : 'lose', t0);
    },

    /** keydown → 排進音訊佇列的延遲統計，加上裝置本身的輸出延遲。 */
    latencyReport() {
      const arr = latency.samples.slice().sort((a, b) => a - b);
      const at = (p) =>
        arr.length ? Number(arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))].toFixed(2)) : 0;
      return {
        samples: arr.length,
        p50: at(50),
        p95: at(95),
        worst: Number(latency.worst.toFixed(2)),
        // 這兩個是裝置與瀏覽器決定的，程式改不了，但要誠實列出來
        baseLatencyMs: ctx ? Number(((ctx.baseLatency || 0) * 1000).toFixed(2)) : null,
        outputLatencyMs: ctx ? Number(((ctx.outputLatency || 0) * 1000).toFixed(2)) : null,
        contextState: ctx ? ctx.state : 'none'
      };
    },

    isMuted() {
      return muted;
    },

    /** 主音量節點的實際值。測試靠它證明靜音真的把聲音關掉了。 */
    masterGain() {
      return master ? master.gain.value : null;
    },

    setMuted(v) {
      muted = !!v;
      writeShared(MUTE_KEY, muted ? '1' : '0');
      if (master) master.gain.value = muted ? 0 : 1;
      return muted;
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      writeShared(VOLUME_KEY, String(volume));
      if (sfxBus) sfxBus.gain.value = volume;
      return volume;
    },

    getVolume() {
      return volume;
    },

    setBgmVolume(v) {
      bgmVolume = Math.max(0, Math.min(1, Number(v) || 0));
      writeShared(BGM_VOLUME_KEY, String(bgmVolume));
      if (bgmBus) bgmBus.gain.value = bgmVolume;
      return bgmVolume;
    },

    getBgmVolume() {
      return bgmVolume;
    },

    /**
     * 給背景音樂用的接點。
     *
     * BGM 自己排程音符，但必須掛在同一個 AudioContext 與同一個靜音開關底下，
     * 所以由這裡把 context 與匯流排交出去，而不是讓 BGM 自己開一個。
     */
    audioBus() {
      const c = ensureCtx();
      if (!c) return null;
      return { ctx: c, destination: bgmBus };
    }
  };
}
