/**
 * C6：特殊敵人（護甲蟲、衝刺蟲、靜音蟲）。
 *
 * 這是第 2 章之後「難度真的變難」的唯一來源——前面幾段（等級、裝備）
 * 都是在讓玩家變強。
 *
 * ── 最重要的一條，跟 C5 一樣 ──────────────────────────────
 *   **§1：力量買的是容錯，不是答案。** 反過來也成立：
 *   **難度不可以靠「多打幾個字母」來製造。**
 *   敵人的血量永遠等於單字的字母數，三種特性一個都不准改變它。
 *
 * 其他要證明的事：
 *   1. 指派是確定性的（同一場重播配到同一批敵人）
 *   2. 護甲：前兩個字母不造成擊退，但**照樣算對、照樣往前推進**
 *   3. 衝刺：每兩秒自己往前衝，而且吃得到蜂群衝刺的減速
 *   4. 靜音：重聽沒有用，**而且不收代價**（收了代價卻沒唸是懲罰他按按鈕）
 *   5. 第一次遇到會介紹一次，同一場不會重複介紹
 *   6. 章節逐步加上去，第 1 章完全沒有
 *
 * 用法：node scripts/enemy-trait-test.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const { createBattle, applyAction, stepBattle, clearEvents, fingerprint, EV, TRAIT_BY_CODE } =
  await import('../public/js/game/core/battle.js');
const { TRAITS, TRAIT_INFO, traitFor, traitPoolForChapter, ARMOR_LETTERS, DASH_EVERY_MS } =
  await import('../public/js/game/core/enemy-trait.js');
const { createRecorder, recordAction, replayLog } = await import(
  '../public/js/game/core/recorder.js'
);
const { buildCampaign } = await import('../public/js/shared/campaign.js');
const wordBank = require('../server/data/word-bank.js');

const WORDS = [
  { id: 'a', english: 'elephant' },
  { id: 'b', english: 'cat' },
  { id: 'c', english: 'computer' },
  { id: 'd', english: 'dog' },
  { id: 'e', english: 'banana' },
  { id: 'f', english: 'tree' }
];

/** 打完整場（全對）。 */
function playAll(opts = {}) {
  const st = createBattle({ words: WORDS, seed: 5, difficulty: 'easy', order: 'sequential', ...opts });
  let guard = 0;
  while (st.status === 'running' && guard++ < 200000) {
    const ch = st.target[st.typed];
    if (ch) applyAction(st, { kind: 'letter', ch });
    else stepBattle(st);
    clearEvents(st);
  }
  return st;
}

/* ── 1. ⭐ 難度不可以靠多打字母做出來 ────────────────────── */
console.log('1) ⭐ 沒有任何一種特性會改變要打的字母數');
{
  const total = WORDS.reduce((a, w) => a + w.english.length, 0);
  const bare = playAll();
  check('全裸打完，字母數等於所有字的長度總和', bare.stats.correctLetters === total,
    `${bare.stats.correctLetters} vs ${total}`);

  const offenders = [];
  for (const pool of [[TRAITS.ARMORED], [TRAITS.DASHER], [TRAITS.SILENT],
    [TRAITS.ARMORED, TRAITS.DASHER, TRAITS.SILENT]]) {
    const st = playAll({ enemyTraits: pool, difficulty: 'easy' });
    if (st.stats.correctLetters !== total) offenders.push(`${pool.join('+')}:${st.stats.correctLetters}`);
  }
  check('四種組合打完，字母數都一模一樣', offenders.length === 0, offenders.join(', '));
  check('敵人數量也沒變',
    playAll({ enemyTraits: [TRAITS.ARMORED] }).stats.wordsKilled === bare.stats.wordsKilled);
}

/* ── 2. 指派是確定性的 ───────────────────────────────────── */
console.log('2) 同一場永遠配到同一批敵人');
{
  const pool = [TRAITS.ARMORED, TRAITS.DASHER, TRAITS.SILENT];
  const a = [];
  const b = [];
  for (let i = 0; i < 30; i += 1) {
    a.push(traitFor(pool, i, 12345));
    b.push(traitFor(pool, i, 12345));
  }
  check('同樣的輸入永遠同樣的輸出', a.join() === b.join());
  const other = [];
  for (let i = 0; i < 30; i += 1) other.push(traitFor(pool, i, 99999));
  check('換一個種子就不一樣（不然每場都背得起來）', a.join() !== other.join());
  check('沒有特性池時全部都是普通的',
    [0, 1, 2, 3, 4].every((i) => traitFor([], i, 1) === TRAITS.NONE));

  /*
   * 不可以變成固定的節奏（第 3、6、9 隻）——那樣他很快就會背起來，
   * 而背起來之後就不再是壓力了。
   */
  const positions = [];
  for (let i = 0; i < 60; i += 1) if (traitFor(pool, i, 777) !== TRAITS.NONE) positions.push(i);
  const gaps = positions.slice(1).map((p, i) => p - positions[i]);
  check('出現的間隔不是固定的', new Set(gaps).size > 1, `間隔有 ${new Set(gaps).size} 種`);
}

/* ── 3. 護甲 ─────────────────────────────────────────────── */
console.log('3) 護甲蟲：前兩個字母打不動牠');
{
  const st = createBattle({
    words: [{ id: 'x', english: 'elephant' }],
    seed: 5, difficulty: 'normal', order: 'sequential', enemyTraits: [TRAITS.ARMORED]
  });
  check('第一隻就是護甲蟲（種子挑過）', st.trait === TRAITS.ARMORED, st.trait);
  check(`外殼有 ${ARMOR_LETTERS} 層`, st.armorLeft === ARMOR_LETTERS, String(st.armorLeft));

  // 先讓牠走一段，才看得出擊退有沒有生效
  for (let i = 0; i < 240; i += 1) { stepBattle(st); clearEvents(st); }
  const before = st.progress;
  applyAction(st, { kind: 'letter', ch: 'e' });
  clearEvents(st);
  check('第 1 個字母：算對了', st.typed === 1, String(st.typed));
  check('但沒有被推回去（外殼擋住）', st.progress >= before, `${before} → ${st.progress}`);
  check('外殼少一層', st.armorLeft === ARMOR_LETTERS - 1, String(st.armorLeft));

  applyAction(st, { kind: 'letter', ch: 'l' });
  let broke = false;
  for (let i = 0; i < st.evCount; i += 1) if (st.ev[i].type === EV.ARMOR_BROKE) broke = true;
  clearEvents(st);
  check('第 2 個字母把外殼打碎了', broke && st.armorLeft === 0, `剩 ${st.armorLeft}`);

  const beforeThird = st.progress;
  applyAction(st, { kind: 'letter', ch: 'e' });
  clearEvents(st);
  check('第 3 個字母開始正常擊退', st.progress < beforeThird,
    `${beforeThird.toFixed(5)} → ${st.progress.toFixed(5)}`);

  /*
   * 這一條是 §1 的具體檢查：外殼擋的是**擊退**，不是進度。
   * 如果擋的是進度，那就等於「這個字要多打兩下」，那就違反鐵律了。
   */
  check('外殼期間打的字母照樣往前推進（擋的是擊退不是進度）', st.typed === 3, String(st.typed));
}

/* ── 4. 衝刺 ─────────────────────────────────────────────── */
console.log('4) 衝刺蟲：每兩秒自己往前衝');
{
  function findDasher() {
    for (let seed = 1; seed < 300; seed += 1) {
      const st = createBattle({
        words: [{ id: 'x', english: 'elephant' }],
        seed, difficulty: 'normal', order: 'sequential', enemyTraits: [TRAITS.DASHER]
      });
      if (st.trait === TRAITS.DASHER) return st;
    }
    return null;
  }
  const st = findDasher();
  check('找得到一隻衝刺蟲', !!st);

  let dashes = 0;
  let ms = 0;
  while (ms < DASH_EVERY_MS * 2.5 && st.status === 'running') {
    stepBattle(st);
    for (let i = 0; i < st.evCount; i += 1) if (st.ev[i].type === EV.ENEMY_DASH) dashes += 1;
    clearEvents(st);
    ms += 1000 / 120;
  }
  check('兩個半週期內衝了 2 次', dashes === 2, `${dashes} 次`);

  // 普通敵人不會自己衝
  const plain = createBattle({
    words: [{ id: 'x', english: 'elephant' }], seed: 5, difficulty: 'normal', order: 'sequential'
  });
  let plainDashes = 0;
  for (let i = 0; i < 1000; i += 1) {
    stepBattle(plain);
    for (let j = 0; j < plain.evCount; j += 1) if (plain.ev[j].type === EV.ENEMY_DASH) plainDashes += 1;
    clearEvents(plain);
  }
  check('普通敵人不會自己衝', plainDashes === 0, String(plainDashes));
}

/* ── 5. 靜音 ─────────────────────────────────────────────── */
console.log('5) 靜音蟲：重聽沒有用，而且不收代價');
{
  function findSilent() {
    for (let seed = 1; seed < 300; seed += 1) {
      const st = createBattle({
        words: [{ id: 'x', english: 'elephant' }],
        seed, difficulty: 'normal', order: 'sequential', enemyTraits: [TRAITS.SILENT]
      });
      if (st.trait === TRAITS.SILENT) return st;
    }
    return null;
  }
  const st = findSilent();
  check('找得到一隻靜音蟲', !!st);
  for (let i = 0; i < 120; i += 1) { stepBattle(st); clearEvents(st); }

  const before = st.progress;
  const listensBefore = st.stats.listens;
  applyAction(st, { kind: 'listen', listen: 'replay' });
  clearEvents(st);
  /*
   * 不收代價是刻意的。收了代價卻沒唸，他學到的是「不要亂按」，
   * 而不是「這隻不能重聽」——而畫面已經把按鈕變灰並寫了原因。
   */
  check('重聽不會讓牠前進', st.progress === before, `${before} vs ${st.progress}`);
  check('也不計入重聽次數', st.stats.listens === listensBefore, String(st.stats.listens));

  // 普通敵人的重聽照舊要付代價
  const plain = createBattle({
    words: [{ id: 'x', english: 'elephant' }], seed: 5, difficulty: 'normal', order: 'sequential'
  });
  for (let i = 0; i < 120; i += 1) { stepBattle(plain); clearEvents(plain); }
  const pb = plain.progress;
  applyAction(plain, { kind: 'listen', listen: 'replay' });
  clearEvents(plain);
  check('普通敵人的重聽照樣付代價', plain.progress > pb, `${pb.toFixed(5)} → ${plain.progress.toFixed(5)}`);
}

/* ── 6. 教學停格 ─────────────────────────────────────────── */
console.log('6) 第一次遇到會介紹一次');
{
  const st = createBattle({
    words: Array.from({ length: 30 }, (_, i) => ({ id: 'w' + i, english: 'cat' })),
    seed: 42, difficulty: 'easy', order: 'sequential',
    enemyTraits: [TRAITS.ARMORED, TRAITS.DASHER, TRAITS.SILENT]
  });
  const intros = [];
  let guard = 0;
  /*
   * 順序很重要：先動作、**再讀事件**、最後才清。
   *
   * 第一版寫成「先讀、再動作、再清」，結果動作產生的事件在下一圈之前
   * 就被清掉了，30 隻只收到 1 筆介紹（實際上是 3 筆）。
   * 這是讀環狀事件緩衝區最容易犯的錯，battle-scene.js 的 consumeEvents
   * 也是先跑動作再讀。
   */
  while (st.status === 'running' && guard++ < 200000) {
    const ch = st.target[st.typed];
    if (ch) applyAction(st, { kind: 'letter', ch });
    else stepBattle(st);
    for (let i = 0; i < st.evCount; i += 1) {
      if (st.ev[i].type === EV.TRAIT_INTRO) intros.push(TRAIT_BY_CODE[st.ev[i].a]);
    }
    clearEvents(st);
  }
  check('有介紹過（30 隻裡一定遇得到）', intros.length > 0, intros.join(', '));
  check('同一種只介紹一次', new Set(intros).size === intros.length, intros.join(', '));
  check('介紹過的都記下來了',
    st.traitsSeen.length === intros.length, `${st.traitsSeen.join(',')} vs ${intros.join(',')}`);

  // 每一種都要有名字與一句話規則，不然停格會是一片空白
  for (const t of [TRAITS.ARMORED, TRAITS.DASHER, TRAITS.SILENT]) {
    const info = TRAIT_INFO[t];
    check(`${t} 有名字與規則`, !!(info && info.label && info.rule), JSON.stringify(info?.rule));
  }
}

/* ── 7. 章節逐步加上去 ───────────────────────────────────── */
console.log('7) 章節逐步加上去');
{
  check('第 1 章完全沒有特殊敵人', traitPoolForChapter(1).length === 0);
  check('第 2 章開始有護甲', JSON.stringify(traitPoolForChapter(2)) === '["armored"]');
  check('第 3 章多了衝刺', traitPoolForChapter(3).length === 2);
  check('第 4 章三種都有', traitPoolForChapter(4).length === 3);

  const campaign = buildCampaign(wordBank.listGroups('g3a'));
  const ch1 = campaign.filter((l) => l.chapter === 1);
  check('關卡表裡第 1 章每一關都沒有特殊敵人',
    ch1.every((l) => (l.enemyTraits || []).length === 0), String(ch1.length));
  const boss = campaign.find((l) => l.level === 100);
  check('大魔王三種都有', (boss.enemyTraits || []).length === 3, JSON.stringify(boss.enemyTraits));
}

/* ── 8. 重播 ─────────────────────────────────────────────── */
console.log('8) 錄影檔重播');
{
  const traits = [TRAITS.ARMORED, TRAITS.DASHER, TRAITS.SILENT];
  const st = createBattle({ words: WORDS, seed: 11, difficulty: 'normal', order: 'sequential', enemyTraits: traits });
  const log = createRecorder({
    seed: 11, difficulty: 'normal', order: 'sequential', maxHp: 3,
    level: 1, xp: 0, relearnIds: [], equipped: null, enemyTraits: traits,
    wordIds: WORDS.map((w) => w.id)
  });
  let guard = 0;
  while (st.status === 'running' && guard++ < 200000) {
    const ch = st.target[st.typed];
    if (ch) { recordAction(log, st.tick, { kind: 'letter', ch }); applyAction(st, { kind: 'letter', ch }); }
    else stepBattle(st);
    clearEvents(st);
  }
  const replayed = replayLog(log, WORDS);
  check('指紋一模一樣', fingerprint(replayed) === fingerprint(st),
    `${fingerprint(st)} vs ${fingerprint(replayed)}`);
  check('錄影檔有存特性池', (log.setup.enemyTraits || []).length === 3,
    JSON.stringify(log.setup.enemyTraits));

  /*
   * 舊錄影檔沒有這個欄位 → 全部是普通敵人，也就是 C6 之前的行為。
   * 不然他之前存下來的「剛剛怪怪的」那些檔案會全部重播不出來。
   */
  const old = { ...log, setup: { ...log.setup } };
  delete old.setup.enemyTraits;
  const asOld = replayLog(old, WORDS);
  check('舊錄影檔退回全普通敵人', asOld.traitPool.length === 0 && asOld.trait === TRAITS.NONE,
    `${asOld.trait}`);
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
