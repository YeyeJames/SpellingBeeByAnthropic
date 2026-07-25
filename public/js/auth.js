import { api } from './api.js';
import { applyTheme } from './theme.js';

export async function fetchCurrentUser() {
  try {
    const { user } = await api.get('/auth/me');
    return user;
  } catch (err) {
    return null;
  }
}

/** 保護需要登入的頁面：沒登入就導回首頁，登入了就套用主題並回傳 user */
export async function requireLogin() {
  const user = await fetchCurrentUser();
  if (!user) {
    window.location.href = '/index.html';
    return null;
  }
  applyTheme(user.activeTheme);
  return user;
}

export async function logout() {
  await api.post('/auth/logout');
  window.location.href = '/index.html';
}
