/**
 * 首頁＝選帳號。
 *
 * 這一頁被整個重寫過（拿掉 PIN 鍵盤、加上新增與刪除帳號），而且是孩子每次
 * 打開來第一個看到的畫面——壞掉就什麼都做不了。伺服器那一側由
 * account-flow-test 驗，這支驗的是畫面本身。
 *
 * 要證明的事：
 *   1. 帳號列出來，點一下就進去（中間沒有任何密碼步驟）
 *   2. 新增帳號只要一個名字
 *   3. 刪除鈕平常不出現——孩子每天點這一頁，常駐的叉叉遲早會被按到
 *   4. 刪除要把名字完整打一次才算數
 *   5. 進去之後到的是練習頁（先練再玩）
 *
 * 用法：node scripts/home-page-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME });

/** 這台機器沒有資料庫，所以帳號相關的 API 全部用攔截的方式給。 */
async function openHome() {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const state = {
    profiles: [
      { _id: 'id-brother', nickname: '哥哥', coins: 120 },
      { _id: 'id-sister', nickname: '妹妹', coins: 40 }
    ],
    calls: []
  };

  await context.route('**/api/auth/profiles', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ profiles: state.profiles })
    });
  });
  await context.route('**/api/auth/profiles/*', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const id = route.request().url().split('/').pop();
    const target = state.profiles.find((p) => p._id === id);
    state.calls.push({ kind: 'delete', id, confirmNickname: body.confirmNickname });
    if (!target || body.confirmNickname !== target.nickname) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: '請把要刪除的帳號名稱完整打一次' })
      });
    }
    state.profiles = state.profiles.filter((p) => p._id !== id);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, nickname: target.nickname })
    });
  });
  await context.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"尚未登入"}' })
  );
  await context.route('**/api/auth/login', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    state.calls.push({ kind: 'login', body });
    const user = state.profiles.find((p) => p.nickname === body.nickname);
    return route.fulfill({
      status: user ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(user ? { user: { ...user, stats: {}, activeTheme: null } } : { error: '找不到這個帳號' })
    });
  });
  await context.route('**/api/auth/register', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    state.calls.push({ kind: 'register', body });
    const user = { _id: `id-${body.nickname}`, nickname: body.nickname, coins: 0, stats: {}, activeTheme: null };
    state.profiles.push(user);
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ user })
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.profile-tile', { timeout: 10000 });
  return { context, page, errors, state };
}

/* ── 1. 選帳號，沒有密碼 ───────────────────────────────── */
console.log('1) 點一下名字就進去');
{
  const { context, page, errors, state } = await openHome();

  const names = await page.locator('.profile-tile .nickname').allInnerTexts();
  check('兩個帳號都列出來', names.includes('哥哥') && names.includes('妹妹'), names.join('、'));
  check('還有一顆「新增帳號」', names.includes('新增帳號'), names.join('、'));
  check('看得到各自的金幣', (await page.locator('.profile-tile .tile-sub').first().innerText()).includes('🪙'));

  // 整頁不該有任何密碼輸入
  const pwFields = await page.locator('input[type="password"], .pin-pad, .pin-dots').count();
  check('畫面上沒有任何密碼欄位或 PIN 鍵盤', pwFields === 0, String(pwFields));

  await page.click('.profile-tile:has(.nickname:text-is("哥哥"))');
  await page.waitForURL('**/practice.html', { timeout: 10000 });
  check('進去之後到的是練習頁（先練再玩）', page.url().includes('/practice.html'), page.url());

  const login = state.calls.find((c) => c.kind === 'login');
  check('送出的只有名字，沒有密碼', login && Object.keys(login.body).join(',') === 'nickname',
    JSON.stringify(login?.body));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

/* ── 2. 新增帳號 ───────────────────────────────────────── */
console.log('\n2) 新增帳號只要一個名字');
{
  const { context, page, errors, state } = await openHome();

  await page.click('.profile-tile.new-profile');
  await page.waitForSelector('#new-profile-step:not(.hidden)');
  check('沒有「下一步：設定 PIN」這種步驟',
    (await page.locator('#new-profile-create').innerText()).includes('建立帳號'),
    await page.locator('#new-profile-create').innerText());

  await page.click('#new-profile-create');
  await page.waitForTimeout(200);
  check('沒填名字要擋下來',
    (await page.locator('#new-profile-error').innerText()).includes('名字'),
    await page.locator('#new-profile-error').innerText());

  await page.fill('#new-nickname', '弟弟');
  await page.click('#new-profile-create');
  await page.waitForURL('**/practice.html', { timeout: 10000 });
  const reg = state.calls.find((c) => c.kind === 'register');
  check('建好之後直接進練習頁', page.url().includes('/practice.html'), page.url());
  check('送出的只有名字', reg && Object.keys(reg.body).join(',') === 'nickname', JSON.stringify(reg?.body));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

/* ── 3~4. 刪除帳號 ─────────────────────────────────────── */
console.log('\n3) 刪除鈕平常不出現');
{
  const { context, page, errors, state } = await openHome();

  check('一進來沒有刪除鈕', (await page.locator('.tile-delete').count()) === 0);

  await page.click('#manage-toggle');
  await page.waitForTimeout(150);
  check('按了管理之後才出現', (await page.locator('.tile-delete').count()) === 2,
    String(await page.locator('.tile-delete').count()));
  check('管理模式下不顯示「新增帳號」（免得誤按）',
    (await page.locator('.profile-tile.new-profile').count()) === 0);

  // 管理模式下點頭像本身不該把人帶進去
  await page.click('.profile-tile:has(.nickname:text-is("妹妹")) .nickname');
  await page.waitForTimeout(300);
  check('管理模式下點名字不會直接進去', page.url().includes('/index.html'), page.url());

  console.log('\n4) 刪除要把名字完整打一次');
  await page.click('.profile-tile:has(.nickname:text-is("妹妹")) .tile-delete');
  await page.waitForSelector('#delete-profile-step:not(.hidden)');
  const warn = await page.locator('#delete-profile-step').innerText();
  check('說清楚會弄丟什麼', /分數|進度/.test(warn), warn.split('\n').slice(0, 3).join(' '));
  check('也說清楚錄音不會被刪掉', /錄音/.test(warn), warn);

  await page.fill('#delete-confirm', '妹');
  await page.click('#delete-confirm-btn');
  await page.waitForTimeout(400);
  check('名字打錯不刪', (await page.locator('#delete-error').innerText()).length > 0,
    await page.locator('#delete-error').innerText());
  check('帳號還在', state.profiles.some((p) => p.nickname === '妹妹'));

  await page.fill('#delete-confirm', '妹妹');
  await page.click('#delete-confirm-btn');
  await page.waitForSelector('#profile-step:not(.hidden)', { timeout: 10000 });
  check('名字打對就刪掉了', !state.profiles.some((p) => p.nickname === '妹妹'),
    state.profiles.map((p) => p.nickname).join('、'));
  const names = await page.locator('.profile-tile .nickname').allInnerTexts();
  check('畫面上也不見了', !names.includes('妹妹'), names.join('、'));
  check('刪完自動離開管理模式', names.includes('新增帳號'), names.join('、'));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

await browser.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
