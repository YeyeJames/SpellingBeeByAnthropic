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
   * 練習頁與遊戲的字數必須一模一樣。
   *
   * 以前含空白的詞條進不了遊戲，於是同一組在練習頁是 24 個字、遊戲是 21 個。
   * 那個差額沒辦法跟小孩解釋，而且那幾個字他在遊戲裡永遠練不到。
   */
  await page.goto(`${BASE}/game?group=w06b&n=200`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  const w06 = await page.evaluate(() => document.getElementById('pregame-count').textContent);
  const w06api = await fetch(`${BASE}/api/wordbank?group=w06b`).then((r) => r.json());
  check('遊戲的字數等於整組的字數', w06 === `總共 ${w06api.words.length} 個字`, `${w06}（單字庫 ${w06api.words.length} 個）`);

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
  /*
   * 四個數字都要在：打完幾個、總共幾個、漏掉幾個、還剩幾個。
   * 原本只有「打完 X / N」——少了他其實更在意的「還剩幾個」，
   * 那是他判斷要不要撐完這一場的依據。
   */
  check('一開始是打完 0 個', /打完 0 \/ 14/.test(before.progress), before.progress);
  check('看得到漏掉幾個', /漏掉 0/.test(before.progress), before.progress);
  check('看得到還剩幾個', /還剩 14 個/.test(before.progress), before.progress);

  // 狀態列的字級要明顯比下面那排按鈕大，不然小孩根本不會去看
  const sizes = await page.evaluate(() => ({
    status: parseFloat(getComputedStyle(document.querySelector('.chrome-status')).fontSize),
    controls: parseFloat(getComputedStyle(document.querySelector('.chrome-controls')).fontSize)
  }));
  check('狀態列的字比按鈕列大一截', sizes.status >= sizes.controls * 1.3,
    `狀態 ${sizes.status}px / 按鈕 ${sizes.controls}px`);

  // 把第一個字整個打完
  const word = await page.evaluate(() => window.__spellbee.state().target);
  for (const ch of word) await page.keyboard.press(ch);
  await page.waitForFunction(
    () => /打完 1 \//.test(document.getElementById('progress-label').textContent),
    null,
    { timeout: 5000 }
  );
  const after = await page.evaluate(() => document.getElementById('progress-label').textContent);
  check(`打完「${word}」之後數字加一`, /打完 1 \/ 14/.test(after), after);
  check('剩下的數量跟著減一', /還剩 13 個/.test(after), after);

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
  /*
   * Week 18 當成已經練完兩次。
   *
   * 這一段驗的是「練習頁走得到遊戲」，不是解鎖規則本身（那有
   * account-flow-test 與 game-gate-test）。沒有這個攔截的話，這台機器
   * 沒有資料庫 → 每一組都鎖著 → 這條路根本走不到。
   */
  await page.route('**/api/practice/progress', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        unlockAfter: 2,
        progress: {
          w18: { groupId: 'w18', practiceCompletions: 2, unlocked: true, completionsNeeded: 0, bestScore: 0 }
        }
      })
    })
  );
  await page.route('**/api/game/access**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unlocked: true, practiceCompletions: 2, completionsNeeded: 0, unlockAfter: 2 })
    })
  );

  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#part-picker .part-btn', { timeout: 15000 });
  check('練習頁有「玩遊戲」的按鈕', await page.isVisible('#go-game-btn'));

  // 沒選組就按，要擋下來而不是開一場空的
  await page.click('#go-game-btn');
  await page.waitForTimeout(300);
  const err = await page.evaluate(() => document.getElementById('setup-error').textContent);
  check('沒選組時擋下來並說原因', err.includes('選擇'), err);

  // 還沒練完的組別，遊戲鈕要是鎖住的（這是新流程的重點）
  await page.click('#part-picker .part-btn:has(.part-title:text-is("Week 17"))');
  const locked = await page.evaluate(() => {
    const b = document.getElementById('go-game-btn');
    return { disabled: b.disabled, text: b.textContent };
  });
  check('沒練過的組別，遊戲鈕是鎖住的', locked.disabled === true, locked.text);
  check('鈕上寫出還要練幾次', /再練完 2 次/.test(locked.text), locked.text);

  await page.click('#part-picker .part-btn:has(.part-title:text-is("Week 18"))');
  const unlocked = await page.evaluate(() => {
    const b = document.getElementById('go-game-btn');
    return { disabled: b.disabled, text: b.textContent };
  });
  check('練完兩次的組別可以按', unlocked.disabled === false, unlocked.text);

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

/* ── 6.5 含空白的詞條要真的打得完 ───────────────────────── */
/*
 * 「整組都在」只證明那些字有被發到題目裡，不代表打得完。
 * 空白鍵如果沒收，他會停在 "alarm" 後面按半天、以為遊戲壞了——
 * 所以一定要真的把一個含空白的詞條從頭打到尾。
 */
console.log('\n6.5) 含空白的詞條要打得完');
{
  const { context, page } = await openCalibrated();
  // Week 4 的 "alarm clock"
  await page.goto(`${BASE}/game?group=w04&n=200&order=sequential&show=1&difficulty=easy`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

  // 一路打到那個含空白的詞條
  const PHRASE = 'alarm clock';
  let reached = false;
  for (let i = 0; i < 200; i += 1) {
    const target = await page.evaluate(() => window.__spellbee.state()?.target);
    if (!target) break;
    if (target === PHRASE) {
      reached = true;
      break;
    }
    for (const ch of target) await page.keyboard.press(ch);
    await page.waitForTimeout(40);
  }
  check(`出得到「${PHRASE}」這一題`, reached);

  if (reached) {
    const killedBefore = await page.evaluate(() => window.__spellbee.state().stats.wordsKilled);

    // 一個字元一個字元打，中間那一下就是空白鍵
    for (const ch of PHRASE) await page.keyboard.press(ch);
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => ({
      killed: window.__spellbee.state().stats.wordsKilled,
      wrong: window.__spellbee.state().stats.wrongLetters
    }));
    check('空白鍵被當成正確的字元', after.wrong === 0, `打錯 ${after.wrong} 次`);
    check('整個詞條打完、算一次擊殺', after.killed === killedBefore + 1, `${killedBefore} → ${after.killed}`);
  }

  // 空白鍵不該把整頁往下捲（預設行為沒擋掉的話畫面會跳）
  const scrolled = await page.evaluate(() => window.scrollY);
  check('空白鍵沒有把頁面捲走', scrolled === 0, String(scrolled));
  await context.close();
}

/* ── 6.8 Combo 三階的畫面 ───────────────────────────────── */
/*
 * 效果如果只改數值、畫面不講，他只會覺得「這次好像比較好打」，
 * 不會知道是自己連對五個換來的——而「我做對了才有的」正是獎勵的意義。
 */
console.log('\n6.8) Combo 三階看得見');
{
  const { context, page } = await openCalibrated();
  await page.goto(`${BASE}/game?group=w18&n=200&order=sequential&show=1&difficulty=easy`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

  // 連對五個字
  for (let i = 0; i < 5; i += 1) {
    const t = await page.evaluate(() => window.__spellbee.state()?.target);
    if (!t) break;
    for (const ch of t) await page.keyboard.press(ch);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(150);

  const shown = await page.evaluate(() => ({
    combo: window.__spellbee.state().combo,
    dashMs: window.__spellbee.state().dashMs,
    banner: window.__spellbeeScene.bonusText.text,
    bannerAlpha: window.__spellbeeScene.bonusText.alpha,
    label: window.__spellbeeScene.effectLabel.text
  }));
  check('連擊到 5', shown.combo === 5, String(shown.combo));
  check('效果真的發動了', shown.dashMs > 0, `${shown.dashMs}ms`);
  check('橫幅說出是什麼效果', shown.banner.includes('蜂群衝刺'), shown.banner);
  check('橫幅看得見', shown.bannerAlpha > 0.5, String(shown.bannerAlpha));
  check('效果進行中有常駐標示', shown.label.includes('衝刺中'), shown.label || '（空的）');

  // 效果結束後標示要收掉，不然他會以為還在加成
  await page.waitForFunction(() => window.__spellbee.state().dashMs === 0, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__spellbeeScene.effectLabel.text);
  check('效果結束後標示收掉', after === '', after || '（空的）');

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
