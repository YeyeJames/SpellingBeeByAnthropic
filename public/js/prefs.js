/**
 * 「這個孩子自己的」設定：難度、出題順序、朗讀方式、上次選的組……
 *
 * ── 為什麼要有這個檔案 ──────────────────────────────────────
 * 這些設定本來全部用 readShared / writeShared 存，也就是**同一台電腦上
 * 所有帳號共用一份**。只有一個孩子在用的時候看不出來；兩個孩子輪流用
 * 同一台電腦，就會互相蓋掉。最嚴重的是難度：
 *
 *   手速校準是「每個孩子第一次玩都要先量」，因為同一個孩子打 easy
 *   失敗率 10%、打 hard 是 100%。共用的話，Allen 一進遊戲就直接拿到
 *   Pierce 量出來的難度，**而且因為「已經有難度了」，連校準都跳過**。
 *
 * 這幾天孩子踩到的 bug 幾乎都是這一種（單字庫頁、練習頁、建帳號選單），
 * 所以把「存到誰名下」集中到這裡，不要每個頁面各自決定。
 *
 * ── 規則 ─────────────────────────────────────────────────
 * - 有登入帳號（本地快取裡有）→ 存在那個帳號名下
 * - 沒有 → 退回共用的那一份。遊戲頁刻意不強制登入（資料庫掛了也要
 *   打得開），那種情況下本來就只有「這台電腦」可以記
 *
 * 帳號是從本地快取讀的，同步、不連網——這些設定常常在頁面一載入就要用。
 *
 * ── 什麼**不**該放這裡 ─────────────────────────────────────
 * 真的是「這台電腦」的東西：登入快取本身、導覽列樣板、商店目錄、
 * 語音引擎選哪一個聲音（那是裝置的事，不是孩子的事）。
 */

import { readShared, writeShared, readUser, writeUser } from './local-store.js';
import { getCachedUser } from './auth.js';

function currentUserId() {
  const u = getCachedUser();
  return u && u._id ? String(u._id) : null;
}

export function readPref(name, fallback = null) {
  const id = currentUserId();
  return id ? readUser(id, name, fallback) : readShared(name, fallback);
}

export function writePref(name, value) {
  const id = currentUserId();
  return id ? writeUser(id, name, value) : writeShared(name, value);
}
