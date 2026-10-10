/**
 * 王關（C7）的規則：中王 ×3、大魔王（game/core/boss.js）。
 *
 * 要證明的事：
 *   0. 沒有王的一場跟 C7 之前一模一樣（指紋不變）——舊錄影檔、既有測試都靠這一條
 *   1. 關卡表：第 25 / 50 / 75 / 100 關各有一隻王，其他關沒有
 *   2. §1 的鐵律：王不改變要打的字母數——打倒王＝把這一關每個字都打完
 *   3. 王的血＝字數，打掉一個字掉一格；登場時第一隻蟲站著等
 *   4. 階段：在 1/3、2/3（大魔王 1/4、2/4、3/4）換，派出新的小兵、速度變快、停一下
 *   5. 金色親衛兵：每 6 隻一隻、不帶特性；零失誤打掉 → +1 血（滿了 → 蜂蜜 ×3）；打錯過就沒有
 *   6. 大魔王：唸題時蟲等著、他一打字就不等；重聽代價 ×2
 *   7. 錄影檔重播：同一場打出同一個結果（王的代號有進錄影檔）
 *
 * 用法：node scripts/boss-test.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBattle, applyAction, stepBattle, clearEvents, fingerprint, EV } = await import('../public/js/game/core/battle.js');
const { BOSS, BOSSES, BOSS_BY_LEVEL, phaseFor, isGuardAt } = await import('../public/js/game/core/boss.js');
const { createRecorder, recordAction, replayFingerprint } = await import('../public/js/game/core/recorder.js');
const { BALANCE } = await import('../public/js/game/core/balance.js');
const { buildCampaign } = await import('../public/js/shared/campaign.js');
const wordBank = require('../server/data/word-bank.js');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const W = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, english: ['cat', 'dog', 'bird', 'fish', 'lion', 'bear', 'frog'][i % 7] + 'abcdefghijklmnopqrstuvwxyz'[i % 26] }));

/** 收這一步的事件（畫面端讀完就清掉，這裡照做） */
function drain(st, into) {
  for (let i = 0; i < st.evCount; i += 1) into.push({ ...st.ev[i] });
  clearEvents(st);
}

/** 打完目前這個字（可以先故意打錯一個字母） */
function typeWord(st, events, { wrongFirst = false } = {}) {
  if (wrongFirst) {
    const bad = st.target[st.typed] === 'q' ? 'z' : 'q';
    applyAction(st, { kind: 'letter', ch: bad });
    drain(st, events);
  }
  const wi = st.wordIndex;
  while (st.status === 'running' && st.wordIndex === wi && st.typed < st.target.length) {
    applyAction(st, { kind: 'letter', ch: st.target[st.typed] });
    drain(st, events);
  }
}

/* ── 0. 沒有王 = C7 之前 ─────────────────────────────────── */
console.log('0) 沒有王的一場不變');
{
  const a = createBattle({ words: W(10), seed: 7, difficulty: 'normal' });
  const b = createBattle({ words: W(10), seed: 7, difficulty: 'normal', boss: null });
  const ev = [];
  for (const st of [a, b]) { for (let i = 0; i < 300; i += 1) stepBattle(st); typeWord(st, ev); }
  check('不給王跟 boss: null 指紋一樣', fingerprint(a) === fingerprint(b));
  check('沒有王就沒有王的事件', !ev.some((e) => [EV.BOSS_INTRO, EV.BOSS_HIT, EV.BOSS_PHASE, EV.GUARD_REWARD].includes(e.type)));
  check('沒有王就沒有金色親衛兵', a.guard === false && b.guard === false);
}

/* ── 1. 關卡表 ───────────────────────────────────────────── */
console.log('1) 關卡表');
for (const bank of ['g3a', 'allen']) {
  const c = buildCampaign(wordBank.listGroups(bank));
  const withBoss = c.filter((l) => l.boss).map((l) => `${l.level}:${l.boss}`);
  check(`${bank}：王在 25 / 50 / 75 / 100`, withBoss.join(',') === '25:beetle,50:wasp,75:spider,100:king', withBoss.join(','));
}
check('每隻王的第一階從 0 開始、門檻往上遞增', Object.values(BOSSES).every((b) => b.phases[0].at === 0 && b.phases.every((p, i) => i === 0 || p.at > b.phases[i - 1].at)));
check('BOSS_BY_LEVEL 指到的王都存在', Object.values(BOSS_BY_LEVEL).every((k) => BOSSES[k]));

/* ── 2～5. 一隻中王從頭打到尾 ─────────────────────────────── */
console.log('2) 鐵律：字母數不變／3) 王的血／4) 階段／5) 金色親衛兵');
{
  const words = W(20);
  const st = createBattle({ words, seed: 3, difficulty: 'normal', boss: 'beetle', order: 'sequential' });
  const ev = [];
  drain(st, ev);
  check('登場有 BOSS_INTRO', ev.some((e) => e.type === EV.BOSS_INTRO));
  check('王的血 = 字數', st.bossTotal === 20);
  const p0 = st.progress;
  for (let i = 0; i < Math.floor(BOSS.introHoldMs / BALANCE.logicStepMs) - 2; i += 1) stepBattle(st);
  check(`登場時第一隻蟲站著等（${BOSS.introHoldMs}ms）`, st.progress === p0, String(st.progress));
  for (let i = 0; i < 20; i += 1) stepBattle(st);
  check('等完就開始走', st.progress > p0);

  const phases = [];
  const guards = [];
  let wrongOnGuard = 0;
  let k = 0;
  while (st.status === 'running' && k < 200) {
    k += 1;
    const pos = st.queueHead - 1;
    if (st.guard) guards.push({ pos, trait: st.trait });
    // 第一隻親衛兵故意打錯（不該有獎勵），第二隻先讓蜂巢少一顆血再零失誤打掉（該 +1 血）
    const wrong = st.guard && guards.length === 1;
    if (wrong) wrongOnGuard += 1;
    if (st.guard && guards.length === 2) st.hp = st.maxHp - 1;
    const before = { hp: st.hp, pool: st.traitPool.join(','), speed: st.bossSpeed };
    const n = ev.length;
    typeWord(st, ev, { wrongFirst: wrong });
    const mine = ev.slice(n);
    const ph = mine.find((e) => e.type === EV.BOSS_PHASE);
    if (ph) phases.push({ phase: ph.a, kills: st.stats.wordsKilled, pool: st.traitPool.join(','), speed: st.bossSpeed, hold: st.holdMs, before });
    const gr = mine.find((e) => e.type === EV.GUARD_REWARD);
    if (st.guard === false && gr) guards[guards.length - 1].reward = gr;
    if (gr) guards[guards.length - 1].reward = { ...gr, hpBefore: before.hp, hpAfter: st.hp };
    if (st.status === 'running') stepBattle(st);
    drain(st, ev);
  }
  const letters = words.reduce((a, w) => a + w.english.length, 0);
  check('打完就贏', st.status === 'won', st.status);
  check('⭐ 鐵律：打對的字母數 = 這一關全部字母數（一個都沒有少）', st.stats.correctLetters === letters, `${st.stats.correctLetters} / ${letters}`);
  const hits = ev.filter((e) => e.type === EV.BOSS_HIT);
  check('每打掉一個字王掉一格血（20 次，最後一下剩 0）', hits.length === 20 && hits[19].a === 0 && hits[0].a === 19, `${hits.length} 次、最後剩 ${hits[hits.length - 1]?.a}`);

  check('換了兩次階段，在第 7、14 個字', JSON.stringify(phases.map((p) => p.kills)) === '[7,14]', JSON.stringify(phases.map((p) => p.kills)));
  check('第二階派出護甲兵', phases[0]?.pool === 'armored', phases[0]?.pool);
  check('第三階暴怒：速度變快', phases[1]?.speed > 1, String(phases[1]?.speed));
  check(`換階段時下一隻蟲站著等（${BOSS.phaseHoldMs}ms）`, phases.every((p) => p.hold === BOSS.phaseHoldMs), phases.map((p) => p.hold).join(','));
  check('換階段不修血', phases.every((p) => p.before.hp >= 0) && !ev.some((e) => e.type === EV.BOSS_PHASE && e.b > 0));

  check('親衛兵在第 6、12、18 隻', JSON.stringify(guards.map((g) => g.pos)) === '[5,11,17]', JSON.stringify(guards.map((g) => g.pos)));
  check('親衛兵不帶特性', guards.every((g) => g.trait === 'none'), guards.map((g) => g.trait).join(','));
  check('打錯過的親衛兵沒有獎勵', wrongOnGuard === 1 && !guards[0].reward, JSON.stringify(guards[0].reward));
  check('零失誤打掉、蜂巢少一顆血 → +1 血', guards[1].reward?.a === 1 && guards[1].reward.hpAfter === guards[1].reward.hpBefore + 1,
    JSON.stringify(guards[1].reward));
  check('零失誤打掉、血是滿的 → 改給蜂蜜', guards[2].reward?.a === 0 && guards[2].reward.b > 0, JSON.stringify(guards[2].reward));
}

/* ── 階段門檻本身 ──────────────────────────────────────────── */
{
  const king = BOSSES.king;
  const at = [0, 24, 25, 49, 50, 74, 75, 99].map((k) => phaseFor(king, k, 100));
  check('大魔王：100 個字在 25 / 50 / 75 換形態', JSON.stringify(at) === '[0,0,1,1,2,2,3,3]', JSON.stringify(at));
  check('大魔王：形態一階比一階快', king.phases.every((p, i) => i === 0 || p.speed > king.phases[i - 1].speed));
  check('親衛兵每 6 隻一隻', [0, 4, 5, 6, 11].map(isGuardAt).join(',') === 'false,false,true,false,true');
}

/* ── 6. 大魔王：唸題、重聽 ─────────────────────────────────── */
console.log('6) 大魔王：跟真的比賽一樣');
{
  const st = createBattle({ words: W(8), seed: 5, difficulty: 'normal', boss: 'king' });
  const ev = [];
  drain(st, ev);
  check('第一隻蟲等的是登場與唸題取長的那個', st.holdMs === Math.max(BOSS.introHoldMs, BOSS.competitionHoldMs), String(st.holdMs));
  typeWord(st, ev);
  check('下一個字也要等唸題', st.holdMs === BOSS.competitionHoldMs, String(st.holdMs));
  const p0 = st.progress;
  for (let i = 0; i < 100; i += 1) stepBattle(st);
  check('唸題的時候蟲站著', st.progress === p0);
  applyAction(st, { kind: 'letter', ch: st.target[0] });
  check('他一打字就不等了', st.holdMs === 0);
  for (let i = 0; i < 30; i += 1) stepBattle(st);
  check('…蟲開始走', st.progress > 0);

  const plain = createBattle({ words: W(3), seed: 5, difficulty: 'normal' });
  const mid = createBattle({ words: W(3), seed: 5, difficulty: 'normal', boss: 'beetle' });
  const fin = createBattle({ words: W(3), seed: 5, difficulty: 'normal', boss: 'king' });
  for (const s of [plain, mid, fin]) { s.holdMs = 0; applyAction(s, { kind: 'listen', listen: 'replay' }); }
  check('中王的重聽代價跟平常一樣', Math.abs(mid.progress - plain.progress) < 1e-9, `${mid.progress} vs ${plain.progress}`);
  check(`大魔王的重聽代價 ×${BOSS.competitionListenFactor}`, Math.abs(fin.progress - plain.progress * BOSS.competitionListenFactor) < 1e-9,
    `${fin.progress.toFixed(4)} vs ${plain.progress.toFixed(4)}`);
}

/* ── 7. 錄影檔重播 ─────────────────────────────────────────── */
console.log('7) 錄影檔重播');
{
  const words = W(14);
  const setup = { seed: 11, difficulty: 'normal', order: 'random', maxHp: BALANCE.maxHp, boss: 'wasp', speed: 1.6, perks: true, wordIds: words.map((w) => w.id) };
  const live = createBattle({ ...setup, words });
  const log = createRecorder(setup);
  check('錄影檔記著王的代號', log.setup.boss === 'wasp');
  let k = 0;
  while (live.status === 'running' && k < 20000) {
    k += 1;
    if (live.perkOffer) {
      const act = { kind: 'perk', pick: 0 };
      recordAction(log, live.tick, act);
      applyAction(live, act);
    } else if (k % 9 === 0 && live.typed < live.target.length) {
      // 偶爾打錯、偶爾重聽：重播要連這些一起重現
      const act = k % 45 === 0 ? { kind: 'listen', listen: 'replay' } : { kind: 'letter', ch: k % 27 === 0 ? 'q' : live.target[live.typed] };
      recordAction(log, live.tick, act);
      applyAction(live, act);
    }
    clearEvents(live);
    if (live.status !== 'running') break;
    stepBattle(live);
    clearEvents(live);
  }
  check('打完了（贏或輸都可以）', live.status !== 'running', live.status);
  check('⭐ 重播出來的指紋一模一樣', replayFingerprint(log, words) === fingerprint(live));
  const noBoss = { ...log, setup: { ...log.setup, boss: null } };
  check('拿掉王的代號重播就不一樣（王真的有進結果）', replayFingerprint(noBoss, words) !== fingerprint(live));
}

console.log(failures ? `\n${failures} 項失敗` : '\n全部通過');
process.exit(failures ? 1 : 0);
