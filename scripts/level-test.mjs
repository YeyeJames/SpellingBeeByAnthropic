/**
 * C2：等級與經驗值。
 *
 * 要證明的事：
 *   1. 曲線本身：等級由累計經驗算出來，兩個方向對得起來
 *   2. 前端與伺服器算出來的經驗**完全一樣**（這是整段最關鍵的一條）
 *   3. ⭐ 以前錯過的字給五倍經驗，而且同一場只給一次
 *   4. 等級加成是「容錯」不是「答案」：要打的字母數一個都沒少
 *   5. 錄影檔重播要帶著等級，不然同一場重播會跑出不同結果
 *   6. 畫面：經驗條、等級、升級橫幅、結算列
 *
 * 用法：node scripts/level-test.mjs
 */

import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const { levelFromXp, xpToNextLevel, xpForLevel, xpForBattle, levelRewards, XP } = await import(
  '../public/js/shared/levels.js'
);
const { createBattle, applyAction, stepBattle, clearEvents, fingerprint } = await import(
  '../public/js/game/core/battle.js'
);
const { createRecorder, recordAction, replayLog } = await import(
  '../public/js/game/core/recorder.js'
);

/* ── 1. 曲線 ─────────────────────────────────────────────── */
console.log('1) 等級曲線');
{
  check('0 經驗是 1 級', levelFromXp(0).level === 1, JSON.stringify(levelFromXp(0)));
  check('差一點點不會升級', levelFromXp(xpToNextLevel(1) - 1).level === 1);
  check('剛好滿就升級', levelFromXp(xpToNextLevel(1)).level === 2);

  /*
   * 兩個方向要對得起來：xpForLevel(n) 是「剛好升到 n 級」的門檻，
   * 拿它回去問 levelFromXp 一定要得到 n。
   * 這一條會抓到「曲線改了但其中一個函式沒跟著改」這種錯。
   */
  let consistent = true;
  for (let l = 1; l <= 60; l += 1) {
    const at = xpForLevel(l);
    if (levelFromXp(at).level !== l) { consistent = false; break; }
    if (at > 0 && levelFromXp(at - 1).level !== l - 1) { consistent = false; break; }
  }
  check('xpForLevel 與 levelFromXp 互為反函數（1~60 級）', consistent);

  // 進度條畫的是 into/need，不可以超出範圍
  let inRange = true;
  for (let xp = 0; xp < 5000; xp += 37) {
    const r = levelFromXp(xp);
    if (r.into < 0 || r.into >= r.need) { inRange = false; break; }
  }
  check('經驗條的 into 永遠在 0~need 之間', inRange);

  check('壞掉的輸入不會炸', levelFromXp(null).level === 1 && levelFromXp(-5).level === 1);
}

/* ── 2. 前端與伺服器算出來一樣 ───────────────────────────── */
console.log('2) 戰鬥中即時累加的經驗 = 伺服器重算的經驗');
{
  /*
   * 這是整段最關鍵的一條。
   *
   * 前端在戰鬥中逐字累加（經驗條才會即時漲），伺服器收到成績後用
   * xpForBattle() 重算一次。兩邊只要差一點，症狀就是「打完看到 302 XP，
   * 重新整理變成 173」——而那種不一致最難解釋。
   *
   * 第一版實作就是這樣漏的：前端只逐字加，完成獎勵與完美倍率只寫在伺服器那邊。
   */
  const mk = (n) => Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    english: i % 3 === 0 ? 'elephant' : 'cat'
  }));

  function playAll(words, opts = {}) {
    const st = createBattle({ words, seed: 7, difficulty: 'easy', order: 'sequential', ...opts });
    let guard = 0;
    while (st.status === 'running' && guard++ < 200000) {
      const ch = st.target[st.typed];
      if (ch) applyAction(st, { kind: 'letter', ch });
      else stepBattle(st);
      clearEvents(st);
    }
    return st;
  }

  for (const n of [5, 14, 20]) {
    const words = mk(n);
    const st = playAll(words);
    const s = st.stats;
    const server = xpForBattle({
      correctLetters: s.correctLetters,
      kills: s.wordsKilled,
      longKills: s.longKills,
      relearns: s.relearns,
      wordCount: words.length,
      won: st.status === 'won',
      perfect: st.status === 'won' && s.wordsMissed === 0 && s.wrongLetters === 0
    });
    check(`${n} 個字全對：兩邊一致`, st.xp === server, `前端 ${st.xp}、伺服器 ${server}`);
  }

  // 有打錯的情況：完美倍率不可以生效
  {
    const words = mk(4);
    const st = createBattle({ words, seed: 3, difficulty: 'easy', order: 'sequential' });
    applyAction(st, { kind: 'letter', ch: 'z' }); // 故意打錯一下
    clearEvents(st);
    let guard = 0;
    while (st.status === 'running' && guard++ < 200000) {
      const ch = st.target[st.typed];
      if (ch) applyAction(st, { kind: 'letter', ch });
      else stepBattle(st);
      clearEvents(st);
    }
    const s = st.stats;
    const server = xpForBattle({
      correctLetters: s.correctLetters,
      kills: s.wordsKilled,
      longKills: s.longKills,
      relearns: s.relearns,
      wordCount: words.length,
      won: st.status === 'won',
      perfect: st.status === 'won' && s.wordsMissed === 0 && s.wrongLetters === 0
    });
    check('打錯過的一場：兩邊仍然一致', st.xp === server, `前端 ${st.xp}、伺服器 ${server}`);
    check('打錯過就不算完美（沒有 1.5 倍）', s.wrongLetters > 0 && st.xp === server);
  }
}

/* ── 3. 重學獎勵 ─────────────────────────────────────────── */
console.log('3) 以前錯過的字給五倍經驗');
{
  const words = [
    { id: 'a', english: 'cat' },
    { id: 'b', english: 'dog' },
    { id: 'c', english: 'pig' }
  ];
  function play(relearnIds) {
    const st = createBattle({ words, seed: 5, difficulty: 'easy', order: 'sequential', relearnIds });
    let guard = 0;
    while (st.status === 'running' && guard++ < 200000) {
      const ch = st.target[st.typed];
      if (ch) applyAction(st, { kind: 'letter', ch });
      else stepBattle(st);
      clearEvents(st);
    }
    return st;
  }
  const plain = play(null);
  const withRelearn = play(['a', 'c']);

  check('沒有重學名單時，relearns 是 0', plain.stats.relearns === 0);
  check('有名單時數得出來', withRelearn.stats.relearns === 2, String(withRelearn.stats.relearns));
  check(
    `兩個重學字剛好多 ${2 * XP.relearnBonus} XP`,
    withRelearn.xp - plain.xp === Math.round(2 * XP.relearnBonus * XP.perfectFactor),
    `差 ${withRelearn.xp - plain.xp}（含完美 1.5 倍）`
  );
  check(
    '一隻普通的蟲 5 XP，重學的 25 XP（差五倍）',
    XP.perKill === 5 && XP.perKill + XP.relearnBonus === 25
  );

  /*
   * 同一場之內不可以重複給。
   *
   * 漏掉的字會排回隊伍尾端，本場之內還會再遇到——如果每次都給，
   * 最賺的玩法會變成「故意漏掉再補打」，而那跟學會那個字完全無關。
   */
  const st = createBattle({
    words: [{ id: 'a', english: 'cat' }],
    seed: 5,
    difficulty: 'easy',
    order: 'sequential',
    relearnIds: ['a']
  });
  for (const ch of 'cat') { applyAction(st, { kind: 'letter', ch }); clearEvents(st); }
  check('打掉之後名單裡就沒有它了', st.relearnSet.size === 0, `剩 ${st.relearnSet.size}`);
}

/* ── 4. 等級加成是容錯，不是答案 ─────────────────────────── */
console.log('4) 等級變強，但要打的字母數一個都沒少');
{
  const words = [{ id: 'a', english: 'elephant' }, { id: 'b', english: 'cat' }];
  const lo = createBattle({ words, seed: 9, difficulty: 'normal', order: 'sequential', level: 1 });
  const hi = createBattle({ words, seed: 9, difficulty: 'normal', order: 'sequential', level: 30 });

  check('高等級的擊退倍率比較大', hi.levelKnockback > lo.levelKnockback,
    `Lv1 ${lo.levelKnockback} → Lv30 ${hi.levelKnockback}`);
  check('敵人的血量（字母數）完全沒變', lo.target.length === hi.target.length, `${lo.target.length}`);

  /*
   * 先讓蟲走一段再打。
   *
   * 開場 progress 是 0，而擊退會被夾在 0（不能推到畫面外），所以在起點
   * 打一下兩邊都是 0，比不出差別——第一版的測試就是這樣寫的，
   * 它「通過」與否跟等級完全無關。要驗擊退，蟲得先有距離可以被推。
   */
  for (let i = 0; i < 240; i += 1) { stepBattle(lo); clearEvents(lo); stepBattle(hi); clearEvents(hi); }
  const beforeLo = lo.progress;
  const beforeHi = hi.progress;
  check('兩邊走到同一個位置（只有等級不同）', Math.abs(beforeLo - beforeHi) < 1e-9,
    `${beforeLo} vs ${beforeHi}`);

  // 打一個字母：兩邊推進的差別只在「推回多少」，不在「要打幾下」
  applyAction(lo, { kind: 'letter', ch: 'e' });
  applyAction(hi, { kind: 'letter', ch: 'e' });
  check('打一下之後，兩邊都只前進了一個字母', lo.typed === 1 && hi.typed === 1);
  check('高等級被推得比較遠（容錯變多）', hi.progress < lo.progress,
    `Lv1 推到 ${lo.progress.toFixed(5)}、Lv30 推到 ${hi.progress.toFixed(5)}`);

  const r30 = levelRewards(30);
  const r1 = levelRewards(1);
  check('1 級完全等於 C2 之前（1.0 倍、不加血）', r1.knockbackFactor === 1 && r1.bonusHp === 0);
  check('血量加成延到 20 級以後（模擬器量過，早給會把難度抹平）',
    levelRewards(19).bonusHp === 0 && levelRewards(20).bonusHp === 1,
    `Lv19=${levelRewards(19).bonusHp}、Lv20=${levelRewards(20).bonusHp}`);
  check('血量加成有上限', r30.bonusHp === levelRewards(999).bonusHp, `Lv30=${r30.bonusHp}、Lv999=${levelRewards(999).bonusHp}`);
}

/* ── 5. 重播要帶著等級 ───────────────────────────────────── */
console.log('5) 錄影檔重播要重現同一場');
{
  const words = [{ id: 'a', english: 'cat' }, { id: 'b', english: 'elephant' }];
  const level = 24;
  const st = createBattle({ words, seed: 11, difficulty: 'normal', order: 'sequential', level, relearnIds: ['b'] });
  const log = createRecorder({
    seed: 11, difficulty: 'normal', order: 'sequential',
    maxHp: 3, level, xp: 0, relearnIds: ['b'],
    wordIds: words.map((w) => w.id)
  });
  let guard = 0;
  while (st.status === 'running' && guard++ < 200000) {
    const ch = st.target[st.typed];
    if (ch) { recordAction(log, st.tick, { kind: 'letter', ch }); applyAction(st, { kind: 'letter', ch }); }
    else stepBattle(st);
    clearEvents(st);
  }
  const replayed = replayLog(log, words);
  check('重播的指紋一模一樣', fingerprint(replayed) === fingerprint(st),
    `${fingerprint(st)} vs ${fingerprint(replayed)}`);
  check('重播的經驗一樣', replayed.xp === st.xp, `${st.xp} vs ${replayed.xp}`);
  check('重播的重學數一樣', replayed.stats.relearns === st.stats.relearns);
  check('錄影檔有存等級', log.setup.level === level, String(log.setup.level));

  /*
   * 舊的錄影檔（沒有 level / relearnIds）要退回 C2 之前的行為，
   * 不然他之前存下來的「剛剛怪怪的」那些檔案全部重播不出來。
   */
  const oldLog = { ...log, setup: { ...log.setup } };
  delete oldLog.setup.level;
  delete oldLog.setup.relearnIds;
  delete oldLog.setup.xp;
  const asOld = replayLog(oldLog, words);
  check('舊錄影檔仍然重播得出來（退回 1 級、空名單）',
    asOld.startLevel === 1 && asOld.stats.relearns === 0,
    `Lv${asOld.startLevel}、重學 ${asOld.stats.relearns}`);
}

/* ── 6. 畫面 ─────────────────────────────────────────────── */
console.log('6) 畫面上看得到');
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(`${BASE}/game?group=w18&n=200&order=sequential&show=1&difficulty=easy`, {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

{
  const start = await page.evaluate(() => window.__spellbee.levelState());
  check('開場是 1 級 0 經驗（沒登入時的預設）', start.level === 1 && start.xp === 0, JSON.stringify(start));
  check('1 級沒有額外血量與擊退', start.maxHp === 3 && start.knockback === 1, JSON.stringify(start));

  // 打到升級
  let sawLevelUp = false;
  for (let i = 0; i < 600; i += 1) {
    const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
    if (!ch) {
      const st = await page.evaluate(() => window.__spellbee.state());
      if (st.status !== 'running') break;
      continue;
    }
    await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    if (!sawLevelUp) {
      const b = await page.evaluate(() => window.__spellbee.levelUpBanner());
      if (b.visible) { sawLevelUp = true; check('升級時有橫幅', /升到 \d+ 級/.test(b.text), b.text); }
    }
  }
  check('戰鬥中就看得到升級（不是打完才結算）', sawLevelUp);

  const end = await page.evaluate(() => window.__spellbee.levelState());
  check('打完之後等級真的漲了', end.level > 1, `Lv${end.level}、${end.xp} XP`);

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#postgame-stats .stat-row')].map((r) => r.textContent)
  );
  check('結算寫出這一場賺了多少經驗', rows.some((r) => /這場經驗/.test(r)), rows.join(' | '));
  check('結算寫出等級與離下一級還差多少', rows.some((r) => /級/.test(r) && /還差/.test(r)), rows.join(' | '));
  /*
   * 「破紀錄！」只能出現在蜂蜜那一列。
   *
   * 第一版把 highlight 跟「破紀錄」綁成同一個旗標，結果經驗那幾列也被
   * 寫上「（破紀錄！）」——經驗每一場都在漲，那三個字放在它旁邊沒有意義。
   */
  const bestLabels = rows.filter((r) => r.includes('破紀錄'));
  check('「破紀錄」不會跑到經驗那幾列上',
    bestLabels.every((r) => r.includes('蜂蜜')), bestLabels.join(' | '));
}

check('沒有 JS 例外', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
