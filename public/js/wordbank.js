import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav } from './nav-partial.js';
import { playWordAudio, speakWord } from './audio-player.js';
import { createRecorder } from './recorder.js';
import { runPageInit } from './ui-status.js';
import { initOutbox } from './outbox.js';
import { readShared, writeShared } from './local-store.js';

/**
 * 單字庫是唯讀的：內容寫死在 server/data/word-bank.js，
 * 這一頁只用來瀏覽、聽發音，以及替單字錄真人發音。
 */
const PARTS = [1, 2, 3, 4];

const wordListEl = document.getElementById('word-list');
const listErrorEl = document.getElementById('list-error');
const searchInput = document.getElementById('search-input');
const partTabs = document.getElementById('part-tabs');
const countEl = document.getElementById('wb-count');
const overlay = document.getElementById('record-overlay');
const recordTitle = document.getElementById('record-title');
const audioStatus = document.getElementById('audio-status');
const audioError = document.getElementById('audio-error');
const btnPlayPreview = document.getElementById('btn-play-preview');
const btnRecord = document.getElementById('btn-record');
const btnRemoveAudio = document.getElementById('btn-remove-audio');
const btnSaveRecord = document.getElementById('btn-save-record');

let allWords = [];
let activePart = null; // null = 全部
let recordingWord = null;
let pendingAudioBlob = null;
let pendingAudioMime = null;
let pendingAudioDuration = null;
let isRecording = false;
let recorder = null;

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function renderPartTabs() {
  partTabs.innerHTML = '';
  [null, ...PARTS].forEach((part) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = part === activePart ? 'wb-part-tab active' : 'wb-part-tab';
    btn.textContent = part === null ? '全部' : `Part ${part}`;
    btn.addEventListener('click', () => {
      activePart = part;
      writeShared('wbPart', part);
      renderPartTabs();
      renderFiltered();
    });
    partTabs.appendChild(btn);
  });
}

function filterLocally() {
  const search = searchInput.value.trim().toLowerCase();
  return allWords.filter((w) => {
    if (activePart !== null && w.part !== activePart) return false;
    if (!search) return true;
    return (
      (w.english || '').toLowerCase().includes(search) ||
      (w.chinese || '').toLowerCase().includes(search)
    );
  });
}

function renderFiltered() {
  const words = filterLocally();
  countEl.textContent = `${words.length} / ${allWords.length} 字`;
  renderWords(words);
}

function renderWords(words) {
  wordListEl.innerHTML = '';
  if (!words.length) {
    wordListEl.innerHTML = '<p>找不到符合的單字。</p>';
    return;
  }
  words.forEach((word) => {
    const card = document.createElement('div');
    card.className = 'word-card';
    card.innerHTML = `
      <div class="wc-top">
        <span class="wc-english">${escapeHtml(word.english)}</span>
        <span class="wc-part">Part ${word.part}</span>
      </div>
      <div class="wc-chinese">${escapeHtml(word.chinese)}</div>
      ${word.exampleSentence ? `<div class="wc-sentence">${escapeHtml(word.exampleSentence)}</div>` : ''}
      <div class="wc-actions">
        <button class="btn secondary" data-action="play" type="button">🔊 播放</button>
        <button class="btn" data-action="record" type="button">${word.audio && word.audio.type === 'recorded' ? '🎙️ 已錄音' : '🎙️ 錄音'}</button>
      </div>
    `;
    card.querySelector('[data-action="play"]').addEventListener('click', () => playWordAudio(word));
    card.querySelector('[data-action="record"]').addEventListener('click', () => openRecorder(word));
    wordListEl.appendChild(card);
  });
}

function refreshWords() {
  return api.get('/words').then(({ words }) => {
    allWords = words;
    writeShared('words', words);
    renderFiltered();
  });
}

/** 有快取就立刻畫出來並直接返回，更新丟到背景 */
async function loadWords() {
  listErrorEl.textContent = '';
  const cached = readShared('words');
  if (cached) {
    allWords = cached;
    renderFiltered();
    refreshWords().catch(() => {});
    return;
  }
  await refreshWords();
}

// ── 錄音 ────────────────────────────────────────────────

function openRecorder(word) {
  recordingWord = word;
  pendingAudioBlob = null;
  pendingAudioMime = null;
  pendingAudioDuration = null;
  audioError.textContent = '';
  recordTitle.textContent = `${word.english}（${word.chinese}）`;
  const hasRecording = word.audio && word.audio.type === 'recorded';
  audioStatus.textContent = hasRecording ? '目前使用真人錄音' : '目前使用瀏覽器語音朗讀';
  btnRemoveAudio.classList.toggle('hidden', !hasRecording);
  btnSaveRecord.classList.add('hidden');
  btnRecord.textContent = '🎙️ 錄音（5秒）';
  overlay.classList.remove('hidden');
}

function closeRecorder() {
  overlay.classList.add('hidden');
  if (isRecording && recorder) recorder.cancel();
  isRecording = false;
  recordingWord = null;
}

btnPlayPreview.addEventListener('click', async () => {
  if (pendingAudioBlob) {
    new Audio(URL.createObjectURL(pendingAudioBlob)).play();
    return;
  }
  if (recordingWord) await playWordAudio(recordingWord);
});

btnRecord.addEventListener('click', () => {
  if (isRecording) {
    recorder.stop();
    return;
  }
  audioError.textContent = '';
  recorder = createRecorder({
    onDone: (blob, mimeType, durationSec) => {
      isRecording = false;
      btnRecord.textContent = '🎙️ 重新錄音';
      pendingAudioBlob = blob;
      pendingAudioMime = mimeType;
      pendingAudioDuration = durationSec;
      audioStatus.textContent = '已錄好新音檔，按「儲存錄音」才會生效';
      btnSaveRecord.classList.remove('hidden');
    },
    onError: (err) => {
      isRecording = false;
      btnRecord.textContent = '🎙️ 錄音（5秒）';
      audioError.textContent = err.message || '無法使用麥克風';
    }
  });
  isRecording = true;
  btnRecord.textContent = '⏹ 停止錄音';
  recorder.start();
});

btnSaveRecord.addEventListener('click', async () => {
  if (!pendingAudioBlob || !recordingWord) return;
  audioError.textContent = '';
  try {
    await uploadAudio(recordingWord._id, pendingAudioBlob, pendingAudioMime, pendingAudioDuration);
    closeRecorder();
    await refreshWords();
  } catch (err) {
    audioError.textContent = err.message;
  }
});

btnRemoveAudio.addEventListener('click', async () => {
  if (!recordingWord) return;
  try {
    await api.del(`/words/${recordingWord._id}/audio`);
    closeRecorder();
    await refreshWords();
  } catch (err) {
    audioError.textContent = err.message;
  }
});

document.getElementById('btn-close-record').addEventListener('click', closeRecorder);

async function uploadAudio(wordId, blob, mimeType, durationSec) {
  const formData = new FormData();
  formData.append('audio', blob, `recording.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`);
  formData.append('durationSec', String(durationSec || ''));
  const res = await fetch(`/api/words/${wordId}/audio`, {
    method: 'POST',
    body: formData,
    credentials: 'same-origin'
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '音檔上傳失敗');
  }
}

searchInput.addEventListener('input', debounce(renderFiltered, 200));

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  initOutbox(user._id);
  const savedPart = readShared('wbPart');
  activePart = savedPart === undefined ? null : savedPart;
  renderPartTabs();
  await Promise.all([mountNav(user, 'wordbank'), loadWords()]);
});
