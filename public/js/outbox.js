import { api } from './api.js';
import { readUser, writeUser, newId } from './local-store.js';

/**
 * 待同步佇列（outbox）。
 *
 * 使用者的操作先寫進這裡並立刻反映在畫面上，再由背景逐筆送到伺服器。
 * 佇列存在 localStorage，所以關掉分頁、當掉、沒網路都不會遺失。
 *
 * 重要：每筆操作都帶一個唯一的 opId，伺服器用它去重。
 * 背景同步會重試，沒有去重的話金幣會被重複計算。
 */

const listeners = new Set();
let flushing = false;
let currentUserId = null;

export function initOutbox(userId) {
  currentUserId = userId;
  flush();
}

function getQueue() {
  return readUser(currentUserId, 'outbox', []) || [];
}

function setQueue(queue) {
  writeUser(currentUserId, 'outbox', queue);
  notify();
}

export function pendingCount() {
  return getQueue().length;
}

function notify() {
  const state = { pending: pendingCount(), flushing };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (err) {
      /* 忽略單一監聽器的錯誤 */
    }
  });
}

export function onSyncState(fn) {
  listeners.add(fn);
  fn({ pending: pendingCount(), flushing });
  return () => listeners.delete(fn);
}

/**
 * 排入一筆待同步操作。
 * onApplied(serverResponse) 會在該筆成功送達後被呼叫，用來以伺服器資料校正本地狀態。
 */
export function enqueue(op) {
  const queue = getQueue();
  queue.push({ ...op, opId: op.opId || newId(), queuedAt: Date.now(), tries: 0 });
  setQueue(queue);
  flush();
}

const appliedHandlers = new Map();

/** 註冊某類型操作成功同步後要做的事（例如用伺服器回傳的金幣校正畫面） */
export function onApplied(kind, handler) {
  appliedHandlers.set(kind, handler);
}

/**
 * 逐筆送出佇列。刻意採序列而非平行：
 * 練習作答的先後順序會影響連勝與金幣計算，順序不能亂。
 */
export async function flush() {
  if (flushing || !currentUserId) return;
  if (!navigator.onLine) return;

  flushing = true;
  notify();

  try {
    while (getQueue().length) {
      const queue = getQueue();
      const op = queue[0];

      let result;
      try {
        result = await api.post(op.path, { ...op.body, opId: op.opId });
      } catch (err) {
        if (err.status && err.status >= 400 && err.status < 500) {
          // 用戶端錯誤（資料有問題、金幣不足）重試也不會成功，
          // 丟掉這筆避免卡住整個佇列，並通知畫面回復先前的樂觀更新
          setQueue(getQueue().slice(1));
          const handler = appliedHandlers.get(op.kind);
          if (handler) handler(null, op, err);
          continue;
        }
        // 伺服器或網路問題，保留在佇列裡，稍後再試
        break;
      }

      setQueue(getQueue().slice(1));
      const handler = appliedHandlers.get(op.kind);
      if (handler) handler(result, op, null);
    }
  } finally {
    flushing = false;
    notify();
  }
}

// 有機會就把佇列清空：回到前景、網路恢復、定時檢查
window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flush();
});
setInterval(flush, 20000);
