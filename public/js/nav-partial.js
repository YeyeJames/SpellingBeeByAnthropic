import { logout } from './auth.js';

let coinsEl = null;
let currentCoins = 0;

/** 載入共用 nav，並用目前登入的 user 填入暱稱/金幣、標記目前頁面 */
export async function mountNav(user, activePage) {
  const mountPoint = document.querySelector('[data-nav-mount]');
  if (!mountPoint) return;

  const html = await fetch('/partials/nav.html').then((r) => r.text());
  mountPoint.innerHTML = html;

  coinsEl = mountPoint.querySelector('[data-nav-coins]');
  currentCoins = user.coins;
  const nicknameEl = mountPoint.querySelector('[data-nav-nickname]');
  if (coinsEl) coinsEl.textContent = `🪙 ${currentCoins}`;
  if (nicknameEl) nicknameEl.textContent = user.nickname;

  const activeLink = mountPoint.querySelector(`[data-nav="${activePage}"]`);
  if (activeLink) activeLink.classList.add('active');

  const logoutBtn = mountPoint.querySelector('[data-nav-logout]');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
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
