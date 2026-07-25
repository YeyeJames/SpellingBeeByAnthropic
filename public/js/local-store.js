/**
 * localStorage 封裝。
 *
 * 兩個重點：
 * 1. 依使用者分隔命名空間——這是家裡共用的裝置，換小孩玩時絕對不能讀到別人的資料
 * 2. 所有操作都要能容忍失敗（無痕模式、容量已滿），失敗時就當作沒有快取，
 *    退回原本的線上流程，不能讓整個 app 掛掉
 */

const PREFIX = 'sb:v2';

function safeGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // 容量滿了就把快取清掉再試一次，還是失敗就放棄（不影響功能，只是變慢）
    try {
      clearCaches();
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err2) {
      return false;
    }
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    /* 忽略 */
  }
}

/** 全域共用的資料（單字庫、商店品項），所有玩家看到的都一樣 */
export function readShared(name, fallback = null) {
  const v = safeGet(`${PREFIX}:shared:${name}`);
  return v === null ? fallback : v;
}

export function writeShared(name, value) {
  return safeSet(`${PREFIX}:shared:${name}`, value);
}

/** 每個玩家各自的資料（個人檔案、金幣、待同步佇列） */
export function readUser(userId, name, fallback = null) {
  if (!userId) return fallback;
  const v = safeGet(`${PREFIX}:u:${userId}:${name}`);
  return v === null ? fallback : v;
}

export function writeUser(userId, name, value) {
  if (!userId) return false;
  return safeSet(`${PREFIX}:u:${userId}:${name}`, value);
}

export function removeUser(userId, name) {
  if (!userId) return;
  safeRemove(`${PREFIX}:u:${userId}:${name}`);
}

/** 清掉所有快取，但保留待同步佇列——那是還沒送出的資料，弄丟就真的不見了 */
export function clearCaches() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX) && !key.endsWith(':outbox')) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((k) => safeRemove(k));
  } catch (err) {
    /* 忽略 */
  }
}

export function newId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
