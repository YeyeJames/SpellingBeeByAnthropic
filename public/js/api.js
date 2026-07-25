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

async function request(method, path, body) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      showWaking(`正在喚醒伺服器…（第 ${attempt}/${MAX_RETRIES} 次嘗試）`);
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

    hideWaking();

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

  hideWaking();
  throw lastError || new Error('請求失敗');
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path)
};
