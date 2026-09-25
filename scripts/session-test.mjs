/**
 * 登入的期限與失效（docs/audit/step2 的 S4）。
 *
 * 要證明的事：
 *   1. 有在用就自動延長：每次請求都把 cookie 的期限往後推，不是「選名字那天＋30 天」
 *   2. 沒登入的請求不會被塞一個 cookie
 *   3. 資料庫裡的 session 期限最多一天更新一次（不是每個請求寫一次資料庫）
 *
 * 用法：node scripts/session-test.mjs（自己起伺服器）
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const store = {};
installFakeDb(createFakeDb(store, { uniqueIndexes: {} }));
const PORT = 9000 + Math.floor(Math.random() * 900);
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

const expiresOf = (setCookie) => {
  const m = /Expires=([^;]+)/i.exec(setCookie || '');
  return m ? new Date(m[1]).getTime() : null;
};
const DAY = 24 * 60 * 60 * 1000;

console.log('1) 有在用就自動延長');
{
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Pierce' })
  });
  const first = r.headers.get('set-cookie');
  const cookie = first.split(';')[0];
  const e1 = expiresOf(first);
  check('（前提）登入時拿到 30 天的 cookie', e1 && Math.abs(e1 - Date.now() - 30 * DAY) < 60 * 1000);

  // cookie 的 Expires 精確到秒，要隔超過一秒才看得出往後推了
  await new Promise((res) => setTimeout(res, 2100));
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  const again = me.headers.get('set-cookie');
  check('之後的請求也會送回 cookie', me.status === 200 && !!again, `${me.status} ${again ? 'set-cookie' : '沒有'}`);
  const e2 = expiresOf(again);
  check('期限往後推了（從這一次起算 30 天）', e2 && e2 - e1 >= 2000, e2 && `${Math.round((e2 - e1) / 1000)} 秒`);
  check('還是同一個登入（不是換了一個新的）', (again || '').split(';')[0] === cookie);
}

console.log('\n2) 沒登入的請求不會被塞 cookie');
{
  const r = await fetch(`${BASE}/api/auth/profiles`);
  check('選人畫面的請求沒有 set-cookie', r.status === 200 && !r.headers.get('set-cookie'));
  const w = await fetch(`${BASE}/api/wordbank/groups`);
  check('單字庫（會被快取的回應）沒有 set-cookie', w.status === 200 && !w.headers.get('set-cookie'));
}

console.log('\n3) 資料庫裡的期限不會每個請求都寫一次');
{
  const src = readFileSync(new URL('../server/sessionStore.js', import.meta.url), 'utf8');
  check('MongoDB 的 session 設了 touchAfter（一天）', /touchAfter:\s*24\s*\*\s*3600/.test(src));
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
