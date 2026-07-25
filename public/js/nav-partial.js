import { logout } from './auth.js';

/** 載入共用 nav，並用目前登入的 user 填入暱稱/金幣、標記目前頁面 */
export async function mountNav(user, activePage) {
  const mountPoint = document.querySelector('[data-nav-mount]');
  if (!mountPoint) return;

  const html = await fetch('/partials/nav.html').then((r) => r.text());
  mountPoint.innerHTML = html;

  const coinsEl = mountPoint.querySelector('[data-nav-coins]');
  const nicknameEl = mountPoint.querySelector('[data-nav-nickname]');
  if (coinsEl) coinsEl.textContent = `🪙 ${user.coins}`;
  if (nicknameEl) nicknameEl.textContent = user.nickname;

  const activeLink = mountPoint.querySelector(`[data-nav="${activePage}"]`);
  if (activeLink) activeLink.classList.add('active');

  const logoutBtn = mountPoint.querySelector('[data-nav-logout]');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
}
