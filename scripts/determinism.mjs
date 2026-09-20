/**
 * 確定性測試——Phase 1.1 的驗收標準之一。
 *
 * 要證明的事：
 *   1. 同一個種子 + 同一串輸入 → 指紋完全一致（跑兩次比對）
 *   2. 不同種子（random 出題）→ 指紋不同，代表種子真的有作用
 *   3. 錄影檔重播出來的結果 = 當初實際跑出來的結果
 *   4. 一場 20 個字的戰鬥可以跑到結束，不會卡住或無窮迴圈
 *
 * 這是純 Node 測試，不開瀏覽器，幾毫秒就跑完。
 * 用 `npm run test:determinism` 執行。
 */

import { createRequire } from 'node:module';
import {
  createBattle,
  applyAction,
  stepBattle,
  clearEvents,
  fingerprint,
  snapshot
} from '../public/js/game/core/battle.js';
import { createRng } from '../public/js/game/core/rng.js';
import { createRecorder, recordAction, replayLog } from '../public/js/game/core/recorder.js';
import { createPlayerModel, pollPlayer, PLAYER_PRESETS } from '../public/js/game/core/player-model.js';
import { semitoneForIndex, comboShift, freqFor } from '../public/js/game/core/scale.js';

const require = createRequire(import.meta.url);
const { wordsByPart } = require('../server/data/word-bank.js');

const WORDS = wordsByPart(1).slice(0, 20);

let failures = 0;
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * 跑完一整場，並且把模擬玩家的每個動作錄下來。
 * 這就是實際遊玩時的流程（只是輸入來自模型而不是鍵盤）。
 */
function runWithRecording({ seed, preset, difficulty = 'normal', order = 'sequential' }) {
  const state = createBattle({ words: WORDS, seed, difficulty, order });
  const log = createRecorder({
    seed,
    difficulty,
    order,
    maxHp: state.maxHp,
    wordIds: WORDS.map((w) => w.id)
  });
  // 玩家模型用另一條亂數流，才不會跟出題洗牌互相干擾
  const model = createPlayerModel(createRng(seed ^ 0x5bf03635), preset);

  const maxTicks = 120 * 60 * 20; // 20 分鐘的保險絲
  while (state.status === 'running' && state.tick < maxTicks) {
    const action = pollPlayer(model, state);
    if (action) {
      recordAction(log, state.tick, action);
      applyAction(state, action);
    }
    clearEvents(state);
    if (state.status !== 'running') break;
    stepBattle(state);
    clearEvents(state);
  }
  return { state, log };
}

console.log('確定性測試');
console.log(`單字：Part 1 前 ${WORDS.length} 個字\n`);

// ── 1. 同種子跑兩次 ────────────────────────────────────────
console.log('1) 同一個種子跑兩次');
for (const preset of Object.keys(PLAYER_PRESETS)) {
  const a = runWithRecording({ seed: 12345, preset });
  const b = runWithRecording({ seed: 12345, preset });
  check(
    `${preset}：指紋一致`,
    fingerprint(a.state) === fingerprint(b.state),
    `${fingerprint(a.state)} vs ${fingerprint(b.state)}`
  );
  check(
    `${preset}：輸入序列一致`,
    JSON.stringify(a.log.entries) === JSON.stringify(b.log.entries),
    `${a.log.entries.length} 個動作`
  );
}

// ── 2. 不同種子要真的不一樣 ────────────────────────────────
console.log('\n2) 不同種子（random 出題）應該不同');
{
  const a = runWithRecording({ seed: 1, preset: 'medium', order: 'random' });
  const b = runWithRecording({ seed: 2, preset: 'medium', order: 'random' });
  check('指紋不同', fingerprint(a.state) !== fingerprint(b.state));
  check(
    '出題順序不同',
    JSON.stringify(a.state.queue.slice(0, 20)) !== JSON.stringify(b.state.queue.slice(0, 20))
  );
}

// ── 3. 錄影檔重播 ──────────────────────────────────────────
console.log('\n3) 錄影檔重播要等於當初跑出來的結果');
for (const preset of Object.keys(PLAYER_PRESETS)) {
  for (const order of ['sequential', 'random']) {
    const { state, log } = runWithRecording({ seed: 777, preset, order });
    const replayed = replayLog(log, WORDS);
    check(
      `${preset} / ${order}`,
      fingerprint(state) === fingerprint(replayed),
      `live=${fingerprint(state)} replay=${fingerprint(replayed)}`
    );
  }
}

// ── 4. 20 個字真的跑得完 ───────────────────────────────────
console.log('\n4) 一場 20 個字跑到結束，不卡住');
for (const preset of Object.keys(PLAYER_PRESETS)) {
  const { state } = runWithRecording({ seed: 42, preset });
  const s = snapshot(state);
  check(
    `${preset}：有結束（${s.status}）`,
    state.status === 'won' || state.status === 'lost',
    `打完 ${s.stats.wordsKilled} 字、漏 ${s.stats.wordsMissed} 字、${(s.timeMs / 1000).toFixed(1)} 秒`
  );
}

// ── 5. 邊界：亂打不會崩、也不會卡死 ────────────────────────
console.log('\n5) 亂打 / 亂按也不能崩');
{
  const state = createBattle({ words: WORDS, seed: 9 });
  const rng = createRng(9);
  let crashed = null;
  try {
    for (let i = 0; i < 200000 && state.status === 'running'; i += 1) {
      const r = rng.next();
      if (r < 0.45) applyAction(state, { kind: 'letter', ch: String.fromCharCode(97 + rng.int(26)) });
      else if (r < 0.6) applyAction(state, { kind: 'backspace' });
      else if (r < 0.65) applyAction(state, { kind: 'listen', listen: 'replay' });
      else if (r < 0.67) applyAction(state, { kind: 'listen', listen: 'slow' });
      else if (r < 0.69) applyAction(state, { kind: 'listen', listen: 'sentence' });
      clearEvents(state);
      stepBattle(state);
      clearEvents(state);
    }
  } catch (err) {
    crashed = err;
  }
  check('沒有例外', crashed === null, crashed ? crashed.message : '');
  check('有走到結束', state.status !== 'running', `status=${state.status}`);
}

// ── 6. 不合法的輸入要被安靜擋掉 ────────────────────────────
console.log('\n6) 不合法的輸入不能影響狀態');
{
  const state = createBattle({ words: WORDS, seed: 5 });
  const before = fingerprint(state);
  applyAction(state, { kind: 'letter', ch: '1' });
  applyAction(state, { kind: 'letter', ch: 'ㄅ' });
  applyAction(state, { kind: 'letter', ch: 'AB' });
  applyAction(state, { kind: 'listen', listen: '不存在' });
  applyAction(state, { kind: '亂七八糟' });
  applyAction(state, null);
  check('狀態沒被動到', fingerprint(state) === before);
}

// ── 7. 參考資料：手速 × 難度的結果對照 ────────────────────
// 不列入通過與否，但可以看出時間公式合不合理：
// 慢手速在標準難度會撐不住、在輕鬆難度要能過，這正是 1.6 難度校準存在的理由。
console.log('\n7) 參考：手速 × 難度（20 字一場）');
console.log('        easy            normal          hard');
for (const preset of ['slow', 'medium', 'fast']) {
  const cells = ['easy', 'normal', 'hard'].map((difficulty) => {
    const { state } = runWithRecording({ seed: 2024, preset, difficulty });
    const tag = state.status === 'won' ? '過' : '敗';
    return `${tag} ${state.stats.wordsKilled}殺/${state.stats.wordsMissed}漏`.padEnd(16, ' ');
  });
  console.log(`${preset.padEnd(8, ' ')}${cells.join('')}`);
}

// ── 8. 打擊音階 ───────────────────────────────────────────
// 釘住一個設計主張：七個字母走完一段完整音階，第八個回到高八度。
console.log('\n8) 打擊音階');
{
  const seq = [0, 1, 2, 3, 4, 5, 6, 7, 8, 14].map(semitoneForIndex);
  check('前七個字母是大調音階', JSON.stringify(seq.slice(0, 7)) === JSON.stringify([0, 2, 4, 5, 7, 9, 11]), seq.slice(0, 7).join(','));
  check('第 8 個字母回到高八度', seq[7] === 12, String(seq[7]));
  check('第 15 個字母再高一個八度', seq[9] === 24, String(seq[9]));
  check('音階單調遞增', seq.every((v, i) => i === 0 || v > seq[i - 1]), seq.join(','));
  check(
    '頻率對得上（第 8 個字母正好是兩倍）',
    Math.abs(freqFor(seq[7]) / freqFor(seq[0]) - 2) < 1e-9,
    (freqFor(seq[7]) / freqFor(seq[0])).toFixed(6)
  );
  check(
    'Combo 門檻移調',
    comboShift(0) === 0 && comboShift(5) === 2 && comboShift(10) === 4 && comboShift(15) === 7 && comboShift(99) === 7,
    [0, 5, 10, 15, 99].map(comboShift).join(',')
  );
}

console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
