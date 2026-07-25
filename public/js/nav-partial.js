import { logout } from './auth.js';
import { api } from './api.js';
import * as sound from './sound-manager.js';

let coinsEl = null;
let currentCoins = 0;

// 在模組載入的當下就開始抓導覽列樣板，跟登入驗證的請求平行進行。
// 若等到 mountNav() 被呼叫才抓，就會多一次串接的往返，導覽列會明顯晚一拍才出現。
const navHtmlPromise = fetch('/partials/nav.html').then((r) => r.text());

/** 載入共用 nav，並用目前登入的 user 填入暱稱/金幣、標記目前頁面 */
export async function mountNav(user, activePage) {
  const mountPoint = document.querySelector('[data-nav-mount]');
  if (!mountPoint) return;

  mountPoint.innerHTML = await navHtmlPromise;

  coinsEl = mountPoint.querySelector('[data-nav-coins]');
  currentCoins = user.coins;
  const nicknameEl = mountPoint.querySelector('[data-nav-nickname]');
  if (coinsEl) coinsEl.textContent = `🪙 ${currentCoins}`;
  if (nicknameEl) nicknameEl.textContent = user.nickname;

  const activeLink = mountPoint.querySelector(`[data-nav="${activePage}"]`);
  if (activeLink) activeLink.classList.add('active');

  const logoutBtn = mountPoint.querySelector('[data-nav-logout]');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  sound.loadPrefs(user);
  const muteBtn = mountPoint.querySelector('[data-nav-mute]');
  if (muteBtn) {
    muteBtn.textContent = sound.isMuted() ? '🔇' : '🔊';
    muteBtn.addEventListener('click', async () => {
      const nowMuted = !sound.isMuted();
      sound.setMuted(nowMuted);
      muteBtn.textContent = nowMuted ? '🔇' : '🔊';
      try {
        await api.put('/auth/audio-prefs', { muted: nowMuted });
      } catch (err) {
        // 靜音狀態暫時只影響這次瀏覽，儲存失敗不影響操作
      }
    });
  }
}

/** 練習/商店等頁面即時異動金幣時，同步更新 nav 上顯示的金幣數字（不用整頁重抓） */
export function refreshNavCoins(delta) {
  currentCoins += delta;
  if (coinsEl) coinsEl.textContent = `🪙 ${currentCoins}`;
}

export function setNavCoins(amount) {
  currentCoins = amount;
  if (coinsEl) coinsEl.textContent = `🪙 ${currentCoins}`;
}
