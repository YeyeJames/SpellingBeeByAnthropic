import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav, setNavCoins } from './nav-partial.js';
import { applyTheme } from './theme.js';
import * as sound from './sound-manager.js';
import { loadPhaser } from './game/load-phaser.js';
import { runPageInit } from './ui-status.js';
import { initOutbox, enqueue, onApplied } from './outbox.js';
import { readShared, writeShared } from './local-store.js';

const shopGrid = document.getElementById('shop-grid');
const shopError = document.getElementById('shop-error');
const minigameOverlay = document.getElementById('minigame-overlay');
const minigameResult = document.getElementById('minigame-result');

let currentUser = null;
let minigameInstance = null;
let cachedItems = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** 用本地的擁有清單重畫，不必再問伺服器 */
function renderFromCache() {
  renderItems(cachedItems);
}

function refreshItems() {
  return api.get('/shop/items').then(({ items }) => {
    // 只快取商品本身，「是否擁有」以本地的使用者資料為準，避免蓋掉尚未同步的購買
    cachedItems = items.map(({ owned, ...item }) => item);
    writeShared('shopItems', cachedItems);
    renderFromCache();
  });
}

/** 有快取就立刻畫出來並直接返回，更新丟到背景 */
async function loadItems() {
  shopError.textContent = '';
  const cached = readShared('shopItems');
  if (cached) {
    cachedItems = cached;
    renderFromCache();
    refreshItems().catch(() => {});
    return;
  }
  await refreshItems();
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
  // 「是否擁有」一律看本地的使用者資料，這樣剛買下去畫面就會立刻變成已擁有
  const owned = (currentUser.ownedItemKeys || []).includes(item.key);

  if (!owned) {
    const btn = document.createElement('button');
    btn.className = 'btn gold';
    btn.textContent = `購買 🪙${item.cost}`;
    btn.disabled = currentUser.coins < item.cost;
    btn.addEventListener('click', () => purchaseItem(item));
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

/**
 * 樂觀購買：先在本地扣款並解鎖，畫面立刻更新，實際請求丟給背景佇列。
 * 若伺服器最後不接受（例如在別台裝置上已經把金幣花掉了），
 * onApplied 會把本地狀態改回來並說明原因。
 */
function purchaseItem(item) {
  shopError.textContent = '';
  if ((currentUser.ownedItemKeys || []).includes(item.key)) return;
  if (currentUser.coins < item.cost) {
    shopError.textContent = '金幣不夠喔，再多練習賺一點吧！';
    return;
  }

  currentUser.coins -= item.cost;
  currentUser.ownedItemKeys = [...(currentUser.ownedItemKeys || []), item.key];
  setNavCoins(currentUser.coins);
  sound.playCoin();
  renderFromCache();

  enqueue({
    kind: 'purchase',
    path: '/shop/purchase',
    body: { itemKey: item.key, cost: item.cost }
  });
}

// 換造型/主題純粹是外觀，先在本地套用，變更丟背景佇列
function equipTheme(themeKey) {
  sound.playClick();
  currentUser.activeTheme = themeKey;
  applyTheme(themeKey);
  renderFromCache();
  enqueue({ kind: 'equip', path: '/user/equip', body: { type: 'theme', itemKey: themeKey } });
}

function toggleAccessory(itemKey, currentlyEquipped) {
  sound.playClick();
  const list = currentUser.avatar.accessories || [];
  currentUser.avatar.accessories = currentlyEquipped
    ? list.filter((k) => k !== itemKey)
    : [...list, itemKey];
  renderFromCache();
  enqueue({
    kind: 'equip',
    path: currentlyEquipped ? '/user/unequip' : '/user/equip',
    body: currentlyEquipped ? { itemKey } : { type: 'avatarAccessory', itemKey }
  });
}

async function openMinigame() {
  sound.playClick();
  minigameResult.textContent = '';
  minigameOverlay.classList.remove('hidden');
  if (!minigameInstance) {
    // 小遊戲才需要 Phaser，等按下去才載入
    minigameResult.textContent = '載入中…';
    await loadPhaser();
    const { createCoinCatchGame } = await import('./game/minigame-coincatch.js');
    minigameResult.textContent = '';
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

// 伺服器是金幣與擁有清單的最終權威。若購買被拒絕（例如在別台裝置上
// 已經把金幣花掉了），把本地的樂觀更新收回來並說明原因。
onApplied('purchase', (result, op, err) => {
  if (err) {
    currentUser.coins += op.body.cost;
    currentUser.ownedItemKeys = (currentUser.ownedItemKeys || []).filter((k) => k !== op.body.itemKey);
    setNavCoins(currentUser.coins);
    shopError.textContent = `「${op.body.itemKey}」購買失敗：${err.message}`;
    renderFromCache();
    return;
  }
  if (result && result.user) {
    currentUser = result.user;
    setNavCoins(currentUser.coins);
    renderFromCache();
  }
});

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  currentUser = user;
  initOutbox(user._id);
  await Promise.all([mountNav(user, 'shop'), loadItems()]);
});
