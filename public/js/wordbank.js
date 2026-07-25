import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav } from './nav-partial.js';
import { playWordAudio, speakWord } from './audio-player.js';
import { createRecorder } from './recorder.js';

const wordListEl = document.getElementById('word-list');
const listErrorEl = document.getElementById('list-error');
const searchInput = document.getElementById('search-input');
const tagFilter = document.getElementById('tag-filter');
const overlay = document.getElementById('word-form-overlay');
const form = document.getElementById('word-form');
const formTitle = document.getElementById('form-title');
const fEnglish = document.getElementById('f-english');
const fChinese = document.getElementById('f-chinese');
const fSentence = document.getElementById('f-sentence');
const fTags = document.getElementById('f-tags');
const formError = document.getElementById('form-error');
const audioStatus = document.getElementById('audio-status');
const audioError = document.getElementById('audio-error');
const btnPlayPreview = document.getElementById('btn-play-preview');
const btnRecord = document.getElementById('btn-record');
const btnRemoveAudio = document.getElementById('btn-remove-audio');
const btnDeleteWord = document.getElementById('btn-delete-word');

let editingWord = null; // null = 新增模式
let pendingAudioBlob = null;
let pendingAudioMime = null;
let pendingAudioDuration = null;
let pendingRemoveAudio = false;
let isRecording = false;
let recorder = null;

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function loadTags() {
  const { tags } = await api.get('/words/tags-list');
  const current = tagFilter.value;
  tagFilter.innerHTML = '<option value="">所有標籤</option>';
  tags.forEach((tag) => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    tagFilter.appendChild(opt);
  });
  tagFilter.value = current;
}

async function loadWords() {
  listErrorEl.textContent = '';
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
  if (tagFilter.value) params.set('tag', tagFilter.value);
  try {
    const { words } = await api.get(`/words?${params.toString()}`);
    renderWords(words);
  } catch (err) {
    listErrorEl.textContent = err.message;
  }
}

function renderWords(words) {
  wordListEl.innerHTML = '';
  if (!words.length) {
    wordListEl.innerHTML = '<p>還沒有單字，點右上角「新增單字」開始建立吧！</p>';
    return;
  }
  words.forEach((word) => {
    const card = document.createElement('div');
    card.className = 'word-card';
    card.innerHTML = `
      <div class="wc-english">${escapeHtml(word.english)}</div>
      <div class="wc-chinese">${escapeHtml(word.chinese)}</div>
      ${word.exampleSentence ? `<div class="wc-sentence">${escapeHtml(word.exampleSentence)}</div>` : ''}
      <div class="wc-tags">${word.tags.map((t) => `<span class="wc-tag">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="wc-actions">
        <button class="btn secondary" data-action="play" type="button">🔊 播放</button>
        <button class="btn" data-action="edit" type="button">✏️ 編輯</button>
      </div>
    `;
    card.querySelector('[data-action="play"]').addEventListener('click', () => playWordAudio(word));
    card.querySelector('[data-action="edit"]').addEventListener('click', () => openForm(word));
    wordListEl.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function resetAudioState(word) {
  pendingAudioBlob = null;
  pendingAudioMime = null;
  pendingAudioDuration = null;
  pendingRemoveAudio = false;
  audioError.textContent = '';
  const hasRecording = word && word.audio && word.audio.type === 'recorded';
  audioStatus.textContent = hasRecording ? '目前使用真人錄音' : '目前使用瀏覽器語音朗讀';
  btnRemoveAudio.classList.toggle('hidden', !hasRecording);
  btnRecord.textContent = '🎙️ 錄音（5秒）';
}

function openForm(word) {
  editingWord = word || null;
  formTitle.textContent = word ? '編輯單字' : '新增單字';
  fEnglish.value = word ? word.english : '';
  fChinese.value = word ? word.chinese : '';
  fSentence.value = word ? word.exampleSentence : '';
  fTags.value = word ? word.tags.join(',') : '';
  formError.textContent = '';
  btnDeleteWord.style.display = word ? 'block' : 'none';
  resetAudioState(word);
  overlay.classList.remove('hidden');
}

function closeForm() {
  overlay.classList.add('hidden');
  if (isRecording && recorder) recorder.cancel();
  isRecording = false;
}

document.getElementById('open-add-form').addEventListener('click', () => openForm(null));
document.getElementById('btn-cancel-form').addEventListener('click', closeForm);

btnPlayPreview.addEventListener('click', async () => {
  if (pendingAudioBlob) {
    const url = URL.createObjectURL(pendingAudioBlob);
    const audio = new Audio(url);
    audio.play();
    return;
  }
  if (editingWord && editingWord.audio && editingWord.audio.type === 'recorded') {
    await playWordAudio(editingWord);
    return;
  }
  const english = fEnglish.value.trim();
  if (english) await speakWord(english);
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
      btnRecord.textContent = '🎙️ 錄音（5秒）';
      pendingAudioBlob = blob;
      pendingAudioMime = mimeType;
      pendingAudioDuration = durationSec;
      pendingRemoveAudio = false;
      audioStatus.textContent = '已錄好新音檔（尚未儲存，按下方「儲存」才會生效）';
      btnRemoveAudio.classList.remove('hidden');
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

btnRemoveAudio.addEventListener('click', () => {
  pendingAudioBlob = null;
  pendingAudioMime = null;
  pendingAudioDuration = null;
  pendingRemoveAudio = true;
  audioStatus.textContent = '儲存後將改用瀏覽器語音朗讀';
  btnRemoveAudio.classList.add('hidden');
});

btnDeleteWord.addEventListener('click', async () => {
  if (!editingWord) return;
  if (!confirm(`確定要刪除「${editingWord.english}」嗎？`)) return;
  try {
    await api.del(`/words/${editingWord._id}`);
    closeForm();
    await Promise.all([loadTags(), loadWords()]);
  } catch (err) {
    formError.textContent = err.message;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';
  const payload = {
    english: fEnglish.value.trim(),
    chinese: fChinese.value.trim(),
    exampleSentence: fSentence.value.trim(),
    tags: fTags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  };

  try {
    let word;
    if (editingWord) {
      ({ word } = await api.put(`/words/${editingWord._id}`, payload));
    } else {
      ({ word } = await api.post('/words', payload));
    }

    if (pendingAudioBlob) {
      await uploadAudio(word._id, pendingAudioBlob, pendingAudioMime, pendingAudioDuration);
    } else if (pendingRemoveAudio) {
      await api.del(`/words/${word._id}/audio`);
    }

    closeForm();
    await Promise.all([loadTags(), loadWords()]);
  } catch (err) {
    formError.textContent = err.message;
  }
});

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

searchInput.addEventListener('input', debounce(loadWords, 300));
tagFilter.addEventListener('change', loadWords);

(async function init() {
  const user = await requireLogin();
  if (!user) return;
  await mountNav(user, 'wordbank');
  await Promise.all([loadTags(), loadWords()]);
})();
