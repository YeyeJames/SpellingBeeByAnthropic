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
 *   6. 進了帳號之後，從導覽列就換得掉帳號——不必自己回去找首頁網址
 *
 * 用法：node scripts/home-page-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

/** 請求裡有沒有任何像密碼的東西。這個 app 刻意沒有密碼與 PIN。 */
function hasSecret(body = {}) {
  return Object.keys(body).some((k) => /pin|pass|pwd|secret|token/i.test(k));
}

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME });

/*
 * 這台機器沒有資料庫，所以帳號相關的 API 全部用攔截的方式給。
 *
 * ⚠️ banks 一定要跟著回。
 * 這個假資料本來只回 { profiles }，跟真的伺服器（會一起回 banks）不一樣，
 * 所以「建帳號時選哪一本單字庫」整個壞掉了測試也全綠——
 * 假的比真的少一個欄位，測到的就是另一支程式。
 */
const ONE_BANK = [{ id: 'g3a', label: 'Grade 3A', owner: 'Pierce', ready: true, groupCount: 28, wordCount: 749 }];
const TWO_BANKS = [
  ...ONE_BANK,
  { id: 'allen', label: 'Grade 4D', owner: 'Allen', ready: true, groupCount: 4, wordCount: 75 }
];

async function openHome({ banks = ONE_BANK } = {}) {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const state = {
    profiles: [
      { _id: 'id-brother', nickname: '哥哥', coins: 120 },
      { _id: 'id-sister', nickname: '妹妹', coins: 40 }
    ],
    banks,
    calls: []
  };

  await context.route('**/api/auth/profiles', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ profiles: state.profiles, banks: state.banks })
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
  check('送出的只有名字，沒有密碼', login && !hasSecret(login.body) && !!login.body.nickname,
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
  /*
   * 驗的是「沒有密碼」，不是「欄位剛好只有一個」。
   *
   * 原本寫死比對鍵的清單，結果多了一個 wordBankId（兩個孩子各一本課本）
   * 就紅了——但那個欄位完全無害，真正要守的是不可以出現密碼或 PIN。
   * 比對清單只是恰好抓到，換個角度就會變成擋住正常的演進。
   */
  check('送出的沒有密碼', reg && !hasSecret(reg.body) && !!reg.body.nickname, JSON.stringify(reg?.body));
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

/* ── 5. 從練習頁換帳號 ─────────────────────────────────── */
/*
 * 實際用起來才發現的問題：進了帳號之後，畫面上找不到任何「換人」或「登出」，
 * 想換另一個帳號只能自己回去找首頁網址。
 *
 * 功能其實一直都在（右上角的暱稱就是按鈕），但它長得像一個顯示「現在是誰」
 * 的標籤，提示只寫在 title 裡——滑鼠停上去才看得到，平板上根本看不到。
 * **功能存在但沒有人找得到，等於不存在。**
 */
console.log('\n5) 從練習頁換帳號');
{
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const USER = {
    _id: 'id-brother',
    nickname: '哥哥',
    coins: 120,
    activeTheme: null,
    stats: { currentStreak: 0 }
  };
  await context.addInitScript((u) => {
    localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u));
  }, USER);
  await context.route('**/api/auth/me', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: USER }) })
  );
  await context.route('**/api/practice/review-queue', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"words":[]}' })
  );
  await context.route('**/api/practice/progress', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unlockAfter: 2, progress: {} })
    })
  );
  let loggedOut = false;
  await context.route('**/api/auth/logout', (r) => {
    loggedOut = true;
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-nav-switch]', { timeout: 10000 });

  check('看得到現在是誰在玩', (await page.locator('[data-nav-nickname]').innerText()) === '哥哥');

  /*
   * 順手釘住一個寫這支測試時才發現的版面問題：
   * #setup-panel 原本用 justify-content: center，而它是會捲動的容器——
   * 置中會讓內容從上下兩端一起溢出，但 scrollTop 不能是負的，
   * 所以溢出到上面那一段永遠捲不到。實測「🎧 聽寫練習」停在 y = -40。
   */
  const titleTop = await page.evaluate(() => {
    const panel = document.getElementById('setup-panel');
    panel.scrollTop = 0;
    return Math.round(panel.querySelector('h1').getBoundingClientRect().top);
  });
  check('頁面標題捲得到（不會被置中溢出吃掉）', titleTop >= 0, `top=${titleTop}`);

  /*
   * ▾ 是「這顆可以點開」的唯一線索。沒有它，這顆按鈕就退回成一個看起來
   * 不能按的標籤，也就是原本那個問題。
   */
  check('按鈕上有可以點開的記號', (await page.locator('.nav-user-caret').count()) === 1);

  check('選單平常收起來', await page.evaluate(() => document.querySelector('[data-nav-user-menu]').hidden));

  await page.click('[data-nav-switch]');
  await page.waitForTimeout(150);
  const menuText = await page.locator('[data-nav-user-menu]').innerText();
  check('點一下打得開', !(await page.evaluate(() => document.querySelector('[data-nav-user-menu]').hidden)));
  check('兩個出路都寫出來了', menuText.includes('換人玩') && menuText.includes('登出'), menuText.replace(/\n/g, ' / '));

  // 點別的地方要收起來，不然它會一直擋在畫面上
  await page.mouse.click(30, 400);
  await page.waitForTimeout(150);
  check('點別的地方會收起來', await page.evaluate(() => document.querySelector('[data-nav-user-menu]').hidden));

  // 換人玩：回選單，但**不登出**——那個帳號仍要顯示「繼續玩」
  await page.click('[data-nav-switch]');
  await page.waitForTimeout(120);
  await page.click('[data-nav-switch-account]');
  await page.waitForURL('**/index.html', { timeout: 10000 });
  check('「換人玩」回到帳號選單', page.url().includes('/index.html'), page.url());
  check('換人不會順便登出（那個帳號還要顯示「繼續玩」）', loggedOut === false, String(loggedOut));

  // 登出：真的清掉 session
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-nav-switch]', { timeout: 10000 });
  await page.click('[data-nav-switch]');
  await page.waitForTimeout(120);
  await page.click('[data-nav-logout]');
  await page.waitForURL('**/index.html', { timeout: 10000 });
  check('「登出」真的登出了', loggedOut === true, String(loggedOut));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));

  await context.close();
}

/* ── 6. 建帳號時選單字庫 ───────────────────────────────────
 *
 * 哥哥要建新帳號，看到「用哪一本單字庫」這一行，**底下一片空白**，
 * 一個選項都沒有。
 *
 * 原因：login.js 的頁面初始化只從 /auth/profiles 解構 profiles，沒有接
 * banks，所以整頁剛載入時 banks 永遠是空陣列；而讀 banks 的
 * reloadProfiles() 只有在建立／刪除帳號之後才會跑。也就是說這個選擇區
 * **從來沒有在第一次載入時work過**。
 *
 * 而它測不出來，是因為這支測試的假資料只回 { profiles }——比真的伺服器
 * 少一個欄位，所以測到的是另一支程式。
 */
console.log('\n6) 建帳號時要選哪一本單字庫');
{
  const { context, page, errors, state } = await openHome({ banks: TWO_BANKS });
  await page.click('.new-profile');
  await page.waitForSelector('#new-bank', { timeout: 5000 });

  const ui = await page.evaluate(() => {
    const box = document.getElementById('new-bank');
    const label = document.querySelector('label[for="new-bank"]');
    return {
      hidden: box.hidden,
      options: [...box.querySelectorAll('.bank-option')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
      labelVisible: !!(label && label.offsetParent)
    };
  });

  check('選擇區看得到', ui.hidden === false, `hidden=${ui.hidden}`);
  check('兩本課本都列出來', ui.options.length === 2, JSON.stringify(ui.options));
  check('寫的是誰的課本（他要認得出哪個是自己的）',
    ui.options.some((t) => t.includes('Pierce')) && ui.options.some((t) => t.includes('Allen')),
    JSON.stringify(ui.options));

  /*
   * 預設不選，逼他做一次決定——選錯會一路練到別人的功課，
   * 而那件事從畫面上看不出來（單字都是英文）。
   */
  // 名字要先填，不然擋下來的會是「請輸入名字」，測不到單字庫那一關
  await page.fill('#new-nickname', 'Allen');
  await page.click('#new-profile-create');
  const err = await page.locator('#new-profile-error').innerText().catch(() => '');
  check('沒選就按建立會被擋下來', err.includes('單字庫'), err || '（沒有訊息）');

  // 選了才過得去，而且送出去的是他選的那一本
  await page.click('.bank-option:nth-child(2)');
  await page.click('#new-profile-create');
  await page.waitForURL('**/practice.html', { timeout: 8000 }).catch(() => {});
  const reg = state.calls.find((c) => c.kind === 'register');
  check('選了之後建得成功，而且送的是他選的那一本',
    reg && reg.body.wordBankId === 'allen', JSON.stringify(reg?.body || null));

  await context.close();

  /*
   * 反面：只有一本的時候，問題跟選項都不該出現——
   * 只有一個選項的問題對小孩來說就是一個看不懂的步驟。
   */
  const one = await openHome({ banks: ONE_BANK });
  await one.page.click('.new-profile');
  await one.page.waitForSelector('#new-profile-step', { timeout: 5000 }).catch(() => {});
  const oneUi = await one.page.evaluate(() => {
    const box = document.getElementById('new-bank');
    const label = document.querySelector('label[for="new-bank"]');
    return { hidden: box.hidden, labelVisible: !!(label && label.offsetParent) };
  });
  check('只有一本時選擇區藏起來', oneUi.hidden === true, `hidden=${oneUi.hidden}`);
  /*
   * 這一條是這個 bug 的第二半：標籤本來寫死在 HTML 裡、永遠看得到，
   * 只有底下的 div 會藏。所以一旦 banks 沒載進來，畫面就是
   * 「一個問題配一片空白」——他看得到問題，卻沒有東西可以回答。
   */
  check('⭐ 問題也要跟著藏（不可以只剩一個問不到答案的問題）',
    oneUi.labelVisible === false, `labelVisible=${oneUi.labelVisible}`);

  check('沒有瀏覽器錯誤', errors.length === 0, errors.slice(0, 2).join(' | '));
  await one.context.close();
}

await browser.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
