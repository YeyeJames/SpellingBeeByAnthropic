/**
 * 行為紀錄（前端）。記什麼、為什麼、保存多久，見 server/routes/telemetry.js。
 *
 * ── 為什麼不走 outbox ────────────────────────────────────────
 * outbox 是**一筆一筆照順序**送的（練習作答的先後會影響連勝與金幣），
 * 一筆卡住，後面全部等。行為紀錄如果也排進去，哪天紀錄那一支出錯，
 * 他的練習答案就同步不上去了——那是本末倒置。
 *
 * 所以這裡有自己的一條路：自己的暫存、自己送、失敗幾次就丟。
 * 最壞的情況是少了幾筆行為紀錄；練習和遊戲的成績一筆都不會受影響。
 *
 * ── 限制 ────────────────────────────────────────────────────
 * - 暫存最多 500 筆事件、5 份錄影檔（localStorage 有容量上限，不能被它塞滿）
 * - 一筆送 5 次都失敗就丟掉
 * - 不記滑鼠座標、不記打進輸入框的內容（按鍵在錄影檔裡，那是遊戲本身的資料）
 */

import { readUser, writeUser, newId } from './local-store.js';

const MAX_EVENTS = 500;
const MAX_LOGS = 5;
const MAX_TRIES = 5;
const BATCH = 200;

let userId = null;
let page = null;
let visibleSince = null;
let visibleMs = 0;
let flushing = false;
let wired = false;

const read = (name, fb) => (userId ? readUser(userId, name, fb) || fb : fb);
const write = (name, v) => userId && writeUser(userId, name, v);

/** 記一筆事件。沒有登入就不記（遊戲頁允許不登入玩）。 */
export function track(kind, data = {}) {
  if (!userId) return;
  const events = read('telemetryEvents', []);
  events.push({ kind, page, t: Date.now(), data });
  write('telemetryEvents', events.slice(-MAX_EVENTS));
}

/** 一場遊戲的錄影檔。跟成績用同一個 opId，之後對得起來。 */
export function uploadBattleLog(opId, log) {
  if (!userId || !log || !log.entries) return;
  const logs = read('telemetryLogs', []);
  logs.push({ opId, log, tries: 0 });
  write('telemetryLogs', logs.slice(-MAX_LOGS));
  flush();
}

async function post(path, body, keepalive = false) {
  const res = await fetch(`/api/telemetry${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    keepalive
  });
  return res.status;
}

/**
 * 送出暫存。事件先組成一批、批號先存起來再送——重送時用同一個批號，
 * 伺服器才認得出是同一批。
 */
export async function flush(keepalive = false) {
  if (!userId || flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  flushing = true;
  try {
    let batch = read('telemetryBatch', null);
    if (!batch) {
      const events = read('telemetryEvents', []);
      if (events.length) {
        batch = { opId: newId(), events: events.slice(0, BATCH), tries: 0 };
        write('telemetryEvents', events.slice(BATCH));
        write('telemetryBatch', batch);
      }
    }
    if (batch) {
      const status = await post('/events', { opId: batch.opId, events: batch.events }, keepalive).catch(() => 0);
      batch.tries += 1;
      // 成功、或是資料本身有問題（4xx，重送也不會好）、或送太多次了：丟掉這一批
      if ((status >= 200 && status < 500) || batch.tries >= MAX_TRIES) write('telemetryBatch', null);
      else write('telemetryBatch', batch);
    }
    if (keepalive) return; // 頁面要關了，大的錄影檔留到下次
    const logs = read('telemetryLogs', []);
    const keep = [];
    for (const item of logs) {
      const status = await post('/battle-log', { opId: item.opId, log: item.log }).catch(() => 0);
      item.tries += 1;
      if (!(status >= 200 && status < 500) && item.tries < MAX_TRIES) keep.push(item);
    }
    write('telemetryLogs', keep);
  } finally {
    flushing = false;
  }
}

/* 看得到的時間才算：分頁切走、螢幕關掉的時間不算在「停在這一頁」 */
function onVisibility() {
  if (document.visibilityState === 'visible') {
    visibleSince = performance.now();
  } else if (visibleSince !== null) {
    visibleMs += performance.now() - visibleSince;
    visibleSince = null;
    flush();
  }
}

function onLeave() {
  if (visibleSince !== null) visibleMs += performance.now() - visibleSince;
  visibleSince = null;
  track('page_leave', { ms: Math.round(visibleMs) });
  flush(true);
}

/*
 * 按了哪個按鈕。只記「是哪一顆」（id、樣式、上面寫什麼的前 30 個字、連到哪一頁），
 * 不記座標、不記輸入框裡的內容。
 */
function onClick(e) {
  const el = e.target && e.target.closest
    ? e.target.closest('button, a, [data-track], .level-cell, .perk-card, .bank-option, .part-btn, .review-card')
    : null;
  if (!el) return;
  const href = el.getAttribute('href');
  track('click', {
    id: el.id || null,
    cls: (el.className && String(el.className).split(/\s+/)[0]) || null,
    track: el.dataset?.track || el.dataset?.minigamePlay || el.dataset?.perkPick || null,
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    href: href && href.startsWith('/') ? href : null
  });
}

/**
 * 每一頁開起來時呼叫一次。
 * @param user   現在登入的帳號（沒有就不記）
 * @param name   這一頁叫什麼：practice、game、shop……
 * @param detail 這一頁的補充（例如遊戲是第幾關）
 */
export function startTelemetry(user, name, detail = {}) {
  /*
   * 家長報告這一頁不記。家長多半是用其中一個孩子的帳號開的，
   * 記下來的話，家長看報告的時間會變成「孩子在報告頁停了 10 分鐘」。
   */
  if (name === 'report') {
    userId = null;
    return;
  }
  userId = user && user._id ? String(user._id) : null;
  if (!userId) return;
  page = name;
  visibleMs = 0;
  visibleSince = document.visibilityState === 'visible' ? performance.now() : null;
  track('page_view', detail);
  if (!wired) {
    wired = true;
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('click', onClick, true);
    setInterval(() => flush(), 15000);
  }
  flush();
}
