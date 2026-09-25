/**
 * 家長報告頁。資料由 /api/telemetry/report 算好，這裡只負責畫出來。
 *
 * 每個數字旁邊都寫「怎麼算的」：這些是從按鍵推出來的，不是讀心，
 * 家長要能判斷該信幾分。
 */

import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav } from './nav-partial.js';
import { runPageInit } from './ui-status.js';

const kidsEl = document.getElementById('report-kids');
const errorEl = document.getElementById('report-error');
const daysEl = document.getElementById('report-days');
const exportEl = document.getElementById('report-export');

const PAGE_NAMES = {
  practice: '練習', game: '遊戲', shop: '商店', campaign: '戰役地圖',
  wordbank: '單字庫', profile: '檔案'
};
const PERK_NAMES = {
  lightning: '⚡ 閃電手', rush: '🔥 加速挑戰', firstStrike: '🎯 首字重擊',
  rewind: '⏪ 倒帶', freeze: '❄️ 冰凍針', clover: '🍀 幸運草'
};
const GAME_NAMES = { minigame_coincatch: '接金幣', minigame_beeflap: '蜜蜂飛行', minigame_whack: '打蟲大作戰' };

function esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}
const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const mins = (ms) => `${Math.round((ms || 0) / 60000)} 分`;

function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return '<div class="rbars">' + rows.map((r) =>
    `<div class="rbar"><span class="rbar-label">${esc(r.label)}</span>` +
    `<span class="rbar-track"><span class="rbar-fill" style="width:${Math.round((r.value / max) * 100)}%"></span></span>` +
    `<span class="rbar-value">${esc(r.text)}</span></div>`).join('') + '</div>';
}

function section(title, body, how) {
  return `<section class="rsec"><h3>${title}</h3>${body}${how ? `<p class="rhow">${how}</p>` : ''}</section>`;
}

function renderKid(r) {
  const out = [];
  out.push(`<h2>${esc(r.nickname)}</h2>`);

  out.push(section('📚 練習與遊戲',
    `<p>練習完 <b>${r.practice.sessions}</b> 組、答了 <b>${r.practice.answers}</b> 題，答對 <b>${pct(r.practice.accuracy)}</b>。</p>` +
    `<p>遊戲打了 <b>${r.games.played}</b> 場、贏 <b>${r.games.won}</b> 場` +
    `（戰役 ${r.games.byMode.level || 0}、複習關 ${r.games.byMode.review || 0}、練習後的遊戲 ${r.games.byMode.group || 0}）。</p>` +
    `<p>戰役打到第 <b>${r.campaign.highestCleared}</b> 關；打過的關卡裡，第一次就輸的比例 <b>${pct(r.campaign.firstTryFail)}</b>。</p>` +
    (r.campaign.hardest.length
      ? `<p>打最多次的關卡：${r.campaign.hardest.map((l) => `第 ${l.level} 關（${l.tries} 次${l.won ? '' : '，還沒過'}）`).join('、')}</p>`
      : '')));

  const m = r.misses;
  out.push(section('🎯 漏掉的字為什麼漏掉',
    m.total
      ? bars([
        { label: '來不及', value: m.slow, text: `${m.slow} 個` },
        { label: '不會拼', value: m.unknown, text: `${m.unknown} 個` },
        { label: '沒動作', value: m.idle, text: `${m.idle} 個` }
      ]) + (m.topUnknown.length
        ? `<p>最常「不會拼」的字：${m.topUnknown.map((w) => `<b>${esc(w.english)}</b>（${w.times}）`).join('、')}</p>` : '')
      : '<p>這段時間沒有漏掉的字（或還沒有遊戲紀錄）。</p>',
    '從每一場的按鍵推出來的：蟲到的時候已經打對一半以上、幾乎沒打錯 → 來不及；' +
    '打錯兩個字母以上、或打不到一半 → 不會拼；整個字一個鍵都沒按 → 沒動作。是推估，不是讀心。'));

  out.push(section('⌨️ 英打速度（越短越快）',
    r.typing.length
      ? bars(r.typing.map((t) => ({ label: `${t.week} 那週`, value: t.msPerKey || 0, text: `每個鍵 ${t.msPerKey} 毫秒（${t.battles} 場）` })))
      : '<p>還沒有遊戲紀錄。</p>',
    '同一個字裡兩個按鍵之間的時間，取中位數。每個字的第一下不算（那裡包含聽單字的時間）。'));

  const pages = Object.entries(r.time.byPage).sort((a, b) => b[1] - a[1]);
  out.push(section('⏱️ 時間花在哪裡',
    pages.length
      ? bars(pages.map(([p, ms]) => ({ label: PAGE_NAMES[p] || p, value: ms, text: mins(ms) })))
      : '<p>還沒有紀錄。</p>',
    '只算畫面開在前面的時間；切到別的分頁、螢幕關掉的時間不算。'));

  const g = r.minigames;
  out.push(section('🎮 小遊戲',
    g.plays
      ? `<p>玩了 <b>${g.plays}</b> 次：${Object.entries(g.byKey).map(([k, n]) => `${GAME_NAMES[k] || k} ${n}`).join('、')}。</p>` +
        `<p>平均每練完一組，玩 <b>${g.perPractice === null ? '—' : g.perPractice.toFixed(1)}</b> 次小遊戲。</p>`
      : '<p>這段時間沒有玩小遊戲。</p>'));

  const p = r.perks;
  out.push(section('🃏 三選一',
    p.decisions
      ? `<p>選了 <b>${p.decisions}</b> 次，一般花 <b>${p.medianMs === null ? '—' : (p.medianMs / 1000).toFixed(1)}</b> 秒選；` +
        `<b>${pct(p.fastShare)}</b> 是一秒內就選好。</p>` +
        bars(Object.entries(p.picked).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: PERK_NAMES[k] || k, value: n, text: `${n} 次` })))
      : '<p>還沒有遇到三選一（只在戰役關卡出現）。</p>',
    '一秒內就選好，多半沒有看卡片上寫什麼。設計上的約定：如果大部分都是亂選，就把三選一拿掉。'));

  return `<article class="rkid">${out.join('')}</article>`;
}

async function load() {
  errorEl.textContent = '';
  const days = Number(daysEl.value) || 30;
  exportEl.href = `/api/telemetry/export?days=${days}`;
  try {
    const data = await api.get(`/telemetry/report?days=${days}`);
    kidsEl.innerHTML = data.reports.length ? data.reports.map(renderKid).join('') : '<p>還沒有任何帳號。</p>';
  } catch (err) {
    errorEl.textContent = err.message || '拿不到報告';
  }
}

daysEl.addEventListener('change', load);

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  await mountNav(user, 'report');
  await load();
});
