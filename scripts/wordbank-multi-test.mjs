/**
 * 兩個孩子，兩本單字庫。
 *
 * Pierce 用的是 Grade 3A（已經在用了），Allen 另外一本，結構一樣內容不同。
 *
 * ── 這一支最重要的兩條 ────────────────────────────────────
 * 1. **Pierce 既有的 id 一個都不能變。** 他的練習進度與真人錄音都是用
 *    現在這些 id 存的（`w01-path`、`p1-account`）。改了會全部變成孤兒，
 *    而且不會有任何錯誤訊息——他只會發現「怎麼又變回機器音了」。
 *
 * 2. **兩本課本的 id 不可以撞。** 錄音是跨帳號共用的（wordAudio 只用
 *    wordId 當鍵，這是刻意的設計），兩邊都有 `w01-path` 的話，
 *    Pierce 錄的聲音會被播到 Allen 那個完全不同的字上面。
 *
 * 其他：
 *   3. 每個帳號只看得到自己那一本的組
 *   4. 拿別人課本的組 id 進來要被擋掉
 *   5. 戰役是各自的（關卡表從各自的組別算出來）
 *   6. 還沒有單字的課本要看得出來，而不是當成壞掉
 *
 * 用法：node scripts/wordbank-multi-test.mjs
 */

import { createRequire } from 'node:module';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const wordBank = require('../server/data/word-bank.js');
const { buildBank } = require('../server/data/build-bank.js');

/* ── 1. ⭐ Pierce 既有的 id 一個都不能變 ─────────────────── */
console.log('1) ⭐ 既有的 id 不能變（進度與錄音都靠它）');
{
  /*
   * 這幾個 id 是從**重構前的實際資料**抓出來的，不是憑印象寫的
   * （第一版就憑印象把 w06-loose 寫成 w06a，實際上它在 w06b）。
   * 每一種形狀各一個：競賽字、一般週字、被切成兩半的週字（id 用週次
   * 而不是切開後的組）、含空白的詞條。
   */
  const mustExist = [
    ['p1-account', 'account', 'p1'],
    ['w01-path', 'path', 'w01'],
    ['w06-loose', 'loose', 'w06b'],
    ['w11-amazing', 'amazing', 'w11b'],
    ['w04-alarm-clock', 'alarm clock', 'w04']
  ];
  const wrong = [];
  for (const [id, english, group] of mustExist) {
    const w = wordBank.getWordById(id);
    if (!w) wrong.push(`${id} 不見了`);
    else if (w.english !== english) wrong.push(`${id} 變成 ${w.english}`);
    else if (w.group !== group) wrong.push(`${id} 的組變成 ${w.group}`);
  }
  check('抽樣的 id 都還在，而且指向同一個字', wrong.length === 0, wrong.join('; '));

  const g3a = wordBank.getBank('g3a');
  check('Grade 3A 仍然是 749 字', g3a.words.length === 749, String(g3a.words.length));
  check('仍然是 28 組', g3a.groups.length === 28, String(g3a.groups.length));
  check('Pierce 那一本的 idPrefix 是空字串（不可以改）', g3a.idPrefix === '',
    JSON.stringify(g3a.idPrefix));
  check('它是預設那一本（舊帳號沒有欄位時會拿到它）',
    wordBank.DEFAULT_BANK_ID === 'g3a', wordBank.DEFAULT_BANK_ID);

  // 切開之前的舊組 id 仍然對得到（瀏覽器歷史、既有連結）
  check('舊的組 id w06 仍然查得到字', wordBank.wordsByGroup('w06').length > 0,
    `${wordBank.wordsByGroup('w06').length} 字`);
}

/* ── 2. ⭐ 兩本課本的 id 不可以撞 ────────────────────────── */
console.log('2) ⭐ 兩本課本的 id 不能撞（錄音是跨帳號共用的）');
{
  /*
   * Allen 那一本現在還沒有單字，所以拿一份假資料組一本出來測——
   * 等真的單字進來才測就太晚了，那時候撞號已經發生在正式資料庫裡。
   */
  /*
   * 用一個**沒有人用過**的前綴組一本假的出來（不是 'a'——那是 Allen 真的在用的，
   * 撞到的話測出來的「重複」是測試自己造成的，不是程式的問題）。
   */
  const fake = buildBank({
    id: 'zz-test',
    label: '測試用課本',
    owner: '測試',
    idPrefix: 'zz',
    contestWords: [
      { id: 'p1-account', part: 1, english: 'account', chinese: '帳戶', exampleSentence: 'x' }
    ],
    weeks: [{ id: 'w01', label: 'Week 1', words: [['path', '小路', 'A path.']] }]
  });

  const allenIds = fake.words.map((w) => w.id);
  check('新課本的 id 有自己的命名空間',
    allenIds.every((id) => id.startsWith('zz-')), allenIds.join(', '));
  check('故意取跟 Pierce 一樣的英文字，id 仍然不同',
    !allenIds.includes('w01-path') && allenIds.includes('zz-w01-path'), allenIds.join(', '));
  check('組 id 也分開了',
    fake.groups.every((g) => g.id.startsWith('zz-')), fake.groups.map((g) => g.id).join(', '));

  /*
   * 全庫掃一次：任何兩個字的 id 都不可以一樣。
   * 這一條是上面那兩條的總結，也是唯一擋得住「以後又加一本忘了給前綴」的檢查。
   */
  const all = [...wordBank.allWords().map((w) => w.id), ...allenIds];
  const dup = all.filter((id, i) => all.indexOf(id) !== i);
  check('所有課本加起來，沒有任何重複的 id', dup.length === 0, dup.join(', '));

  const allGroups = [...wordBank.GROUPS.map((g) => g.id), ...fake.groups.map((g) => g.id)];
  const dupG = allGroups.filter((id, i) => allGroups.indexOf(id) !== i);
  check('組 id 也沒有重複', dupG.length === 0, dupG.join(', '));
}

/* ── 3. 課本目錄 ─────────────────────────────────────────── */
console.log('3) 課本目錄');
{
  const banks = wordBank.listBanks();
  check('列得出兩本', banks.length === 2, JSON.stringify(banks.map((b) => b.id)));
  const allen = banks.find((b) => b.id === 'allen');
  check('Allen 那一本有字了（Part 1~4 共 75 字）',
    allen && allen.ready === true && allen.wordCount === 75,
    `${allen?.wordCount} 字`);
  check('Pierce 那一本是好的', banks.find((b) => b.id === 'g3a')?.ready === true);
  /*
   * 空課本仍然要能被表示出來——第二本課本一定會有一段「帳號建好了但
   * 單字還沒進去」的時間，那時候 ready 必須是 false 而不是爆掉。
   */
  const empty = buildBank({ id: 'empty', label: '空的', idPrefix: 'q', contestWords: [], weeks: [] });
  check('完全沒有單字的課本標成「還沒好」', empty.ready === false && empty.words.length === 0);
  check('認不得的課本 id 退回預設，不會炸',
    wordBank.resolveBankId('沒這本') === 'g3a', wordBank.resolveBankId('沒這本'));
  check('沒給也退回預設', wordBank.resolveBankId(undefined) === 'g3a');
}

/* ── 4~6. 伺服器：每個帳號只看得到自己那一本 ─────────────── */
console.log('4) 每個帳號只看得到自己那一本');
{
  const store = {
    users: [], campaignProgress: [], purchases: [], gameResults: [],
    groupProgress: [], groupCompletions: [], wordProgress: [], attempts: [],
    practiceSessions: [], wordAudio: []
  };
  const fake = createFakeDb(store, { uniqueIndexes: { campaignProgress: ['userId'] } });
  installFakeDb(fake);

  const express = require('express');
  const User = require('../server/models/User.js');

  const pierce = await User.createUser('Pierce', 'g3a');
  const allen = await User.createUser('Allen', 'allen');
  check('帳號記著用哪一本', pierce.wordBankId === 'g3a' && allen.wordBankId === 'allen',
    `${pierce.wordBankId} / ${allen.wordBankId}`);

  function appFor(user) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = { userId: String(user._id), destroy: (cb) => cb && cb() };
      next();
    });
    app.use('/api/practice', require('../server/routes/practice.js'));
    app.use('/api/game', require('../server/routes/game.js'));
    app.use('/api/campaign', require('../server/routes/campaign.js'));
    return app;
  }
  const call = async (app, method, path, body) => {
    const s = app.listen(0);
    const port = s.address().port;
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    } finally {
      s.close();
    }
  };

  const pApp = appFor(pierce);
  const aApp = appFor(allen);

  const pGroups = await call(pApp, 'GET', '/api/practice/progress');
  check('Pierce 看得到 28 組', pGroups.body?.groups?.length === 28,
    String(pGroups.body?.groups?.length));
  const aGroups = await call(aApp, 'GET', '/api/practice/progress');
  /*
   * Allen 現在有 4 個 Part（75 字），每週單字還在等。
   * 他看到的組數要剛好是自己那一本的，不是 Pierce 的 28 組。
   */
  const allenGroups = wordBank.listGroups('allen');
  check(`Allen 看到自己那一本的 ${allenGroups.length} 組`,
    aGroups.body?.groups?.length === allenGroups.length,
    `${aGroups.body?.groups?.length} / ${allenGroups.length}`);
  check('而且組 id 都是他自己的命名空間',
    (aGroups.body?.groups || []).every((g) => g.id.startsWith('a-')),
    (aGroups.body?.groups || []).map((g) => g.id).join(', '));

  /*
   * 拿別人課本的組 id 進來要被擋。
   * 只靠畫面不列出來是不夠的——網址改個 group= 就繞過去了，
   * 而且進度還會記在他自己名下，之後怎麼看都覺得數字不對。
   */
  const cross = await call(aApp, 'GET', '/api/game/access?group=w01');
  check('Allen 拿 Pierce 的組會被擋', cross.status === 404,
    `${cross.status} ${cross.body?.error || ''}`);
  const own = await call(pApp, 'GET', '/api/game/access?group=w01');
  check('Pierce 拿自己的組沒問題', own.status === 200, String(own.status));
  check('access 會回課本 id（遊戲頁要拿它去抓對的單字）',
    own.body?.wordBankId === 'g3a', String(own.body?.wordBankId));

  console.log('5) 戰役是各自的');
  const pCamp = await call(pApp, 'GET', '/api/campaign');
  check('Pierce 的戰役是 100 關', pCamp.body?.levels?.length === 100,
    String(pCamp.body?.levels?.length));
  check('第 1 關是他課本的 Week 1', pCamp.body?.levels?.[0]?.groupIds?.[0] === 'w01',
    JSON.stringify(pCamp.body?.levels?.[0]?.groupIds));

  /*
   * Allen 那一本還沒有單字，戰役會是一張空表。
   * 重點是**不能炸**——建好帳號之後看到「還沒有單字」是可以理解的，
   * 看到 500 就只會以為壞了。
   */
  const aCamp = await call(aApp, 'GET', '/api/campaign');
  check('Allen 的戰役不會爆掉', aCamp.status === 200, String(aCamp.status));
  /*
   * 戰役的 96 關都是從**每週單字**排出來的，Allen 那一本還沒有，所以是空表。
   * 重點是不能爆掉，而且進度百分比不可以是 NaN——接到畫面上會變成
   * width: NaN%，進度條壞掉而且完全看不出為什麼。
   */
  check('（每週單字還沒進來，所以戰役是空的）', aCamp.body?.levels?.length === 0,
    `${aCamp.body?.levels?.length} 關`);
  check('空戰役的進度是 0% 而不是 NaN', aCamp.body?.summary?.percent === 0,
    JSON.stringify(aCamp.body?.summary?.percent));
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
