import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav } from './nav-partial.js';
import { playWordAudio } from './audio-player.js';
import { createRecorder } from './recorder.js';
import { runPageInit } from './ui-status.js';
import { initOutbox } from './outbox.js';
import { readUser, writeUser } from './local-store.js';

/**
 * 單字庫是唯讀的：內容寫死在 server/data/word-bank.js，
 * 這一頁只用來瀏覽、聽發音，以及替單字錄真人發音。
 *
 * 分頁的單位是「組」（Part 1~4 與 Week 1~10），清單由後端給，
 * 這裡不自己寫死——以後加 Week 11 只要改資料，這一頁不用動。
 */

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

/*
 * 這一頁的快取（單字、組別、上次看的分頁）一律**分帳號**存。
 *
 * 本來全部存在 shared 底下，同一台電腦上兩個孩子共用一份。結果 Allen 用
 * 自己的帳號進來，先畫出來的是 Pierce 上次留下的 749 個字；上次看的分頁
 * 如果是 Week 1，那個分頁在 Allen 的課本裡根本不存在，畫面就是一片空白。
 * 快取的 key 裡沒有「是誰的」，就等於假設這台電腦只有一個人在用。
 */
let userId = null;
let allWords = [];
let allGroups = [];
let activeGroup = null; // null = 全部
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
  [null, ...allGroups].forEach((group) => {
    const id = group === null ? null : group.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = id === activeGroup ? 'wb-part-tab active' : 'wb-part-tab';
    btn.textContent = group === null ? '全部' : group.label;
    btn.addEventListener('click', () => {
      activeGroup = id;
      writeUser(userId, 'wbGroup', id);
      renderPartTabs();
      renderFiltered();
    });
    partTabs.appendChild(btn);
  });
}

function groupLabel(id) {
  const g = allGroups.find((x) => x.id === id);
  return g ? g.label : id || '';
}

function filterLocally() {
  const search = searchInput.value.trim().toLowerCase();
  return allWords.filter((w) => {
    if (activeGroup !== null && w.group !== activeGroup) return false;
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
        <span class="wc-part">${escapeHtml(groupLabel(word.group))}</span>
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
  return api.get('/words').then(({ words, groups }) => {
    allWords = words;
    allGroups = groups || [];
    writeUser(userId, 'words', words);
    writeUser(userId, 'wbGroups', allGroups);
    // 記住的分頁不在這一本裡（課本換過、或資料改過），就回到「全部」，不要畫一片空白
    if (activeGroup && !allGroups.some((g) => g.id === activeGroup)) activeGroup = null;
    renderPartTabs();
    renderFiltered();
  });
}

/** 有快取就立刻畫出來並直接返回，更新丟到背景 */
async function loadWords() {
  listErrorEl.textContent = '';
  const cached = readUser(userId, 'words');
  const cachedGroups = readUser(userId, 'wbGroups');
  /*
   * 舊版快取的單字沒有 group 欄位。直接拿來畫會變成整頁都篩不到東西，
   * 而且使用者完全看不出是快取的問題——所以認不得就當作沒有快取。
   */
  const usable = Array.isArray(cached) && cached.length > 0 && cached[0].group && cachedGroups;
  if (usable) {
    allWords = cached;
    allGroups = cachedGroups;
    renderPartTabs();
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
  userId = user._id;
  const savedGroup = readUser(userId, 'wbGroup');
  activeGroup = savedGroup === undefined || savedGroup === '' ? null : savedGroup;
  renderPartTabs();
  await Promise.all([mountNav(user, 'wordbank'), loadWords()]);
});
