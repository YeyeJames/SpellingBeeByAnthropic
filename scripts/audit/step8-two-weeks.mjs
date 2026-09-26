// 步驟八：模擬兩個孩子各用 14 天，最後把資料庫的帳跟「自己記的帳」逐項對一遍。
// 真的 MongoDB＋真的伺服器（另一個 process）。不經過瀏覽器，直接照前端送出的格式呼叫 API——
// 瀏覽器那一段前面幾步都驗過了，這一支驗的是「用久了，帳還對不對」。
// 用法：node scripts/audit/step8-two-weeks.mjs [--days=14] [--export=/tmp/x.json]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(`${ROOT}/scripts/x.mjs`);
const { MongoClient, ObjectId } = require('mongodb');
const wordBank = require(`${ROOT}/server/data/word-bank.js`);
const { calcCoinsForCorrectAnswer } = require(`${ROOT}/server/utils/coins.js`);
const { nextBoxLevel } = require(`${ROOT}/server/utils/spacedRepetition.js`);
const { SHOP_ITEMS } = require(`${ROOT}/server/data/shop-items.js`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const DAYS = Number(args.days) || 14;

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 可重現的亂數 ──────────────────────────────────────────── */
let seed = Number(args.seed) || 20260926;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const chance = (p) => rand() < p;
const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];

/* ── 真的 MongoDB＋伺服器 ──────────────────────────────────── */
const cache = join(homedir(), '.cache', 'spellbee-mongo');
const bin = (existsSync(cache) ? readdirSync(cache) : []).map((d) => join(cache, d, 'bin', 'mongod')).find(existsSync);
if (!bin) { console.log('找不到 mongod，跳過'); process.exit(0); }
const dataDir = mkdtempSync(join(tmpdir(), 'spellbee-2w-'));
const MPORT = 28000 + Math.floor(Math.random() * 1000);
const mongod = spawn(bin, ['--dbpath', dataDir, '--port', String(MPORT), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
const URI = `mongodb://127.0.0.1:${MPORT}/spellbee_two_weeks`;
const PORT = 9000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
await sleep(1500);
const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), MONGODB_URI: URI }, stdio: 'ignore' });
process.on('exit', () => { try { server.kill('SIGKILL'); mongod.kill('SIGKILL'); } catch (e) { /* */ } try { rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* */ } });
for (let i = 0; i < 150; i += 1) {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (h && h.database === 'connected') break;
  await sleep(200);
}
const client = new MongoClient(URI);
await client.connect();
const db = client.db();

/* ── 一個孩子：API 呼叫＋自己記的帳 ───────────────────────── */
let opSeq = 0;
function makeKid(nickname, bankId, skill) {
  return {
    nickname, bankId, skill, cookie: null, id: null,
    ledger: {
      coinsEarned: 0, coinsSpent: 0, honeyEarned: 0, honeySpent: 0, xp: 0,
      answers: 0, correct: 0, streak: 0, bestStreak: 0,
      completions: {}, owned: [], gear: [], highestCleared: 0,
      words: {}, // wordId → { correct, incorrect, box }
      games: { played: 0, won: 0, byMode: {} }, plays: 0, battlesWithLogs: 0,
      duplicatesSent: 0
    }
  };
}
async function call(kid, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', cookie: kid.cookie }, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
/* 背景佇列會重送：一成的請求照原樣再送一次（同一個 opId），帳不可以變 */
async function send(kid, path, body) {
  const r = await call(kid, 'POST', path, body);
  if (chance(0.1)) {
    kid.ledger.duplicatesSent += 1;
    const again = await call(kid, 'POST', path, body);
    if (again.status >= 500) throw new Error(`重送 ${path} 回 ${again.status}`);
  }
  return r;
}
const opId = (kid, what) => `${kid.nickname}-${what}-${(opSeq += 1)}`;
function wordRow(kid, id) {
  return (kid.ledger.words[id] = kid.ledger.words[id] || { correct: 0, incorrect: 0, box: 0 });
}
function recordWord(kid, id, correct) {
  const w = wordRow(kid, id);
  if (correct) w.correct += 1; else w.incorrect += 1;
  w.box = nextBoxLevel(w.box, correct);
}

async function register(kid) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: kid.nickname, wordBankId: kid.bankId })
  });
  kid.cookie = r.headers.get('set-cookie').split(';')[0];
  kid.id = String((await r.json()).user._id);
}

async function practiceGroup(kid, groupId) {
  const s = await call(kid, 'POST', '/practice/session', { group: groupId, order: 'random' });
  if (s.status !== 201) throw new Error(`開練習 ${groupId} 回 ${s.status}`);
  const clientSessionId = opId(kid, 'session');
  for (const w of s.body.words) {
    const right = chance(kid.skill);
    const r = await send(kid, '/practice/attempt', {
      opId: opId(kid, 'att'), wordId: w._id, userAnswer: right ? w.english : `${w.english}q`, clientSessionId, attemptedAt: new Date().toISOString()
    });
    if (r.status !== 200) throw new Error(`作答回 ${r.status}`);
    kid.ledger.answers += 1;
    if (right) {
      kid.ledger.correct += 1;
      kid.ledger.streak += 1;
      kid.ledger.bestStreak = Math.max(kid.ledger.bestStreak, kid.ledger.streak);
      kid.ledger.coinsEarned += calcCoinsForCorrectAnswer(kid.ledger.streak);
    } else {
      kid.ledger.streak = 0;
    }
    recordWord(kid, w._id, right);
  }
  const c = await send(kid, '/practice/group-complete', { opId: opId(kid, 'done'), groupId, answered: s.body.words.length });
  if (c.status !== 200) throw new Error(`練完一組回 ${c.status}`);
  kid.ledger.completions[groupId] = (kid.ledger.completions[groupId] || 0) + 1;
}

/* 打一場：照前端的格式送成績。每個字：七成乾淨打完、一成五打錯但打完、一成五漏掉；偶爾顯示著單字 */
async function battle(kid, where, wordIds) {
  const words = wordIds.map((id) => wordBank.getWordById(id)).filter(Boolean);
  const outcomes = words.map((w) => ({ id: w.id, outcome: chance(0.7) ? 1 : chance(0.5) ? 2 : 3, shown: chance(0.1), len: w.english.length }));
  const missed = outcomes.filter((o) => o.outcome === 3).length;
  const won = missed < 3;
  // 輸的話後面的字沒遇到，不送（跟前端一樣）
  const met = won ? outcomes : outcomes.slice(0, Math.min(outcomes.length, outcomes.findIndex((o, i) => outcomes.slice(0, i + 1).filter((x) => x.outcome === 3).length >= 3) + 1));
  const killed = met.filter((o) => o.outcome !== 3);
  const body = {
    opId: opId(kid, 'battle'), ...where,
    words: met.map(({ id, outcome, shown }) => ({ id, outcome, shown })),
    score: killed.length * 25, accuracy: 0.9, won,
    wordsKilled: killed.length, wordsMissed: met.length - killed.length,
    correctLetters: killed.reduce((a, o) => a + o.len, 0), wrongLetters: met.filter((o) => o.outcome === 2).length,
    longKills: killed.filter((o) => o.len >= 7).length, relearns: 0
  };
  const r = await send(kid, '/game/result', body);
  if (r.status !== 200) throw new Error(`成績回 ${r.status} ${JSON.stringify(r.body)}`);
  kid.ledger.xp += r.body.xpGained;
  kid.ledger.honeyEarned += r.body.honeyGained;
  kid.ledger.games.played += 1;
  if (won) kid.ledger.games.won += 1;
  const mode = where.review ? 'review' : where.level ? 'level' : 'group';
  kid.ledger.games.byMode[mode] = (kid.ledger.games.byMode[mode] || 0) + 1;
  for (const o of met) if (!o.shown) recordWord(kid, o.id, o.outcome === 1);
  // 錄影檔：一半的場次有上傳（只驗伺服器收得下；內容用最小的合法格式）
  if (chance(0.5)) {
    const up = await call(kid, 'POST', '/telemetry/battle-log', {
      opId: body.opId, log: { setup: { wordIds: words.map((w) => w.id), seed: 1, difficulty: 'normal', order: 'random' }, entries: [] }
    });
    if (up.status === 200) kid.ledger.battlesWithLogs += 1;
  }
  return { won, body };
}

async function shopRound(kid) {
  const me = (await call(kid, 'GET', '/auth/me')).body.user;
  // 造型：買得起就買最便宜的一件沒有的
  const cosmetics = SHOP_ITEMS.filter((i) => i.active && i.type !== 'minigame' && !kid.ledger.owned.includes(i.key)).sort((a, b) => a.cost - b.cost);
  if (cosmetics.length && me.coins >= cosmetics[0].cost && chance(0.6)) {
    const item = cosmetics[0];
    const r = await send(kid, '/shop/purchase', { itemKey: item.key, opId: opId(kid, 'buy') });
    if (r.status === 200 && !r.body.duplicate) {
      kid.ledger.coinsSpent += item.cost;
      kid.ledger.owned.push(item.key);
      const equip = item.type === 'theme'
        ? { type: 'theme', itemKey: item.key.replace('theme_', '') }
        : { type: 'avatarAccessory', itemKey: item.key };
      const e = await send(kid, '/user/equip', equip);
      if (e.status !== 200) throw new Error(`穿上／套用 ${item.key} 回 ${e.status} ${JSON.stringify(e.body)}`);
    }
  }
  // 小遊戲：買一個，之後偶爾付費玩
  const mg = SHOP_ITEMS.find((i) => i.key === 'minigame_coincatch');
  if (!kid.ledger.owned.includes(mg.key) && me.coins >= mg.cost + 200 && chance(0.5)) {
    const r = await send(kid, '/shop/purchase', { itemKey: mg.key, opId: opId(kid, 'buy') });
    if (r.status === 200 && !r.body.duplicate) { kid.ledger.coinsSpent += mg.cost; kid.ledger.owned.push(mg.key); }
  } else if (kid.ledger.owned.includes(mg.key) && chance(0.6)) {
    const now = (await call(kid, 'GET', '/auth/me')).body.user.coins;
    const r = await send(kid, '/shop/play', { itemKey: mg.key, opId: opId(kid, 'play') });
    if (now >= mg.playCost) {
      if (r.status !== 200) throw new Error(`玩小遊戲回 ${r.status}`);
      kid.ledger.coinsSpent += mg.playCost;
      kid.ledger.plays += 1;
    } else if (r.status !== 400) throw new Error(`錢不夠卻沒擋：${r.status}`);
  }
  // 裝備：買得起、解鎖了就買
  const gear = (await call(kid, 'GET', '/shop/gear')).body;
  const canBuy = (gear.items || []).filter((g) => g.canBuy);
  if (canBuy.length) {
    const g = canBuy[0];
    const r = await send(kid, '/shop/gear/buy', { gearKey: g.key, opId: opId(kid, 'gear') });
    if (r.status === 200 && !r.body.duplicate) {
      kid.ledger.honeySpent += g.cost;
      kid.ledger.gear.push(g.key);
      await send(kid, '/shop/gear/equip', { slot: g.slot, gearKey: g.key });
    }
  }
}

async function events(kid) {
  const now = Date.now();
  const evs = [
    { kind: 'page_view', page: 'practice', t: now, data: {} },
    { kind: 'page_leave', page: 'practice', t: now, data: { ms: 600000 } },
    { kind: 'click', page: 'practice', t: now, data: { id: 'start-practice-btn', text: '開始' } }
  ];
  await send(kid, '/telemetry/events', { opId: opId(kid, 'ev'), events: evs });
}

/* ── 兩週 ─────────────────────────────────────────────────── */
const pierce = makeKid('Pierce', 'g3a', 0.88);
const allen = makeKid('Allen', 'allen', 0.93);
await register(pierce);
await register(allen);
const pGroups = wordBank.listGroups('g3a').map((g) => g.id);
const aGroups = wordBank.listGroups('allen').map((g) => g.id);

console.log(`模擬 ${DAYS} 天：Pierce（g3a）、Allen（allen）\n`);
for (let day = 1; day <= DAYS; day += 1) {
  // Pierce：練兩組 → 打一場組別遊戲 → 戰役往前打 2～3 關 → 隔天打一次複習關 → 逛商店
  for (let k = 0; k < 2; k += 1) await practiceGroup(pierce, pGroups[(day * 2 + k) % pGroups.length]);
  const pg = pGroups[(day * 2) % pGroups.length];
  await battle(pierce, { groupId: pg }, wordBank.wordsByGroup(pg).map((w) => w.id).slice(0, 20));
  for (let t = 0; t < 3; t += 1) {
    const n = pierce.ledger.highestCleared + 1;
    const lv = await call(pierce, 'GET', `/campaign/level/${n}`);
    if (lv.status !== 200) throw new Error(`第 ${n} 關回 ${lv.status}`);
    const ids = lv.body.limit ? lv.body.wordIds.slice(0, lv.body.limit) : lv.body.wordIds;
    const { won, body } = await battle(pierce, { level: n }, ids);
    const clear = await send(pierce, '/campaign/clear', { level: n, won, accuracy: body.accuracy, score: body.score, opId: body.opId });
    if (clear.status !== 200) throw new Error(`過關回 ${clear.status}`);
    if (won) pierce.ledger.highestCleared = Math.max(pierce.ledger.highestCleared, n);
  }
  if (day % 2 === 0) {
    const rv = await call(pierce, 'GET', '/campaign/review');
    if (rv.status === 200) await battle(pierce, { review: true }, rv.body.wordIds);
  }
  await shopRound(pierce);
  await events(pierce);

  // Allen：練一～兩個 Part → 打那個 Part 的遊戲 → 偶爾複習關 → 逛商店（他沒有戰役）
  const ag = aGroups[day % aGroups.length];
  await practiceGroup(allen, ag);
  if (chance(0.5)) await practiceGroup(allen, aGroups[(day + 1) % aGroups.length]);
  await battle(allen, { groupId: ag }, wordBank.wordsByGroup(ag).map((w) => w.id));
  if (day % 3 === 0) {
    const rv = await call(allen, 'GET', '/campaign/review');
    if (rv.status === 200) await battle(allen, { review: true }, rv.body.wordIds);
  }
  await shopRound(allen);
  await events(allen);
  if (day % 7 === 0) console.log(`  第 ${day} 天：Pierce 戰役第 ${pierce.ledger.highestCleared} 關、答了 ${pierce.ledger.answers} 題；Allen 答了 ${allen.ledger.answers} 題`);
}

/* ── 對帳 ─────────────────────────────────────────────────── */
async function audit(kid) {
  console.log(`\n${kid.nickname} 的帳（重送了 ${kid.ledger.duplicatesSent} 次）`);
  const _id = new ObjectId(kid.id);
  const u = await db.collection('users').findOne({ _id });
  const L = kid.ledger;
  check('金幣 ＝ 賺的 − 花的', u.coins === L.coinsEarned - L.coinsSpent, `資料庫 ${u.coins}、帳 ${L.coinsEarned} − ${L.coinsSpent}`);
  check('蜂蜜 ＝ 賺的 − 花的', u.honey === L.honeyEarned - L.honeySpent, `資料庫 ${u.honey}、帳 ${L.honeyEarned} − ${L.honeySpent}`);
  check('經驗 ＝ 每一場回報的經驗加起來', u.xp === L.xp, `${u.xp} / ${L.xp}`);
  check('金幣、蜂蜜都不是負的', u.coins >= 0 && u.honey >= 0);
  check('練習統計：總題數、答對、答錯', u.stats.totalWordsPracticed === L.answers && u.stats.totalCorrect === L.correct
    && u.stats.totalIncorrect === L.answers - L.correct, JSON.stringify(u.stats));
  check('連勝：目前與最高', u.stats.currentStreak === L.streak && u.stats.bestStreak === L.bestStreak, `${u.stats.currentStreak}/${u.stats.bestStreak}`);
  // 作答紀錄照順序重算一次金幣（獨立的算法，不靠伺服器回的數字）
  const atts = await db.collection('attempts').find({ userId: _id }).sort({ attemptedAt: 1, _id: 1 }).toArray();
  let st = 0; let coins = 0;
  for (const a of atts) { st = a.correct ? st + 1 : 0; if (a.correct) coins += calcCoinsForCorrectAnswer(st); }
  check('作答紀錄一題不多一題不少', atts.length === L.answers, `${atts.length} / ${L.answers}`);
  check('照作答紀錄重算的金幣 ＝ 賺的', coins === L.coinsEarned, `${coins} / ${L.coinsEarned}`);
  const gp = await db.collection('groupProgress').find({ userId: _id }).toArray();
  const gpMap = Object.fromEntries(gp.map((g) => [g.groupId, g.practiceCompletions || 0]));
  const badGroups = Object.entries(L.completions).filter(([g, n]) => gpMap[g] !== n);
  check('每一組「練完幾次」都對', badGroups.length === 0 && Object.keys(gpMap).length === Object.keys(L.completions).length, JSON.stringify(badGroups.slice(0, 3)));
  const wp = await db.collection('wordProgress').find({ userId: _id }).toArray();
  const wrong = wp.filter((r) => {
    const e = L.words[r.wordId];
    return !e || (r.timesCorrect || 0) !== e.correct || (r.timesIncorrect || 0) !== e.incorrect || r.boxLevel !== e.box;
  });
  check(`每個字的精熟度（${wp.length} 個字：答對次數、答錯次數、第幾格）`, wrong.length === 0 && wp.length === Object.keys(L.words).length,
    wrong.slice(0, 2).map((r) => `${r.wordId} ${r.timesCorrect}/${r.timesIncorrect}/${r.boxLevel} vs ${JSON.stringify(L.words[r.wordId])}`).join(' '));
  const bank = new Set(wordBank.getBank(kid.bankId).words.map((w) => w.id));
  check('精熟度紀錄都是自己那一本的字', wp.every((r) => bank.has(r.wordId)));
  check('擁有的造型 ＝ 買的', JSON.stringify([...(u.ownedItemKeys || [])].sort()) === JSON.stringify([...L.owned].sort()), JSON.stringify(u.ownedItemKeys));
  check('擁有的裝備 ＝ 買的', JSON.stringify([...(u.ownedGear || [])].sort()) === JSON.stringify([...L.gear].sort()), JSON.stringify(u.ownedGear));
  const cp = await db.collection('campaignProgress').findOne({ userId: _id });
  check('戰役進度', (cp?.highestCleared || 0) === L.highestCleared, `${cp?.highestCleared || 0} / ${L.highestCleared}`);
  const gr = await db.collection('gameResults').countDocuments({ userId: _id });
  check('遊戲成績一場不多一場不少（重送沒有多記）', gr === L.games.played, `${gr} / ${L.games.played}`);
  const mp = await db.collection('minigamePlays').countDocuments({ userId: _id });
  check('小遊戲付費紀錄', mp === L.plays, `${mp} / ${L.plays}`);
  const bl = await db.collection('battleLogs').countDocuments({ userId: _id });
  check('錄影檔', bl === L.battlesWithLogs, `${bl} / ${L.battlesWithLogs}`);
  if (u.activeTheme !== 'sports') check('買的主題真的套用了（6-A）', L.owned.includes(`theme_${u.activeTheme}`), u.activeTheme);

  const rep = await call(kid, 'GET', '/telemetry/report?days=30');
  const mine = rep.body.reports.find((r) => r.nickname === kid.nickname);
  check('家長報告：答題數、練完幾組', mine.practice.answers === L.answers
    && mine.practice.sessions === Object.values(L.completions).reduce((a, b) => a + b, 0), JSON.stringify(mine.practice));
  check('家長報告：遊戲場數、贏幾場、各模式', mine.games.played === L.games.played && mine.games.won === L.games.won
    && JSON.stringify(Object.entries(mine.games.byMode).sort()) === JSON.stringify(Object.entries(L.games.byMode).sort()), JSON.stringify(mine.games));
  check('家長報告：小遊戲次數', mine.minigames.plays === L.plays);
  return { u, L };
}
const P = await audit(pierce);
const A = await audit(allen);

console.log('\n兩週之後');
console.log(`  Pierce：戰役第 ${P.L.highestCleared} 關、答 ${P.L.answers} 題、金幣 ${P.u.coins}、蜂蜜 ${P.u.honey}、經驗 ${P.u.xp}、造型 ${P.L.owned.length} 件、裝備 ${P.L.gear.length} 件、小遊戲 ${P.L.plays} 次`);
console.log(`  Allen：答 ${A.L.answers} 題、金幣 ${A.u.coins}、蜂蜜 ${A.u.honey}、經驗 ${A.u.xp}、造型 ${A.L.owned.length} 件、裝備 ${A.L.gear.length} 件、小遊戲 ${A.L.plays} 次`);

if (args.export) {
  const r = await call(pierce, 'GET', '/telemetry/export?days=30');
  writeFileSync(args.export, JSON.stringify(r.body));
  console.log(`\n分析檔存到 ${args.export}（${Math.round(JSON.stringify(r.body).length / 1024)} KB）`);
}

await client.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
