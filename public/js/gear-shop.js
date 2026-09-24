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
import { battlesToLevel } from './shared/levels.js';

const honeyBadge = document.getElementById('gear-honey');
const levelBadge = document.getElementById('gear-level');
const goalEl = document.getElementById('gear-goal');
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
  /*
   * 鎖著的時候寫「還差幾級」，不是只寫門檻。
   *
   * 原本只寫「🔒 10 級解鎖」，而畫面上沒有任何地方寫他現在幾級——
   * 那個數字他無法拿來算距離，只能盯著看。差距要我們幫他算好。
   */
  if (!item.unlocked) {
    const gap = item.minLevel - (data ? data.level : 0);
    return { text: `🔒 還差 ${gap} 級（${item.minLevel} 級解鎖）`, cls: 'is-locked' };
  }
  if (!item.affordable) return { text: `🍯 ${item.cost}（還差 ${item.cost - data.honey}）`, cls: 'is-poor' };
  return { text: `🍯 ${item.cost}`, cls: 'is-buyable' };
}

/*
 * 「這裡現在有什麼可以做」——一行話寫在最上面。
 *
 * 實際看他玩發現的：練完一輪就跑來商店，然後研究了很久。那個畫面上
 * 十三件裝備有十一件是鎖的、兩件是他身上已經穿著的初始裝，蜂蜜有七百多
 * 卻一滴都花不掉——他在找的是「我到底要做什麼」，而畫面沒有回答。
 *
 * 一件都不能買的時候，不能只是排一堆灰色卡片了事，要把最近的那個目標
 * 直接講出來：還差幾級、練到了可以買什麼。錢花不掉本來就是設計裡寫過的
 * 失敗模式（§9.5），等級門檻等於在上面又做了一次，那就得由畫面補回來。
 */
function goalLine() {
  const buyable = data.items.filter((i) => i.canBuy);
  if (buyable.length) {
    return `現在有 ${buyable.length} 件買得起：${buyable.map((i) => i.name).join('、')}`;
  }

  const locked = data.items
    .filter((i) => !i.owned && !i.unlocked)
    .sort((a, b) => a.minLevel - b.minLevel);
  if (locked.length) {
    const next = locked[0];
    const gap = next.minLevel - data.level;
    /*
     * 「還差 4 級」他看不出是多遠——聽起來像一個禮拜，實際上是兩場。
     * 所以換算成場數講出來（估計值，見 levels.js 的 TYPICAL_BATTLE_XP）。
     * 沒有 xp 的話（舊的伺服器）就只講級數，不要硬掰一個場數。
     */
    const games = typeof data.xp === 'number'
      ? battlesToLevel(data.xp, next.minLevel) : 0;
    const howFar = games
      ? `再升 ${gap} 級（大約再打 ${games} 場）`
      : `再升 ${gap} 級`;
    return `你現在 ${data.level} 級。${howFar}就能買第一件裝備：${next.name}。去玩遊戲模式賺經驗吧！`;
  }

  // 買不起但解得開：問題在錢，講差多少
  const poor = data.items
    .filter((i) => !i.owned && i.unlocked && !i.affordable)
    .sort((a, b) => a.cost - b.cost);
  if (poor.length) {
    return `再賺 🍯 ${poor[0].cost - data.honey} 就能買 ${poor[0].name}。`;
  }
  return '每一件都到手了，厲害！';
}

function render() {
  if (!data) return;
  honeyBadge.textContent = `🍯 ${data.honey}`;
  levelBadge.textContent = `Lv ${data.level}`;
  goalEl.textContent = goalLine();
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
        btn.textContent = `再 ${item.minLevel - data.level} 級`;
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
