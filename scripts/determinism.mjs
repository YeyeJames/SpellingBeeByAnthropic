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
import { computeIntervals, suggestDifficulty } from '../public/js/game/core/calibration.js';

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

// ── 6.5 含空白的詞條 ──────────────────────────────────────
// 課本有 "alarm clock"、"high-pitched" 這種詞條。遊戲只收 a~z 的時候，
// 它們只能被濾掉，於是練習頁與遊戲的字數對不起來，那幾個字也永遠練不到。
console.log('\n6.5) 含空白／連字號的詞條');
{
  const PHRASE = [{ id: 'x1', english: 'alarm clock' }];

  // 乖乖按空白
  {
    const state = createBattle({ words: PHRASE, seed: 1 });
    for (const ch of 'alarm clock') applyAction(state, { kind: 'letter', ch });
    check('按了空白：打得完', state.status === 'won', state.status);
    check('按了空白：不算打錯', state.stats.wrongLetters === 0, String(state.stats.wrongLetters));
  }

  /*
   * 不按空白也要過。
   *
   * 正常遊玩看不到單字（這是聽寫遊戲），他聽到 "alarm clock" 很可能
   * 直接打 alarmclock——然後卡在第六個字元，而畫面不會告訴他少了空白。
   * 那是最糟的一種卡關：看不出原因。
   */
  {
    const state = createBattle({ words: PHRASE, seed: 1 });
    for (const ch of 'alarmclock') applyAction(state, { kind: 'letter', ch });
    check('沒按空白：一樣打得完', state.status === 'won', state.status);
    check('沒按空白：不算打錯', state.stats.wrongLetters === 0, String(state.stats.wrongLetters));
  }

  // 連字號同理
  {
    const state = createBattle({ words: [{ id: 'x2', english: 'high-pitched' }], seed: 1 });
    for (const ch of 'highpitched') applyAction(state, { kind: 'letter', ch });
    check('連字號也可以跳過', state.status === 'won', state.status);
  }

  /*
   * 放寬的只有分隔符，拼字本身一個字母都沒放水。
   * 在空白的位置打一個不對的字母仍然算打錯，接著打對的還是照樣通過。
   */
  {
    const state = createBattle({ words: PHRASE, seed: 1 });
    for (const ch of 'alarm') applyAction(state, { kind: 'letter', ch });
    applyAction(state, { kind: 'letter', ch: 'k' }); // 這裡該是空白或 c
    check('在空白的位置打錯字母算打錯', state.stats.wrongLetters === 1, String(state.stats.wrongLetters));
    check('打錯不會倒退已經打對的', state.typed === 5, String(state.typed));
    for (const ch of 'clock') applyAction(state, { kind: 'letter', ch });
    check('打錯之後接著打對仍然過得了', state.status === 'won', state.status);
  }

  // 空白鍵在不該出現的地方仍然是打錯
  {
    const state = createBattle({ words: [{ id: 'x3', english: 'cat' }], seed: 1 });
    applyAction(state, { kind: 'letter', ch: 'c' });
    applyAction(state, { kind: 'letter', ch: ' ' });
    check('一般單字裡按空白算打錯', state.stats.wrongLetters === 1, String(state.stats.wrongLetters));
    check('打錯不會把已經打對的清掉', state.typed === 1, String(state.typed));
  }
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

// ── 9. 難度校準的計算 ─────────────────────────────────────
console.log('\n9) 難度校準');
{
  // 用固定間隔造三個字的按鍵時間戳
  const make = (perWord, gap) =>
    perWord.map((n) => {
      const t = [];
      for (let i = 0; i < n; i += 1) t.push(1000 + i * gap);
      return t;
    });

  const slow = computeIntervals(make([3, 3, 4], 900));
  const mid = computeIntervals(make([3, 3, 4], 500));
  const fast = computeIntervals(make([3, 3, 4], 250));

  check('每個字的第一次按鍵不算（含讀字與反應）', slow.length === 2 + 2 + 3, `${slow.length} 筆`);
  check('慢手速 → 輕鬆', suggestDifficulty(slow).difficulty === 'easy', suggestDifficulty(slow).difficulty);
  check('中手速 → 標準', suggestDifficulty(mid).difficulty === 'normal', suggestDifficulty(mid).difficulty);
  check('快手速 → 挑戰', suggestDifficulty(fast).difficulty === 'hard', suggestDifficulty(fast).difficulty);

  // 中間卡住一次不該把結論帶走——這正是用中位數而不是平均的理由
  const stalled = computeIntervals([[0, 500, 1000, 4500, 5000, 5500, 6000]]);
  const s1 = suggestDifficulty(stalled);
  const meanMs = stalled.reduce((a, b) => a + b, 0) / stalled.length;
  check(
    '中間發呆一次仍判為標準（中位數擋掉極端值）',
    s1.difficulty === 'normal',
    `中位數 ${s1.medianMs}ms、平均 ${Math.round(meanMs)}ms → ${s1.difficulty}`
  );

  // 樣本太少就不要亂猜
  const few = suggestDifficulty(computeIntervals([[0, 200]]));
  check('樣本不足時不下結論', few.confident === false && few.difficulty === 'normal', JSON.stringify(few));

  // 不合理的值要被濾掉
  const noisy = computeIntervals([[0, 5, 10, 15, 20]]); // 全部 5ms，不是人類手速
  check('濾掉不合理的間隔', noisy.length === 0, `${noisy.length} 筆`);
}

console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
