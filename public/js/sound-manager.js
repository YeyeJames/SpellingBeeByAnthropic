import { api } from './api.js';

/**
 * 拼字蜂音效/背景音樂管理。
 * 因為這個開發環境無法連外抓取免費音樂/音效檔案，SFX 與 BGM 都用 Web Audio API
 * 即時合成產生，完全不需要音檔，也沒有授權問題。之後如果想換成真的錄音室音樂，
 * 只要把 startBgm() 換成播放 /public/assets/audio/bgm/*.mp3 即可，介面不用改。
 */

let ctx = null;
let sfxVolume = 0.8;
let bgmVolume = 0.5;
let muted = false;

let bgmTimer = null;
let bgmStep = 0;
let bgmPlaying = false;

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq, start, duration, type = 'sine', gain = 0.2, slideTo = null }) {
  if (muted) return;
  const audioCtx = getCtx();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function scaledGain(base) {
  return base * sfxVolume;
}

export function playCorrect() {
  const t = getCtx().currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    tone({ freq, start: t + i * 0.09, duration: 0.16, type: 'triangle', gain: scaledGain(0.22) });
  });
}

export function playIncorrect() {
  const t = getCtx().currentTime;
  tone({ freq: 220, start: t, duration: 0.22, type: 'sine', gain: scaledGain(0.18), slideTo: 160 });
}

export function playCoin() {
  const t = getCtx().currentTime;
  tone({ freq: 988, start: t, duration: 0.08, type: 'square', gain: scaledGain(0.15) });
  tone({ freq: 1318, start: t + 0.07, duration: 0.14, type: 'square', gain: scaledGain(0.15) });
}

export function playClick() {
  const t = getCtx().currentTime;
  tone({ freq: 440, start: t, duration: 0.05, type: 'sine', gain: scaledGain(0.08) });
}

export function playStreak() {
  const t = getCtx().currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
    tone({ freq, start: t, duration: 0.35, type: 'triangle', gain: scaledGain(0.14) });
  });
  [1567.98, 2093].forEach((freq, i) => {
    tone({ freq, start: t + 0.12 + i * 0.08, duration: 0.18, type: 'sine', gain: scaledGain(0.1) });
  });
}

// 簡單的運動風 8 步進行(bass + lead)背景音樂 loop，約 120bpm
const BASS_PATTERN = [130.81, 130.81, 164.81, 130.81, 146.83, 146.83, 164.81, 196.0];
const LEAD_PATTERN = [523.25, 0, 659.25, 0, 587.33, 0, 523.25, 0];
const STEP_MS = 220;

function scheduleBgmStep() {
  if (!bgmPlaying) return;
  const t = getCtx().currentTime;
  const bassFreq = BASS_PATTERN[bgmStep % BASS_PATTERN.length];
  const leadFreq = LEAD_PATTERN[bgmStep % LEAD_PATTERN.length];

  tone({ freq: bassFreq, start: t, duration: 0.32, type: 'triangle', gain: bgmVolume * 0.16 });
  if (leadFreq) {
    tone({ freq: leadFreq, start: t + 0.02, duration: 0.18, type: 'square', gain: bgmVolume * 0.07 });
  }

  bgmStep += 1;
  bgmTimer = setTimeout(scheduleBgmStep, STEP_MS);
}

export function startBgm() {
  if (bgmPlaying || muted) return;
  bgmPlaying = true;
  bgmStep = 0;
  scheduleBgmStep();
}

export function stopBgm() {
  bgmPlaying = false;
  clearTimeout(bgmTimer);
}

export function isBgmPlaying() {
  return bgmPlaying;
}

export function setMuted(value) {
  muted = value;
  if (muted) stopBgm();
}

export function isMuted() {
  return muted;
}

export function setSfxVolume(v) {
  sfxVolume = v;
}

export function setBgmVolume(v) {
  bgmVolume = v;
}

export function getVolumes() {
  return { sfxVolume, bgmVolume, muted };
}

/** 從使用者資料載入音量設定（不會自動播放 BGM，需使用者手動觸發，避免瀏覽器封鎖自動播放） */
export function loadPrefs(user) {
  if (!user || !user.audioPrefs) return;
  sfxVolume = user.audioPrefs.sfxVolume ?? 0.8;
  bgmVolume = user.audioPrefs.bgmVolume ?? 0.5;
  muted = !!user.audioPrefs.muted;
}

export async function savePrefs() {
  await api.put('/auth/audio-prefs', { sfxVolume, bgmVolume, muted });
}
