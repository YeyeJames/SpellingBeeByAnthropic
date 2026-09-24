/**
 * 商店的裝備區（C5）。
 *
 * 跟造型那一區分開是刻意的：那一區花金幣（練習賺的）買外觀，這一區花蜂蜜
 * （遊戲賺的）買會改變戰鬥的東西。混在一起他會分不清自己的錢夠不夠。
 *
 * 畫面的判斷全部來自 shared/equipment.js 的 gearAvailability()——伺服器用的是
 * 同一個函式，所以不會出現「畫面說能買、按下去說不行」。
 */

import { api } from './api.js';
import * as sound from './sound-manager.js';
import { newId } from './local-store.js';

const honeyBadge = document.getElementById('gear-honey');
const slotsEl = document.getElementById('gear-slots');
const errorEl = document.getElementById('gear-error');

let data = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

/**
 * 一件裝備的狀態標籤。
 *
 * 順序就是他要看的順序：裝著的最重要，其次是鎖著（還差幾級——這是他
 * 下一個目標），再來是買得起／不夠。只寫「不能買」是沒有用的資訊，
 * 一定要寫出「為什麼」與「還差多少」。
 */
function statusOf(item) {
  if (item.equipped) return { text: '✅ 裝備中', cls: 'is-equipped' };
  if (item.owned) return { text: '已擁有', cls: 'is-owned' };
  if (!item.unlocked) return { text: `🔒 ${item.minLevel} 級解鎖`, cls: 'is-locked' };
  if (!item.affordable) return { text: `🍯 ${item.cost}（還差 ${item.cost - data.honey}）`, cls: 'is-poor' };
  return { text: `🍯 ${item.cost}`, cls: 'is-buyable' };
}

function render() {
  if (!data) return;
  honeyBadge.textContent = `🍯 ${data.honey}`;
  slotsEl.innerHTML = '';

  for (const slot of data.slots) {
    const items = data.items.filter((i) => i.slot === slot).sort((a, b) => a.tier - b.tier);
    const section = document.createElement('section');
    section.className = 'gear-slot';

    const equippedItem = items.find((i) => i.equipped);
    section.innerHTML =
      `<h2 class="gear-slot-title">${escapeHtml(data.slotLabels[slot] || slot)}` +
      `<span class="gear-slot-now">${equippedItem ? escapeHtml(equippedItem.name) : '沒有裝'}</span></h2>`;

    const grid = document.createElement('div');
    grid.className = 'gear-grid';

    for (const item of items) {
      const st = statusOf(item);
      const card = document.createElement('div');
      card.className = `gear-card ${st.cls}`;
      card.innerHTML =
        `<div class="gear-name">${escapeHtml(item.name)}</div>` +
        `<div class="gear-desc">${escapeHtml(item.description)}</div>` +
        `<div class="gear-status">${escapeHtml(st.text)}</div>`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      if (item.equipped) {
        /*
         * 飾品才可以脫掉。武器護甲脫掉等於回到初始裝備，
         * 那個「脫掉」按鈕只會讓人誤以為可以不裝——所以不給。
         */
        if (slot === 'trinket') {
          btn.textContent = '脫下';
          btn.classList.add('secondary');
          btn.onclick = () => equip(slot, null);
        } else {
          btn.textContent = '裝備中';
          btn.disabled = true;
        }
      } else if (item.owned) {
        btn.textContent = '換上';
        btn.onclick = () => equip(slot, item.key);
      } else if (!item.unlocked) {
        btn.textContent = `${item.minLevel} 級解鎖`;
        btn.disabled = true;
      } else if (!item.affordable) {
        btn.textContent = '蜂蜜不夠';
        btn.disabled = true;
      } else {
        btn.textContent = '買下來';
        btn.classList.add('gold');
        btn.onclick = () => buy(item);
      }
      card.appendChild(btn);
      grid.appendChild(card);
    }

    section.appendChild(grid);
    slotsEl.appendChild(section);
  }
}

async function load() {
  try {
    data = await api.get('/shop/gear');
    errorEl.textContent = '';
    render();
  } catch (err) {
    errorEl.textContent = err.message || '拿不到裝備清單';
  }
}

async function buy(item) {
  errorEl.textContent = '';
  sound.playClick();
  try {
    /*
     * 不走背景佇列。
     *
     * 買裝備跟記練習分數不一樣：他按下去之後要馬上知道買到了沒、
     * 蜂蜜剩多少。排進佇列的話畫面得先樂觀假設成功，萬一伺服器說
     * 「蜂蜜不夠」（在別台裝置上花掉了），畫面已經把裝備畫成擁有了。
     * opId 還是帶著，重送不會扣兩次錢。
     */
    await api.post('/shop/gear/buy', { gearKey: item.key, opId: newId() });
    sound.playStreak();
    await load();
  } catch (err) {
    errorEl.textContent = err.message || '買不下來';
  }
}

async function equip(slot, gearKey) {
  errorEl.textContent = '';
  sound.playClick();
  try {
    await api.post('/shop/gear/equip', { slot, gearKey });
    await load();
  } catch (err) {
    errorEl.textContent = err.message || '換不了裝';
  }
}

export function initGearShop() {
  if (!slotsEl) return Promise.resolve();
  return load();
}
