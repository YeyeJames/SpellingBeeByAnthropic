import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav } from './nav-partial.js';
import { applyTheme } from './theme.js';
import * as sound from './sound-manager.js';
import { listEnglishVoices, getPreferredVoiceURI, setPreferredVoiceURI, speakWord } from './audio-player.js';
import { runPageInit } from './ui-status.js';

const THEME_NAMES = { sports: '🏅 運動風（預設）', space: '🚀 太空', dino: '🦖 恐龍' };
const ACCESSORY_SPRITES = {
  accessory_sunglasses: '/assets/sprites/accessory-sunglasses.svg',
  accessory_cape: '/assets/sprites/accessory-cape.svg',
  accessory_medal: '/assets/sprites/accessory-medal.svg'
};

const avatarPreview = document.getElementById('avatar-preview');
const statsGrid = document.getElementById('stats-grid');
const themeSwitcher = document.getElementById('theme-switcher');
const bgmVolumeInput = document.getElementById('bgm-volume');
const sfxVolumeInput = document.getElementById('sfx-volume');
const muteToggle = document.getElementById('mute-toggle');
const audioSaveMsg = document.getElementById('audio-save-msg');

let currentUser = null;

function renderAvatar() {
  avatarPreview.innerHTML = `<img src="/assets/sprites/bee-mascot.svg" alt="拼字蜂" />`;
  (currentUser.avatar.accessories || []).forEach((key) => {
    const src = ACCESSORY_SPRITES[key];
    if (!src) return;
    const img = document.createElement('img');
    img.src = src;
    img.alt = key;
    avatarPreview.appendChild(img);
  });
}

function renderStats() {
  const { stats, coins } = currentUser;
  const accuracy = stats.totalWordsPracticed
    ? Math.round((stats.totalCorrect / stats.totalWordsPracticed) * 100)
    : 0;
  const tiles = [
    { label: '🪙 金幣', value: coins },
    { label: '🔥 目前連勝', value: stats.currentStreak },
    { label: '🏆 最佳連勝', value: stats.bestStreak },
    { label: '📈 正確率', value: `${accuracy}%` },
    { label: '✅ 答對次數', value: stats.totalCorrect },
    { label: '📝 總練習次數', value: stats.totalWordsPracticed }
  ];
  statsGrid.innerHTML = tiles
    .map(
      (t) => `<div class="stat-tile"><div class="stat-value">${t.value}</div><div class="stat-label">${t.label}</div></div>`
    )
    .join('');
}

function renderThemeSwitcher() {
  const ownedThemes = (currentUser.ownedItemKeys || [])
    .filter((k) => k.startsWith('theme_'))
    .map((k) => k.replace('theme_', ''));
  const themes = ['sports', ...ownedThemes];

  themeSwitcher.innerHTML = '';
  themes.forEach((themeKey) => {
    const btn = document.createElement('button');
    const isActive = currentUser.activeTheme === themeKey;
    btn.className = isActive ? 'btn secondary' : 'btn';
    btn.textContent = THEME_NAMES[themeKey] || themeKey;
    btn.disabled = isActive;
    btn.addEventListener('click', () => switchTheme(themeKey));
    themeSwitcher.appendChild(btn);
  });
}

async function switchTheme(themeKey) {
  sound.playClick();
  try {
    const { user } = await api.post('/user/equip', { type: 'theme', itemKey: themeKey });
    currentUser = user;
    applyTheme(themeKey);
    renderThemeSwitcher();
  } catch (err) {
    // 主題一定是已擁有的才會顯示按鈕，理論上不會失敗
  }
}

/**
 * 英文語音挑選。可用的語音由裝置提供，各家瀏覽器/系統差很多，
 * 所以設定存在本機而不是帳號裡——同步到別台裝置只會選到不存在的語音。
 */
function renderVoicePicker() {
  const select = document.getElementById('voice-select');
  const hint = document.getElementById('voice-hint');
  const voices = listEnglishVoices();

  select.innerHTML = '';
  if (!voices.length) {
    hint.textContent = '這個瀏覽器目前找不到英文語音，會使用系統預設的朗讀方式。';
    select.disabled = true;
    return;
  }

  const preferred = getPreferredVoiceURI();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '（自動選擇）';
  select.appendChild(defaultOpt);

  voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name}（${v.lang}）`;
    if (v.voiceURI === preferred) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => {
    setPreferredVoiceURI(select.value);
    speakWord('spelling bee');
  });
}

document.getElementById('test-voice-btn').addEventListener('click', () => {
  sound.playClick();
  speakWord('spelling bee');
});

function loadAudioControls() {
  const { bgmVolume, sfxVolume, muted } = currentUser.audioPrefs;
  bgmVolumeInput.value = bgmVolume;
  sfxVolumeInput.value = sfxVolume;
  muteToggle.checked = muted;
}

document.getElementById('save-audio-btn').addEventListener('click', async () => {
  const bgmVolume = Number(bgmVolumeInput.value);
  const sfxVolume = Number(sfxVolumeInput.value);
  const muted = muteToggle.checked;

  sound.setBgmVolume(bgmVolume);
  sound.setSfxVolume(sfxVolume);
  sound.setMuted(muted);
  sound.playClick();

  try {
    await api.put('/auth/audio-prefs', { bgmVolume, sfxVolume, muted });
    audioSaveMsg.textContent = '✅ 已儲存';
    audioSaveMsg.style.color = 'var(--color-success)';
  } catch (err) {
    audioSaveMsg.textContent = err.message;
  }
  setTimeout(() => {
    audioSaveMsg.textContent = '';
  }, 2000);
});

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  currentUser = user;
  await mountNav(user, 'profile');
  renderAvatar();
  renderStats();
  renderThemeSwitcher();
  renderVoicePicker();
  loadAudioControls();
});
