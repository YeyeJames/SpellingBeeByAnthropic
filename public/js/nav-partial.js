import { api } from './api.js';
import { onSyncState } from './outbox.js';
import { readShared, writeShared } from './local-store.js';
import { updateCachedUser } from './auth.js';
import * as sound from './sound-manager.js';
import { levelFromXp } from './shared/levels.js';
import { startTelemetry } from './telemetry.js';

let coinsEl = null;
let levelEl = null;
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
// navHtml4：加了 [data-nav-level] 等級章；navHtml5：選單加了「家長報告」
const NAV_CACHE_KEY = 'navHtml5';

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
  // 行為紀錄：每一頁都掛導覽列，所以「看了哪一頁、停多久」在這裡記一次就好
  startTelemetry(user, activePage);

  coinsEl = mountPoint.querySelector('[data-nav-coins]');
  currentCoins = user.coins;
  levelEl = mountPoint.querySelector('[data-nav-level]');
  const nicknameEl = mountPoint.querySelector('[data-nav-nickname]');
  if (coinsEl) coinsEl.textContent = `🪙 ${currentCoins}`;
  if (nicknameEl) nicknameEl.textContent = user.nickname;
  setNavLevelFromXp(user.xp);

  const activeLink = mountPoint.querySelector(`[data-nav="${activePage}"]`);
  if (activeLink) activeLink.classList.add('active');

  /*
   * 背景驗證回來之後，金幣要跟著校正。
   *
   * requireLogin() 為了不擋畫面，是先用快取把頁面畫出來、同時在背景
   * 重抓一次 user。但以前沒有人聽那個結果，所以快取只要舊了，
   * 導覽列就會一路顯示舊的數字直到下次重新整理——錢看起來就像變少了。
   *
   * 只在「伺服器比畫面多」時才蓋過去。
   *
   * 這趟請求是頁面剛載入的那一刻發出的，回來時可能已經過時了：Render 的
   * 執行個體在睡覺時，api.js 會重試 503 長達二十秒，那段時間他早就答完
   * 好幾題了。無條件覆蓋會把這幾題剛賺到的錢抹掉——又變成「錢變少」，
   * 只是換一個原因。
   *
   * 扣錢的情況不靠這裡：商店買東西是由商店自己拿伺服器的回應呼叫
   * setNavCoins()，那是明確的、當下的更新，不受這個條件影響。
   */
  window.addEventListener('user-refreshed', (e) => {
    const fresh = e.detail;
    if (!fresh || typeof fresh.coins !== 'number') return;
    if (fresh.coins > currentCoins) setNavCoins(fresh.coins);
    // 等級只會往上，所以直接跟著伺服器走，不需要金幣那套防倒退的判斷
    setNavLevelFromXp(fresh.xp);
    const nameEl = mountPoint.querySelector('[data-nav-nickname]');
    if (nameEl && fresh.nickname) nameEl.textContent = fresh.nickname;
  });

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

/*
 * 目前的金幣總數。
 *
 * 這個數字比 currentUser.coins 準：它會在答對的當下先樂觀加上去，
 * 伺服器回來再校正。練習結算畫面要寫「存款總共幾枚」，用 currentUser 的話，
 * 最後幾題還在佇列裡沒送出去，寫出來的數字會比他剛剛看到的還小。
 */
export function getNavCoins() {
  return currentCoins;
}

/**
 * 伺服器確認過的金幣總數。
 *
 * 一定要一併寫回快取：換頁時 requireLogin() 是直接拿快取畫出來的，
 * 不寫的話，他在這一頁看到 700 多，跳到下一頁又變回這一頁載入時的舊值。
 */
export function setNavCoins(amount) {
  currentCoins = amount;
  if (coinsEl) coinsEl.textContent = `🪙 ${currentCoins}`;
  updateCachedUser({ coins: amount });
}

/**
 * 導覽列的等級章。
 *
 * ── 為什麼要有 ──────────────────────────────────────────
 * 他自己問的：「怎麼沒看到等級？不是說幾級才能解鎖？」
 * 在此之前 levelFromXp() 只有戰鬥畫面的 HUD 在用，遊戲外面一個地方都沒有。
 * 商店寫著「10 級解鎖」，他卻沒辦法知道自己離那裡多遠。
 *
 * ── 為什麼從 xp 現算，不另外存一個 level ──────────────────
 * 跟伺服器同一份 shared/levels.js。存兩份遲早對不起來，而那種不一致
 * 最難查：商店說他 9 級不能買，導覽列寫 10 級。
 *
 * ── 還沒打過遊戲的人不顯示 ────────────────────────────────
 * xp 是 0（或還沒有這個欄位）就整個藏起來。只練習過的人看到一個永遠
 * 不動的「Lv 1」只會多一個看不懂的東西；等他第一次打完遊戲，
 * 這個章才會出現——那時候它才有意義。
 */
export function setNavLevelFromXp(xp) {
  if (!levelEl) return;
  const n = Number(xp) || 0;
  if (n <= 0) {
    levelEl.hidden = true;
    return;
  }
  levelEl.hidden = false;
  levelEl.textContent = `Lv ${levelFromXp(n).level}`;
}
