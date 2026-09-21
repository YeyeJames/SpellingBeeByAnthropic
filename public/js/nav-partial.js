import { api } from './api.js';
import { onSyncState } from './outbox.js';
import { readShared, writeShared } from './local-store.js';
import * as sound from './sound-manager.js';

let coinsEl = null;
let currentCoins = 0;

// 導覽列樣板存進本地：切換分頁時可以立刻畫出來，完全不必等網路。
// 同時在背景更新快取，樣板改版後下次進來就會生效。
/*
 * 版本號要跟著樣板一起改。
 *
 * 不改的話，樣板改版後第一次進來用的仍是舊的快取 HTML，而新的 JS 會去找
 * 舊 HTML 裡沒有的元素——按鈕直接變成死的，要重新整理一次才會好。
 * 那種問題在自己的機器上永遠看不到（快取是空的），只有使用者會遇到。
 */
const NAV_CACHE_KEY = 'navHtml2';

function fetchNavHtml() {
  return fetch('/partials/nav.html')
    .then((r) => r.text())
    .then((html) => {
      writeShared(NAV_CACHE_KEY, html);
      return html;
    });
}

const cachedNavHtml = readShared(NAV_CACHE_KEY);
// 有快取就背景更新，沒有才需要等
const navHtmlPromise = cachedNavHtml ? Promise.resolve(cachedNavHtml) : fetchNavHtml();
if (cachedNavHtml) fetchNavHtml().catch(() => {});

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

  // 同步狀態：讓家長看得出來練習紀錄有沒有真的存到伺服器
  const syncEl = mountPoint.querySelector('[data-sync-status]');
  if (syncEl) {
    onSyncState(({ pending, flushing }) => {
      if (pending === 0) {
        syncEl.textContent = '✅';
        syncEl.title = '資料已全部同步';
      } else {
        syncEl.textContent = flushing ? `⏳ ${pending}` : `📤 ${pending}`;
        syncEl.title = `還有 ${pending} 筆資料等待同步`;
      }
    });
  }

  prefetchOtherPages(activePage);

  /*
   * 換人／登出的選單。
   *
   * 「換人玩」不登出：選單上那個帳號仍然顯示「繼續玩」，想換別人點他的
   * 頭像就進去了（沒有密碼，家裡沒有外人）。「登出」才真的把 session 清掉，
   * 留給「這台電腦等一下不是我們在用」的情況。
   *
   * 兩個都留著是因為它們的心智模型不同：小孩想的是「換人」，
   * 大人想的是「登出」，兩個詞都要看得到才不會有人找不到路。
   */
  const menu = mountPoint.querySelector('[data-nav-user-menu]');
  const switchBtn = mountPoint.querySelector('[data-nav-switch]');
  const nicknameMenuEl = mountPoint.querySelector('[data-nav-nickname-menu]');
  if (nicknameMenuEl) nicknameMenuEl.textContent = user.nickname;

  /*
   * 萬一仍然拿到舊版樣板（快取剛好卡在中間狀態），退回原本的行為：
   * 點暱稱直接回選單。寧可少一個選單，也不能讓按鈕變成死的。
   */
  if (switchBtn && !menu) {
    switchBtn.addEventListener('click', () => {
      window.location.href = '/index.html';
    });
  }

  if (switchBtn && menu) {
    const setOpen = (open) => {
      menu.hidden = !open;
      switchBtn.setAttribute('aria-expanded', String(open));
    };

    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });

    // 點別的地方、或按 Esc 就收起來
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !mountPoint.querySelector('[data-nav-user]').contains(e.target)) {
        setOpen(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) setOpen(false);
    });

    mountPoint
      .querySelector('[data-nav-switch-account]')
      ?.addEventListener('click', () => {
        window.location.href = '/index.html';
      });

    mountPoint.querySelector('[data-nav-logout]')?.addEventListener('click', async () => {
      const { logout } = await import('./auth.js');
      logout();
    });
  }

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

// 每個分頁自己專屬的檔案；共用的 CSS/JS 第一次載入後就已在快取裡
const PAGE_ASSETS = {
  practice: ['/practice.html', '/css/practice.css', '/js/practice.js'],
  wordbank: ['/wordbank.html', '/css/wordbank.css', '/js/wordbank.js'],
  shop: ['/shop.html', '/css/shop.css', '/js/shop.js'],
  profile: ['/profile.html', '/css/profile.css', '/js/profile.js']
};

/**
 * 頁面閒下來後，把其他分頁的檔案先抓進瀏覽器快取。
 * 這樣點下分頁時就不必再等檔案下載，切換會明顯順很多。
 */
function prefetchOtherPages(activePage) {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => {
    Object.entries(PAGE_ASSETS).forEach(([page, urls]) => {
      if (page === activePage) return;
      urls.forEach((url) => {
        fetch(url, { credentials: 'same-origin' }).catch(() => {});
      });
    });
  });
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
