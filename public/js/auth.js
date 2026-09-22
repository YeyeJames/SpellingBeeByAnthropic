import { api } from './api.js';
import { applyTheme } from './theme.js';
import { readShared, writeShared } from './local-store.js';

const CACHE_KEY = 'currentUser';

export function getCachedUser() {
  return readShared(CACHE_KEY);
}

export function cacheUser(user) {
  writeShared(CACHE_KEY, user);
}

export function clearCachedUser() {
  writeShared(CACHE_KEY, null);
}

/**
 * 就地改幾個欄位進快取。
 *
 * requireLogin() 為了不擋畫面，換頁時是直接回傳快取的 user；但練習途中
 * 金幣是在記憶體裡加的，從來沒寫回快取。結果就是：練到 700 多，一跳到
 * 單字庫又變回 680——那是這一頁載入時的舊值。錢**變少**對小孩來說
 * 不是顯示問題，是「我的錢不見了」。
 *
 * 所以伺服器一確認新的金幣數，就順手更新快取，下一頁才會從對的數字開始。
 */
export function updateCachedUser(patch) {
  const cached = getCachedUser();
  if (!cached || !patch) return cached;
  const next = { ...cached, ...patch };
  writeShared(CACHE_KEY, next);
  return next;
}

/**
 * 取得目前登入的使用者。
 * 只有「確定沒登入」(401) 才回傳 null；其他錯誤（伺服器掛掉、資料庫連不上）
 * 一律往外丟，讓頁面把錯誤顯示出來，而不是被誤判成「沒登入」。
 */
export async function fetchCurrentUser() {
  try {
    const { user } = await api.get('/auth/me');
    cacheUser(user);
    return user;
  } catch (err) {
    if (err.status === 401) {
      clearCachedUser();
      return null;
    }
    throw err;
  }
}

/**
 * 保護需要登入的頁面。
 *
 * 有本地快取時直接用它把畫面畫出來，不等伺服器回應——切換分頁時
 * 光是這一趟驗證就要幾百毫秒，而登入狀態幾乎不會在分頁之間改變。
 * 驗證改在背景進行，真的失效了再導回登入頁。
 */
export async function requireLogin() {
  const cached = getCachedUser();

  if (cached) {
    applyTheme(cached.activeTheme);
    // 背景驗證，不擋畫面
    fetchCurrentUser()
      .then((user) => {
        if (!user) {
          window.location.href = '/index.html';
          return;
        }
        if (user.activeTheme !== cached.activeTheme) applyTheme(user.activeTheme);
        window.dispatchEvent(new CustomEvent('user-refreshed', { detail: user }));
      })
      .catch(() => {
        // 伺服器暫時有問題就先讓使用者繼續用本地資料，api.js 會自行重試
      });
    return cached;
  }

  const user = await fetchCurrentUser();
  if (!user) {
    window.location.href = '/index.html';
    return null;
  }
  applyTheme(user.activeTheme);
  return user;
}

export async function logout() {
  clearCachedUser();
  try {
    await api.post('/auth/logout');
  } finally {
    window.location.href = '/index.html';
  }
}
