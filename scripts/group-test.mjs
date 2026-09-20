/**
 * 分組測試——把「一次練一組」這件事從資料一路驗到遊戲畫面。
 *
 * 要證明的事：
 *   1. /api/wordbank?group=w06 只回那一組的字
 *   2. 舊的 ?part= 還能用（單字庫頁面和既有連結靠它）
 *   3. 遊戲用 ?group= 開得起來，而且題目真的來自那一組
 *   4. 含空白／連字號的詞條不會被丟進遊戲（那種字打不出來）
 *   5. 不存在的組不會靜靜地開出一場空戰鬥，而是報錯
 *
 * 用法：node scripts/group-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── 1~2. 端點 ──────────────────────────────────────────── */
console.log('1) /api/wordbank');
{
  const all = await fetch(`${BASE}/api/wordbank`).then((r) => r.json());
  check('沒帶參數時回全部', all.words.length > 400, `${all.words.length} 字`);
  check('有回組別目錄', Array.isArray(all.groups) && all.groups.length >= 13, `${all.groups?.length} 組`);
  check(
    '每個字都屬於某一組',
    all.words.every((w) => typeof w.group === 'string' && w.group),
    all.words.find((w) => !w.group)?.id || ''
  );

  const w06 = await fetch(`${BASE}/api/wordbank?group=w06`).then((r) => r.json());
  check('?group=w06 只回那一組', w06.words.every((w) => w.group === 'w06'), `${w06.words.length} 字`);

  const p1 = await fetch(`${BASE}/api/wordbank?part=1`).then((r) => r.json());
  check('?part=1 仍然可用（舊連結）', p1.words.length === 25 && p1.words.every((w) => w.part === 1), `${p1.words.length} 字`);

  const nope = await fetch(`${BASE}/api/wordbank?group=不存在`).then((r) => r.json());
  check('不存在的組回空陣列', Array.isArray(nope.words) && nope.words.length === 0);

  // 練習頁只要畫幾顆按鈕，不該為此載入四百多個字
  const onlyGroups = await fetch(`${BASE}/api/wordbank/groups`).then((r) => r.json());
  check(
    '/groups 只回目錄，不夾帶單字',
    Array.isArray(onlyGroups.groups) &&
      onlyGroups.groups.length === all.groups.length &&
      onlyGroups.words === undefined,
    `${onlyGroups.groups?.length} 組`
  );
  check(
    '每一組都有名稱與字數',
    onlyGroups.groups.every((g) => g.id && g.label && g.count > 0 && g.kind),
    JSON.stringify(onlyGroups.groups.find((g) => !g.count || !g.label) || '')
  );
  // 練習頁靠這個順序分成「競賽單字」「課本每週單字」兩段，混在一起就畫不出分隔
  const kinds = onlyGroups.groups.map((g) => g.kind);
  check(
    '競賽單字全部排在每週單字前面',
    kinds.lastIndexOf('contest') < kinds.indexOf('week'),
    kinds.join(',')
  );
}

/* ── 3~5. 遊戲頁 ────────────────────────────────────────── */
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const consoleErrors = [];

console.log('\n2) 遊戲用 ?group= 開起來');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
  });

  // w06 是含最多「打不出來的詞條」的一組，拿它來測濾除最有意義
  await page.goto(`${BASE}/game?group=w06&difficulty=normal&n=100`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

  const info = await page.evaluate(() => {
    const words = window.__spellbee.words();
    return {
      count: words.length,
      groups: [...new Set(words.map((w) => w.group))],
      withSpace: words.filter((w) => /[^a-z]/.test(w.english)).map((w) => w.english)
    };
  });
  check('題目都來自 w06', info.groups.length === 1 && info.groups[0] === 'w06', info.groups.join(','));
  check('題目數量對得上（46 個能打的字）', info.count === 46, `${info.count} 字`);
  check('沒有含空白或連字號的題目', info.withSpace.length === 0, info.withSpace.join('、'));

  console.log('\n3) 不存在的組要報錯，不要開一場空戰鬥');
  // 這一段是故意讓它失敗，所以之後的 console 錯誤是預期中的，不算數
  check('到這裡為止沒有非預期的錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  consoleErrors.length = 0;
  await page.goto(`${BASE}/game?group=w99&difficulty=normal`, { waitUntil: 'domcontentloaded' });
  const errText = await page
    .waitForFunction(
      () => {
        const el = document.getElementById('game-error');
        return el && el.textContent.trim() ? el.textContent.trim() : null;
      },
      null,
      { timeout: 15000 }
    )
    .then((h) => h.jsonValue())
    .catch(() => '');
  check('畫面上看得到錯誤訊息', errText.length > 0, errText);
  check('錯誤訊息說得出是哪一組', errText.includes('w99'), errText);

  await context.close();
}

/* ── 4. 練習頁的選組畫面 ─────────────────────────────────── */
/*
 * 練習頁需要登入，而這台機器沒有 MongoDB。不過登入狀態本來就先讀本地快取，
 * 所以塞一個假的使用者進去就能把畫面畫出來——要驗的是選組的那段，
 * 不是登入流程（那有自己的測試）。
 */
console.log('\n4) 練習頁選組');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem(
      'sb:v2:shared:currentUser',
      JSON.stringify({ _id: 'test-user', username: '測試', coins: 0, activeTheme: null, stats: { currentStreak: 0 } })
    );
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  /*
   * 這兩支要資料庫，這台機器沒有——沒擋掉的話頁面會停在「正在喚醒伺服器」
   * 重試二十秒，選組畫面根本不會顯示出來。組別目錄那一支是真的，不擋。
   */
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { _id: 'test-user', username: '測試', coins: 0, activeTheme: null, stats: { currentStreak: 0 } } })
    })
  );
  await page.route('**/api/practice/review-queue', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ words: [] }) })
  );

  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#part-picker .part-btn', { timeout: 15000 });

  const picker = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('#part-picker .part-btn .part-title')].map((e) => e.textContent),
    subs: [...document.querySelectorAll('#part-picker .part-btn .part-sub')].map((e) => e.textContent),
    heads: [...document.querySelectorAll('#part-picker .part-group-label')].map((e) => e.textContent)
  }));
  check('十三組都列出來', picker.buttons.length === 13, picker.buttons.join('、'));
  check('有 Part 也有 Week', picker.buttons.includes('Part 1') && picker.buttons.includes('Week 10'), picker.buttons.join('、'));
  check('分成競賽與每週兩段', picker.heads.length === 2, picker.heads.join(' / '));
  check('每顆按鈕都寫著字數', picker.subs.every((s) => /^\d+ 個單字$/.test(s)), picker.subs.slice(0, 3).join('、'));
  check(
    'Week 6 顯示 49 個字（練習不濾掉含空白的詞條）',
    picker.subs[picker.buttons.indexOf('Week 6')] === '49 個單字',
    picker.subs[picker.buttons.indexOf('Week 6')]
  );

  // 選了要記得，下次進來才不用再選一次
  await page.click('#part-picker .part-btn:has(.part-title:text-is("Week 6"))');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sb:v2:shared:lastGroup')));
  check('選過的組會記住', saved === 'w06', String(saved));
  const selected = await page.evaluate(
    () => document.querySelector('#part-picker .part-btn.selected .part-title')?.textContent
  );
  check('選中的那一顆看得出來', selected === 'Week 6', String(selected));

  check('沒有未捕捉的例外', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await context.close();
}

await browser.close();

console.log('\n驗收');
check(
  '失敗時只吐出那一則預期的錯誤',
  consoleErrors.every((e) => e.includes('w99')),
  consoleErrors.filter((e) => !e.includes('w99')).slice(0, 3).join(' | ')
);
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
