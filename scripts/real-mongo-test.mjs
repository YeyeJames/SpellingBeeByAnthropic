/**
 * 在「真的 MongoDB」上驗證假資料庫驗不到的事（docs/audit 步驟三，G1／Q6）。
 *
 * 其他測試都用 scripts/lib/fake-mongo.mjs：它一次只處理一個請求，
 * 查詢語法也只模仿了用到的部分。這一支改接真的 mongod，專門驗：
 *   1. 啟動時建索引（部分唯一索引、TTL）在真的資料庫上不會出錯，而且真的建了
 *   2. ⭐ 同時發生的請求：同時買兩件、同時買同一件裝備、小遊戲連點、
 *      同一筆作答同時重送、同一場成績同時重送
 *   3. 戰役過關的 upsert（查詢條件與 $setOnInsert 有同一個欄位）在真的資料庫上可以用
 *   4. 經驗與蜂蜜的 findOneAndUpdate 回傳值（driver v6 的格式）
 *   5. session 存在資料庫：伺服器重開之後還是登入的
 *   6. 刪帳號把每一個 collection 裡的資料都刪乾淨
 *
 * 用法：node scripts/real-mongo-test.mjs
 *   - 有 REAL_MONGO_URI 就用它（要是可以整個丟掉的測試資料庫）
 *   - 沒有就自己起一個 mongod（MONGOD_BIN，或 ~/.cache/spellbee-mongo 底下的）
 *   - 兩者都沒有就跳過（不算失敗）：這個環境裝不了 MongoDB 時，其他測試照跑
 * 不在 test:all 裡：要有 mongod 才跑得了。
 */

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { MongoClient, ObjectId } = require('mongodb');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 找一個真的 MongoDB ──────────────────────────────────── */
function findMongod() {
  if (process.env.MONGOD_BIN && existsSync(process.env.MONGOD_BIN)) return process.env.MONGOD_BIN;
  const cache = join(homedir(), '.cache', 'spellbee-mongo');
  if (!existsSync(cache)) return null;
  for (const d of readdirSync(cache)) {
    const bin = join(cache, d, 'bin', 'mongod');
    if (existsSync(bin)) return bin;
  }
  return null;
}

let mongod = null;
let dataDir = null;
let uri = process.env.REAL_MONGO_URI;
if (!uri) {
  const bin = findMongod();
  if (!bin) {
    console.log('找不到 mongod（也沒有 REAL_MONGO_URI），跳過。');
    process.exit(0);
  }
  dataDir = mkdtempSync(join(tmpdir(), 'spellbee-mongo-'));
  const port = 28000 + Math.floor(Math.random() * 1000);
  mongod = spawn(bin, ['--dbpath', dataDir, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
  uri = `mongodb://127.0.0.1:${port}/spellbee_realdb_test`;
}
const cleanup = () => {
  try { mongod?.kill('SIGTERM'); } catch (e) { /* 已經結束 */ }
  if (dataDir) setTimeout(() => { try { rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ } }, 300);
};
process.on('exit', cleanup);

const probe = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
for (let i = 0; i < 50; i += 1) {
  try { await probe.connect(); break; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
}
const db = probe.db();
await db.dropDatabase(); // 一定是一個乾淨的資料庫
const version = (await db.command({ buildInfo: 1 })).version;
console.log(`真的 MongoDB ${version}\n`);

/* ── 起伺服器（跟正式環境同一支 server/index.js，只是連到這個資料庫） ── */
const PORT = 9000 + Math.floor(Math.random() * 900);
process.env.PORT = String(PORT);
process.env.MONGODB_URI = uri;
const realLog = console.log;
const realErr = console.error;
console.log = () => {};
console.error = () => {};
require('../server/index.js');
const BASE = `http://127.0.0.1:${PORT}`;
let health = null;
for (let i = 0; i < 100; i += 1) {
  health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (health && health.database === 'connected' && health.sessionStorage === 'mongodb') break;
  await new Promise((r) => setTimeout(r, 150));
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

async function register(nickname, wordBankId) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, wordBankId })
  });
  const body = await r.json();
  return { cookie: r.headers.get('set-cookie').split(';')[0], id: String(body.user._id), _id: new ObjectId(body.user._id) };
}
async function api(cookie, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const user = (u) => db.collection('users').findOne({ _id: u._id });
const setUser = (u, fields) => db.collection('users').updateOne({ _id: u._id }, { $set: fields });

/* ── 1. 啟動 ──────────────────────────────────────────── */
console.log('1) 啟動：連線、索引、session');
check('伺服器連上真的資料庫', health?.database === 'connected', JSON.stringify(health?.databaseError || health?.database));
check('session 存在資料庫（不是記憶體）', health?.sessionStorage === 'mongodb', health?.sessionStorage);
check('商店品項自動寫進去了', health?.shopItemCount > 0, String(health?.shopItemCount));
const idx = async (name) => (await db.collection(name).indexes().catch(() => []));
const hasUniqueOpId = async (name) => (await idx(name)).some((i) =>
  i.unique && i.key.userId === 1 && i.key.opId === 1 && i.partialFilterExpression?.opId?.$type === 'string');
for (const name of ['attempts', 'purchases', 'minigamePlays', 'groupCompletions', 'gameResults', 'battleLogs', 'eventBatches']) {
  check(`${name}：opId 去重的唯一索引`, await hasUniqueOpId(name));
}
for (const name of ['events', 'battleLogs', 'eventBatches']) {
  const ttl = (await idx(name)).find((i) => i.key.at === 1 && typeof i.expireAfterSeconds === 'number');
  check(`${name}：90 天自動刪除（TTL）`, ttl?.expireAfterSeconds === 90 * 24 * 60 * 60, String(ttl?.expireAfterSeconds));
}
check('暱稱不分大小寫唯一', (await idx('users')).some((i) => i.unique && i.key.nicknameLower === 1));
check('戰役進度一人一列', (await idx('campaignProgress')).some((i) => i.unique && i.key.userId === 1));

const pierce = await register('Pierce', 'g3a');
const allen = await register('Allen', 'allen');
check('（前提）建得了帳號', !!pierce.id && !!allen.id);
check('同一個暱稱不同大小寫會被擋', (await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'pierce' })
})).status === 409);

/* ── 2. 同時發生 ──────────────────────────────────────── */
console.log('\n2) ⭐ 同時發生的請求');
{
  // 2a 同時買兩件、錢只夠一件（這一條假資料庫測不出舊版的錯）
  await setUser(pierce, { coins: 1000, ownedItemKeys: [] });
  const rs = await Promise.all([
    api(pierce.cookie, 'POST', '/shop/purchase', { itemKey: 'accessory_sunglasses', opId: 'p-a' }),
    api(pierce.cookie, 'POST', '/shop/purchase', { itemKey: 'accessory_cape', opId: 'p-b' })
  ]);
  const u = await user(pierce);
  check('同時買兩件：只買到一件', u.ownedItemKeys.length === 1, JSON.stringify(u.ownedItemKeys));
  check('同時買兩件：金幣沒有變負的', u.coins >= 0, String(u.coins));
  check('同時買兩件：錢對得起來（1000 − 買到的那一件）',
    u.coins === 1000 - (u.ownedItemKeys[0] === 'accessory_sunglasses' ? 600 : 900), String(u.coins));
  check('同時買兩件：購買紀錄只有一筆', (await db.collection('purchases').countDocuments({ userId: pierce._id })) === 1,
    rs.map((r) => r.status).join(','));

  // 2b 同一件東西、同一個 opId 同時送兩次（背景佇列重送撞上原本那一次）
  await setUser(pierce, { coins: 5000, ownedItemKeys: [] });
  await db.collection('purchases').deleteMany({ userId: pierce._id });
  await Promise.all([1, 2, 3].map(() => api(pierce.cookie, 'POST', '/shop/purchase', { itemKey: 'theme_space', opId: 'same-op' })));
  const u2 = await user(pierce);
  check('同一筆購買同時送三次：只扣一次錢', u2.coins === 3000, String(u2.coins));

  // 2c 裝備：同一件同時買三次
  await setUser(pierce, { honey: 100000, xp: 10_000_000, ownedGear: [] });
  const gearList = (await api(pierce.cookie, 'GET', '/shop/gear')).body.items || [];
  const gear = gearList.find((g) => g.tier === 2);
  await Promise.all([1, 2, 3].map((i) => api(pierce.cookie, 'POST', '/shop/gear/buy', { gearKey: gear.key, opId: `g-${i}` })));
  const u3 = await user(pierce);
  check('同一件裝備同時買三次（不同 opId）：只扣一次蜂蜜', u3.honey === 100000 - gear.cost, `${u3.honey}（價格 ${gear.cost}）`);
  check('同一件裝備：擁有清單裡只有一件', u3.ownedGear.filter((k) => k === gear.key).length === 1);

  // 2d 小遊戲連點：同一個 opId 同時送三次
  await setUser(pierce, { coins: 1000, ownedItemKeys: ['minigame_coincatch'] });
  await Promise.all([1, 2, 3].map(() => api(pierce.cookie, 'POST', '/shop/play', { itemKey: 'minigame_coincatch', opId: 'play-1' })));
  const u4 = await user(pierce);
  check('小遊戲連點三下：只付一次', u4.coins === 850, String(u4.coins));
  // 2e 小遊戲：錢只夠一次、同時按兩次（不同 opId）
  await setUser(pierce, { coins: 200 });
  const plays = await Promise.all(['play-2', 'play-3'].map((opId) => api(pierce.cookie, 'POST', '/shop/play', { itemKey: 'minigame_coincatch', opId })));
  const u5 = await user(pierce);
  check('小遊戲錢只夠一次、同時按兩次：只玩得到一次，金幣不會變負的',
    u5.coins === 50 && plays.filter((p) => p.status === 200).length === 1, `${u5.coins} ${plays.map((p) => p.status)}`);
  check('付不起的那一次，付費紀錄撤掉了', (await db.collection('minigamePlays').countDocuments({ userId: pierce._id })) === 2);

  // 2f 同一筆作答同時重送三次
  await setUser(pierce, { coins: 0, 'stats.currentStreak': 0 });
  const before = (await user(pierce)).stats.totalWordsPracticed;
  const att = { opId: 'att-1', wordId: 'p1-account', userAnswer: 'account' };
  await Promise.all([1, 2, 3].map(() => api(pierce.cookie, 'POST', '/practice/attempt', att)));
  const u6 = await user(pierce);
  check('同一筆作答同時送三次：只算一題', u6.stats.totalWordsPracticed === before + 1, `${before} → ${u6.stats.totalWordsPracticed}`);
  check('同一筆作答同時送三次：金幣只加一次', u6.coins > 0 && u6.coins <= 30, String(u6.coins));
  check('作答紀錄只有一筆', (await db.collection('attempts').countDocuments({ userId: pierce._id, opId: 'att-1' })) === 1);

  // 2g 同一場成績同時重送三次
  const xp0 = (await user(pierce)).xp || 0;
  await db.collection('groupProgress').updateOne({ userId: pierce._id, groupId: 'p1' },
    { $set: { practiceCompletions: 1, unlocked: true } }, { upsert: true });
  const result = {
    opId: 'battle-1', groupId: 'p1', words: [{ id: 'p1-account', outcome: 1, shown: false }],
    score: 100, accuracy: 1, won: true, wordsKilled: 1, wordsMissed: 0, correctLetters: 7, wrongLetters: 0, longKills: 0, relearns: 0
  };
  const rr = await Promise.all([1, 2, 3].map(() => api(pierce.cookie, 'POST', '/game/result', result)));
  const u7 = await user(pierce);
  const gained = rr.find((r) => typeof r.body.xpGained === 'number' && !r.body.duplicate)?.body.xpGained;
  check('同一場成績同時送三次：經驗只加一次', gained > 0 && u7.xp === xp0 + gained, `${xp0} → ${u7.xp}（這一場 ${gained}）`);
  check('成績紀錄只有一筆', (await db.collection('gameResults').countDocuments({ userId: pierce._id, opId: 'battle-1' })) === 1);
}

/* ── 3. 戰役過關的 upsert ─────────────────────────────── */
console.log('\n3) 戰役過關（第一次過關會新建一列）');
{
  const r = await api(allen.cookie, 'POST', '/campaign/clear', { level: 1, won: true, accuracy: 1 });
  // Allen 的課本沒有週單字、沒有關卡：應該是 404，不是 500
  check('Allen（沒有關卡）過關回 404，不是伺服器錯誤', r.status === 404, String(r.status));
  const p = await api(pierce.cookie, 'POST', '/campaign/clear', { level: 1, won: true, accuracy: 0.95 });
  check('Pierce 第 1 關過關成功', p.status === 200 && p.body.highestCleared === 1, `${p.status} ${JSON.stringify(p.body)}`);
  const row = await db.collection('campaignProgress').findOne({ userId: pierce._id });
  check('資料庫裡新建了一列，userId 是對的', !!row && String(row.userId) === pierce.id && row.highestCleared === 1);
  check('星等存進去了（正確率 95% → 2 顆）', row?.stars?.['1'] === 2, JSON.stringify(row?.stars));
  const again = await api(pierce.cookie, 'POST', '/campaign/clear', { level: 2, won: true, accuracy: 1 });
  const rows = await db.collection('campaignProgress').countDocuments({ userId: pierce._id });
  check('第二次過關更新同一列，不會多一列', again.status === 200 && rows === 1 && again.body.highestCleared === 2, `${rows} 列`);
  const both = await Promise.all([3, 3].map((level) => api(pierce.cookie, 'POST', '/campaign/clear', { level, won: true, accuracy: 1 })));
  check('同一關同時過關兩次：沒有出錯、還是一列', both.every((b) => b.status === 200)
    && (await db.collection('campaignProgress').countDocuments({ userId: pierce._id })) === 1);
}

/* ── 4. 經驗、蜂蜜的回傳值 ───────────────────────────── */
console.log('\n4) 經驗與蜂蜜：回傳給畫面的數字等於資料庫裡的數字');
{
  const result = {
    opId: 'battle-2', groupId: 'p1', words: [{ id: 'p1-addition', outcome: 1, shown: false }],
    score: 120, accuracy: 1, won: true, wordsKilled: 1, wordsMissed: 0, correctLetters: 8, wrongLetters: 0, longKills: 0, relearns: 0
  };
  const r = await api(pierce.cookie, 'POST', '/game/result', result);
  const u = await user(pierce);
  check('回傳的經驗 = 資料庫裡的經驗', r.body.xp === u.xp, `${r.body.xp} / ${u.xp}`);
  check('回傳的蜂蜜 = 資料庫裡的蜂蜜', r.body.honey === u.honey, `${r.body.honey} / ${u.honey}`);
  const fresh = await register('Fresh', 'g3a');
  await db.collection('groupProgress').updateOne({ userId: fresh._id, groupId: 'p1' },
    { $set: { practiceCompletions: 1, unlocked: true } }, { upsert: true });
  const f = await api(fresh.cookie, 'POST', '/game/result', { ...result, opId: 'fresh-1' });
  const fu = await user(fresh);
  check('全新帳號第一場：經驗與蜂蜜從 0 開始算對', f.body.xp === fu.xp && fu.xp === f.body.xpGained && fu.honey === 120,
    `xp ${f.body.xp}/${fu.xp} honey ${fu.honey}`);
}

/* ── 5. session 存在資料庫 ────────────────────────────── */
console.log('\n5) 登入存在資料庫');
{
  const rows = await db.collection('sessions').countDocuments();
  check('登入紀錄寫進了 sessions', rows >= 2, `${rows} 筆`);
  const me = await api(pierce.cookie, 'GET', '/auth/me');
  check('用 cookie 認得出是誰', me.status === 200 && me.body.user?.nickname === 'Pierce');
  // 模擬伺服器重開：記憶體裡什麼都沒有，只剩資料庫。直接在資料庫裡找得到這個 session 就代表重開後還在
  const sid = decodeURIComponent(pierce.cookie.split('=')[1]).replace(/^s:/, '').split('.')[0];
  const row = await db.collection('sessions').findOne({ _id: sid });
  check('這個登入在資料庫裡（伺服器重開不會被登出）', !!row && /Pierce|userId/.test(String(row.session)));
  const exp = row && new Date(row.expires).getTime();
  check('資料庫裡的期限大約是 30 天後', exp && Math.abs(exp - Date.now() - 30 * 24 * 3600 * 1000) < 5 * 60 * 1000);
}

/* ── 6. 刪帳號 ────────────────────────────────────────── */
console.log('\n6) 刪帳號：每一個 collection 都刪乾淨');
{
  const { OWNED_COLLECTIONS } = require('../server/models/User.js');
  // 每一個 collection 都放一筆 Allen 的資料，再加一筆 Pierce 的當對照組
  for (const name of OWNED_COLLECTIONS) {
    await db.collection(name).insertOne({ userId: allen._id, opId: `del-${name}`, at: new Date() });
  }
  await db.collection('wordAudio').updateOne({ wordId: 'a-p1-acquaint' }, { $set: { wordId: 'a-p1-acquaint', gridfsFileId: null } }, { upsert: true });
  const r = await api(allen.cookie, 'DELETE', `/auth/profiles/${allen.id}`, { confirmNickname: 'Allen' });
  check('刪得掉', r.status === 200, String(r.status));
  const left = [];
  for (const name of OWNED_COLLECTIONS) {
    const n = await db.collection(name).countDocuments({ userId: allen._id });
    if (n) left.push(`${name}:${n}`);
  }
  check('Allen 的資料一筆不剩', left.length === 0, left.join(' '));
  check('帳號本身也刪了', !(await db.collection('users').findOne({ _id: allen._id })));
  check('Pierce 的資料沒有被波及', (await db.collection('attempts').countDocuments({ userId: pierce._id })) >= 1);
  check('錄音沒有跟著被刪', (await db.collection('wordAudio').countDocuments({ wordId: 'a-p1-acquaint' })) === 1);
  // 用資料庫裡實際存在的 collection 反查：有沒有哪一個帶 userId 的 collection 不在刪除清單上
  const all = (await db.listCollections().toArray()).map((c) => c.name);
  const withUser = [];
  for (const name of all) {
    if (['users', 'sessions'].includes(name) || name.startsWith('audio.')) continue;
    if (await db.collection(name).findOne({ userId: { $exists: true } })) withUser.push(name);
  }
  const missing = withUser.filter((n) => !OWNED_COLLECTIONS.includes(n));
  check('資料庫裡每一個存了 userId 的 collection 都在刪除清單上', missing.length === 0, missing.join(' ') || withUser.join(' '));
}

await db.dropDatabase();
await probe.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
