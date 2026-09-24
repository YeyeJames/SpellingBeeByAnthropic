/**
 * C5：裝備。
 *
 * §1 是這一段的鐵律，也是最重要的那條測試：
 *
 *   **力量買的是容錯，不是答案。**
 *   敵人的血量永遠等於單字的字母數，任何裝備都不會改變它。
 *
 * 一件裝備如果讓他少打一個字母，那就是花錢買「不用學」，整個設計就毀了。
 * 所以下面第 2 節是逐件裝備去驗「字母數一個都沒少」。
 *
 * 其他要證明的事：
 *   1. 效果換算：倍率相乘、加成相加、減傷有上限
 *   2. ⭐ 沒有任何一件會減少要打的字母
 *   3. 每一件的效果真的生效（擊退、打錯代價、重聽、連擊門檻、二次機會、長字）
 *   4. 玻璃蜂針的風險是真的（血量被壓到 1，而且蓋掉所有加血）
 *   5. 前端與伺服器算的經驗仍然一致（長字獵手會動到它）
 *   6. 錄影檔重播要帶著裝備
 *   7. 等級門檻與買賣：買不起／沒解鎖不能買，重送不會扣兩次
 *
 * 用法：node scripts/gear-test.mjs
 */

import { createRequire } from 'node:module';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const { GEAR, SLOTS, effectsFor, gearByKey, gearAvailability, DEFAULT_EQUIPPED } = await import(
  '../public/js/shared/equipment.js'
);
const { xpForBattle } = await import('../public/js/shared/levels.js');
const { createBattle, applyAction, stepBattle, clearEvents, fingerprint, EV } = await import(
  '../public/js/game/core/battle.js'
);
const { createRecorder, recordAction, replayLog } = await import(
  '../public/js/game/core/recorder.js'
);
const { BALANCE } = await import('../public/js/game/core/balance.js');

const WORDS = [
  { id: 'a', english: 'elephant' }, // 8 字母＝長字
  { id: 'b', english: 'cat' },
  { id: 'c', english: 'computer' }, // 8 字母＝長字
  { id: 'd', english: 'dog' }
];

/** 打完整場（全對），回傳最終狀態。 */
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

/* ── 1. 效果換算 ─────────────────────────────────────────── */
console.log('1) 效果換算');
{
  const bare = effectsFor({});
  check('全裸是全部 1 倍（等於 C5 之前）',
    bare.knockback === 1 && bare.penalty === 1 && bare.listen === 1 && bare.bonusHp === 0);

  const q = effectsFor({ weapon: 'weapon_queen' });
  check('女王之刺 擊退 1.8 倍', q.knockback === 1.8, String(q.knockback));

  const glassQueen = effectsFor({ weapon: 'weapon_queen', trinket: 'trinket_glass' });
  check('兩件都給擊退時要相乘（1.8 × 2）', glassQueen.knockback === 3.6, String(glassQueen.knockback));
  check('玻璃蜂針把血量蓋成 1', glassQueen.hpOverride === 1, String(glassQueen.hpOverride));

  /*
   * 減傷上限 50%（§1 明訂）。
   * 打錯的懲罰如果能降到接近零，「小心打」就沒意義了，他會養成亂按的習慣——
   * 而亂按正是拼字最不該養成的習慣。
   */
  check('減傷不會超過 50%', effectsFor({ armor: 'armor_royal' }).penalty === 0.5);
  let worst = 1;
  for (const g of GEAR) worst = Math.min(worst, effectsFor({ [g.slot]: g.key }).penalty);
  check('任何單件裝備都打不破 50% 上限', worst >= 0.5, String(worst));

  check('沒有裝備時連擊門檻用 balance.js 的原值', bare.comboAt === null);
  check('蜜糖節奏換掉整組門檻',
    JSON.stringify(effectsFor({ trinket: 'trinket_rhythm' }).comboAt) === '[4,8,12]');
}

/* ── 2. ⭐ 力量買的是容錯，不是答案 ──────────────────────── */
console.log('2) ⭐ 沒有任何一件裝備會讓他少打字母');
{
  const bare = playAll();
  const bareLetters = bare.stats.correctLetters;
  const totalLetters = WORDS.reduce((a, w) => a + w.english.length, 0);
  check('全裸打完，打的字母數等於所有字的長度總和',
    bareLetters === totalLetters, `${bareLetters} vs ${totalLetters}`);

  let offenders = [];
  for (const g of GEAR) {
    const st = playAll({ equipped: { [g.slot]: g.key } });
    if (st.stats.correctLetters !== totalLetters) {
      offenders.push(`${g.name}:${st.stats.correctLetters}`);
    }
  }
  check(`逐件檢查 ${GEAR.length} 件，打的字母數都一樣`, offenders.length === 0, offenders.join(', '));

  // 全套頂裝也一樣
  const full = playAll({
    equipped: { weapon: 'weapon_queen', armor: 'armor_royal', trinket: 'trinket_hunter' },
    level: 30
  });
  check('全套頂裝 + 30 級，還是要打一模一樣多的字母',
    full.stats.correctLetters === totalLetters, `${full.stats.correctLetters} vs ${totalLetters}`);
  check('敵人數量也沒變', full.stats.wordsKilled === bare.stats.wordsKilled);
}

/* ── 3. 每一件的效果真的生效 ─────────────────────────────── */
console.log('3) 效果真的生效');
{
  /* 擊退：先讓蟲走一段，再比打一下之後被推到哪裡 */
  function knockTest(equipped) {
    const st = createBattle({ words: WORDS, seed: 9, difficulty: 'normal', order: 'sequential', equipped });
    for (let i = 0; i < 240; i += 1) { stepBattle(st); clearEvents(st); }
    const before = st.progress;
    applyAction(st, { kind: 'letter', ch: st.target[0] });
    clearEvents(st);
    return before - st.progress; // 推回去多少
  }
  const bareKnock = knockTest({});
  const ironKnock = knockTest({ weapon: 'weapon_iron' });
  check('鐵蜂針推得比較遠', ironKnock > bareKnock,
    `${bareKnock.toFixed(5)} → ${ironKnock.toFixed(5)}`);
  check('大約就是 +25%', Math.abs(ironKnock / bareKnock - 1.25) < 0.02,
    `實際 ${(ironKnock / bareKnock).toFixed(3)} 倍`);

  /* 打錯的代價 */
  function penaltyTest(equipped) {
    const st = createBattle({ words: WORDS, seed: 9, difficulty: 'normal', order: 'sequential', equipped });
    const before = st.progress;
    // 挑一個一定不是正解的字母
    const wrong = 'zzzz'.includes(st.target[0]) ? 'q' : 'z';
    applyAction(st, { kind: 'letter', ch: wrong });
    clearEvents(st);
    return st.progress - before;
  }
  const barePen = penaltyTest({});
  const thickPen = penaltyTest({ armor: 'armor_thick' });
  check('厚蠟甲讓打錯的代價變小', thickPen < barePen, `${barePen.toFixed(5)} → ${thickPen.toFixed(5)}`);
  check('大約就是 −20%', Math.abs(thickPen / barePen - 0.8) < 0.02,
    `實際 ${(thickPen / barePen).toFixed(3)} 倍`);

  /* 重聽 */
  function listenTest(equipped) {
    const st = createBattle({ words: WORDS, seed: 9, difficulty: 'normal', order: 'sequential', equipped });
    const before = st.progress;
    applyAction(st, { kind: 'listen', listen: 'replay' });
    clearEvents(st);
    return st.progress - before;
  }
  const bareListen = listenTest({});
  const echoListen = listenTest({ trinket: 'trinket_echo' });
  check('回音水晶讓重聽的代價減半',
    Math.abs(echoListen / bareListen - 0.5) < 0.02, `實際 ${(echoListen / bareListen).toFixed(3)} 倍`);

  /* 連擊門檻 */
  {
    const st = createBattle({
      words: WORDS, seed: 9, difficulty: 'easy', order: 'sequential',
      equipped: { trinket: 'trinket_rhythm' }
    });
    let firedAt = -1;
    let guard = 0;
    while (st.status === 'running' && guard++ < 200000 && firedAt < 0) {
      const ch = st.target[st.typed];
      if (ch) applyAction(st, { kind: 'letter', ch });
      else stepBattle(st);
      for (let i = 0; i < st.evCount; i += 1) {
        const ev = st.ev[i];
        if (ev.type === EV.COMBO_BONUS && ev.a === 1) firedAt = ev.b;
      }
      clearEvents(st);
    }
    check('蜜糖節奏讓第一階在 4 連就發動（原本 5）',
      firedAt === 4, `在 ${firedAt} 連發動（balance 原值 ${BALANCE.combo.dashAt}）`);
  }

  /* 二次機會 */
  {
    function missOnce(equipped) {
      const st = createBattle({ words: WORDS, seed: 9, difficulty: 'hard', order: 'sequential', equipped });
      // 什麼都不打，讓第一隻走到底
      let guard = 0;
      while (st.stats.wordsMissed === 0 && guard++ < 200000) { stepBattle(st); clearEvents(st); }
      return st;
    }
    const bareMiss = missOnce({});
    const saved = missOnce({ trinket: 'trinket_secondchance' });
    check('沒戴飾品：漏字扣一顆血', bareMiss.hp === bareMiss.maxHp - 1, `${bareMiss.hp}/${bareMiss.maxHp}`);
    check('二次機會：第一次漏字不扣血', saved.hp === saved.maxHp, `${saved.hp}/${saved.maxHp}`);
    check('但字還是算漏掉了（學習的部分沒有少）', saved.stats.wordsMissed === 1);
    check('赦免次數用掉了', saved.freeMissesLeft === 0, String(saved.freeMissesLeft));
  }

  /* 長字獵手 */
  {
    const bare = playAll();
    const hunter = playAll({ equipped: { trinket: 'trinket_hunter' } });
    check('長字獵手讓蜂蜜變多', hunter.honey > bare.honey, `${bare.honey} → ${hunter.honey}`);
    const extra = BALANCE.honey.longWordBonus * 2; // 兩個長字，各多一份長字獎勵
    check('多出來的剛好是兩個長字的額外獎勵',
      hunter.honey - bare.honey === extra, `多了 ${hunter.honey - bare.honey}，預期 ${extra}`);
    check('經驗也跟著變多', hunter.xp > bare.xp, `${bare.xp} → ${hunter.xp}`);
  }
}

/* ── 4. 玻璃蜂針的風險是真的 ─────────────────────────────── */
console.log('4) 玻璃蜂針：高風險高回報');
{
  const st = createBattle({
    words: WORDS, seed: 9, difficulty: 'normal', order: 'sequential',
    level: 30, // 30 級本來有加血
    equipped: { armor: 'armor_royal', trinket: 'trinket_glass' } // 護甲也加血
  });
  check('血量被壓到 1，等級與護甲的加血都被蓋掉', st.maxHp === 1, String(st.maxHp));
  check('而且擊退真的是兩倍', st.gear.knockback === 2, String(st.gear.knockback));
}

/* ── 5. 前端與伺服器算的經驗仍然一致 ─────────────────────── */
console.log('5) 長字獵手動到經驗，兩邊還是要一致');
{
  for (const trinket of [null, 'trinket_hunter']) {
    const st = playAll({ equipped: trinket ? { trinket } : {} });
    const s = st.stats;
    const server = xpForBattle({
      correctLetters: s.correctLetters,
      kills: s.wordsKilled,
      longKills: s.longKills,
      relearns: s.relearns,
      wordCount: WORDS.length,
      won: st.status === 'won',
      perfect: st.status === 'won' && s.wordsMissed === 0 && s.wrongLetters === 0,
      longWordFactor: st.gear.longWordFactor
    });
    check(`${trinket || '沒戴飾品'}：前端 ${st.xp} = 伺服器 ${server}`, st.xp === server);
  }
}

/* ── 6. 重播要帶著裝備 ───────────────────────────────────── */
console.log('6) 錄影檔重播');
{
  const equipped = { weapon: 'weapon_queen', armor: 'armor_hive', trinket: 'trinket_echo' };
  const st = createBattle({ words: WORDS, seed: 11, difficulty: 'normal', order: 'sequential', equipped });
  const log = createRecorder({
    seed: 11, difficulty: 'normal', order: 'sequential', maxHp: 3,
    level: 1, xp: 0, relearnIds: [], equipped, wordIds: WORDS.map((w) => w.id)
  });
  let guard = 0;
  while (st.status === 'running' && guard++ < 200000) {
    const ch = st.target[st.typed];
    if (ch) { recordAction(log, st.tick, { kind: 'letter', ch }); applyAction(st, { kind: 'letter', ch }); }
    else stepBattle(st);
    clearEvents(st);
  }
  const replayed = replayLog(log, WORDS);
  check('指紋一模一樣', fingerprint(replayed) === fingerprint(st));
  check('錄影檔有存裝備', log.setup.equipped?.weapon === 'weapon_queen', JSON.stringify(log.setup.equipped));

  /*
   * 舊錄影檔（沒有 equipped）要退回全裸，不然他之前存下來的
   * 「剛剛怪怪的」檔案全部重播不出來。
   */
  const old = { ...log, setup: { ...log.setup } };
  delete old.setup.equipped;
  const asOld = replayLog(old, WORDS);
  check('舊錄影檔仍然重播得出來（退回全裸）', asOld.gear.knockback === 1, String(asOld.gear.knockback));
}

/* ── 7. 等級門檻與買賣 ───────────────────────────────────── */
console.log('7) 等級門檻與購買');
{
  const iron = gearByKey('weapon_iron');
  check('鐵蜂針要 10 級', iron.minLevel === 10, String(iron.minLevel));
  const lowLevel = gearAvailability(iron, { level: 5, honey: 99999, owned: [] });
  check('等級不夠就不能買（錢再多也一樣）', lowLevel.canBuy === false && lowLevel.unlocked === false);
  const poor = gearAvailability(iron, { level: 20, honey: 10, owned: [] });
  check('錢不夠也不能買', poor.canBuy === false && poor.affordable === false);
  const ok = gearAvailability(iron, { level: 20, honey: 500, owned: [] });
  check('等級夠、錢夠就能買', ok.canBuy === true);
  const already = gearAvailability(iron, { level: 20, honey: 500, owned: ['weapon_iron'] });
  check('買過就不會再顯示可買', already.canBuy === false && already.owned === true);
  check('初始裝備本來就算擁有',
    gearAvailability(gearByKey('weapon_wood'), { level: 1, honey: 0, owned: [] }).owned === true);

  /* 門檻分布：飾品要早於武器護甲的高階（§7 特別講過這件事） */
  const firstTrinket = Math.min(...GEAR.filter((g) => g.slot === 'trinket').map((g) => g.minLevel));
  const topWeapon = Math.max(...GEAR.filter((g) => g.slot === 'weapon').map((g) => g.minLevel));
  check('第一個飾品比頂級武器早得多（那一刻的「原來還能這樣玩」比 +25% 有感）',
    firstTrinket < topWeapon, `飾品最早 ${firstTrinket} 級、武器最高 ${topWeapon} 級`);
}

/* ── 8. 伺服器端 ─────────────────────────────────────────── */
console.log('8) 伺服器：買、裝、扣蜂蜜');
{
  const store = {
    users: [], purchases: [], gameResults: [], groupProgress: [],
    groupCompletions: [], wordProgress: [], attempts: [], practiceSessions: [], wordAudio: []
  };
  const fake = createFakeDb(store, { uniqueIndexes: { purchases: ['userId', 'opId'] } });
  installFakeDb(fake);

  const express = require('express');
  const User = require('../server/models/User.js');

  const app = express();
  app.use(express.json());
  const user = await User.createUser('測試');
  // 給他足夠的等級與蜂蜜
  await User.addXp(user._id, 100000);
  await User.addHoney(user._id, 5000);
  /*
   * 假的 session。
   *
   * 路由內部第一行就是 requireAuth，而它讀的是 req.session.userId——
   * 直接塞 req.user 會被它蓋掉（第一版就是這樣拿到 401 的）。
   * 從 session 進去才是真的走完整條驗證路徑。
   */
  app.use((req, res, next) => {
    req.session = { userId: String(user._id), destroy: (cb) => cb && cb() };
    next();
  });
  app.use('/api/shop', require('../server/routes/shop.js'));

  const server = app.listen(0);
  const port = server.address().port;
  const call = async (method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const list = await call('GET', '/api/shop/gear');
  check('拿得到裝備清單', list.status === 200 && list.body.items.length === GEAR.length,
    `${list.status}、${list.body?.items?.length} 件`);
  check('清單會說現在裝了什麼', list.body.equipped.weapon === DEFAULT_EQUIPPED.weapon,
    JSON.stringify(list.body.equipped));

  const buy = await call('POST', '/api/shop/gear/buy', { gearKey: 'weapon_iron', opId: 'buy-1' });
  check('買得下來', buy.status === 200, `${buy.status} ${buy.body?.error || ''}`);
  check('蜂蜜被扣掉了', buy.body.user.honey === 5000 - 300, String(buy.body?.user?.honey));
  check('記進擁有清單', (buy.body.user.ownedGear || []).includes('weapon_iron'));

  const dup = await call('POST', '/api/shop/gear/buy', { gearKey: 'weapon_iron', opId: 'buy-1' });
  check('重送不會扣兩次錢', dup.body.duplicate === true, JSON.stringify(dup.body?.duplicate));
  const afterDup = await call('GET', '/api/shop/gear');
  check('重送之後蜂蜜沒再少', afterDup.body.honey === 4700, String(afterDup.body.honey));

  const equip = await call('POST', '/api/shop/gear/equip', { slot: 'weapon', gearKey: 'weapon_iron' });
  check('換得上', equip.status === 200 && equip.body.user.equipped.weapon === 'weapon_iron',
    JSON.stringify(equip.body?.user?.equipped));

  const notOwned = await call('POST', '/api/shop/gear/equip', { slot: 'weapon', gearKey: 'weapon_queen' });
  check('沒買的裝備裝不上去', notOwned.status === 400, `${notOwned.status} ${notOwned.body?.error || ''}`);

  const wrongSlot = await call('POST', '/api/shop/gear/equip', { slot: 'armor', gearKey: 'weapon_iron' });
  check('武器裝不進護甲欄', wrongSlot.status === 400, `${wrongSlot.status}`);

  /*
   * 等級門檻由伺服器守。
   * 只靠畫面把按鈕變灰是不夠的——那顆按鈕按不按得到是瀏覽器說了算。
   */
  const poorUser = await User.createUser('新手');
  const app2 = express();
  app2.use(express.json());
  app2.use((req, res, next) => {
    req.session = { userId: String(poorUser._id), destroy: (cb) => cb && cb() };
    next();
  });
  app2.use('/api/shop', require('../server/routes/shop.js'));
  const s2 = app2.listen(0);
  const p2 = s2.address().port;
  await User.addHoney(poorUser._id, 99999); // 錢很多，但等級是 1
  const r2 = await fetch(`http://127.0.0.1:${p2}/api/shop/gear/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gearKey: 'weapon_queen', opId: 'x' })
  });
  const b2 = await r2.json();
  check('1 級就算蜂蜜爆多也買不到 30 級的裝備', r2.status === 400 && /級/.test(b2.error || ''),
    `${r2.status} ${b2.error || ''}`);

  server.close();
  s2.close();
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
