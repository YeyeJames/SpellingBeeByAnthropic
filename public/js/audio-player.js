let cachedVoices = [];
let voicesReady = false;

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  cachedVoices = window.speechSynthesis.getVoices();
  if (cachedVoices.length) voicesReady = true;
}

if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickEnglishVoice() {
  if (!cachedVoices.length) loadVoices();
  return (
    cachedVoices.find((v) => v.lang === 'en-US') ||
    cachedVoices.find((v) => v.lang && v.lang.startsWith('en')) ||
    null
  );
}

export function speakWord(english) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(english);
    utterance.lang = 'en-US';
    const voice = pickEnglishVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.9;
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * 播放單字發音：優先播放真人錄音，失敗/沒有錄音就 fallback 到瀏覽器 TTS。
 * word 需要包含 _id 與 audio.type。
 */
export async function playWordAudio(word) {
  const hasRecording = word.audio && word.audio.type === 'recorded' && word.audio.gridfsFileId;
  if (!hasRecording) {
    return speakWord(word.english);
  }

  try {
    const played = await playRecordedAudio(`/api/words/${word._id}/audio`);
    if (played) return true;
  } catch (err) {
    // 忽略，往下 fallback 到 TTS
  }
  return speakWord(word.english);
}

function playRecordedAudio(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.addEventListener('ended', () => resolve(true));
    audio.addEventListener('error', () => reject(new Error('錄音播放失敗')));
    audio.play().catch(reject);
  });
}
