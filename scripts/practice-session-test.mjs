/**
 * 練習流程測試——「選一組 → 按開始練習」那一步。
 *
 * 為什麼要特地寫這支：
 *   這條路徑是整個分組改動裡唯一會碰資料庫的地方，而開發這台機器沒有
 *   MongoDB（也裝不了，下載站被擋）。其他每一處我都實際跑過，只有這裡
 *   停在「程式碼看起來對」。孩子實際在用的流程是「先練習一兩次再玩遊戲」，
 *   所以這一步壞掉等於整個單字庫白做——不能靠看程式碼交差。
 *
 * 做法：用一個極簡的記憶體假資料庫頂替 server/db.js，再把真正的
 * practice 路由掛進一個乾淨的 express app。路由、模型、單字庫都是真的，
 * 只有儲存層是假的。
 *
 * 要證明的事：
 *   1. 沒登入會被擋下來
 *   2. group=w01 真的回那一組的字，而且順序照單字表
 *   3. random 會打亂，但題目一個不多一個不少
 *   4. 含空白的詞條「不會」被濾掉（練習打在輸入框裡，課本考的就是整個詞條）
 *   5. 每個字都帶著中文與例句（答完要看得到）
 *   6. 不存在的組會被擋下來，而不是開一場空的練習
 *   7. 舊的 part=1 還能用
 *   8. 真的有寫下一筆練習紀錄，而且記的是組別
 *
 * 用法：node scripts/practice-session-test.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 記憶體假資料庫 ─────────────────────────────────────────
   只實作這條路徑真的會用到的那幾個操作。多寫的部分不會被測到，
   反而會變成「看起來有測」的假象。 */
const { ObjectId } = require('mongodb');

const USER_ID = new ObjectId();
const store = {
  users: [{ _id: USER_ID, nickname: '測試', coins: 0, stats: { currentStreak: 0 } }],
  wordAudio: [],
  practiceSessions: [],
  wordProgress: []
};

function matches(doc, query) {
  return Object.entries(query).every(([k, v]) => {
    const actual = doc[k];
    if (v instanceof ObjectId) return actual && actual.toString() === v.toString();
    return actual === v;
  });
}

function fakeCollection(name) {
  const rows = store[name] || (store[name] = []);
  return {
    find: (query = {}) => ({ toArray: async () => rows.filter((d) => matches(d, query)) }),
    findOne: async (query = {}) => rows.find((d) => matches(d, query)) || null,
    insertOne: async (doc) => {
      const _id = new ObjectId();
      rows.push({ ...doc, _id });
      return { insertedId: _id };
    },
    updateOne: async () => ({ matchedCount: 0 }),
    deleteOne: async () => ({ deletedCount: 0 }),
    createIndex: async () => 'ok'
  };
}

const fakeDb = { collection: fakeCollection };

// 必須在載入任何模型「之前」頂替掉：模型是在載入時就把 getDB 解構走的
const dbPath = require.resolve('../server/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    connectDB: async () => fakeDb,
    getDB: () => fakeDb,
    getAudioBucket: () => {
      throw new Error('這支測試不碰錄音');
    }
  }
};

const express = require('express');
const practiceRouter = require('../server/routes/practice.js');

/* ── 把路由掛起來 ─────────────────────────────────────────── */
const app = express();
app.use(express.json());
// 假的 session：帶 x-test-user 標頭就算登入，沒帶就算沒登入
app.use((req, res, next) => {
  req.session = req.get('x-test-user') ? { userId: req.get('x-test-user'), destroy: (cb) => cb() } : {};
  next();
});
app.use('/api/practice', practiceRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

async function startSession(body, { auth = true } = {}) {
  const res = await fetch(`${BASE}/api/practice/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { 'x-test-user': USER_ID.toString() } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

/* ── 1. 沒登入 ──────────────────────────────────────────── */
console.log('1) 沒登入');
{
  const r = await startSession({ group: 'w01' }, { auth: false });
  check('被擋下來', r.status === 401, `${r.status} ${r.body.error || ''}`);
  check('沒有留下練習紀錄', store.practiceSessions.length === 0);
}

/* ── 2~5. 選一組開始練習 ────────────────────────────────── */
console.log('\n2) group=w01 照順序');
{
  const r = await startSession({ group: 'w01', order: 'sequential' });
  check('開得起來', r.status === 201, `${r.status} ${r.body.error || ''}`);

  const words = r.body.words || [];
  check('拿到 Week 1 的 40 個字', words.length === 40, `${words.length} 個`);
  check('全部都是 w01', words.every((w) => w.group === 'w01'), [...new Set(words.map((w) => w.group))].join(','));
  check('順序照單字表', words[0].english === 'path', words.slice(0, 3).map((w) => w.english).join(','));
  check(
    '每個字都有中文與例句（答完要看得到）',
    words.every((w) => w.chinese && w.exampleSentence),
    words.find((w) => !w.chinese || !w.exampleSentence)?.id || ''
  );
  check(
    '前端沿用的 _id 有帶上',
    words.every((w) => w._id === w.id),
    words.find((w) => w._id !== w.id)?.id || ''
  );

  console.log('\n3) 有寫下練習紀錄');
  check('多了一筆', store.practiceSessions.length === 1, `${store.practiceSessions.length} 筆`);
  const rec = store.practiceSessions[0];
  check('記的是組別而不是 part', rec.partLabel === 'w01', String(rec.partLabel));
  check('記下了這次要練哪些字', rec.wordIds.length === 40, `${rec.wordIds.length} 個`);
  check('記的是這個使用者', rec.userId.toString() === USER_ID.toString());
}

/* ── 4. 練習不濾掉含空白的詞條 ──────────────────────────── */
console.log('\n4) 練習模式保留含空白的詞條');
{
  const r = await startSession({ group: 'w06', order: 'sequential' });
  const words = r.body.words || [];
  check('Week 6 是 49 個字（不是遊戲的 46）', words.length === 49, `${words.length} 個`);
  const spaced = words.filter((w) => /[^a-z]/.test(w.english)).map((w) => w.english);
  check('含空白的詞條都在', spaced.length === 3, spaced.join('、'));
}

/* ── 5. 打亂 ────────────────────────────────────────────── */
console.log('\n5) 隨機出題');
{
  const a = await startSession({ group: 'w01', order: 'sequential' });
  const b = await startSession({ group: 'w01', order: 'random' });
  const seq = a.body.words.map((w) => w.id);
  const rnd = b.body.words.map((w) => w.id);
  check('順序真的不一樣', seq.join(',') !== rnd.join(','), rnd.slice(0, 4).join(','));
  check(
    '題目一個不多一個不少',
    [...rnd].sort().join(',') === [...seq].sort().join(','),
    `${rnd.length} 個`
  );
}

/* ── 6~7. 邊界 ──────────────────────────────────────────── */
console.log('\n6) 不存在的組要擋下來');
{
  const before = store.practiceSessions.length;
  const r = await startSession({ group: 'w99' });
  check('回 400 而不是開一場空的', r.status === 400, `${r.status} ${r.body.error || ''}`);
  check('沒有留下紀錄', store.practiceSessions.length === before);

  const noArg = await startSession({});
  check('什麼都不給也要擋下來', noArg.status === 400, `${noArg.status} ${noArg.body.error || ''}`);
}

console.log('\n7) 舊的 part= 還能用');
{
  const r = await startSession({ part: 1, order: 'sequential' });
  check('開得起來', r.status === 201, `${r.status} ${r.body.error || ''}`);
  check('是 Part 1 的 25 個字', (r.body.words || []).length === 25, `${r.body.words?.length} 個`);
  check(
    '紀錄標成 part1',
    store.practiceSessions[store.practiceSessions.length - 1].partLabel === 'part1',
    store.practiceSessions[store.practiceSessions.length - 1].partLabel
  );
}

server.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
