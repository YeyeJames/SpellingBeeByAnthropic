/**
 * 音效包：答對時的那一聲（練習答對、遊戲打掉一隻蟲）。
 *
 * 跟其他音效一樣用 Web Audio 即時合成，不需要音檔。練習頁（sound-manager.js）
 * 與遊戲頁（game/sfx.js）各有自己的 AudioContext 與音量線路，所以這裡只負責
 * 「在給定的 context、接到給定的出口」把聲音排出來，音量與靜音由呼叫的那一邊管。
 *
 * 只換「答對」這一聲。打每個字母的音階不換：那個音階是打字節奏的回饋，
 * 換掉會讓他分不出自己打到第幾個字母。
 */

let noiseCache = null;

function noiseBuffer(ctx) {
  if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) return noiseCache;
  const len = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  noiseCache = buf;
  return buf;
}

function osc(ctx, out, { type = 'sine', freq, to = null, at, dur, gain }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(out);
  o.start(at);
  o.stop(at + dur + 0.03);
}

function hiss(ctx, out, { at, dur, gain, type = 'highpass', freq = 1800 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(at);
  src.stop(at + dur + 0.02);
}

const PACKS = {
  /* 咻——：方波從高掃到低，疊一個高八度 */
  sound_laser(ctx, out, at, k) {
    osc(ctx, out, { type: 'square', freq: 1800, to: 260, at, dur: 0.28, gain: 0.12 * k });
    osc(ctx, out, { type: 'sawtooth', freq: 3600, to: 520, at, dur: 0.2, gain: 0.05 * k });
  },
  /* 咚咚鏘：兩下大鼓＋一下小鼓 */
  sound_drum(ctx, out, at, k) {
    [0, 0.12].forEach((d) => osc(ctx, out, { freq: 150, to: 45, at: at + d, dur: 0.18, gain: 0.5 * k }));
    hiss(ctx, out, { at: at + 0.24, dur: 0.16, gain: 0.3 * k, type: 'highpass', freq: 1500 });
    osc(ctx, out, { type: 'triangle', freq: 220, to: 160, at: at + 0.24, dur: 0.1, gain: 0.15 * k });
  },
  /* 啵啵：兩顆往上彈的短音 */
  sound_bubble(ctx, out, at, k) {
    osc(ctx, out, { freq: 320, to: 1100, at, dur: 0.09, gain: 0.3 * k });
    osc(ctx, out, { freq: 420, to: 1500, at: at + 0.11, dur: 0.09, gain: 0.28 * k });
    osc(ctx, out, { freq: 520, to: 1900, at: at + 0.21, dur: 0.08, gain: 0.22 * k });
  },
  /* 魔法鈴：高音琶音＋一點閃亮的嘶聲 */
  sound_chime(ctx, out, at, k) {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
      osc(ctx, out, { freq: f, at: at + i * 0.06, dur: 0.5, gain: 0.12 * k }));
    hiss(ctx, out, { at, dur: 0.35, gain: 0.04 * k, type: 'highpass', freq: 6000 });
  }
};

export const SOUND_PACK_KEYS = Object.keys(PACKS);

/**
 * 播一次。認得這個音效包就回傳 true，呼叫的那一邊就不要再播預設的那一聲。
 * @param gain 音量倍率（呼叫的那一邊自己的音效音量）
 */
export function playPack(key, ctx, out, gain = 1) {
  const fn = PACKS[key];
  if (!fn || !ctx || !out) return false;
  fn(ctx, out, ctx.currentTime + 0.005, gain);
  return true;
}
