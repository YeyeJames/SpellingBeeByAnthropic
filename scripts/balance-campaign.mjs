/**
 * 戰役平衡模擬器（C9）：模擬一個孩子從第 1 關打到第 100 關。
 *
 * ── 跟 sim.mjs 的差別 ──────────────────────────────────────
 * sim.mjs 一次只打一場，固定 1 級、沒有裝備、沒有戰役——它回答的是
 * 「三段難度標籤對不對」。這一支回答的是 C9 真正的問題：
 * **他一路變強（等級、裝備、三選一）之後，後面的關卡還有沒有挑戰？**
 *
 * 所以這裡模擬的是一整趟旅程：
 *   - 真的關卡表（shared/campaign.js）、真的單字、真的特殊敵人
 *   - 打輸了就重打同一關（最多 8 次）
 *   - 經驗照核心算、蜂蜜照這一場的分數進帳
 *   - 裝備：一解鎖、一買得起就買（武器 → 護甲 → 飾品）
 *   - 三選一：隨便選（設計文件擔心的「他只會亂選」，也是最保守的假設）
 *
 * ── 玩家模型的重要前提（2026-09 家長實際觀察）──────────────
 * 兩兄弟「不會拼」的比例非常小——只有第一次看到那個字時可能錯，
 * 第二、三次就完全記住了。所以這裡預設 unknownRate = 0.01。
 * **失敗幾乎完全來自速度**，這也是家長要的方向：
 *
 * ⚠️ 解鎖門檻後來從「練兩次」改成「練一次」（家長：沒記住的字在遊戲裡
 * 被扣分很快就記得了）。所以每一組的**第一場**不會的字可能多一點——
 * 那個情境用 --unknown=0.03 跑，結果記在設計文件附錄 G。
 * 加快速度、增加「來不及」、順便練英打。
 *
 * 用法：
 *   node scripts/balance-campaign.mjs                 # 目前的平衡
 *   node scripts/balance-campaign.mjs --runs=8        # 每種手速跑幾趟
 *   node scripts/balance-campaign.mjs --unknown=0.03  # 換一個「不會拼」比例
 *   node scripts/balance-campaign.mjs --json
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const { createBattle, applyAction, stepBattle, clearEvents } = await import('../public/js/game/core/battle.js');
const { createPlayerModel, pollPlayer, PLAYER_PRESETS } = await import('../public/js/game/core/player-model.js');
const { createRng } = await import('../public/js/game/core/rng.js');
const { buildCampaign, pickLevelWordIds } = await import('../public/js/shared/campaign.js');
const { levelFromXp } = await import('../public/js/shared/levels.js');
const { GEAR, gearAvailability } = await import('../public/js/shared/equipment.js');
const wordBank = require('../server/data/word-bank.js');

/*
 * 手速對應到校準會建議的難度（balance.js 的 calibration 門檻：
 * 慢於 700ms → 輕鬆、快於 350ms → 挑戰）。孩子第一次玩會先量手速，
 * 所以慢手速的孩子打的是輕鬆、快手速的是挑戰——模擬也要照這個配對，
 * 不然會量到「快手速打輕鬆」這種不會發生的組合。
 */
const TYPISTS = [
  { preset: 'slow', difficulty: 'easy' },
  { preset: 'medium', difficulty: 'normal' },
  { preset: 'fast', difficulty: 'hard' }
];

const RUNS = Number(args.runs) || 6;
const UNKNOWN = args.unknown !== undefined ? Number(args.unknown) : 0.01;
const MAX_TRIES = 8;

const campaign = buildCampaign(wordBank.listGroups('g3a'));

/* 跟伺服器出題同一份規則（shared/campaign.js）：混合關每一組平均抽。亂數用這一場的種子，模擬才重現得出來 */
function wordsForLevel(level, seed) {
  const rng = createRng((seed ^ 0x2f6b1a3d) >>> 0);
  return pickLevelWordIds(
    level,
    (g) => wordBank.wordsByGroup(g).map((w) => w.id),
    () => rng.next(),
    (id) => wordBank.getWordById(id)?.english || id
  ).map((id) => wordBank.getWordById(id));
}

/** 一解鎖、一買得起就買：武器 → 護甲 → 飾品。每一欄只換更高階的。 */
function shop(kid) {
  const level = levelFromXp(kid.xp).level;
  for (const slot of ['weapon', 'armor', 'trinket']) {
    const options = GEAR.filter((g) => g.slot === slot && g.tier > 1)
      .filter((g) => gearAvailability(g, { level, honey: kid.honey, owned: kid.owned }).canBuy)
      .sort((a, b) => b.tier - a.tier);
    const best = options[0];
    const current = GEAR.find((g) => g.key === kid.equipped[slot]);
    if (best && (!current || best.tier > current.tier)) {
      kid.honey -= best.cost;
      kid.owned.push(best.key);
      kid.equipped[slot] = best.key;
    }
  }
}

function playOnce(kid, level, seed, typist, speedOf) {
  const words = wordsForLevel(level, seed);
  const st = createBattle({
    words,
    seed,
    difficulty: typist.difficulty,
    order: level.order,
    level: levelFromXp(kid.xp).level,
    xp: kid.xp,
    equipped: kid.equipped,
    enemyTraits: level.enemyTraits,
    perks: true,
    speed: speedOf(level)
  });
  const cfg = { ...PLAYER_PRESETS[typist.preset], unknownRate: UNKNOWN };
  const model = createPlayerModel(createRng((seed ^ 0x5bf03635) >>> 0), cfg);
  const pickRng = createRng((seed ^ 0x1234567) >>> 0);
  const maxTicks = 120 * 60 * 25;
  while (st.status === 'running' && st.tick < maxTicks) {
    if (st.perkOffer) {
      applyAction(st, { kind: 'perk', pick: pickRng.int(st.perkOffer.length) });
      clearEvents(st);
      continue;
    }
    const action = pollPlayer(model, st);
    if (action) applyAction(st, action);
    clearEvents(st);
    if (st.status !== 'running') break;
    stepBattle(st);
    clearEvents(st);
  }
  kid.xp += st.xp;
  kid.honey += st.honey;
  return st.status === 'won';
}

/**
 * 一趟旅程：第 1 關打到第 100 關。
 * 回傳每一關「第一次就過」與「總共打了幾次」，以及進每一章時的等級與裝備。
 */
function journey(typist, run, speedOf) {
  const kid = { xp: 0, honey: 0, owned: [], equipped: { weapon: 'weapon_wood', armor: 'armor_thin', trinket: null } };
  const out = [];
  for (const level of campaign) {
    shop(kid);
    const lvBefore = levelFromXp(kid.xp).level;
    const gearBefore = { ...kid.equipped };
    let tries = 0;
    let won = false;
    while (!won && tries < MAX_TRIES) {
      tries += 1;
      won = playOnce(kid, level, (run * 100003 + level.level * 7919 + tries * 104729) >>> 0, typist, speedOf);
    }
    out.push({ level: level.level, chapter: level.chapter, kind: level.kind, firstTry: tries === 1 && won, tries,
      stuck: !won, lv: lvBefore, gear: gearBefore });
  }
  return out;
}

function groupOf(r) {
  if (r.level === 100) return '大魔王';
  if (r.kind === 'midboss') return '中王';
  return `第 ${r.chapter} 章`;
}

export function runBalance(speedOf = (level) => level.speed || 1, { runs = RUNS, typists = TYPISTS } = {}) {
  const table = [];
  for (const typist of typists) {
    const all = [];
    for (let run = 0; run < runs; run += 1) all.push(...journey(typist, run, speedOf));
    const groups = {};
    for (const r of all) (groups[groupOf(r)] = groups[groupOf(r)] || []).push(r);
    for (const [name, rows] of Object.entries(groups)) {
      const fail = rows.filter((r) => !r.firstTry).length / rows.length;
      const tries = rows.reduce((a, r) => a + r.tries, 0) / rows.length;
      const stuck = rows.filter((r) => r.stuck).length / rows.length;
      const lvs = rows.map((r) => r.lv);
      table.push({
        typist: typist.preset,
        difficulty: typist.difficulty,
        group: name,
        firstTryFail: fail,
        avgTries: tries,
        stuck,
        lvFrom: Math.min(...lvs),
        lvTo: Math.max(...lvs)
      });
    }
  }
  return table;
}

function print(table) {
  const order = ['第 1 章', '中王', '第 2 章', '第 3 章', '第 4 章', '大魔王'];
  console.log(`\n「不會拼」比例 ${(UNKNOWN * 100).toFixed(0)}%，每種手速 ${RUNS} 趟，三選一隨便選\n`);
  console.log('手速     難度      段落        第一次就輸  平均打幾次  打 8 次還過不了  等級');
  console.log('─'.repeat(78));
  for (const t of TYPISTS) {
    for (const g of order) {
      const r = table.find((x) => x.typist === t.preset && x.group === g);
      if (!r) continue;
      console.log(
        `${r.typist.padEnd(8)} ${r.difficulty.padEnd(8)} ${r.group.padEnd(9)} ` +
        `${(r.firstTryFail * 100).toFixed(0).padStart(6)}%  ${r.avgTries.toFixed(2).padStart(9)}  ` +
        `${(r.stuck * 100).toFixed(0).padStart(12)}%     Lv${r.lvFrom}–${r.lvTo}`
      );
    }
    console.log('');
  }
}

// 直接執行時印表；被 import 時（測試）只給函式
if (import.meta.url === `file://${process.argv[1]}`) {
  const table = runBalance();
  if (args.json) console.log(JSON.stringify(table, null, 2));
  else print(table);
}
