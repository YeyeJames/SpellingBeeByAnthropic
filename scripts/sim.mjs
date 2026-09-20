/**
 * 平衡模擬器。
 *
 * 用純邏輯（不開瀏覽器、不畫任何東西）跑大量場次，把平衡從「感覺一下」
 * 變成可以量測的數字。幾秒鐘就能跑完幾百場，調完數值立刻重跑，
 * 不必等小孩玩一百場才發現不平衡。
 *
 * 它憑什麼代表真實遊玩：scripts/parity-test.mjs 證明了同一份錄影檔
 * 在瀏覽器與 Node 裡跑出來的狀態指紋完全相同。模擬器用的就是同一份 core/。
 *
 * 用法：
 *   node scripts/sim.mjs                      # 每種組合 200 場
 *   node scripts/sim.mjs --runs=1000
 *   node scripts/sim.mjs --words=20 --json    # 輸出 JSON 方便比較兩次調整
 *   node scripts/sim.mjs --sweep --runs=120   # 掃過候選數值，找出落在預期區間的組合
 */

import { createRequire } from 'node:module';
import { BALANCE } from '../public/js/game/core/balance.js';
import { createBattle, applyAction, stepBattle, clearEvents, EV } from '../public/js/game/core/battle.js';
import { createRng } from '../public/js/game/core/rng.js';
import { createPlayerModel, pollPlayer, PLAYER_PRESETS } from '../public/js/game/core/player-model.js';

const require = createRequire(import.meta.url);
const { allWords } = require('../server/data/word-bank.js');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const RUNS = Number(args.runs) || 200;
const WORD_COUNT = Number(args.words) || 20;
const PRESETS = ['slow', 'medium', 'fast'];
const DIFFICULTIES = ['easy', 'normal', 'hard'];

/**
 * 1.5 的預期區間。
 *
 * Phase 1 只有一隻敵人、沒有 Combo 效果也沒有能力，所以這裡不是設計書裡
 * 那四種關卡的最終目標，而是「時間公式本身合不合理」的檢查點：
 *
 *   - 手速與難度相稱時，應該大多會過，但不能零失誤（零失誤代表沒有張力）
 *   - 手速明顯跟不上難度時，應該大多會輸（這正是 1.6 難度校準存在的理由）
 */
const EXPECTED = {
  'slow/easy': { min: 0.02, max: 0.35, note: '相稱' },
  'medium/normal': { min: 0.1, max: 0.35, note: '相稱（預設組合）' },
  'fast/hard': { min: 0.05, max: 0.35, note: '相稱' },
  'slow/hard': { min: 0.75, max: 1.0, note: '明顯不相稱，應該大多輸' },
  'fast/easy': { min: 0.0, max: 0.05, note: '游刃有餘' }
};

// 只用打得出來的字：含空白或連字號的詞條（"alarm clock"）永遠打不完，會讓模擬卡住
const WORDS = allWords()
  .filter((w) => w.typeable)
  .slice(0, WORD_COUNT);

/**
 * 跑一場，回傳結果。
 *
 * 順便數 Combo 三階各觸發幾次。做了一個孩子實際上看不到的效果等於沒做，
 * 而「會不會觸發」不是用想的，是要數的。
 */
function runBattle({ seed, preset, difficulty }) {
  const state = createBattle({ words: WORDS, seed, difficulty, order: 'sequential' });
  const model = createPlayerModel(createRng((seed ^ 0x5bf03635) >>> 0), preset);
  const bonuses = [0, 0, 0];

  const countBonuses = () => {
    for (let i = 0; i < state.evCount; i += 1) {
      const ev = state.ev[i];
      if (ev.type === EV.COMBO_BONUS) bonuses[ev.a - 1] += 1;
    }
  };

  const maxTicks = 120 * 60 * 20; // 20 分鐘的保險絲
  while (state.status === 'running' && state.tick < maxTicks) {
    const action = pollPlayer(model, state);
    if (action) applyAction(state, action);
    countBonuses();
    clearEvents(state);
    if (state.status !== 'running') break;
    stepBattle(state);
    countBonuses();
    clearEvents(state);
  }
  return { state, bonuses };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function simulate(preset, difficulty) {
  let lost = 0;
  let killed = 0;
  let missed = 0;
  let wrong = 0;
  let maxCombo = 0;
  const comboTiers = [0, 0, 0]; // 三階各觸發幾次（全部場次加總）
  const comboRuns = [0, 0, 0]; // 有幾場至少觸發過一次
  const durations = [];

  for (let i = 0; i < RUNS; i += 1) {
    const { state, bonuses } = runBattle({ seed: 10000 + i, preset, difficulty });
    if (state.status !== 'won') lost += 1;
    killed += state.stats.wordsKilled;
    missed += state.stats.wordsMissed;
    wrong += state.stats.wrongLetters;
    durations.push(state.timeMs / 1000);
    maxCombo += state.maxCombo;
    for (let t = 0; t < 3; t += 1) {
      comboTiers[t] += bonuses[t];
      if (bonuses[t] > 0) comboRuns[t] += 1;
    }
  }
  durations.sort((a, b) => a - b);

  return {
    preset,
    difficulty,
    runs: RUNS,
    failRate: lost / RUNS,
    avgKilled: killed / RUNS,
    avgMissed: missed / RUNS,
    avgWrong: wrong / RUNS,
    medianSec: percentile(durations, 50),
    p90Sec: percentile(durations, 90),
    avgMaxCombo: maxCombo / RUNS,
    // 每階「有觸發過的場次比例」——他實際上看不看得到這些效果
    comboSeen: comboRuns.map((n) => n / RUNS),
    comboPerRun: comboTiers.map((n) => n / RUNS)
  };
}

function runAllCells() {
  const out = [];
  for (const preset of PRESETS) {
    for (const difficulty of DIFFICULTIES) {
      out.push(simulate(preset, difficulty));
    }
  }
  return out;
}

/** 某一組數值有沒有讓每個檢查點都落在預期區間。 */
function scoreConfig(results) {
  let misses = 0;
  let distance = 0;
  for (const [key, exp] of Object.entries(EXPECTED)) {
    const [preset, difficulty] = key.split('/');
    const r = results.find((x) => x.preset === preset && x.difficulty === difficulty);
    if (r.failRate < exp.min) {
      misses += 1;
      distance += exp.min - r.failRate;
    } else if (r.failRate > exp.max) {
      misses += 1;
      distance += r.failRate - exp.max;
    }
  }
  return { misses, distance };
}

/*
 * 掃描模式。
 *
 * 手調數值很容易陷入「改一個好了、另一個壞了」的迴圈。既然一場模擬
 * 只要不到 0.1 毫秒，不如把候選值全部跑過一遍，讓資料告訴我哪一組可行。
 */
if (args.sweep) {
  /*
   * easy 的候選值往上加了一大截。
   *
   * 第一輪掃描裡 slow/easy 仍然有 64% 失敗率——而 easy 正是為「剛開始、
   * 打字還不熟」的孩子準備的難度，它必須讓那個孩子過得去。
   * 原因不只是每個字的時間不夠：漏掉的字會排回隊伍尾端，所以慢手速會
   * 一邊累積題目一邊消耗血量，三條命很快就沒了。
   */
  const EASY = [
    [4400, 1300],
    [4000, 1200],
    [3600, 1050],
    [3200, 900]
  ];
  const NORMAL = [
    [2400, 620],
    [2200, 580],
    [2000, 560]
  ];
  const HARD = [
    [1700, 430],
    [1500, 400],
    [1300, 380]
  ];
  const KNOCKBACK = [0.1, 0.15, 0.2];

  const candidates = [];
  for (const e of EASY) {
    for (const n of NORMAL) {
      for (const h of HARD) {
        for (const kb of KNOCKBACK) {
          BALANCE.difficulty.easy = { baseMs: e[0], perLetterMs: e[1] };
          BALANCE.difficulty.normal = { baseMs: n[0], perLetterMs: n[1] };
          BALANCE.difficulty.hard = { baseMs: h[0], perLetterMs: h[1] };
          BALANCE.knockbackRatioPerLetter = kb;
          const res = runAllCells();
          const score = scoreConfig(res);
          candidates.push({ e, n, h, kb, ...score, res });
        }
      }
    }
  }
  candidates.sort((a, b) => a.misses - b.misses || a.distance - b.distance);

  console.log(`掃描 ${candidates.length} 組數值，每組每格 ${RUNS} 場` + String.fromCharCode(10));
  console.log('名次  未達標  偏離   easy         normal       hard         擊退');
  console.log('─'.repeat(72));
  for (const c of candidates.slice(0, 8)) {
    console.log(
      `  ${String(candidates.indexOf(c) + 1).padStart(2)}    ${c.misses}     ` +
        `${(c.distance * 100).toFixed(1).padStart(5)}  ` +
        `${c.e[0]}+${c.e[1]}    ${c.n[0]}+${c.n[1]}    ${c.h[0]}+${c.h[1]}    ${c.kb}`
    );
  }
  const best = candidates[0];
  console.log(String.fromCharCode(10) + '最佳組合的各格失敗率');
  for (const r of best.res) {
    console.log(
      `  ${r.preset.padEnd(8)} ${r.difficulty.padEnd(8)} ${(r.failRate * 100).toFixed(1).padStart(5)}%`
    );
  }
  process.exit(0);
}

const results = runAllCells();

if (args.json) {
  console.log(JSON.stringify({ runs: RUNS, words: WORD_COUNT, results }, null, 2));
  process.exit(0);
}

console.log(`平衡模擬：每種組合 ${RUNS} 場，每場 ${WORD_COUNT} 個字\n`);
console.log('手速     難度      失敗率   平均殺  平均漏  平均錯  中位秒數  p90 秒數');
console.log('─'.repeat(74));
for (const r of results) {
  console.log(
    `${r.preset.padEnd(8)} ${r.difficulty.padEnd(9)} ` +
      `${(r.failRate * 100).toFixed(1).padStart(5)}% ` +
      `${r.avgKilled.toFixed(1).padStart(7)} ` +
      `${r.avgMissed.toFixed(1).padStart(7)} ` +
      `${r.avgWrong.toFixed(1).padStart(7)} ` +
      `${r.medianSec.toFixed(1).padStart(9)} ` +
      `${r.p90Sec.toFixed(1).padStart(9)}`
  );
}

console.log('\n對照預期區間');
let failures = 0;
for (const [key, exp] of Object.entries(EXPECTED)) {
  const [preset, difficulty] = key.split('/');
  const r = results.find((x) => x.preset === preset && x.difficulty === difficulty);
  const ok = r.failRate >= exp.min && r.failRate <= exp.max;
  if (!ok) failures += 1;
  console.log(
    `  [${ok ? 'PASS' : 'FAIL'}] ${key.padEnd(14)} 失敗率 ${(r.failRate * 100).toFixed(1)}%` +
      `（預期 ${(exp.min * 100).toFixed(0)}~${(exp.max * 100).toFixed(0)}%）　${exp.note}`
  );
}

/*
 * Combo 三階實際觸發的頻率。
 *
 * 這不是通過與否的判準（設計書沒有訂數字），但一定要印出來：
 * 做了一個孩子看不到的效果等於沒做，而「會不會觸發」是要數的，不是用想的。
 */
console.log('\nCombo 三階觸發率（有觸發過的場次比例）');
console.log('手速     難度      最高連擊  ⑤衝刺   ⑩蜜糖   ⑮狂蜂');
console.log('─'.repeat(58));
for (const r of results) {
  console.log(
    `${r.preset.padEnd(8)} ${r.difficulty.padEnd(9)} ` +
      `${r.avgMaxCombo.toFixed(1).padStart(7)} ` +
      r.comboSeen.map((v) => `${(v * 100).toFixed(0).padStart(6)}%`).join(' ')
  );
}

console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項落在預期之外`}`);
process.exit(failures === 0 ? 0 : 1);
