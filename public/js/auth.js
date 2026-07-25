import { api } from './api.js';
import { applyTheme } from './theme.js';

/**
 * 取得目前登入的使用者。
 * 只有「確定沒登入」(401) 才回傳 null；其他錯誤（伺服器掛掉、資料庫連不上）
 * 一律往外丟，讓頁面把錯誤顯示出來，而不是被誤判成「沒登入」。
 */
export async function fetchCurrentUser() {
  try {
    const { user } = await api.get('/auth/me');
    return user;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
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
