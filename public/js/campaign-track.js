/**
 * 戰役的「路」：一條從第 1 關走到第 100 關的進度路線，加上「下一關」的按鈕。
 *
 * ── 為什麼要有這個 ──────────────────────────────────────────
 * 第 100 關（大魔王）是整個遊戲的終點，但原本只有導覽列上一個小小的「戰役」
 * 分頁知道它存在：登入後落在練習頁，練完按「玩遊戲」打的是單組遊戲，
 * 一路上沒有任何地方提到戰役。家長看分析檔才發現：哥哥打到第 6 關就沒再進去，
 * 弟弟一關都沒打過。
 *
 * 所以同一條路畫在每一個他會經過的地方（練習頁、個人檔案、地圖頁、遊戲結算），
 * 長得一模一樣：他看一次就認得「這是我的戰役，我走到這裡，終點是那頂皇冠」。
 *
 * ── 為什麼路上要標中王 ────────────────────────────────────
 * 6 / 100 對小四生來說等於「永遠打不完」。路上那三個 🔶 把一百關切成四段，
 * 「再 19 關就是中王」是今天、這個禮拜就看得到的距離。
 */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

/* 王關的位置寫死在關卡表裡（shared/campaign.js 的 MIDBOSS_LEVELS / FINAL_BOSS_LEVEL） */
const MILESTONES = [
  { level: 25, icon: '🔶', label: '中王' },
  { level: 50, icon: '🔶', label: '中王' },
  { level: 75, icon: '🔶', label: '中王' },
  { level: 100, icon: '👑', label: '大魔王' }
];
const CHAPTER_LABELS = ['第一章', '第二章', '第三章', '第四章'];

/**
 * 進度路線。summary 是 shared/campaign.js 的 campaignSummary()（至少要有 cleared / total）。
 * @param opts.labels 要不要在路下面寫章名與「中王／大魔王」（窄的地方不寫）
 */
export function trackHtml(summary, { labels = true } = {}) {
  const total = Number(summary?.total) || 0;
  if (!total) return '';
  const cleared = Math.min(Number(summary.cleared) || 0, total);
  const pct = (n) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  const nodes = MILESTONES.filter((m) => m.level <= total)
    .map((m) => {
      const state = m.level <= cleared ? 'is-done' : m.level === summary.nextBoss?.level ? 'is-next' : '';
      return (
        `<span class="ctrack-node ${state}${m.level === total ? ' is-final' : ''}" style="left:${pct(m.level)}"` +
        ` title="第 ${m.level} 關・${m.label}">${m.icon}</span>`
      );
    })
    .join('');
  const labelRow = labels
    ? '<div class="ctrack-labels">' +
      CHAPTER_LABELS.map((t, i) => `<span style="left:${pct(i * 25 + 12.5)}">${t}</span>`).join('') +
      MILESTONES.filter((m) => m.level <= total)
        .map((m) => `<span class="is-boss${m.level === total ? ' is-final' : ''}" style="left:${pct(m.level)}">${m.label}</span>`)
        .join('') +
      '</div>'
    : '';
  return (
    `<div class="ctrack" role="img" aria-label="戰役進度：${cleared} / ${total} 關">` +
    `<div class="ctrack-rail"><div class="ctrack-fill" style="width:${pct(cleared)}"></div></div>` +
    nodes +
    `<span class="ctrack-bee" style="left:${pct(cleared)}">🐝</span>` +
    '</div>' +
    labelRow
  );
}

/** 「下一個目標」那一句：下一個王還有幾關 */
export function goalText(summary) {
  if (!summary?.total) return '';
  if (summary.done) return '🎉 一百關全部打完了！你已經完成整場模擬比賽。';
  const b = summary.nextBoss;
  if (!b) return '';
  if (b.kind === 'finalboss') {
    return b.away <= 1
      ? '👑 下一關就是大魔王：競賽單字全部 100 字！'
      : `👑 終點：第 ${b.level} 關・大魔王（還有 ${b.away} 關）`;
  }
  return b.away <= 1
    ? `🔶 下一關就是中王（第 ${b.level} 關）！`
    : `🔶 下一個中王：第 ${b.level} 關（還有 ${b.away} 關）`;
}

/** 「下一關」按鈕的字與連結 */
export function nextAction(summary) {
  if (!summary?.total) return null;
  if (summary.done || !summary.next) return { href: '/campaign.html', text: '🗺️ 看戰役地圖', sub: '' };
  const n = summary.next;
  const icon = n.kind === 'finalboss' ? '👑' : n.kind === 'midboss' ? '🔶' : '▶';
  return {
    href: `/game?level=${n.level}`,
    text: `${icon} ${summary.cleared ? '繼續' : '開始'}第 ${n.level} 關`,
    sub: n.weakness ? '你的弱點單字' : `${n.subtitle}・${n.wordCount} 字`
  };
}

/**
 * 戰役橫幅：練習頁與個人檔案的最上面。
 * 標題、打到第幾關、星星、進度路線、下一個目標，右邊一顆「繼續第 N 關」。
 */
export function bannerHtml(summary) {
  const act = nextAction(summary);
  if (!act) return '';
  return (
    '<div class="cbanner">' +
    '<div class="cbanner-main">' +
    '<div class="cbanner-head">' +
    '<a class="cbanner-title" href="/campaign.html">🗺️ 蜂巢戰役</a>' +
    `<span class="cbanner-count">第 <b>${summary.cleared}</b> / ${summary.total} 關</span>` +
    (summary.starsEarned ? `<span class="cbanner-stars">★ ${summary.starsEarned}</span>` : '') +
    '</div>' +
    trackHtml(summary) +
    `<p class="cbanner-goal">${escapeHtml(goalText(summary))}</p>` +
    '</div>' +
    `<a class="cbanner-go" href="${act.href}">` +
    `<span>${escapeHtml(act.text)}</span>` +
    (act.sub ? `<small>${escapeHtml(act.sub)}</small>` : '') +
    '</a>' +
    '</div>'
  );
}

/**
 * 只知道「打到第幾關」時（導覽列從 /auth/me 拿到的 { cleared, total }），
 * 自己推出路線要用的那幾個欄位。王關的位置是固定的，不必問伺服器。
 */
export function summaryFromCounts(campaign) {
  const total = Number(campaign?.total) || 0;
  if (!total) return null;
  const cleared = Math.min(Number(campaign.cleared) || 0, total);
  const boss = MILESTONES.find((m) => m.level <= total && m.level > cleared);
  return {
    cleared,
    total,
    done: cleared >= total,
    next: cleared < total ? { level: cleared + 1 } : null,
    nextBoss: boss
      ? { level: boss.level, kind: boss.level === total ? 'finalboss' : 'midboss', away: boss.level - cleared }
      : null
  };
}

/**
 * 確定這個帳號打得了戰役（他那一本課本有每週單字）才做 fn。
 *
 * 快取裡的 user 可能是登入那一刻存的、還沒有 campaign 欄位；背景的 /auth/me
 * 回來（user-refreshed）才知道。兩邊都等，但只做一次。
 * 不知道就不問伺服器：沒有戰役的帳號不該為了一塊不會出現的橫幅多打一支 API。
 */
export function whenCampaignKnown(user, fn) {
  let done = false;
  const run = (u) => {
    if (done || !(Number(u?.campaign?.total) > 0)) return;
    done = true;
    fn(u);
  };
  run(user);
  if (!done) window.addEventListener('user-refreshed', (e) => run(e.detail));
}

/** 跟伺服器拿進度摘要。拿不到（沒登入、離線）回 null，呼叫的那一邊就不畫 */
export async function fetchCampaignSummary() {
  try {
    const res = await fetch('/api/campaign/summary', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.summary?.total ? data.summary : null;
  } catch (err) {
    return null;
  }
}
