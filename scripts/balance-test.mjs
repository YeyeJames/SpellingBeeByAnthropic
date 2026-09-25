/**
 * C9：戰役的難度曲線要落在目標區間裡。
 *
 * ── 為什麼要釘住 ───────────────────────────────────────────
 * C9 之前量到的曲線是**反的**：第 1 關（Lv1、Week 1 四十個字）輸的機率接近一半，
 * 是整個遊戲最難的一關；之後等級一路往上、擊退沒有上限，第 2 章以後第一次就輸的
 * 比例是 0%。那個狀態持續了好幾個階段都沒有人發現，因為沒有任何測試在看「一整趟」。
 *
 * 這一支就是那個測試。任何人動了速度、擊退、裝備、經驗曲線、三選一，
 * 只要讓某一段變得太簡單或太難，這裡會紅。
 *
 * 前提：家長實際觀察，「不會拼」的比例非常小（第二、三次就記住了），
 * 所以難度來自速度。這裡用 1%（見 balance-campaign.mjs）。
 *
 * 區間比附錄 G 寫的目標各放寬 7 個百分點：模擬本身有抽樣誤差，
 * 釘得太死的話，這支測試會在沒有人改任何東西的時候紅。
 */

const { runBalance } = await import('./balance-campaign.mjs');
const { levelRewards, KNOCKBACK_CAP_LEVEL } = await import('../public/js/shared/levels.js');
const { SPEED, buildCampaign } = await import('../public/js/shared/campaign.js');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const wordBank = require('../server/data/word-bank.js');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 1. 兩個旋鈕本身 ─────────────────────────────────────── */
console.log('1) 擊退加成有上限、關卡表帶著速度');
{
  const at = (lv) => levelRewards(lv).knockbackFactor;
  check(`擊退加成到 ${KNOCKBACK_CAP_LEVEL} 級就停`, at(KNOCKBACK_CAP_LEVEL) === at(999) && at(KNOCKBACK_CAP_LEVEL) > at(1),
    `Lv1 ×${at(1)}、Lv${KNOCKBACK_CAP_LEVEL} ×${at(KNOCKBACK_CAP_LEVEL).toFixed(2)}、Lv999 ×${at(999).toFixed(2)}`);

  const campaign = buildCampaign(wordBank.listGroups('g3a'));
  check('每一關都有速度', campaign.every((l) => l.speed > 0));
  const byChapter = (n) => campaign.filter((l) => l.chapter === n && l.kind === 'normal').map((l) => l.speed);
  check('每一章裡面是一關一關往上加', [1, 2, 3, 4].every((n) => {
    const s = byChapter(n);
    return s.every((v, i) => i === 0 || v >= s[i - 1]);
  }));
  check('第 1 關比基本速度慢（第一次玩戰役不該擲銅板）', campaign[0].speed < 1, String(campaign[0].speed));
  check('後面的章節比前面快', SPEED.chapters[3][0] > SPEED.chapters[1][0] && SPEED.chapters[4][1] > SPEED.chapters[1][1]);
}

/* ── 2. 一整趟 ───────────────────────────────────────────── */
console.log('\n2) 模擬一整趟戰役（三種手速）');
const table = runBalance(undefined, { runs: 4 });
const avg = (group) => {
  const rows = table.filter((r) => r.group === group);
  return rows.reduce((a, r) => a + r.firstTryFail, 0) / rows.length;
};
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const SLACK = 0.07;
const BANDS = [
  ['第 1 章', 0.10, 0.20],
  ['中王', 0.30, 0.45],
  ['第 2 章', 0.20, 0.30],
  ['第 3 章', 0.30, 0.40],
  ['第 4 章', 0.25, 0.35],
  ['大魔王', 0.40, 0.60]
];
for (const [group, lo, hi] of BANDS) {
  const a = avg(group);
  const each = table.filter((r) => r.group === group).map((r) => pct(r.firstTryFail)).join(' / ');
  check(`${group}：第一次就輸 ${pct(lo)}～${pct(hi)}`, a >= lo - SLACK && a <= hi + SLACK,
    `平均 ${pct(a)}（慢／中／快：${each}）`);
}

/*
 * 最重要的一條：不管多難，**一定要打得過**。
 * 打 8 次還過不了的話，孩子遇到的是一堵牆，不是挑戰。
 * 大魔王例外放寬一點：它是 100 字的模擬賽，本來就該是最後的考驗。
 */
const stuck = table.filter((r) => r.group !== '大魔王' && r.stuck > 0.02);
check('大魔王以外，沒有一段會卡住（打 8 次還過不了 ≤ 2%）', stuck.length === 0,
  stuck.map((r) => `${r.typist} ${r.group} ${pct(r.stuck)}`).join('、'));

/*
 * C9 的驗證點（設計文件 §10）：第 3 章在滿裝備下仍有挑戰性。
 * 這一條就是當初那個 bug 的反面——那時候這裡是 0%。
 */
const ch3 = table.filter((r) => r.group === '第 3 章');
check('⭐ 第 3 章在高等級、滿裝備下，每一種手速都還會輸', ch3.every((r) => r.firstTryFail >= 0.15),
  ch3.map((r) => `${r.typist} ${pct(r.firstTryFail)} Lv${r.lvFrom}–${r.lvTo}`).join('、'));

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
