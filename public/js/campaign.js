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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

const KIND_ICON = { normal: '', midboss: '🔶', finalboss: '👑' };

function render(data) {
  const { summary, chapters, levels } = data;

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
        `<span class="level-meta">${l.wordCount} 字</span>` +
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
