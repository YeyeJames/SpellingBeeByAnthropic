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

/*
 * ── 為什麼唸單字前要等一下 ────────────────────────────────
 *
 * 回報：練習模式第一次唸單字時，有時候前面半秒聽不到。
 *
 * iOS Safari 的語音合成有兩個很典型的問題，這裡兩個都踩到了：
 *
 *   1. cancel() 之後馬上 speak()。cancel() 內部是非同步的，同一個
 *      事件迴圈就接著 speak，引擎還在收拾上一段，新的那段不是被吞掉
 *      就是被切掉開頭。而我們每換一題都會走這條路（送出答案時
 *      stopSpeaking() 會 cancel，下一題馬上要唸）。
 *
 *   2. 音訊工作階段剛被啟用時的第一段語音會被切掉開頭。這就是
 *      「**第一次**唸的時候」特別容易發生的原因。
 *
 * 對策：第一次使用者互動時先用一段無聲的語音把引擎叫醒（warmUpSpeech），
 * 之後每次發話前都留一小段空檔，剛 cancel 過就留久一點。
 *
 * 這 90ms 對練習模式完全感覺不到（他還在讀畫面），但少了它，
 * 被切掉的是單字的第一個音——而這是聽寫，第一個音聽錯就整個字拼錯。
 */
const SPEAK_LEAD_MS = 90; // 每次發話前的基本空檔
const CANCEL_SETTLE_MS = 180; // 剛 cancel 過要等更久

let cachedVoices = [];
let lastCancelAt = 0;
/* 每次發話拿一個號碼牌；等待期間有人插隊就放棄這一段 */
let speakToken = 0;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * 把引擎叫醒。
 *
 * 必須在**使用者手勢裡**呼叫（點按鈕、按鍵），否則 iOS 不會啟用音訊
 * 工作階段。用一段無聲的空白語音，聽不到但足以把引擎帶起來，
 * 之後真正要唸的第一個字就不會被切掉開頭。重複呼叫沒有副作用。
 */
let warmedUp = false;
export function warmUpSpeech() {
  if (warmedUp || !('speechSynthesis' in window)) return false;
  warmedUp = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.rate = 1;
    window.speechSynthesis.speak(u);
    return true;
  } catch (err) {
    return false;
  }
}

/** 只在真的有東西在唸的時候才 cancel，並記下時間點。 */
function cancelSpeech() {
  if (!('speechSynthesis' in window)) return;
  const s = window.speechSynthesis;
  if (s.speaking || s.pending) {
    s.cancel();
    lastCancelAt = Date.now();
  }
}

async function speak(text, rate) {
  if (!('speechSynthesis' in window)) return false;

  const myToken = (speakToken += 1);
  cancelSpeech();

  // 剛 cancel 過就等久一點，讓引擎收拾完上一段
  const sinceCancel = Date.now() - lastCancelAt;
  await delay(Math.max(SPEAK_LEAD_MS, CANCEL_SETTLE_MS - sinceCancel));
  // 等的時候有人又要唸別的了，這一段就作廢——否則兩個字會疊在一起
  if (myToken !== speakToken) return false;

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    const voice = pickEnglishVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = rate;

    /*
     * 保險絲：被 cancel 的語音在某些瀏覽器上 onend 與 onerror 都不會觸發，
     * 那個 Promise 就永遠不會結束。競賽模式是 await 這個 Promise 的
     * （單字 → 例句 → 再唸一次），卡住的話整個流程就停在那裡不動了。
     */
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(fuse);
      resolve(ok);
    };
    const estimateMs = (1200 + text.length * 130) / Math.max(0.3, rate);
    const fuse = setTimeout(() => finish(false), estimateMs * 2 + 2000);

    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    window.speechSynthesis.speak(utterance);
  });
}

export function speakWord(english, { slow = false } = {}) {
  return speak(english, slow ? SLOW_RATE : NORMAL_RATE);
}

export function speakSentence(sentence) {
  return speak(sentence, NORMAL_RATE);
}

/*
 * 正在播的那一段錄音。
 *
 * 必須留著參照才停得掉。遊戲裡打完一個字就換下一個，如果上一段錄音
 * 還在播，兩個字會疊在一起——而這是聽寫遊戲，聽錯字就是打錯字。
 * speechSynthesis 有 cancel()，<audio> 沒有，得自己管。
 */
let currentAudio = null;

function stopRecordedAudio() {
  if (!currentAudio) return;
  try {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  } catch (err) {
    /* 還沒開始播就被停掉，忽略 */
  }
  currentAudio = null;
}

function playRecordedAudio(url, rate) {
  return new Promise((resolve, reject) => {
    stopRecordedAudio();
    const audio = new Audio(url);
    currentAudio = audio;
    audio.playbackRate = rate;
    audio.addEventListener('ended', () => {
      if (currentAudio === audio) currentAudio = null;
      resolve(true);
    });
    audio.addEventListener('error', () => {
      if (currentAudio === audio) currentAudio = null;
      reject(new Error('錄音播放失敗'));
    });
    audio.play().catch(reject);
  });
}

/**
 * 播放單字發音：優先真人錄音，失敗或沒錄音就 fallback 到 TTS。
 * word 需要包含 _id、english 與 audio.type。
 */
export async function playWordAudio(word, { slow = false } = {}) {
  /*
   * 只看 type。遊戲頁只從 /api/words/recorded 拿得到「哪些字有錄音」，
   * 拿不到 gridfsFileId——真要抓不到音檔，下面的 catch 會退回 TTS。
   */
  const hasRecording = word.audio && word.audio.type === 'recorded';

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
  // 號碼牌往前推：正在等空檔的那一段會自己作廢，不會晚一步才冒出來
  speakToken += 1;
  cancelSpeech();
  // 真人錄音也要停。只停 TTS 的話，換字時上一段錄音會繼續播下去
  stopRecordedAudio();
}
