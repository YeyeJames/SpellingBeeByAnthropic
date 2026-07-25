/**
 * 全頁面共用的狀態提示：錯誤橫幅與「伺服器喚醒中」覆蓋層。
 *
 * 重要：這裡一律使用 inline style，不依賴任何 CSS 檔案。
 * 因為這些提示要在「連 CSS 都載入失敗」的情況下依然看得見，
 * 否則使用者只會看到一片空白，完全沒有線索。
 */

function esc(str) {
  const div = document.createElement('div');
  div.textContent = String(str == null ? '' : str);
  return div.innerHTML;
}

/** 顯示無法繼續的錯誤，並提供重新整理按鈕 */
export function showFatalError(title, detail) {
  document.querySelectorAll('[data-fatal-error]').forEach((el) => el.remove());

  const box = document.createElement('div');
  box.setAttribute('data-fatal-error', '');
  box.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:99999',
    'background:#e5383b', 'color:#fff', 'padding:16px 18px',
    'font-family:system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif',
    'font-size:15px', 'line-height:1.6', 'box-shadow:0 2px 14px rgba(0,0,0,.35)'
  ].join(';');

  box.innerHTML = `
    <div style="font-weight:bold;font-size:16px;">⚠️ ${esc(title)}</div>
    <div style="margin-top:6px;font-size:13px;opacity:.95;word-break:break-word;">${esc(detail)}</div>
    <button type="button" data-reload
      style="margin-top:12px;background:#fff;color:#e5383b;border:none;border-radius:8px;
             padding:8px 16px;font-size:14px;font-weight:bold;cursor:pointer;">
      重新整理
    </button>
  `;
  box.querySelector('[data-reload]').addEventListener('click', () => window.location.reload());
  document.body.appendChild(box);
}

let wakingEl = null;

/** Render 免費方案休眠後喚醒需要約 1 分鐘，這段期間要讓使用者知道正在等待 */
export function showWaking(message) {
  if (wakingEl) {
    const msgEl = wakingEl.querySelector('[data-waking-msg]');
    if (msgEl) msgEl.textContent = message;
    return;
  }

  wakingEl = document.createElement('div');
  wakingEl.setAttribute('data-waking', '');
  wakingEl.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99998',
    'background:rgba(20,40,80,.88)', 'color:#fff',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:14px', 'text-align:center', 'padding:24px',
    'font-family:system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif'
  ].join(';');

  wakingEl.innerHTML = `
    <div style="font-size:52px;animation:sb-bob 1s ease-in-out infinite;">🐝</div>
    <div data-waking-msg style="font-size:17px;font-weight:bold;">${esc(message)}</div>
    <div style="font-size:13px;opacity:.85;max-width:280px;">
      免費方案的伺服器休息後需要一點時間醒來，請稍等一下下…
    </div>
    <style>@keyframes sb-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}</style>
  `;
  document.body.appendChild(wakingEl);
}

export function hideWaking() {
  if (wakingEl) {
    wakingEl.remove();
    wakingEl = null;
  }
}

/** 移除載入閘門，讓頁面內容一次淡入 */
export function markPageReady() {
  document.body.classList.remove('page-loading');
}

/**
 * 包住每個頁面的初始化流程：
 * 1. 出錯時把錯誤顯示在畫面上，而不是留下一片空白
 * 2. 不論成功或失敗，最後都要解除載入閘門，避免畫面永遠卡在載入中
 */
export async function runPageInit(fn) {
  try {
    await fn();
  } catch (err) {
    hideWaking();
    console.error(err);
    showFatalError('載入失敗', err && err.message ? err.message : String(err));
  } finally {
    markPageReady();
  }
}
