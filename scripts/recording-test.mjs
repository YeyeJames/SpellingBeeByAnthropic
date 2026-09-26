/**
 * 真人錄音：錄、存、播、重錄、刪（docs/audit 步驟四，Q9／F6）。
 *
 * 錄音存在 MongoDB 的 GridFS 裡，假資料庫沒有這一塊，所以這一支接**真的 MongoDB**
 * （跟 real-mongo-test.mjs 一樣：有 REAL_MONGO_URI 就用，沒有就自己起 mongod，都沒有就跳過）。
 * 麥克風用 Chrome 內建的假裝置（會發出一段測試音），不用真的講話。
 *
 * 要證明的事：
 *   1. 在單字庫頁按「錄音」→「停止」→「儲存」，錄音真的存進去了
 *   2. 存進去的檔案播得出來（伺服器回得出同一份內容、格式對）
 *   3. 那張卡片變成「已錄音」；遊戲會用它（/api/words/recorded 列得出來）
 *   4. 重錄：新的蓋掉舊的，舊的檔案真的刪掉（不會越積越多）
 *   5. 刪除：卡片變回「錄音」、檔案刪掉、遊戲改回機器語音
 *   6. 不收奇怪的格式、不收太大的檔案
 *
 * 用法：node scripts/recording-test.mjs
 */

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { MongoClient } = require('mongodb');
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function findMongod() {
  if (process.env.MONGOD_BIN && existsSync(process.env.MONGOD_BIN)) return process.env.MONGOD_BIN;
  const cache = join(homedir(), '.cache', 'spellbee-mongo');
  for (const d of existsSync(cache) ? readdirSync(cache) : []) {
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
  dataDir = mkdtempSync(join(tmpdir(), 'spellbee-rec-'));
  const port = 28000 + Math.floor(Math.random() * 1000);
  mongod = spawn(bin, ['--dbpath', dataDir, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
  uri = `mongodb://127.0.0.1:${port}/spellbee_recording_test`;
}
process.on('exit', () => {
  try { mongod?.kill('SIGTERM'); } catch (e) { /* */ }
  if (dataDir) try { rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* */ }
});
const probe = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
for (let i = 0; i < 50; i += 1) {
  try { await probe.connect(); break; } catch (e) { await sleep(200); }
}
const db = probe.db();
await db.dropDatabase();

const PORT = 9000 + Math.floor(Math.random() * 900);
process.env.PORT = String(PORT);
process.env.MONGODB_URI = uri;
const realLog = console.log;
const realErr = console.error;
console.log = () => {};
console.error = () => {};
require('../server/index.js');
// 伺服器對擋掉的上傳會印出錯誤堆疊（第 6 節故意觸發），不要混進測試結果
const quietErr = () => {};
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 100; i += 1) {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (h && h.database === 'connected') break;
  await sleep(150);
}
console.log = realLog;
console.error = quietErr;
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
const bail = (err) => {
  console.log(`  [FAIL] 測試中途出錯 — ${err && err.message ? err.message.split('\n')[0] : err}`);
  console.log('\n測試中途出錯');
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce', wordBankId: 'g3a' })
});
const cookie = reg.headers.get('set-cookie').split(';')[0];
const user = (await reg.json()).user;
const files = () => db.collection('audio.files').countDocuments();
const recorded = async () => (await fetch(`${BASE}/api/words/recorded`, { headers: { cookie } }).then((r) => r.json())).wordIds || [];

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});
const ctx = await browser.newContext();
await ctx.grantPermissions(['microphone'], { origin: BASE });
const [n, v] = cookie.split('=');
await ctx.addCookies([{ name: n, value: v, url: BASE }]);
await ctx.addInitScript((u) => {
  try { localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u)); } catch (e) { /* */ }
}, user);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(`${BASE}/wordbank.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.word-card', { timeout: 15000 });
await sleep(500);
const firstCard = page.locator('.word-card').first();
const wordEnglish = (await firstCard.locator('.wc-english').textContent()).trim();
const wordId = (await page.evaluate(async () => {
  const r = await fetch('/api/words', { credentials: 'same-origin' }).then((x) => x.json());
  return r.words[0]._id;
}));

async function recordOnce(ms = 1200) {
  await firstCard.locator('[data-action="record"]').click();
  await page.waitForSelector('#record-overlay:not(.hidden)', { timeout: 5000 });
  await page.click('#btn-record');
  await sleep(ms);
  await page.click('#btn-record'); // 停止
  await page.waitForSelector('#btn-save-record:not(.hidden)', { timeout: 8000 });
  const saved = page.waitForResponse((r) => r.url().includes(`/api/words/${wordId}/audio`) && r.request().method() === 'POST');
  await page.click('#btn-save-record');
  return (await saved).status();
}

console.log(`1) 錄音、儲存（「${wordEnglish}」）`);
const status1 = await recordOnce();
check('上傳成功', status1 === 200, String(status1));
await sleep(600);
const doc1 = await db.collection('wordAudio').findOne({ wordId });
check('資料庫記下這個字有錄音', !!doc1?.gridfsFileId, JSON.stringify(doc1 && { mime: doc1.mimeType, dur: doc1.durationSec }));
check('格式存成 audio/webm（Chrome 錄的）', /^audio\/webm/.test(doc1?.mimeType || ''), doc1?.mimeType);
check('錄音檔真的存進去了（1 個檔）', (await files()) === 1);

console.log('\n2) 播得出來');
const audio = await fetch(`${BASE}/api/words/${wordId}/audio`, { headers: { cookie } });
const buf = Buffer.from(await audio.arrayBuffer());
check('伺服器回得出錄音', audio.status === 200 && buf.length > 500, `${audio.status} ${buf.length} bytes`);
check('格式標頭正確', /^audio\/webm/.test(audio.headers.get('content-type') || ''), audio.headers.get('content-type'));
check('內容是 WebM（開頭的檔案標記對）', buf.subarray(0, 4).toString('hex') === '1a45dfa3', buf.subarray(0, 4).toString('hex'));
const playable = await page.evaluate(async (id) => {
  const a = new Audio(`/api/words/${id}/audio`);
  return new Promise((res) => {
    a.addEventListener('loadedmetadata', () => res({ ok: true, duration: a.duration }));
    a.addEventListener('error', () => res({ ok: false, code: a.error && a.error.code }));
    setTimeout(() => res({ ok: false, timeout: true }), 5000);
  });
}, wordId);
check('瀏覽器真的載入得了這個音檔', playable.ok, JSON.stringify(playable));

console.log('\n3) 卡片與遊戲都看得到');
const label1 = (await firstCard.locator('[data-action="record"]').textContent()).trim();
check('卡片變成「已錄音」', /已錄音/.test(label1), label1);
check('遊戲會用這個錄音（列在 recorded 裡）', (await recorded()).includes(wordId));

console.log('\n4) 重錄：新的蓋掉舊的');
const status2 = await recordOnce(900);
check('重錄上傳成功', status2 === 200, String(status2));
await sleep(600);
const doc2 = await db.collection('wordAudio').findOne({ wordId });
check('指到新的檔案', doc2 && String(doc2.gridfsFileId) !== String(doc1.gridfsFileId));
check('舊的檔案刪掉了（還是只有 1 個檔）', (await files()) === 1, `${await files()} 個`);
check('紀錄只有一筆', (await db.collection('wordAudio').countDocuments({ wordId })) === 1);

console.log('\n5) 刪除');
await firstCard.locator('[data-action="record"]').click();
await page.waitForSelector('#record-overlay:not(.hidden)', { timeout: 5000 });
const del = page.waitForResponse((r) => r.url().includes(`/api/words/${wordId}/audio`) && r.request().method() === 'DELETE');
await page.click('#btn-remove-audio');
check('刪除成功', (await del).status() === 200);
await sleep(600);
check('檔案刪掉了（0 個）', (await files()) === 0, `${await files()} 個`);
check('資料庫不再說這個字有錄音', !(await db.collection('wordAudio').findOne({ wordId })));
check('遊戲改回機器語音（不在 recorded 裡）', !(await recorded()).includes(wordId));
const gone = await fetch(`${BASE}/api/words/${wordId}/audio`, { headers: { cookie } });
check('再要那個錄音回 404（不是 500）', gone.status === 404, String(gone.status));
const label2 = (await firstCard.locator('[data-action="record"]').textContent()).trim();
check('卡片變回「錄音」', !/已錄音/.test(label2), label2);

console.log('\n6) 不收奇怪的東西');
{
  const fd = new FormData();
  fd.append('audio', new Blob(['not audio'], { type: 'text/plain' }), 'x.txt');
  const r = await fetch(`${BASE}/api/words/${wordId}/audio`, { method: 'POST', body: fd, headers: { cookie } });
  /*
   * 現況回 500（錯誤訊息是英文或「伺服器發生錯誤」），不是 400。Chrome 的錄音最多 5 秒、
   * 格式固定是 webm，孩子碰不到這兩種情況，所以不改（docs/audit/step4 的 P4-5）。
   * 這裡只守真正重要的：擋掉、沒有存進去。
   */
  check('不是音檔：擋掉', r.status >= 400, String(r.status));
  const big = new FormData();
  big.append('audio', new Blob([Buffer.alloc(600 * 1024)], { type: 'audio/webm' }), 'big.webm');
  const b = await fetch(`${BASE}/api/words/${wordId}/audio`, { method: 'POST', body: big, headers: { cookie } });
  check('超過 500KB：擋掉', b.status >= 400, String(b.status));
  const nf = new FormData();
  nf.append('audio', new Blob([Buffer.alloc(100)], { type: 'audio/webm' }), 'a.webm');
  const x = await fetch(`${BASE}/api/words/no-such-word/audio`, { method: 'POST', body: nf, headers: { cookie } });
  check('不存在的字：404', x.status === 404, String(x.status));
  check('這些都沒有留下檔案', (await files()) === 0, `${await files()} 個`);
}

check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
await browser.close();
await db.dropDatabase();
await probe.close();
console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
