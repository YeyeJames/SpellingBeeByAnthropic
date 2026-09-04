import { readShared, writeShared } from './local-store.js';

/**
 * 單字發音。優先播放真人錄音，沒有錄音就用瀏覽器語音合成（TTS）。
 *
 * 語音的選擇存在本機而不是使用者帳號裡：可用的語音是裝置決定的，
 * 手機上挑好的語音在平板上可能根本不存在，同步過去只會選到無效的語音。
 */

const VOICE_KEY = 'preferredVoiceURI';
const SLOW_RATE = 0.55;
const NORMAL_RATE = 0.9;

let cachedVoices = [];

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  cachedVoices = window.speechSynthesis.getVoices();
}

if ('speechSynthesis' in window) {
  loadVoices();
  // 有些瀏覽器的語音清單是非同步載入的，第一次讀會是空的
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

/** 裝置上可用的英文語音清單，給設定頁挑選用 */
export function listEnglishVoices() {
  if (!cachedVoices.length) loadVoices();
  return cachedVoices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
}

export function getPreferredVoiceURI() {
  return readShared(VOICE_KEY) || '';
}

export function setPreferredVoiceURI(uri) {
  writeShared(VOICE_KEY, uri || '');
}

function pickEnglishVoice() {
  const voices = listEnglishVoices();
  if (!voices.length) return null;

  const preferred = getPreferredVoiceURI();
  if (preferred) {
    const match = voices.find((v) => v.voiceURI === preferred);
    if (match) return match;
  }
  return voices.find((v) => v.lang === 'en-US') || voices[0];
}

function speak(text, rate) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    const voice = pickEnglishVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = rate;
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

export function speakWord(english, { slow = false } = {}) {
  return speak(english, slow ? SLOW_RATE : NORMAL_RATE);
}

export function speakSentence(sentence) {
  return speak(sentence, NORMAL_RATE);
}

function playRecordedAudio(url, rate) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.playbackRate = rate;
    audio.addEventListener('ended', () => resolve(true));
    audio.addEventListener('error', () => reject(new Error('錄音播放失敗')));
    audio.play().catch(reject);
  });
}

/**
 * 播放單字發音：優先真人錄音，失敗或沒錄音就 fallback 到 TTS。
 * word 需要包含 _id、english 與 audio.type。
 */
export async function playWordAudio(word, { slow = false } = {}) {
  const hasRecording = word.audio && word.audio.type === 'recorded' && word.audio.gridfsFileId;

  if (hasRecording) {
    try {
      // 真人錄音也可以放慢，直接調整播放速率
      const played = await playRecordedAudio(`/api/words/${word._id}/audio`, slow ? 0.7 : 1);
      if (played) return true;
    } catch (err) {
      // 忽略，往下 fallback 到 TTS
    }
  }
  return speakWord(word.english, { slow });
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 競賽模式朗讀：單字 → 例句 → 再唸一次單字。
 * 真實拼字比賽中，選手可以要求主持人把單字放進句子裡唸一次，
 * 這個順序就是照著那個流程來的。
 */
export async function playCompetitionSequence(word) {
  await playWordAudio(word);
  if (word.exampleSentence) {
    await pause(500);
    await speakSentence(word.exampleSentence);
    await pause(400);
    await playWordAudio(word);
  }
  return true;
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
