/**
 * 戰役地圖頁（C3）。
 *
 * 一頁一百關。做成一張長長的清單而不是一張畫出來的地圖，理由很實際：
 * 一百個節點的地圖在手機上不是縮到看不見就是要一直捲，而他真正要的
 * 只有兩個答案——「我打到第幾關」和「下一關在哪裡」。
 * 兩個答案都放在最上面，下面才是整條路。
 */

import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav } from './nav-partial.js';
import { runPageInit } from './ui-status.js';
import * as sound from './sound-manager.js';

const chaptersEl = document.getElementById('campaign-chapters');
const errorEl = document.getElementById('campaign-error');
const progressEl = document.getElementById('campaign-progress');
const barEl = document.getElementById('campaign-bar');
const nextEl = document.getElementById('campaign-next');
const reviewEl = document.getElementById('campaign-review');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

const KIND_ICON = { normal: '', midboss: '🔶', finalboss: '👑' };

/*
 * 📖 複習關的入口（C4）。
 *
 * §0：卡關的出口是複習關，不是重打舊關。所以它放在最上面、下一關的旁邊——
 * 他卡住的時候第一眼就要看到「還有一條路」。
 *
 * 沒有要複習的字時也要顯示，而且寫成好消息：這是他做對了事情的結果。
 * 藏起來的話，他不會知道這個東西存在，等到有字要複習了也不會去找。
 */
function renderReview(review) {
  if (!reviewEl) return;
  if (!review) {
    reviewEl.innerHTML = '';
    return;
  }
  if (!review.count) {
    reviewEl.innerHTML =
      '<div class="review-card is-empty">' +
      '<span class="review-icon">📖</span>' +
      '<span class="review-text"><strong>複習關</strong>' +
      '<span>✨ 目前沒有要複習的字。打錯過的字會在該複習的時候出現在這裡。</span></span>' +
      '</div>';
    return;
  }
  reviewEl.innerHTML =
    `<a class="review-card" href="/game?review=1">` +
    '<span class="review-icon">📖</span>' +
    '<span class="review-text"><strong>複習關</strong>' +
    `<span>你打錯過的 ${review.count} 個字等著你` +
    `${review.count > review.size ? `（一次 ${review.size} 個）` : ''}・` +
    `經驗 ×${review.xpFactor}・卡關的時候來這裡變強</span></span>` +
    '<span class="review-go">去複習 →</span>' +
    '</a>';
  reviewEl.querySelector('a').addEventListener('click', () => sound.playClick());
}

function render(data) {
  const { summary, chapters, levels } = data;
  renderReview(data.review);

  /*
   * 關卡表是空的：這一本課本還沒有每週單字（戰役的 96 關都是從週單字排出來的）。
   *
   * 不能只是畫一張空白的清單——那看起來就是壞了。要說清楚現在是什麼狀態、
   * 以及他現在可以做什麼（競賽單字的 Part 已經練得了）。
   */
  if (!levels.length) {
    progressEl.textContent = '尚未開放';
    barEl.style.width = '0%';
    nextEl.textContent = '';
    chaptersEl.innerHTML =
      '<p class="muted" style="line-height:1.8">' +
      '這一本單字庫還沒有「每週單字」，而戰役的關卡是從每週單字排出來的，<br />' +
      '所以戰役還打不了。<br /><br />' +
      '競賽單字的 Part 已經可以用了——去<a href="/practice.html">練習</a>選一個 Part 開始吧！' +
      '</p>';
    return;
  }

  progressEl.textContent = `第 ${summary.cleared} / ${summary.total} 關`;
  barEl.style.width = `${summary.percent}%`;
  nextEl.textContent = summary.next
    ? `下一關：第 ${summary.next.level} 關・${summary.next.subtitle}`
    : '🎉 全部一百關都打完了！';

  chaptersEl.innerHTML = '';
  for (const ch of chapters) {
    const rows = levels.filter((l) => l.chapter === ch.n);
    if (!rows.length) continue;

    const done = rows.filter((l) => l.cleared).length;
    const section = document.createElement('section');
    section.className = 'chapter';
    section.innerHTML =
      `<h2 class="chapter-title">${escapeHtml(ch.title)}` +
      `<span class="chapter-count">${done} / ${rows.length}</span></h2>` +
      `<p class="chapter-blurb">${escapeHtml(ch.blurb)}</p>`;

    const grid = document.createElement('div');
    grid.className = 'level-grid';

    for (const l of rows) {
      const cls = ['level-cell'];
      if (l.cleared) cls.push('is-cleared');
      else if (l.unlocked) cls.push('is-next');
      else cls.push('is-locked');
      if (l.kind !== 'normal') cls.push('is-boss');

      const cell = document.createElement(l.unlocked ? 'a' : 'div');
      cell.className = cls.join(' ');
      if (l.unlocked) {
        cell.href = `/game?level=${l.level}`;
        cell.addEventListener('click', () => sound.playClick());
      }
      cell.innerHTML =
        `<span class="level-no">${KIND_ICON[l.kind] || ''}${l.level}</span>` +
        `<span class="level-sub">${escapeHtml(l.subtitle)}</span>` +
        `<span class="level-meta">${l.weakness ? '你的弱點字' : `${l.wordCount} 字`}</span>` +
        (l.cleared ? `<span class="level-stars">${'★'.repeat(l.stars)}${'☆'.repeat(3 - l.stars)}</span>` : '');
      /*
       * 鎖著的格子要說得出「為什麼」。
       * 只是灰掉的話他會以為壞了——而這裡的答案很簡單：先過前一關。
       */
      if (!l.unlocked) cell.title = `先過第 ${summary.cleared + 1} 關`;
      grid.appendChild(cell);
    }

    section.appendChild(grid);
    chaptersEl.appendChild(section);
  }
}

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  await mountNav(user, 'campaign');
  try {
    render(await api.get('/campaign'));
  } catch (err) {
    errorEl.textContent = err.message || '拿不到戰役進度';
  }
});
