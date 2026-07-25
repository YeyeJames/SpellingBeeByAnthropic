import { api } from './api.js';
import { fetchCurrentUser } from './auth.js';

const profileStep = document.getElementById('profile-step');
const profileGrid = document.getElementById('profile-grid');
const pinStep = document.getElementById('pin-step');
const pinStepTitle = document.getElementById('pin-step-title');
const pinDots = document.getElementById('pin-dots').querySelectorAll('.dot');
const pinPad = document.getElementById('pin-pad');
const pinError = document.getElementById('pin-error');
const newProfileStep = document.getElementById('new-profile-step');
const newNicknameInput = document.getElementById('new-nickname');
const newProfileError = document.getElementById('new-profile-error');

let mode = null; // 'login' | 'register'
let activeNickname = '';
let pinDigits = [];

function showStep(step) {
  [profileStep, pinStep, newProfileStep].forEach((s) => s.classList.add('hidden'));
  step.classList.remove('hidden');
}

function renderPinDots() {
  pinDots.forEach((dot, i) => dot.classList.toggle('filled', i < pinDigits.length));
}

async function loadProfiles() {
  const { profiles } = await api.get('/auth/profiles');
  profileGrid.innerHTML = '';
  profiles.forEach((p) => {
    const tile = document.createElement('div');
    tile.className = 'profile-tile';
    tile.innerHTML = `
      <div class="avatar-circle">${p.nickname.slice(0, 1).toUpperCase()}</div>
      <div class="nickname">${escapeHtml(p.nickname)}</div>
    `;
    tile.addEventListener('click', () => startLogin(p.nickname));
    profileGrid.appendChild(tile);
  });

  const newTile = document.createElement('div');
  newTile.className = 'profile-tile new-profile';
  newTile.innerHTML = `
    <div class="avatar-circle">＋</div>
    <div class="nickname">新玩家</div>
  `;
  newTile.addEventListener('click', startNewProfile);
  profileGrid.appendChild(newTile);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function startLogin(nickname) {
  mode = 'login';
  activeNickname = nickname;
  pinDigits = [];
  pinError.textContent = '';
  pinStepTitle.textContent = `${nickname}，輸入你的 PIN 碼`;
  renderPinDots();
  showStep(pinStep);
}

function startNewProfile() {
  newNicknameInput.value = '';
  newProfileError.textContent = '';
  showStep(newProfileStep);
}

document.getElementById('new-profile-cancel').addEventListener('click', () => showStep(profileStep));

document.getElementById('new-profile-next').addEventListener('click', () => {
  const nickname = newNicknameInput.value.trim();
  if (!nickname) {
    newProfileError.textContent = '請輸入暱稱';
    return;
  }
  mode = 'register';
  activeNickname = nickname;
  pinDigits = [];
  pinError.textContent = '';
  pinStepTitle.textContent = `幫 ${nickname} 設定一組 4 位數 PIN`;
  renderPinDots();
  showStep(pinStep);
});

pinPad.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.id === 'pin-cancel') {
    pinDigits = [];
    showStep(mode === 'register' ? newProfileStep : profileStep);
    return;
  }

  if (btn.id === 'pin-back') {
    pinDigits.pop();
    renderPinDots();
    return;
  }

  const digit = btn.dataset.digit;
  if (digit === undefined || pinDigits.length >= 4) return;
  pinDigits.push(digit);
  renderPinDots();

  if (pinDigits.length === 4) {
    await submitPin();
  }
});

async function submitPin() {
  const pin = pinDigits.join('');
  pinError.textContent = '';
  try {
    if (mode === 'login') {
      await api.post('/auth/login', { nickname: activeNickname, pin });
    } else {
      await api.post('/auth/register', { nickname: activeNickname, pin });
    }
    window.location.href = '/practice.html';
  } catch (err) {
    pinError.textContent = err.message || '發生錯誤，請再試一次';
    pinDigits = [];
    renderPinDots();
  }
}

(async function init() {
  const user = await fetchCurrentUser();
  if (user) {
    window.location.href = '/practice.html';
    return;
  }
  await loadProfiles();
})();
