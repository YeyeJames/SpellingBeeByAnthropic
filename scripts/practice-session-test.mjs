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
  users: [
    {
      _id: USER_ID,
      nickname: '測試',
      coins: 0,
      stats: {
        currentStreak: 0,
        bestStreak: 0,
        totalWordsPracticed: 0,
        totalCorrect: 0,
        totalIncorrect: 0
      }
    }
  ],
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

/** 'stats.coins' 這種帶點的路徑要寫得進去，計分用的更新全是這種形狀。 */
function setPath(doc, path, value) {
  const parts = path.split('.');
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

function getPath(doc, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), doc);
}

function applyUpdate(doc, update) {
  for (const [path, value] of Object.entries(update.$set || {})) setPath(doc, path, value);
  for (const [path, delta] of Object.entries(update.$inc || {})) {
    setPath(doc, path, (Number(getPath(doc, path)) || 0) + delta);
  }
  return doc;
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
    /*
     * $set / $inc 要真的生效，否則計分那條路徑等於沒測到——
     * 「答對了但金幣沒加」正是這裡出錯時的症狀。
     */
    updateOne: async (query = {}, update = {}, opts = {}) => {
      const hit = rows.find((d) => matches(d, query));
      if (hit) {
        applyUpdate(hit, update);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (opts.upsert) {
        rows.push(applyUpdate({ ...query, _id: new ObjectId() }, update));
        return { matchedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0 };
    },
    /*
     * 遊戲模式加經驗用的是 findOneAndUpdate（$inc 要原子，兩場同時回報時
     * 讀-改-寫會讓其中一場的經驗憑空消失）。這個假的一開始沒有這個方法，
     * 結果整支測試以 500「findOneAndUpdate is not a function」失敗——
     * 那不是程式錯，是這個測試替身不完整。
     *
     * driver 6 的回傳是文件本身（不是 { value }），這裡照它的形狀回。
     */
    findOneAndUpdate: async (query = {}, update = {}, opts = {}) => {
      const hit = rows.find((d) => matches(d, query));
      if (!hit) {
        if (!opts.upsert) return null;
        const created = applyUpdate({ ...query, _id: new ObjectId() }, update);
        rows.push(created);
        return created;
      }
      const before = { ...hit };
      applyUpdate(hit, update);
      return opts.returnDocument === 'before' ? before : hit;
    },
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
  const r = await startSession({ group: 'w06b', order: 'sequential' });
  const words = r.body.words || [];
  check('Week 6② 是 24 個字（不是遊戲的 21）', words.length === 24, `${words.length} 個`);
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
  /*
   * 重點是「擋下來、不要開一場空的」，狀態碼本身是次要的。
   *
   * 原本這裡是 400（查不到字才擋）。兩本課本之後，組別會先對「這個帳號
   * 那一本」守門，不在裡面就 404——跟 /api/game/access、/api/words
   * 同一個情況同一個答案。前端只顯示錯誤訊息，不看狀態碼。
   */
  check('擋下來而不是開一場空的（404：不在你的單字庫裡）', r.status === 404,
    `${r.status} ${r.body.error || ''}`);
  check('沒有留下紀錄', store.practiceSessions.length === before);

  const noArg = await startSession({});
  check('什麼都不給也要擋下來', noArg.status === 400, `${noArg.status} ${noArg.body.error || ''}`);
}

/* ── 7.5 錄音清單 ───────────────────────────────────────── */
/*
 * 遊戲靠這支知道哪些字要播孩子自己錄的聲音。沒有它，遊戲就永遠用機器語音，
 * 而且不會有任何錯誤訊息——只有孩子知道「還是唸錯」。
 */
console.log('\n7) 哪些字有真人錄音');
{
  const wordsRouter = require('../server/routes/words.js');
  const app2 = express();
  app2.use(express.json());
  app2.use((req, res, next) => {
    req.session = req.get('x-test-user') ? { userId: req.get('x-test-user'), destroy: (cb) => cb() } : {};
    next();
  });
  app2.use('/api/words', wordsRouter);
  const srv2 = app2.listen(0);
  const base2 = `http://127.0.0.1:${srv2.address().port}`;

  const get = (path, auth = true) =>
    fetch(`${base2}${path}`, { headers: auth ? { 'x-test-user': USER_ID.toString() } : {} });

  const anon = await get('/api/words/recorded', false);
  check('沒登入拿不到', anon.status === 401, String(anon.status));

  const empty = await get('/api/words/recorded').then((r) => r.json());
  check('還沒有人錄音時回空陣列', Array.isArray(empty.wordIds) && empty.wordIds.length === 0);

  // 模擬孩子在練習模式錄了一個字
  store.wordAudio.push({ wordId: 'w06-loose', gridfsFileId: 'fake-file-id', mimeType: 'audio/webm' });
  // 只建了紀錄卻沒有檔案的，不算數——遊戲去抓會 404，不如一開始就別列
  store.wordAudio.push({ wordId: 'w01-path', gridfsFileId: null });

  const after = await get('/api/words/recorded').then((r) => r.json());
  check('錄過的字會出現在清單裡', after.wordIds.includes('w06-loose'), after.wordIds.join(','));
  check('沒有音檔的紀錄不列入', !after.wordIds.includes('w01-path'), after.wordIds.join(','));

  /*
   * 這一條是整件事的關鍵：孩子錄的是 w06-loose，而 Week 6 現在被切成
   * w06a / w06b。如果切組時把 id 改成 w06b-loose，這個錄音就變成孤兒，
   * 遊戲再也找不到它——而且不會有任何錯誤訊息。
   */
  const { getWordById } = require('../server/data/word-bank.js');
  const w = getWordById('w06-loose');
  check('切組之後這個 id 仍然查得到字', !!w, w ? `${w.english}（${w.group}）` : '查不到');

  srv2.close();
}

/* ── 7.8 答案判定 ───────────────────────────────────────── */
/*
 * 分隔符不算數。聽寫的時候他看不到單字，"alarm clock" 那裡到底有沒有空白
 * 不是拼字能力的問題，是用猜的。遊戲那邊已經不強制，練習這邊如果還嚴格，
 * 同一個孩子、同一個字會在遊戲裡算對、在練習裡算錯——而練習才是影響
 * 金幣與統計的那一邊。
 */
console.log('\n8) 答案判定');
{
  const { isAnswerCorrect } = await import('../public/js/shared/answer-match.js');

  const CASES = [
    ['alarm clock', 'alarm clock', true, '照打'],
    ['alarm clock', 'alarmclock', true, '沒打空白'],
    ['alarm clock', 'ALARM CLOCK', true, '大寫'],
    ['alarm clock', '  alarm clock  ', true, '前後有空白'],
    ['alarm clock', 'alarm-clock', true, '打成連字號'],
    ['high-pitched', 'highpitched', true, '沒打連字號'],
    ['high-pitched', 'high pitched', true, '連字號打成空白'],
    ['a couple of', 'acoupleof', true, '整串連在一起'],
    ['alarm clock', 'alarmclok', false, '拼錯一個字母'],
    ['alarm clock', 'alarm', false, '只打一半'],
    ['cat', '', false, '什麼都沒打'],
    ['cat', 'cats', false, '多一個字母']
  ];

  for (const [target, answer, expected, why] of CASES) {
    const got = isAnswerCorrect(answer, target);
    check(`${why}：「${answer}」→ ${expected ? '對' : '錯'}`, got === expected, `判成${got ? '對' : '錯'}`);
  }

  // 空題目不能因為什麼都沒打就被判對
  check('題目是空的一律算錯', isAnswerCorrect('', '') === false);

  /*
   * 前端與伺服器必須用同一份規則。
   * 兩邊各寫一次的話，症狀是畫面說答對了、金幣卻沒加——最難解釋的那種。
   */
  const fs = require('node:fs');
  const clientSrc = fs.readFileSync('public/js/practice.js', 'utf8');
  const serverSrc = fs.readFileSync('server/routes/practice.js', 'utf8');
  check(
    '前端用的是共用的判定規則',
    clientSrc.includes("from './shared/answer-match.js'") && clientSrc.includes('isAnswerCorrect('),
    ''
  );
  check(
    '伺服器用的是同一個檔案',
    serverSrc.includes('public/js/shared/answer-match.js') && serverSrc.includes('isAnswerCorrect('),
    ''
  );
  check(
    '兩邊都沒有自己再寫一份比對',
    !clientSrc.includes('normalizeAnswer(userAnswer) ===') &&
      !serverSrc.includes('normalizeAnswer(userAnswer) ==='),
    ''
  );
}

/* ── 8.5 真的送一次作答進去 ─────────────────────────────── */
/*
 * 上面驗的是判定規則本身。這一段走完整條路：POST /attempt → 伺服器重新判定
 * → 記作答 → 加金幣。這也是唯一能證明「伺服器真的載得到那份共用規則」的方式，
 * 路徑寫錯的話只有跑起來才會知道。
 */
console.log('\n9) 送一次作答');
{
  const attempt = (body) =>
    fetch(`${BASE}/api/practice/attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': USER_ID.toString() },
      body: JSON.stringify(body)
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

  // 沒打空白，伺服器也要判對——這正是這次要改的行為
  const a = await attempt({ opId: 'op-1', wordId: 'w04-alarm-clock', userAnswer: 'alarmclock' });
  check('伺服器判對（沒打空白）', a.status === 200 && a.body.correct === true, JSON.stringify(a.body).slice(0, 120));
  check('有給金幣', a.body.coinsAwarded > 0, String(a.body.coinsAwarded));
  check('回傳正確拼法給畫面揭曉', a.body.correctSpelling === 'alarm clock', a.body.correctSpelling);

  const user = store.users[0];
  check('金幣真的加到使用者身上', user.coins === a.body.coinsAwarded, `${user.coins}`);
  check('連勝加一', user.stats.currentStreak === 1, String(user.stats.currentStreak));

  // 同一個 opId 重送不能重複計分（背景佇列一定會重試）
  const again = await attempt({ opId: 'op-1', wordId: 'w04-alarm-clock', userAnswer: 'alarmclock' });
  check('重送同一筆不重複計分', again.body.duplicate === true && again.body.coinsAwarded === 0, JSON.stringify(again.body).slice(0, 80));
  check('金幣沒有再加', store.users[0].coins === a.body.coinsAwarded, String(store.users[0].coins));

  // 拼錯還是錯，一個字母都沒放水
  const wrong = await attempt({ opId: 'op-2', wordId: 'w04-alarm-clock', userAnswer: 'alarmclok' });
  check('拼錯判錯', wrong.body.correct === false, JSON.stringify(wrong.body).slice(0, 80));
  check('拼錯不給金幣', wrong.body.coinsAwarded === 0, String(wrong.body.coinsAwarded));
  check('連勝歸零', store.users[0].stats.currentStreak === 0, String(store.users[0].stats.currentStreak));
}

console.log('\n10) 舊的 part= 還能用');
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
