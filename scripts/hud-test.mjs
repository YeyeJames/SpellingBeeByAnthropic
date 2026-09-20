/**
 * 開場畫面與進度列測試。
 *
 * 要證明的事：
 *   1. 開場畫面說得出這一場是哪一組、總共幾個字
 *   2. 選「照順序」與選「打亂」真的產生不同的出題順序
 *   3. 選過的順序會記住，下次標出來
 *   4. 遊戲進行中，上方那一條會顯示組別、總字數、打完幾個
 *   5. 打完一個字，數字真的會加一
 *   6. 網址帶 order= 時跳過開場畫面（所有自動化測試靠這個）
 *   7. 練習頁有路可以走到遊戲，而且會把選好的組帶過去
 *
 * 用法：node scripts/hud-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const pageErrors = [];

/** 開一個已經校準過的分頁，這樣不會被校準畫面擋住。 */
async function openCalibrated(width = 1280, height = 720) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(() => {
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  return { context, page };
}

/* ── 1~3. 開場畫面 ──────────────────────────────────────── */
console.log('1) 開場畫面');
{
  const { context, page } = await openCalibrated();
  await page.goto(`${BASE}/game?group=w18&n=200`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });

  const shown = await page.evaluate(() => ({
    group: document.getElementById('pregame-group').textContent,
    count: document.getElementById('pregame-count').textContent,
    orders: [...document.querySelectorAll('.btn-order')].map((b) => b.textContent)
  }));
  check('寫出是哪一組', shown.group === 'Week 18', shown.group);
  check('寫出總共幾個字', shown.count === '總共 14 個字', shown.count);
  check('兩種出題順序都有', shown.orders.length === 2, shown.orders.join('、'));

  /*
   * 練習頁寫「Week 6②・24 個單字」，遊戲只有 21 個。不解釋的話他會以為字不見了，
   * 所以差額一定要講出來。
   */
  await page.goto(`${BASE}/game?group=w06b&n=200`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  const w06 = await page.evaluate(() => document.getElementById('pregame-count').textContent);
  check('有字被濾掉時會說明差額', w06 === '總共 21 個字（另外 3 個有空白的詞只在練習模式出現）', w06);

  await page.goto(`${BASE}/game?group=w18&n=200`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });

  // 還沒選之前不該開場
  const startedEarly = await page.evaluate(() => !!(window.__spellbee && window.__spellbee.ready));
  check('選之前不會自己開始', startedEarly === false);

  await page.click('[data-order="sequential"]');
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  const seq = await page.evaluate(() => ({
    order: window.__spellbee.order(),
    queue: window.__spellbee.queueOrder()
  }));
  check('遊戲收到的順序是 sequential', seq.order === 'sequential', seq.order);
  check(
    '照順序就是單字表原本的排列',
    seq.queue.every((v, i) => v === i),
    seq.queue.slice(0, 8).join(',')
  );

  /* ── 3. 記住選擇 ── */
  await page.goto(`${BASE}/game?group=w18&n=200`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  const lastMark = await page.evaluate(
    () => document.querySelector('.btn-order.is-last')?.dataset.order
  );
  console.log('\n2) 記住上次選的順序');
  check('上次選的那一顆有標起來', lastMark === 'sequential', String(lastMark));

  /* ── 2. 打亂真的會不一樣 ── */
  console.log('\n3) 打亂要真的打亂');
  await page.click('[data-order="random"]');
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  const rnd = await page.evaluate(() => ({
    order: window.__spellbee.order(),
    queue: window.__spellbee.queueOrder()
  }));
  check('遊戲收到的順序是 random', rnd.order === 'random', rnd.order);
  /*
   * 不比對「第一個字不一樣」——十四個字洗牌後第一個剛好一樣的機率是 1/14，
   * 那種測試每跑十幾次就會無故紅一次。改比對整串序列：洗完之後整串
   * 仍然完全一致的機率是 1/14!，實際上等於零。
   */
  check(
    '打亂後的題目序列跟照順序不同',
    rnd.queue.join(',') !== seq.queue.join(','),
    rnd.queue.slice(0, 8).join(',')
  );
  check(
    '打亂只是換順序，沒有多出或少掉題目',
    [...rnd.queue].sort((a, b) => a - b).join(',') === seq.queue.join(','),
    `${rnd.queue.length} 題`
  );
  await context.close();
}

/* ── 4~5. 進度列 ────────────────────────────────────────── */
console.log('\n4) 遊戲中的進度列');
{
  const { context, page } = await openCalibrated();
  // show=1 讓畫面顯示單字：無頭瀏覽器沒有語音，不顯示就不知道該打什麼
  await page.goto(`${BASE}/game?group=w18&n=200&order=sequential&show=1`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

  const before = await page.evaluate(() => ({
    group: document.getElementById('group-label').textContent,
    progress: document.getElementById('progress-label').textContent
  }));
  check('顯示組別、字數與出題順序', before.group === 'Week 18・14 字・照順序', before.group);
  check('一開始是打完 0 個', before.progress === '打完 0 / 14', before.progress);

  // 把第一個字整個打完
  const word = await page.evaluate(() => window.__spellbee.state().target);
  for (const ch of word) await page.keyboard.press(ch);
  await page.waitForFunction(
    () => document.getElementById('progress-label').textContent !== '打完 0 / 14',
    null,
    { timeout: 5000 }
  );
  const after = await page.evaluate(() => document.getElementById('progress-label').textContent);
  check(`打完「${word}」之後數字加一`, after === '打完 1 / 14', after);

  console.log('\n5) 網址帶 order= 時跳過開場畫面');
  check('開場畫面沒有出現', await page.evaluate(() => document.getElementById('pregame').hidden));
  await context.close();
}

/* ── 6. 練習頁走得到遊戲 ────────────────────────────────── */
console.log('\n6) 練習頁 → 遊戲');
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
    localStorage.setItem(
      'sb:v2:shared:currentUser',
      JSON.stringify({ _id: 'test-user', username: '測試', coins: 0, activeTheme: null, stats: { currentStreak: 0 } })
    );
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // 這兩支要資料庫，這台機器沒有
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { _id: 'test-user', username: '測試', coins: 0, activeTheme: null, stats: { currentStreak: 0 } } })
    })
  );
  await page.route('**/api/practice/review-queue', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ words: [] }) })
  );

  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#part-picker .part-btn', { timeout: 15000 });
  check('練習頁有「玩遊戲」的按鈕', await page.isVisible('#go-game-btn'));

  // 沒選組就按，要擋下來而不是開一場空的
  await page.click('#go-game-btn');
  await page.waitForTimeout(300);
  const err = await page.evaluate(() => document.getElementById('setup-error').textContent);
  check('沒選組時擋下來並說原因', err.includes('選擇'), err);

  await page.click('#part-picker .part-btn:has(.part-title:text-is("Week 18"))');
  await page.click('#go-game-btn');
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  check('真的走到遊戲頁', page.url().includes('/game?group=w18'), page.url());
  const carried = await page.evaluate(() => ({
    group: document.getElementById('pregame-group').textContent,
    count: document.getElementById('pregame-count').textContent
  }));
  check('選好的組有帶過去', carried.group === 'Week 18', carried.group);
  check('整組都帶過去，沒被砍成 20 個', carried.count === '總共 14 個字', carried.count);
  await context.close();
}

/* ── 7. 真人錄音 ────────────────────────────────────────── */
/*
 * 孩子聽到某個字唸錯，自己到練習模式錄了一段。遊戲裡如果還是用機器語音唸，
 * 那段錄音等於白錄——而且不會有任何錯誤訊息，只有他知道「還是不對」。
 *
 * 這台機器沒有資料庫，所以錄音清單與音檔都用攔截的方式給。
 * 要驗的是遊戲有沒有去抓錄音，不是錄音怎麼存的（那有 practice-session-test）。
 */
console.log('\n7) 有錄音的字要播錄音，不要用機器語音');
{
  const { context, page } = await openCalibrated();

  // 一段極短的靜音 wav，足夠讓 <audio> 真的播得起來
  const WAV = Buffer.from(
    'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=',
    'base64'
  );
  const audioRequests = [];

  await page.route('**/api/words/recorded', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      // Week 18 的第一個字
      body: JSON.stringify({ wordIds: ['w18-crack'] })
    })
  );
  await page.route('**/api/words/*/audio', (r) => {
    audioRequests.push(r.request().url());
    r.fulfill({ status: 200, contentType: 'audio/wav', body: WAV });
  });

  await page.goto(`${BASE}/game?group=w18&n=200&order=sequential&show=1`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

  const marked = await page.evaluate(() => {
    const words = window.__spellbee.words();
    return {
      recordedCount: window.__spellbee.recordedCount(),
      crack: words.find((w) => w.id === 'w18-crack')?.audio,
      other: words.find((w) => w.id !== 'w18-crack')?.audio
    };
  });
  check('有錄音的字被標成 recorded', marked.crack === 'recorded', String(marked.crack));
  check('沒錄音的字還是用機器語音', marked.other === 'tts', String(marked.other));
  check('數得出這一場有幾個字是自己錄的', marked.recordedCount === 1, String(marked.recordedCount));

  // 按「再聽一次」，應該去抓那個字的錄音
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(500);
  check(
    '真的去抓了錄音檔',
    audioRequests.some((u) => u.includes('/api/words/w18-crack/audio')),
    audioRequests.join(' | ') || '一次都沒抓'
  );

  console.log('\n8) 開場畫面要讓他知道錄音有用上');
  await page.goto(`${BASE}/game?group=w18&n=200`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  const note = await page.evaluate(() => document.getElementById('pregame-count').textContent);
  check('寫出有幾個字是自己錄的', note.includes('其中 1 個唸的是你自己錄的聲音'), note);

  await context.close();
}

await browser.close();

console.log('\n驗收');
check('沒有未捕捉的例外', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
