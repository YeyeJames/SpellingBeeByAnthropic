import { showWaking, hideWaking } from './ui-status.js';

const BASE = '/api';

// Render 免費方案休眠喚醒時，前幾個請求可能直接失敗或回 502/503/504，
// 所以遇到這類「伺服器還沒醒」的狀況要自動重試，並讓使用者看到等待畫面。
const RETRY_STATUSES = [502, 503, 504];
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * quiet：背景同步用，不蓋那一層「正在喚醒伺服器」。
 *
 * 那一層是整頁不透明、擋住所有點擊的，本來是給「頁面剛打開、真的要等
 * 伺服器」用的。背景佇列送練習答案時也走這裡：網路閃一下、伺服器重開，
 * 孩子每答一題就被擋 15～20 秒（docs/audit/step3 的 N1～N3）——而練習
 * 本來就設計成沒網路也能繼續，答案會留在佇列裡之後再送。
 * 背景同步的狀態看導覽列的小圖示（📤 N）就好。重試的次數與間隔不變。
 */
async function request(method, path, body, { quiet = false } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      if (!quiet) showWaking(`正在喚醒伺服器…（第 ${attempt}/${MAX_RETRIES} 次嘗試）`);
      await sleep(RETRY_DELAY_MS);
    }

    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin'
      });
    } catch (networkErr) {
      // 連不上伺服器（休眠中、斷網），值得重試
      lastError = new Error('連不到伺服器，請確認網路連線');
      lastError.isNetworkError = true;
      continue;
    }

    if (RETRY_STATUSES.includes(res.status)) {
      // 保留伺服器給的具體原因（例如「資料庫尚未連線：...」），
      // 重試都失敗時才有辦法告訴使用者到底哪裡出問題
      const detail = await res.text().then(
        (t) => {
          try {
            return JSON.parse(t).error;
          } catch (e) {
            return null;
          }
        },
        () => null
      );
      lastError = new Error(detail || `伺服器暫時無法回應 (${res.status})`);
      lastError.status = res.status;
      continue;
    }

    if (!quiet) hideWaking();

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        // 伺服器回傳了非 JSON 的內容（通常是錯誤頁面），把它當成錯誤訊息呈現
        const error = new Error(`伺服器回應格式錯誤 (${res.status})：${text.slice(0, 120)}`);
        error.status = res.status;
        throw error;
      }
    }

    if (!res.ok) {
      const error = new Error((data && data.error) || `請求失敗 (${res.status})`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  if (!quiet) hideWaking();
  throw lastError || new Error('請求失敗');
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body) => request('PUT', path, body),
  // DELETE 也吃 body：刪帳號要把名字打一次才算數，那個確認字串得送過去
  del: (path, body) => request('DELETE', path, body)
};
