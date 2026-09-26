// 步驟八：測試裡假造的伺服器回應，跟真的伺服器對得起來嗎（step1 的 G2／Q7）。
// 先用 mock-recorder.cjs 把假回應記下來（見 docs/audit/step8），再跑這一支：
//   node scripts/audit/mock-drift.mjs <mocks.jsonl>
// 它會起一個真的伺服器（假資料庫）、準備一個有資料的帳號，對每一個被假造的端點
// 打一次真的請求，然後比對：假回應有、真的沒有的欄位；型別不一樣的欄位；狀態碼不一樣。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(`${ROOT}/scripts/x.mjs`);
const { createFakeDb, installFakeDb } = await import(`${ROOT}/scripts/lib/fake-mongo.mjs`);
const { SHOP_ITEMS } = require(`${ROOT}/server/data/shop-items.js`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mocks = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const store = { shopItems: SHOP_ITEMS.map((i) => ({ ...i })) };
installFakeDb(createFakeDb(store, { uniqueIndexes: { attempts: ['userId', 'opId'], groupCompletions: ['userId', 'opId'], campaignProgress: ['userId'] } }));
const PORT = 9000 + Math.floor(Math.random() * 900);
process.env.PORT = String(PORT);
const rl = console.log, re = console.error; console.log = () => {}; console.error = () => {};
require(`${ROOT}/server/index.js`);
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) break; await sleep(100); }
console.log = rl; console.error = re;
process.removeAllListeners('uncaughtException'); process.removeAllListeners('unhandledRejection');

/* 一個「用過一陣子」的帳號：練過、錯過、過了幾關、買過東西、有錄音 */
const reg = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce', wordBankId: 'g3a' }) });
const cookie = reg.headers.get('set-cookie').split(';')[0];
const api = (method, path, body) => fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
const s = await (await api('POST', '/api/practice/session', { group: 'w01', order: 'sequential' })).json();
for (const [i, w] of s.words.entries()) await api('POST', '/api/practice/attempt', { opId: `a${i}`, wordId: w._id, userAnswer: i % 5 ? w.english : 'zz' });
await api('POST', '/api/practice/group-complete', { opId: 'c1', groupId: 'w01', answered: s.words.length });
const u = store.users[0];
u.coins = 3000; u.xp = 5000; u.honey = 800; u.ownedItemKeys = ['theme_space', 'accessory_sunglasses']; u.activeTheme = 'space';
store.campaignProgress = [{ userId: u._id, highestCleared: 3, stars: { 1: 3, 2: 2, 3: 1 } }];
for (const r of store.wordProgress) r.nextReviewAt = new Date(Date.now() - 1000);
store.wordAudio = [{ wordId: 'w01-lamp', gridfsFileId: 'x', mimeType: 'audio/webm' }];

/* 真的請求：GET 照假回應的網址；POST／DELETE 用合理的內容 */
async function real(m) {
  const url = new URL(m.url);
  const path = url.pathname + url.search;
  if (m.method === 'GET') return api('GET', path);
  if (/auth\/login/.test(path)) return fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce' }) });
  if (/auth\/register/.test(path)) return fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `New${Date.now() % 100000}`, wordBankId: 'g3a' }) });
  if (/auth\/logout/.test(path)) return fetch(`${BASE}${path}`, { method: 'POST' });
  if (/auth\/profiles\//.test(path)) {
    const tmp = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Sister' }) });
    const id = (await tmp.json()).user._id;
    return fetch(`${BASE}/api/auth/profiles/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmNickname: 'Sister' }) });
  }
  if (/practice\/session/.test(path)) return api('POST', path, { group: 'w01', order: 'sequential' });
  return api(m.method, path);
}

function shape(v) {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return v === null ? 'null' : typeof v;
}
/* 假回應裡有、真的沒有（或型別不一樣）的欄位 */
function diff(mockS, realS, path = '') {
  const out = [];
  if (Array.isArray(mockS)) {
    if (!Array.isArray(realS)) return [`${path || '(整個)'}：假的是陣列、真的是 ${JSON.stringify(realS).slice(0, 20)}`];
    if (mockS.length && realS.length) out.push(...diff(mockS[0], realS[0], `${path}[]`));
    return out;
  }
  if (mockS && typeof mockS === 'object') {
    if (!realS || typeof realS !== 'object' || Array.isArray(realS)) return [`${path || '(整個)'}：型別不一樣`];
    for (const k of Object.keys(mockS)) {
      if (!(k in realS)) out.push(`${path}.${k}：假回應有、真的伺服器沒有`);
      else out.push(...diff(mockS[k], realS[k], `${path}.${k}`));
    }
    return out;
  }
  if (mockS !== realS && mockS !== 'null' && realS !== 'null') out.push(`${path}：假的是 ${mockS}、真的是 ${realS}`);
  return out;
}

const seen = new Set();
const rows = [];
for (const m of mocks) {
  const u2 = new URL(m.url);
  const key = `${m.method} ${u2.pathname.replace(/\/[0-9a-z-]+\/audio$/, '/:id/audio').replace(/profiles\/[^/]+$/, 'profiles/:id')} ← ${m.test}`;
  let mockBody;
  try { mockBody = JSON.parse(m.body); } catch (e) { continue; }
  const r = await real(m);
  const realBody = await r.json().catch(() => null);
  const problems = diff(shape(mockBody), shape(realBody));
  const statusNote = (m.status >= 400) !== (r.status >= 400) ? [`狀態碼：假的 ${m.status}、真的 ${r.status}`] : [];
  const sig = key + JSON.stringify([...problems, ...statusNote]);
  if (seen.has(sig)) continue;
  seen.add(sig);
  rows.push({ key, mockStatus: m.status, realStatus: r.status, problems: [...statusNote, ...problems] });
}
for (const r of rows.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`${r.problems.length ? '⚠️' : '✅'} ${r.key}（假 ${r.mockStatus}／真 ${r.realStatus}）`);
  for (const p of r.problems) console.log(`     ${p}`);
}
process.exit(0);
