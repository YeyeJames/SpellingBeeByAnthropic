/**
 * 語音發話的時序。
 *
 * 回報：練習模式第一次唸單字時，有時候前面半秒聽不到。
 *
 * iOS Safari 的語音合成有兩個很典型的問題：cancel() 之後馬上 speak()
 * 會讓新的那段被切掉開頭；音訊工作階段剛啟用時的第一段語音也會被切掉。
 * 修法是「先用無聲語音把引擎叫醒」＋「發話前留一小段空檔」。
 *
 * ── 這支測試能驗到什麼、不能驗到什麼 ──────────────────────
 * **不能**：無頭瀏覽器沒有安裝任何語音，這裡聽不到聲音，
 * 所以「開頭有沒有被切掉」這件事我沒辦法在這台機器上直接驗證。
 * 真正的確認只能由你在 iPhone 上聽。
 *
 * **能**：把語音引擎換成一個會記錄呼叫時間的假引擎，驗證程式有沒有
 * 照著修法的規則走——那是這次唯一改動的東西，也是能被客觀檢查的部分：
 *   1. 第一次使用者手勢真的有叫醒引擎，而且是無聲的
 *   2. cancel 跟 speak 之間真的留了空檔，不是同一個 tick 接著發
 *   3. 連續要求唸兩個字時，前一個會作廢，不會兩個疊在一起
 *   4. 引擎完全不回應時，Promise 仍然會結束（競賽模式是 await 它的）
 *
 * 用法：node scripts/speech-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 假的語音引擎：記下每一次 cancel/speak 與它發生的時間。 */
const STUB = (opts = {}) => `
  window.__speechLog = [];
  const log = (type, extra) => window.__speechLog.push({ type, t: performance.now(), ...extra });
  /*
   * 一定要用 defineProperty。window.speechSynthesis 在 Chromium 上是唯讀的
   * 存取器，直接指派會**安靜地失敗**——真引擎還在，然後它會拒絕我們的假
   * utterance。第一次跑就是這樣掛的。
   */
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    writable: true,
    value: function (text) { this.text = text; this.volume = 1; }
  });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speaking: false,
    pending: false,
    onvoiceschanged: null,
    getVoices: () => [{ voiceURI: 'stub-en', lang: 'en-US', name: 'Stub English' }],
    cancel() { log('cancel'); this.speaking = false; this.pending = false; },
    speak(u) {
      log('speak', { text: u.text, volume: u.volume, rate: u.rate });
      this.speaking = true;
      ${opts.neverFinish
        ? '/* 故意不回應：驗保險絲 */'
        : `setTimeout(() => { this.speaking = false; if (u.onend) u.onend(); }, 100);`}
    }
  } });
`;

const browser = await chromium.launch({ executablePath: CHROME });

/* ── 1. 模組層級的時序 ─────────────────────────────────── */
console.log('1) cancel 與 speak 之間要留空檔');
{
  const context = await browser.newContext();
  await context.addInitScript(STUB());
  const page = await context.newPage();
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const mod = await import('/js/audio-player.js');
    window.__speechLog.length = 0;

    // 模擬換題：送出答案會 stopSpeaking()，緊接著唸下一題
    mod.stopSpeaking();
    await mod.speakWord('billboard');

    return window.__speechLog.map((e) => ({ ...e }));
  });

  const speaks = result.filter((e) => e.type === 'speak');
  check('單字有被唸出來', speaks.some((e) => e.text === 'billboard'),
    speaks.map((e) => e.text).join(',') || '（沒有）');

  /*
   * 關鍵的一條：speak 不可以跟 cancel 擠在同一個 tick。
   * 這就是 iOS 上開頭被切掉的直接原因。
   */
  const wordSpeak = speaks.find((e) => e.text === 'billboard');
  const before = result.filter((e) => e.t <= wordSpeak.t && e.type === 'cancel').pop();
  if (before) {
    const gap = wordSpeak.t - before.t;
    check('cancel 之後有等一下才 speak', gap >= 60, `隔了 ${Math.round(gap)}ms`);
  } else {
    // 沒有在唸東西時 stopSpeaking 不會真的 cancel，這也是對的
    check('沒東西在唸時不會多呼叫一次 cancel', true, '（沒有 cancel，正確）');
  }

  await context.close();
}

/* ── 2. 連續要求只留最後一個 ───────────────────────────── */
console.log('\n2) 連續換題時，前一個字要作廢');
{
  const context = await browser.newContext();
  await context.addInitScript(STUB());
  const page = await context.newPage();
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });

  const spoken = await page.evaluate(async () => {
    const mod = await import('/js/audio-player.js');
    window.__speechLog.length = 0;
    // 兩個字幾乎同時被要求唸出來（換題太快時就是這樣）
    const a = mod.speakWord('aaaa');
    const b = mod.speakWord('bbbb');
    await Promise.all([a, b]);
    return window.__speechLog.filter((e) => e.type === 'speak').map((e) => e.text);
  });

  /*
   * 這是聽寫遊戲，兩個字疊在一起唸等於直接害他打錯。
   * 後來的那個要贏，先來的那個必須在等空檔的時候自己放棄。
   */
  check('只唸最後要求的那一個', spoken.length === 1 && spoken[0] === 'bbbb', spoken.join(',') || '（沒有）');
  await context.close();
}

/* ── 3. 叫醒引擎 ───────────────────────────────────────── */
console.log('\n3) 第一次使用者手勢要把引擎叫醒');
{
  const context = await browser.newContext();
  await context.addInitScript(STUB());
  const page = await context.newPage();
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });

  const r = await page.evaluate(async () => {
    const mod = await import('/js/audio-player.js');
    window.__speechLog.length = 0;
    const first = mod.warmUpSpeech();
    const second = mod.warmUpSpeech(); // 重複呼叫不該再叫一次
    return {
      first,
      second,
      log: window.__speechLog.filter((e) => e.type === 'speak').map((e) => ({ text: e.text, volume: e.volume }))
    };
  });

  check('第一次呼叫有作用', r.first === true, String(r.first));
  check('重複呼叫不會再唸一次', r.second === false && r.log.length === 1, `${r.log.length} 次`);
  check('叫醒用的那一段是無聲的（聽不到）', r.log[0] && r.log[0].volume === 0, JSON.stringify(r.log[0]));
}

/* ── 4. 練習頁真的有接上 ───────────────────────────────── */
console.log('\n4) 按「開始練習」那一刻就叫醒');
{
  const context = await browser.newContext();
  await context.addInitScript(STUB());
  const USER = { _id: 'u', nickname: '測試', coins: 0, activeTheme: null, stats: { currentStreak: 0 } };
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
  await context.route('**/api/practice/session', async (r) => {
    const res = await fetch(`${BASE}/api/wordbank?group=w18`).then((x) => x.json());
    const words = res.words.slice(0, 3).map((w) => ({ ...w, _id: w.id, audio: { type: 'tts' } }));
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ words }) });
  });

  const page = await context.newPage();
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#part-picker .part-btn', { timeout: 15000 });
  await page.click('#part-picker .part-btn:has(.part-title:text-is("Week 18"))');
  await page.evaluate(() => {
    window.__speechLog.length = 0;
  });
  await page.click('#start-practice-btn');
  await page.waitForSelector('#practice-panel:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(900);

  const log = await page.evaluate(() => window.__speechLog.filter((e) => e.type === 'speak'));
  check('第一筆就是無聲的喚醒', log[0] && log[0].volume === 0, JSON.stringify(log[0] || null));
  check('接著才唸真正的單字', log.length >= 2 && log[1].volume !== 0, JSON.stringify(log[1] || null));

  if (log.length >= 2) {
    /*
     * 喚醒跟第一個單字之間也要有距離。這正是「第一次唸會被切掉」
     * 那個症狀發生的位置。
     */
    const gap = log[1].t - log[0].t;
    check('喚醒與第一個單字之間有空檔', gap >= 60, `隔了 ${Math.round(gap)}ms`);
  }
  await context.close();
}

/* ── 5. 引擎不回應時不能卡死 ───────────────────────────── */
console.log('\n5) 引擎完全不回應時，流程不能卡住');
{
  const context = await browser.newContext();
  await context.addInitScript(STUB({ neverFinish: true }));
  const page = await context.newPage();
  await page.goto(`${BASE}/practice.html`, { waitUntil: 'domcontentloaded' });

  /*
   * 被 cancel 的語音在某些瀏覽器上 onend 與 onerror 都不會觸發。
   * 競賽模式是 await 這個 Promise 的（單字 → 例句 → 再唸一次），
   * 沒有保險絲的話整個流程會停在那裡不動，而畫面上看起來就只是「卡住」。
   */
  const finished = await page.evaluate(async () => {
    const mod = await import('/js/audio-player.js');
    const t0 = performance.now();
    const ok = await mod.speakWord('a');
    return { ok, ms: Math.round(performance.now() - t0) };
  });

  check('Promise 有結束，沒有永遠等下去', finished.ms < 15000, `${finished.ms}ms 後結束`);
  check('而且誠實回報沒唸成功', finished.ok === false, String(finished.ok));
  await context.close();
}

await browser.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
