/*
 * 首頁 = 選帳號。
 *
 * 沒有密碼、沒有 PIN。這台機器只有我跟孩子在用，家裡沒有外人，
 * PIN 擋不到任何人，只會讓孩子每次玩之前多按四下還常常忘記。
 * 點一下名字就進去，另外可以新增與刪除帳號。
 *
 * 刻意「不」因為已登入就自動跳轉：這是家裡共用的裝置，要停在選單讓
 * 使用者自己挑，否則永遠只會用上一個人的帳號進去，換人玩還得先登出。
 */

import { api } from './api.js';
import { fetchCurrentUser, logout, cacheUser } from './auth.js';
import { runPageInit } from './ui-status.js';

const profileStep = document.getElementById('profile-step');
const profileGrid = document.getElementById('profile-grid');
const profileError = document.getElementById('profile-error');
const manageToggle = document.getElementById('manage-toggle');
const newProfileStep = document.getElementById('new-profile-step');
const newNicknameInput = document.getElementById('new-nickname');
const newProfileError = document.getElementById('new-profile-error');
const deleteStep = document.getElementById('delete-profile-step');
const deleteTargetName = document.getElementById('delete-target-name');
const deleteConfirmInput = document.getElementById('delete-confirm');
const deleteError = document.getElementById('delete-error');

let profiles = [];
let currentUser = null;
/* 有哪幾本單字庫（兩個孩子各一本），以及新帳號選了哪一本 */
let banks = [];
let selectedBank = null;
let managing = false; // 管理模式：每個帳號右上角多一顆刪除鈕
let deleteTarget = null;

function showStep(step) {
  [profileStep, newProfileStep, deleteStep].forEach((s) => s.classList.add('hidden'));
  step.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/*
 * 帳號磚上標出用的是哪一本課本。
 *
 * 兩個孩子的帳號長得一樣，只有名字不同——標出課本才看得出「這個是哥哥的」。
 * 只有一本的時候不標，那是噪音。
 */
function bankLabelFor(profile) {
  if (banks.length <= 1) return '';
  const b = banks.find((x) => x.id === (profile.wordBankId || banks[0]?.id));
  return b ? ` ・ ${escapeHtml(b.label)}` : '';
}

function renderProfiles() {
  profileGrid.innerHTML = '';

  profiles.forEach((p) => {
    const isCurrent = currentUser && p.nickname === currentUser.nickname;
    const tile = document.createElement('div');
    tile.className = isCurrent ? 'profile-tile current' : 'profile-tile';

    const coins = Number(p.coins) || 0;
    tile.innerHTML = `
      <div class="avatar-circle">${escapeHtml(p.nickname.slice(0, 1).toUpperCase())}</div>
      <div class="nickname">${escapeHtml(p.nickname)}</div>
      <div class="tile-sub">🪙 ${coins}${bankLabelFor(p)}</div>
      ${isCurrent ? '<div class="current-badge">繼續玩</div>' : ''}
    `;

    if (managing) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tile-delete';
      del.title = `刪除 ${p.nickname}`;
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation(); // 不要順便把這個帳號選進去
        startDelete(p);
      });
      tile.appendChild(del);
    } else {
      tile.addEventListener('click', () => enterProfile(p.nickname));
    }

    profileGrid.appendChild(tile);
  });

  if (!managing) {
    const newTile = document.createElement('div');
    newTile.className = 'profile-tile new-profile';
    newTile.innerHTML = `
      <div class="avatar-circle">＋</div>
      <div class="nickname">新增帳號</div>
    `;
    newTile.addEventListener('click', startNewProfile);
    profileGrid.appendChild(newTile);
  }

  manageToggle.textContent = managing ? '完成' : '管理帳號';
  if (!profiles.length) profileError.textContent = '';
}

async function enterProfile(nickname) {
  profileError.textContent = '';
  try {
    const { user } = await api.post('/auth/login', { nickname });
    // 立刻寫入快取，下一頁就不必再等一次登入驗證
    cacheUser(user);
    // 進來先看到練習頁：先練再玩，這是整個流程的順序
    window.location.href = '/practice.html';
  } catch (err) {
    profileError.textContent = err.message || '進不去，請再試一次';
  }
}

/*
 * 課本選擇。
 *
 * 只有一本的時候不用問——多一個只有一個選項的問題，對小孩來說就是
 * 一個看不懂的步驟。兩本以上才畫出來，而且預設不選，逼他做一次決定：
 * 選錯的話他會一路練到別人的功課，而畫面上看不出來（單字都是英文）。
 */
function renderBankPicker() {
  const box = document.getElementById('new-bank');
  const note = document.getElementById('new-bank-note');
  if (!box) return;
  box.innerHTML = '';
  if (banks.length <= 1) {
    box.hidden = true;
    if (note) note.textContent = '';
    selectedBank = banks[0]?.id || null;
    return;
  }
  box.hidden = false;
  for (const b of banks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bank-option' + (selectedBank === b.id ? ' selected' : '');
    btn.innerHTML =
      `<span class="bank-name">${escapeHtml(b.owner || b.label)}</span>` +
      `<span class="bank-sub">${escapeHtml(b.label)}・${b.ready ? `${b.wordCount} 字` : '還沒有單字'}</span>`;
    btn.addEventListener('click', () => {
      selectedBank = b.id;
      renderBankPicker();
    });
    box.appendChild(btn);
  }
  const chosen = banks.find((b) => b.id === selectedBank);
  if (note) {
    note.textContent = chosen && !chosen.ready
      ? '⚠️ 這一本還沒有單字，建好帳號之後要先把單字加進去才練得了。'
      : '';
  }
}

function startNewProfile() {
  newNicknameInput.value = '';
  newProfileError.textContent = '';
  selectedBank = null;
  renderBankPicker();
  showStep(newProfileStep);
  newNicknameInput.focus();
}

async function createProfile() {
  const nickname = newNicknameInput.value.trim();
  if (!nickname) {
    newProfileError.textContent = '請輸入名字';
    return;
  }
  if (banks.length > 1 && !selectedBank) {
    newProfileError.textContent = '請選一本單字庫';
    return;
  }
  newProfileError.textContent = '';
  try {
    /*
     * 只有一本課本的時候不送這個欄位——沒得選就不該有這個問題存在，
     * 伺服器本來就會退回預設那一本。
     */
    const body = selectedBank ? { nickname, wordBankId: selectedBank } : { nickname };
    const { user } = await api.post('/auth/register', body);
    cacheUser(user);
    window.location.href = '/practice.html';
  } catch (err) {
    newProfileError.textContent = err.message || '建立失敗，請再試一次';
  }
}

function startDelete(profile) {
  deleteTarget = profile;
  deleteTargetName.textContent = profile.nickname;
  deleteConfirmInput.value = '';
  deleteError.textContent = '';
  showStep(deleteStep);
  deleteConfirmInput.focus();
}

async function confirmDelete() {
  if (!deleteTarget) return;
  deleteError.textContent = '';
  try {
    await api.del(`/auth/profiles/${deleteTarget._id}`, {
      confirmNickname: deleteConfirmInput.value
    });
  } catch (err) {
    deleteError.textContent = err.message || '刪不掉，請再試一次';
    return;
  }

  // 刪掉的如果是目前登入的那位，前端的快取也要一起清掉
  if (currentUser && currentUser._id === deleteTarget._id) {
    currentUser = null;
    cacheUser(null);
    document.getElementById('logged-in-hint').classList.add('hidden');
  }
  deleteTarget = null;
  managing = false;
  await reloadProfiles();
  showStep(profileStep);
}

async function reloadProfiles() {
  const { profiles: list, banks: bankList } = await api.get('/auth/profiles');
  profiles = list || [];
  banks = bankList || [];
  renderProfiles();
}

manageToggle.addEventListener('click', () => {
  managing = !managing;
  renderProfiles();
});

document.getElementById('new-profile-cancel').addEventListener('click', () => showStep(profileStep));
document.getElementById('new-profile-create').addEventListener('click', createProfile);
newNicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createProfile();
});

document.getElementById('delete-cancel').addEventListener('click', () => {
  deleteTarget = null;
  showStep(profileStep);
});
document.getElementById('delete-confirm-btn').addEventListener('click', confirmDelete);
deleteConfirmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmDelete();
});

runPageInit(async () => {
  const [{ profiles: list }, user] = await Promise.all([
    api.get('/auth/profiles'),
    fetchCurrentUser()
  ]);
  profiles = list || [];
  currentUser = user;
  renderProfiles();

  if (user) {
    document.getElementById('logged-in-name').textContent = user.nickname;
    document.getElementById('logged-in-hint').classList.remove('hidden');
    document.getElementById('logout-link').addEventListener('click', logout);
  }
});
