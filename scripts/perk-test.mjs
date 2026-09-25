/**
 * 三選一的臨時能力（C8）。
 *
 * 要證明的事：
 *   1. 沒開的時候完全沒有三選一，指紋跟 C8 之前一樣
 *   2. 第 5、12、19、26 隻之後各一次、最多四次、不重複；選的時候整場停住、
 *      手上還在打的字母不算打錯
 *   3. 六張卡各自真的有效果
 *   4. ⭐ 三條鐵律：要打的字母數不變、經驗值不變、精熟度紀錄不變
 *   5. 錄影檔重播得出來；舊錄影檔不會跑出三選一；被截斷的錄影檔不會卡死
 *   6. 瀏覽器：戰役關卡出現選卡畫面、按 1/2/3 選得到、方向鍵不會漏去觸發重聽；
 *      組別遊戲沒有三選一
 *
 * 用法：node scripts/perk-test.mjs（自己起伺服器）
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const { createBattle, applyAction, stepBattle, clearEvents, fingerprint, EV } = await import(
  '../public/js/game/core/battle.js'
);
const { createRecorder, recordAction, replayLog } = await import('../public/js/game/core/recorder.js');
const { PERK_IDS, PERK_OFFER_AT, REWIND, FREEZE_MS, RUSH } = await import('../public/js/game/core/perks.js');

const LIST = ['cat', 'dog', 'sun', 'map', 'hat', 'pen', 'cup', 'box', 'jam', 'fox', 'bee', 'owl',
  'ant', 'bat', 'cow', 'elk', 'gum', 'hen', 'ink', 'jet', 'kit', 'log', 'mud', 'net', 'oak',
  'pig', 'rat', 'sky', 'toy', 'van', 'web', 'yak'];
const WORDS = LIST.map((english, i) => ({ id: `w${i}`, english }));

/**
 * 打完整場。pick(offer, state) 決定選第幾張（預設第一張）。
 * 回傳最終狀態與事件。每打一個字前可以用 before(state) 動手腳。
 */
function play({ words = WORDS, perks = false, pick = () => 0, typoAt = -1, seed = 3 } = {}) {
  const st = createBattle({ words, seed, difficulty: 'easy', order: 'sequential', perks });
  const events = [];
  const drain = () => {
    for (let i = 0; i < st.evCount; i += 1) events.push({ type: st.ev[i].type, a: st.ev[i].a, b: st.ev[i].b });
    clearEvents(st);
  };
  drain();
  let guard = 0;
  while (st.status === 'running' && guard++ < 400000) {
    if (st.perkOffer) { applyAction(st, { kind: 'perk', pick: pick(st.perkOffer, st) }); drain(); continue; }
    const ch = st.target[st.typed];
    if (st.stats.wordsKilled === typoAt && st.typed === 1 && st.cleanWord) applyAction(st, { kind: 'letter', ch: 'q' });
    else if (ch) applyAction(st, { kind: 'letter', ch });
    else stepBattle(st);
    drain();
  }
  return { st, events };
}

/* ── 1. 沒開就沒有 ──────────────────────────────────────── */
console.log('1) 沒開的時候完全沒有三選一');
{
  const off = play({ perks: false });
  check('打完 32 個字，一次都沒出現', !off.events.some((e) => e.type === EV.PERK_OFFER));
  const legacy = createBattle({ words: WORDS, seed: 3, difficulty: 'easy', order: 'sequential' });
  const explicit = createBattle({ words: WORDS, seed: 3, difficulty: 'easy', order: 'sequential', perks: false });
  check('不給參數 = 關的，指紋一模一樣（舊錄影檔不受影響）', fingerprint(legacy) === fingerprint(explicit));
}

/* ── 2. 什麼時候出現、出現時怎樣 ─────────────────────────── */
console.log('\n2) 什麼時候出現、出現的時候怎樣');
{
  const offersAt = [];
  const seen = [];
  const r = play({
    perks: true,
    pick: (offer, st) => { offersAt.push(st.stats.wordsKilled); seen.push(offer.slice()); return 0; }
  });
  check(`第 ${PERK_OFFER_AT.join('、')} 隻之後各一次`, offersAt.join(',') === PERK_OFFER_AT.join(','), offersAt.join(','));
  check('一場最多 4 次', r.st.perks.length === 4, String(r.st.perks.length));
  check('每次三張', seen.every((o) => o.length === 3), seen.map((o) => o.length).join(','));
  check('一張卡同一場不會出現第二次（拿過的不再出現）',
    seen.every((o, i) => o.every((id) => !r.st.perks.slice(0, i).includes(id))));
  check('四次拿到的都不一樣', new Set(r.st.perks).size === 4, r.st.perks.join(','));

  // 選卡時整場停住
  const st = createBattle({ words: WORDS, seed: 3, difficulty: 'easy', order: 'sequential', perks: true });
  let guard = 0;
  while (!st.perkOffer && guard++ < 100000) {
    const ch = st.target[st.typed];
    if (ch) applyAction(st, { kind: 'letter', ch }); else stepBattle(st);
    clearEvents(st);
  }
  const before = { tick: st.tick, progress: st.progress, wrong: st.stats.wrongLetters, typed: st.typed };
  for (let i = 0; i < 500; i += 1) stepBattle(st);
  applyAction(st, { kind: 'letter', ch: 'z' });
  applyAction(st, { kind: 'letter', ch: st.target[0] });
  applyAction(st, { kind: 'listen', listen: 'sentence' });
  check('選卡時時間不走、蟲不動', st.tick === before.tick && st.progress === before.progress,
    `tick ${before.tick}→${st.tick}`);
  check('選卡時手上打的字母不算打錯、也不算打對',
    st.stats.wrongLetters === before.wrong && st.typed === before.typed);
  check('選卡時重聽不收（也不扣代價）', st.stats.listens === 0);
  applyAction(st, { kind: 'perk', pick: 9 });
  check('選一張不存在的卡沒有作用', !!st.perkOffer);
  applyAction(st, { kind: 'perk', pick: 1 });
  check('選了之後繼續', st.perkOffer === null && st.perks.length === 1);
}

/* ── 3. 每張卡的效果 ─────────────────────────────────────── */
console.log('\n3) 每張卡真的有效果');
/** 開一場、手動塞一張卡（效果測試不需要走三選一流程） */
function withPerk(id, words = WORDS.slice(0, 3)) {
  const st = createBattle({ words, seed: 5, difficulty: 'easy', order: 'sequential', perks: true });
  if (id) { st.perks.push(id); if (id === 'rush') st.perkSpeed = RUSH.speedFactor; }
  clearEvents(st);
  return st;
}
const firesOf = (st) => { const out = []; for (let i = 0; i < st.evCount; i += 1) out.push(st.ev[i]); return out; };
{
  // ⚡ 閃電手：打得快才有
  const fast = withPerk('lightning');
  for (const ch of fast.target) applyAction(fast, { kind: 'letter', ch });
  const fastFired = firesOf(fast).some((e) => e.type === EV.PERK_FIRED);
  const slow = withPerk('lightning');
  for (let i = 0; i < 120 * 5; i += 1) stepBattle(slow); // 發呆 5 秒
  clearEvents(slow);
  for (const ch of slow.target) applyAction(slow, { kind: 'letter', ch });
  const slowFired = firesOf(slow).some((e) => e.type === EV.PERK_FIRED);
  const plain = withPerk(null);
  for (const ch of plain.target) applyAction(plain, { kind: 'letter', ch });
  check('⚡ 閃電手：打得快，這個字的蜂蜜變多', fastFired && fast.honey > plain.honey, `${plain.honey} → ${fast.honey}`);
  check('⚡ 閃電手：發呆 5 秒才打，就沒有', !slowFired);

  // 🔥 加速挑戰：蟲更快走到蜂巢、蜂蜜 ×2
  const ticksToHive = (st) => { let n = 0; while (st.stats.wordsMissed === 0 && n < 100000) { stepBattle(st); n += 1; } return n; };
  const tRush = ticksToHive(withPerk('rush'));
  const tPlain = ticksToHive(withPerk(null));
  check('🔥 加速挑戰：蟲走到蜂巢快了約 25%', Math.abs(tPlain / tRush - RUSH.speedFactor) < 0.02, `${tPlain} → ${tRush} 步`);
  const rushH = withPerk('rush');
  applyAction(rushH, { kind: 'letter', ch: rushH.target[0] });
  check('🔥 加速挑戰：蜂蜜 ×2', rushH.honey === 2, String(rushH.honey));

  // 🎯 首字重擊：第一個字母打對，進度剩一半
  const fs = withPerk('firstStrike');
  const fsPlain = withPerk(null);
  for (let i = 0; i < 240; i += 1) { stepBattle(fs); stepBattle(fsPlain); }
  applyAction(fs, { kind: 'letter', ch: fs.target[0] });
  applyAction(fsPlain, { kind: 'letter', ch: fsPlain.target[0] });
  check('🎯 首字重擊：第一下打對，蟲退得比平常多很多', fs.progress < fsPlain.progress * 0.6,
    `${fsPlain.progress.toFixed(3)} vs ${fs.progress.toFixed(3)}`);
  applyAction(fs, { kind: 'letter', ch: fs.target[1] });
  const p2 = fs.progress;
  const fs2 = withPerk('firstStrike');
  for (let i = 0; i < 240; i += 1) stepBattle(fs2);
  applyAction(fs2, { kind: 'letter', ch: 'q' }); // 第一下打錯
  const beforeRight = fs2.progress;
  applyAction(fs2, { kind: 'letter', ch: fs2.target[0] });
  check('🎯 首字重擊：第一下打錯就沒有了', fs2.progress > beforeRight * 0.6, `${beforeRight.toFixed(3)} → ${fs2.progress.toFixed(3)}`);
  void p2;

  // ⏪ 倒帶：一次
  const rw = withPerk('rewind');
  let bounced = 0;
  for (let i = 0; i < 100000 && rw.stats.wordsMissed === 0; i += 1) {
    stepBattle(rw);
    for (const e of firesOf(rw)) if (e.type === EV.PERK_FIRED) bounced += 1;
    clearEvents(rw);
  }
  check('⏪ 倒帶：快到蜂巢時彈回去，只有一次', bounced === 1, `${bounced} 次`);
  check('⏪ 倒帶：彈回去之後還是會走到蜂巢（救一次、不是無敵）', rw.stats.wordsMissed === 1);
  void REWIND;

  // ❄️ 冰凍針：乾淨打完，下一隻凍住
  const fz = withPerk('freeze');
  for (const ch of fz.target) applyAction(fz, { kind: 'letter', ch });
  const start = fz.progress;
  for (let i = 0; i < Math.floor((FREEZE_MS / 1000) * 120) - 2; i += 1) stepBattle(fz);
  const during = fz.progress;
  for (let i = 0; i < 60; i += 1) stepBattle(fz);
  check('❄️ 冰凍針：下一隻蟲凍住 1 秒', during === start && fz.progress > during, `${start} / ${during} / ${fz.progress.toFixed(3)}`);
  const fzTypo = withPerk('freeze');
  applyAction(fzTypo, { kind: 'letter', ch: 'q' });
  for (const ch of fzTypo.target) applyAction(fzTypo, { kind: 'letter', ch });
  for (let i = 0; i < 60; i += 1) stepBattle(fzTypo);
  check('❄️ 冰凍針：有打錯的字不算', fzTypo.progress > 0);

  // 🍀 幸運草：連擊掉一半
  /*
   * 只打 4 個字：打到第 5 隻就會跳出三選一，那時候字母一律不收——
   * 第一版打 10 個字，連擊卡在 5、打錯也被吃掉，看起來像幸運草沒作用。
   */
  const cl = withPerk('clover', WORDS.slice(0, 6));
  for (let w = 0; w < 4; w += 1) for (const ch of cl.target) applyAction(cl, { kind: 'letter', ch });
  const comboBefore = cl.combo;
  applyAction(cl, { kind: 'letter', ch: 'q' });
  check('🍀 幸運草：打錯時連擊只掉一半', cl.combo === Math.floor(comboBefore / 2), `${comboBefore} → ${cl.combo}`);
  const noCl = withPerk(null, WORDS.slice(0, 6));
  for (let w = 0; w < 4; w += 1) for (const ch of noCl.target) applyAction(noCl, { kind: 'letter', ch });
  applyAction(noCl, { kind: 'letter', ch: 'q' });
  check('（對照）沒有幸運草就歸零', noCl.combo === 0);
}

/* ── 4. 三條鐵律 ────────────────────────────────────────── */
console.log('\n4) ⭐ 三條鐵律：字母數、經驗值、精熟度都不變');
{
  const base = play({ perks: false, typoAt: 3 });
  const totalLetters = WORDS.reduce((a, w) => a + w.english.length, 0);
  for (const id of PERK_IDS) {
    const r = play({ perks: true, typoAt: 3, pick: (offer) => Math.max(0, offer.indexOf(id)) });
    // 每一場至少要真的拿到這張卡，這一條才有意義
    const got = r.st.perks.includes(id);
    check(`${id}：要打的字母數沒變`, r.st.stats.correctLetters === totalLetters, `${r.st.stats.correctLetters} / ${totalLetters}`);
    check(`${id}：經驗值跟沒有能力時一模一樣`, !got || r.st.xp === base.st.xp, `${base.st.xp} vs ${r.st.xp}${got ? '' : '（沒抽到）'}`);
    check(`${id}：精熟度紀錄一樣（打錯過的字照樣算打錯）`,
      r.st.wordOutcome.join('') === base.st.wordOutcome.join(''));
  }
}

/* ── 5. 錄影檔 ──────────────────────────────────────────── */
console.log('\n5) 錄影檔');
{
  const setup = { words: WORDS, seed: 11, difficulty: 'easy', order: 'sequential', perks: true };
  const log = createRecorder({ ...setup, wordIds: WORDS.map((w) => w.id) });
  const live = createBattle(setup);
  let guard = 0;
  while (live.status === 'running' && guard++ < 400000) {
    let action = null;
    if (live.perkOffer) action = { kind: 'perk', pick: 2 };
    else if (live.target[live.typed]) action = { kind: 'letter', ch: live.target[live.typed] };
    if (action) { recordAction(log, live.tick, action); applyAction(live, action); }
    else stepBattle(live);
    clearEvents(live);
  }
  const replayed = replayLog(log, WORDS);
  check('錄影檔記得有開三選一', log.setup.perks === true);
  check('重播拿到一樣的卡', replayed.perks.join(',') === live.perks.join(','), replayed.perks.join(','));
  check('重播的指紋一模一樣', fingerprint(replayed) === fingerprint(live));

  const old = { ...log, setup: { ...log.setup } };
  delete old.setup.perks;
  old.entries = log.entries.filter((e) => e[1] !== 4);
  check('舊錄影檔（沒有這個欄位）不會跑出三選一', replayLog(old, WORDS).perks.length === 0);

  const cut = { ...log, entries: log.entries.filter((e) => e[1] !== 4) };
  const t0 = Date.now();
  const stuck = replayLog(cut, WORDS);
  check('截斷的錄影檔（有三選一、沒有選卡紀錄）不會卡死', Date.now() - t0 < 5000 && !!stuck.perkOffer,
    `${Date.now() - t0}ms`);
}

/* ── 6. 瀏覽器 ──────────────────────────────────────────── */
console.log('\n6) 瀏覽器：選卡畫面');
const store = {};
installFakeDb(createFakeDb(store, { uniqueIndexes: { gameResults: ['userId', 'opId'] } }));
const PORT = 8000 + Math.floor(Math.random() * 1000);
process.env.PORT = String(PORT);
const realLog = console.log;
const realErr = console.error;
console.log = () => {};
console.error = () => {};
require('../server/index.js');
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i += 1) {
  if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}
console.log = realLog;
console.error = realErr;
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
const bail = (err) => {
  console.log(`  [FAIL] 測試中途出錯 — ${err && err.message ? err.message.split('\n')[0] : err}`);
  console.log('\n測試中途出錯');
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);
{
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce' })
  });
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const [n, v] = cookie.split('=');
  await ctx.addCookies([{ name: n, value: v, url: BASE }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  async function typeUntilOffer(max) {
    for (let i = 0; i < max; i += 1) {
      const st = await page.evaluate(() => window.__spellbee.state());
      if (st.perkOffer || st.status !== 'running') return st;
      await page.keyboard.type(st.target, { delay: 25 });
      await page.waitForTimeout(150);
    }
    return page.evaluate(() => window.__spellbee.state());
  }

  await page.goto(`${BASE}/game?level=1&n=7&difficulty=easy&order=sequential&show=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  const st = await typeUntilOffer(6);
  check('打掉 5 隻之後出現三選一', !!st.perkOffer && st.stats.wordsKilled === 5, `殺 ${st.stats.wordsKilled}`);
  await page.waitForSelector('#perk-panel:not([hidden])', { timeout: 3000 }).catch(() => {});
  const cards = await page.$$eval('#perk-cards .perk-card', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check('畫面上有三張卡', cards.length === 3, cards.join(' | '));
  check('每張卡寫得出名字與一行規則', cards.every((t) => t.length > 6));

  const listensBefore = st.stats.listens;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const afterArrows = await page.evaluate(() => window.__spellbee.state());
  check('方向鍵只移動選擇，不會漏去觸發「唸例句」', afterArrows.stats.listens === listensBefore);
  const selected = await page.$$eval('#perk-cards .perk-card', (els) => els.findIndex((e) => e.classList.contains('is-selected')));
  check('方向鍵移動得到', selected === 2, String(selected));

  await page.keyboard.press('2');
  await page.waitForTimeout(150);
  const picked = await page.evaluate(() => window.__spellbee.state());
  check('按 2 選到第二張', picked.perks.length === 1 && picked.perks[0] === st.perkOffer[1], picked.perks.join(','));
  check('選完畫面收起來、繼續打', await page.$eval('#perk-panel', (e) => e.hidden) && !picked.perkOffer);

  /*
   * 不是戰役的一場：沒有三選一。
   * 用 ?part= 而不是 ?group=：新帳號的組別要先練兩次才解鎖，會卡在鎖住的畫面。
   */
  await page.goto(`${BASE}/game?part=1&n=7&difficulty=easy&order=sequential&show=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 });
  const g = await typeUntilOffer(6);
  check('不是戰役的一場不會出現三選一（練習完的那一場維持原樣）', !g.perksOn && !g.perkOffer, `perksOn=${g.perksOn}`);

  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await browser.close();
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
