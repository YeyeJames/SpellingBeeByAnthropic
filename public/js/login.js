import { api } from './api.js';
import { fetchCurrentUser, logout } from './auth.js';
import { runPageInit } from './ui-status.js';

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

function renderProfiles(profiles, currentUser) {
  profileGrid.innerHTML = '';
  profiles.forEach((p) => {
    const isCurrent = currentUser && p.nickname === currentUser.nickname;
    const tile = document.createElement('div');
    tile.className = isCurrent ? 'profile-tile current' : 'profile-tile';
    tile.innerHTML = `
      <div class="avatar-circle">${escapeHtml(p.nickname.slice(0, 1).toUpperCase())}</div>
      <div class="nickname">${escapeHtml(p.nickname)}</div>
      ${isCurrent ? '<div class="current-badge">繼續玩</div>' : ''}
    `;
    // 已登入的那位不用再輸入 PIN，直接進去；其他人要輸入自己的 PIN
    tile.addEventListener('click', () => {
      if (isCurrent) {
        window.location.href = '/practice.html';
      } else {
        startLogin(p.nickname);
      }
    });
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

runPageInit(async () => {
  // 這裡刻意「不」因為已登入就自動跳轉。
  // 這是家裡共用的裝置，要停在選單讓使用者自己挑，
  // 否則永遠只會用上一個人的帳號進去，換人玩還得先登出。
  const [{ profiles }, user] = await Promise.all([api.get('/auth/profiles'), fetchCurrentUser()]);
  renderProfiles(profiles, user);

  if (user) {
    document.getElementById('logged-in-name').textContent = user.nickname;
    document.getElementById('logged-in-hint').classList.remove('hidden');
    document.getElementById('logout-link').addEventListener('click', logout);
  }
});
