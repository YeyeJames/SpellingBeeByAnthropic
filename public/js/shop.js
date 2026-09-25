import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav, setNavCoins } from './nav-partial.js';
import { applyTheme } from './theme.js';
import * as sound from './sound-manager.js';
import { loadPhaser } from './game/load-phaser.js';
import { runPageInit } from './ui-status.js';
import { initOutbox, enqueue, onApplied } from './outbox.js';
import { readShared, writeShared, newId } from './local-store.js';
import { readPref, writePref } from './prefs.js';
import { track } from './telemetry.js';
import { initGearShop } from './gear-shop.js';

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
  /*
   * 一件商品都沒有的時候要說話。
   *
   * 原本是直接畫一個空的格線——什麼都沒有、也沒有任何說明。商店品項是
   * 要跑 `npm run seed` 才會進資料庫的，忘了跑（或換了資料庫）就會變這樣。
   * 兒子第一次玩就是先跑去點商店想看有什麼；那一下要是看到一片空白，
   * 他學到的是「這裡沒東西」，之後就不會再點了——而商店正是賺金幣的理由。
   */
  if (!items.length) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.style.gridColumn = '1 / -1';
    note.textContent = '商店還沒有上架任何東西，晚點再來看看！';
    shopGrid.appendChild(note);
    return;
  }
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
    /*
     * 每玩一次要付錢（家長決定的，見 shop-items.js），所以按鈕上一定要寫價格，
     * 錢不夠就直接灰掉並寫出差多少——不是按下去才跳錯誤。
     * 價格拿不到（舊的商店快取）就只寫「玩」，不要寫出一個錯的數字。
     */
    const btn = document.createElement('button');
    const cost = Number(item.playCost) || 0;
    const short = cost - (currentUser.coins || 0);
    btn.className = 'btn gold';
    btn.dataset.minigamePlay = item.key;
    btn.textContent = cost ? `🎮 玩一次 🪙${cost}` : '🎮 玩';
    btn.disabled = cost > 0 && short > 0;
    if (btn.disabled) btn.title = `還差 🪙${short}，去練習賺一點吧！`;
    btn.addEventListener('click', () => openMinigame(item));
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

/* ── 小遊戲 ────────────────────────────────────────────────
 *
 * 流程：付錢 → 付成功才開始玩 → 結束 → 顯示分數與最高紀錄 → 可以再玩一次（再付一次）。
 *
 * 付錢不走背景佇列（跟購買不一樣）：伺服器說付成功了遊戲才開始。
 * 先玩後付的話，錢不夠的那一局等於免費，畫面上的金幣還會先變負再彈回來。
 */
const minigameTitle = document.getElementById('minigame-title');
const minigameHowTo = document.getElementById('minigame-howto');
const minigameAgain = document.getElementById('minigame-again');
const minigameNote = document.getElementById('minigame-note');
let minigameItem = null;
let minigameStartedAt = 0;

/*
 * 測試用的把手（跟遊戲頁的 window.__spellbee 同一個做法）。
 * 只讀狀態與觸發明確開放的動作，不給任何改金幣的方法。
 */
const testHandle = { key: null, ready: false, scoreEvents: 0 };
window.__minigame = {
  get key() { return testHandle.key; },
  get ready() { return testHandle.ready; },
  score: () => (minigameInstance ? minigameInstance.score() : 0),
  autoplay: () => (minigameInstance ? minigameInstance.autoplay() : 0),
  finish: () => minigameInstance && minigameInstance.finish(),
  scoreEventCount: () => testHandle.scoreEvents,
  resetScoreEventCount: () => { testHandle.scoreEvents = 0; },
  peekLetter: () => (minigameInstance && minigameInstance.peekLetter ? minigameInstance.peekLetter() : null),
  peekStarted: () => (minigameInstance && minigameInstance.peekStarted ? minigameInstance.peekStarted() : null)
};

function stopMinigame() {
  if (minigameInstance) {
    minigameInstance.game.destroy(true);
    minigameInstance = null;
  }
  testHandle.ready = false;
}

async function openMinigame(item) {
  sound.playClick();
  stopMinigame();
  minigameItem = item;
  const { MINIGAMES } = await import('./game/minigames/registry.js');
  const def = MINIGAMES[item.key];
  if (!def) {
    shopError.textContent = '這個小遊戲還沒有做好';
    return;
  }
  minigameTitle.textContent = def.title;
  minigameHowTo.textContent = def.howTo;
  minigameAgain.hidden = true;
  minigameNote.hidden = true;
  minigameResult.textContent = '付款中…';
  minigameOverlay.classList.remove('hidden');

  let paid;
  try {
    paid = await api.post('/shop/play', { itemKey: item.key, opId: newId() });
  } catch (err) {
    minigameResult.textContent = err.message || '付款失敗，請再試一次';
    return;
  }
  currentUser.coins = paid.coins;
  setNavCoins(paid.coins);
  renderFromCache();

  minigameResult.textContent = '載入中…';
  await loadPhaser();
  const mod = await def.load();
  // 付款期間他可能已經按了關閉
  if (minigameOverlay.classList.contains('hidden') || minigameItem !== item) return;
  minigameResult.textContent = '';
  testHandle.key = item.key;
  testHandle.scoreEvents = 0;
  minigameStartedAt = performance.now();
  minigameInstance = mod.create('minigame-container', {
    onReady: () => { testHandle.ready = true; },
    onScore: () => {
      testHandle.scoreEvents += 1;
      sound.playCoin();
    },
    onEnd: (score) => onMinigameEnded(item, score)
  });
}

/*
 * 一局結束：寫分數與最高紀錄。
 *
 * ⚠️ 這裡**只寫字**，不碰金幣。小遊戲的分數如果會變成真的錢，練拼字就變成
 * 賺錢最慢的方法了（economy-test 第 4 節盯著這一段）。
 * 最高紀錄存在這個孩子自己名下（prefs），兩兄弟各比各的。
 */
function onMinigameEnded(item, score) {
  // 行為紀錄：他最常玩哪一個、玩多久——拿來跟練習次數比，看小遊戲有沒有取代練習
  track('minigame', { key: item.key, score, ms: Math.round(performance.now() - minigameStartedAt) });
  const key = `minigameBest:${item.key}`;
  const best = Number(readPref(key)) || 0;
  const isRecord = score > best;
  if (isRecord) writePref(key, score);
  /*
   * 最後那一句不能省：接金幣的畫面上數的就是「金幣」，不講清楚的話
   * 他會以為接到的會加進存款，然後回頭問「錢怎麼沒有變多」——
   * 跟之前「練習了三次，錢怎麼還是只有 300」同一種困惑。
   */
  const line = isRecord && score > 0
    ? `🏆 新紀錄！這一局 ${score} 分`
    : `這一局 ${score} 分（最高紀錄 ${Math.max(best, score)} 分）`;
  minigameResult.textContent = line;
  minigameNote.textContent = '（分數是好玩用的，不會加到真正的金幣喔）';
  minigameNote.hidden = false;
  showAgainButton(item);
}

/* 「再玩一次」要再付一次，所以跟商店的按鈕一樣寫價格、錢不夠就灰掉 */
function showAgainButton(item) {
  const cost = Number(item.playCost) || 0;
  minigameAgain.textContent = cost ? `🔁 再玩一次 🪙${cost}` : '🔁 再玩一次';
  minigameAgain.disabled = cost > 0 && (currentUser.coins || 0) < cost;
  minigameAgain.hidden = false;
}

minigameAgain.addEventListener('click', () => {
  if (minigameItem) openMinigame(minigameItem);
});

document.getElementById('close-minigame-btn').addEventListener('click', () => {
  minigameOverlay.classList.add('hidden');
  minigameItem = null;
  stopMinigame();
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
  await Promise.all([mountNav(user, 'shop'), loadItems(), initGearShop()]);
});
