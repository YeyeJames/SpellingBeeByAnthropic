import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav, setNavCoins } from './nav-partial.js';
import { applyTheme } from './theme.js';
import * as sound from './sound-manager.js';
import { createCoinCatchGame } from './game/minigame-coincatch.js';
import { runPageInit } from './ui-status.js';

const shopGrid = document.getElementById('shop-grid');
const shopError = document.getElementById('shop-error');
const minigameOverlay = document.getElementById('minigame-overlay');
const minigameResult = document.getElementById('minigame-result');

let currentUser = null;
let minigameInstance = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadItems() {
  shopError.textContent = '';
  try {
    const { items } = await api.get('/shop/items');
    renderItems(items);
  } catch (err) {
    shopError.textContent = err.message;
  }
}

function renderItems(items) {
  shopGrid.innerHTML = '';
  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'shop-card';
    card.innerHTML = `
      <img src="${item.iconAsset}" alt="${escapeHtml(item.name)}" />
      <div class="sc-name">${escapeHtml(item.name)}</div>
      <div class="sc-desc">${escapeHtml(item.description)}</div>
      <div class="sc-action"></div>
    `;
    const actionEl = card.querySelector('.sc-action');
    actionEl.appendChild(buildActionElement(item));
    shopGrid.appendChild(card);
  });
}

function buildActionElement(item) {
  if (!item.owned) {
    const btn = document.createElement('button');
    btn.className = 'btn gold';
    btn.textContent = `購買 🪙${item.cost}`;
    btn.disabled = currentUser.coins < item.cost;
    btn.addEventListener('click', () => purchaseItem(item.key));
    return btn;
  }

  if (item.type === 'theme') {
    const btn = document.createElement('button');
    const isActive = currentUser.activeTheme === item.key.replace('theme_', '');
    btn.className = isActive ? 'btn secondary' : 'btn';
    btn.textContent = isActive ? '✅ 使用中' : '套用主題';
    btn.disabled = isActive;
    btn.addEventListener('click', () => equipTheme(item.key.replace('theme_', '')));
    return btn;
  }

  if (item.type === 'avatarAccessory') {
    const equipped = (currentUser.avatar.accessories || []).includes(item.key);
    const btn = document.createElement('button');
    btn.className = equipped ? 'btn secondary' : 'btn';
    btn.textContent = equipped ? '卸下' : '穿上';
    btn.addEventListener('click', () => toggleAccessory(item.key, equipped));
    return btn;
  }

  if (item.type === 'minigame') {
    const btn = document.createElement('button');
    btn.className = 'btn gold';
    btn.textContent = '🎮 玩';
    btn.addEventListener('click', openMinigame);
    return btn;
  }

  return document.createElement('span');
}

async function purchaseItem(itemKey) {
  shopError.textContent = '';
  try {
    const { user } = await api.post('/shop/purchase', { itemKey });
    currentUser = user;
    setNavCoins(user.coins);
    sound.playCoin();
    await loadItems();
  } catch (err) {
    shopError.textContent = err.message;
  }
}

async function equipTheme(themeKey) {
  sound.playClick();
  try {
    const { user } = await api.post('/user/equip', { type: 'theme', itemKey: themeKey });
    currentUser = user;
    applyTheme(themeKey);
    await loadItems();
  } catch (err) {
    shopError.textContent = err.message;
  }
}

async function toggleAccessory(itemKey, currentlyEquipped) {
  sound.playClick();
  try {
    const path = currentlyEquipped ? '/user/unequip' : '/user/equip';
    const body = currentlyEquipped ? { itemKey } : { type: 'avatarAccessory', itemKey };
    const { user } = await api.post(path, body);
    currentUser = user;
    await loadItems();
  } catch (err) {
    shopError.textContent = err.message;
  }
}

function openMinigame() {
  sound.playClick();
  minigameResult.textContent = '';
  minigameOverlay.classList.remove('hidden');
  if (!minigameInstance) {
    minigameInstance = createCoinCatchGame('minigame-container');
  }
  window.addEventListener('coincatch-coin', () => sound.playCoin());
  window.addEventListener('coincatch-ended', onMinigameEnded);
}

function onMinigameEnded(e) {
  minigameResult.textContent = `🎉 這次接到了 ${e.detail.score} 個金幣！（好玩用的，不會加到真正的金幣喔）`;
}

document.getElementById('close-minigame-btn').addEventListener('click', () => {
  minigameOverlay.classList.add('hidden');
  if (minigameInstance) {
    minigameInstance.destroy(true);
    minigameInstance = null;
  }
});

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  currentUser = user;
  await mountNav(user, 'shop');
  await loadItems();
});
