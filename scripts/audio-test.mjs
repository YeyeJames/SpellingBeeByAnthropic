/**
 * 音效測試——Phase 1.4 的驗收。
 *
 * 要證明的事：
 *   1. keydown → 把聲音排進音訊佇列，p95 ≤ 20ms
 *   2. 每一個有聲音的回饋，都有對應的畫面回饋（靜音也要能玩）
 *   3. 靜音真的是安靜的（主音量歸零），而且單字會改成顯示在畫面上
 *   4. 重聽／慢唸／例句三個鍵都會觸發聲音，而且各自付出代價
 *   5. 音訊節點沒有累積（連續打幾百下之後記憶體不會一路往上）
 *
 * 用法：node scripts/audio-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

/*
 * 這幾支要登入與資料庫，這台機器兩個都沒有，所以它們回 503、瀏覽器記一筆錯誤。
 * 全都是設計好會發生而且已經處理掉的：拿不到錄音就用機器語音，問不到解鎖狀態
 * 就放行，分數記不到就算了。不算故障——但也不能整段忽略 503，
 * 否則真的壞掉時測試會安靜地放行。只放行這幾支。
 */
const EXPECTED_503 = ['/api/words/recorded', '/api/game/access', '/api/game/result'];

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/*
 * --autoplay-policy 讓無頭瀏覽器不必先有使用者手勢就能發聲。
 * 真實瀏覽器是靠玩家的第一個按鍵解鎖的（見 game.js 的 sfx.unlock）。
 * --expose-gc 用來量真正被留住的記憶體。
 */
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  /*
   * 「哪些字有真人錄音」那支要登入與資料庫，這台機器兩個都沒有，
   * 所以它回 503、瀏覽器記一筆錯誤。這是設計好會發生而且已經處理掉的
   * （拿不到就全部用機器語音），不算故障——但也不能整段忽略 503，
   * 否則真的壞掉時測試會安靜地放行。只放行這一支。
   */
  if (m.type() === 'error' && EXPECTED_503.some((u) => (m.location()?.url || '').includes(u))) return;
  if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
});

await page.goto(`${BASE}/game?seed=4242&part=all&n=100&difficulty=easy&order=sequential&show=1`, {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, {
  timeout: 15000
});

/* ── 0. 音訊到底有沒有起來 ──────────────────────────────── */
console.log('0) 音訊環境');
{
  await page.keyboard.press('a'); // 第一個按鍵負責解鎖音訊
  const rep = await page.evaluate(() => window.__spellbee.audioLatency());
  console.log(
    `     AudioContext ${rep.contextState}　裝置輸出延遲 ${rep.outputLatencyMs}ms` +
      `（base ${rep.baseLatencyMs}ms）`
  );
  check('AudioContext 有啟動', rep.contextState === 'running', rep.contextState);
}

/* ── 1. 按鍵到發聲的延遲 ────────────────────────────────── */
console.log('\n1) keydown → 排進音訊佇列的延遲');
{
  for (let i = 0; i < 400; i += 1) {
    const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
    if (!ch) break;
    await page.keyboard.press(ch);
    if (i % 5 === 0) await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  const rep = await page.evaluate(() => window.__spellbee.audioLatency());
  const vis = await page.evaluate(() => window.__spellbee.latency());
  console.log(
    `     聲音：樣本 ${rep.samples}　p50 ${rep.p50}ms　p95 ${rep.p95}ms　最差 ${rep.worst}ms`
  );
  console.log(
    `     畫面：樣本 ${vis.samples}　p50 ${vis.p50}ms　p95 ${vis.p95}ms` +
      `（另有 ${vis.deferred} 個按鍵是頓挫期間排隊後補上的，不列入統計）`
  );
  check('樣本數 ≥ 300', rep.samples >= 300, String(rep.samples));
  check('p95 ≤ 20ms', rep.p95 <= 20, `${rep.p95}ms`);
}

/* ── 2. 聲音回饋都要有畫面回饋 ──────────────────────────── */
console.log('\n2) 每個聲音回饋都要有對應的畫面回饋');
{
  // 製造一次重聽與一次漏字，讓事件種類湊齊
  await page.keyboard.press('ArrowUp');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.keyboard.press('ArrowDown');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  // 亂打幾個字母製造失誤
  for (const ch of 'zzz') {
    await page.keyboard.press(ch);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }

  const cov = await page.evaluate(() => window.__spellbee.feedbackCoverage());
  // 這些事件的資訊不能只存在於聲音裡
  const dual = ['LETTER_OK', 'LETTER_BAD', 'WORD_KILLED', 'COMBO_UP', 'LISTEN'];
  const missing = dual.filter((k) => cov[k] && (cov[k].sfx === 0 || cov[k].vfx === 0));
  const seen = dual.filter((k) => cov[k]);
  console.log(`     涵蓋的事件：${seen.join(', ')}`);
  check('測到的事件種類 ≥ 4 種', seen.length >= 4, seen.join(','));
  check(
    '沒有只有聲音、沒有畫面的事件',
    missing.length === 0,
    missing.map((k) => `${k}=${JSON.stringify(cov[k])}`).join(' | ')
  );
}

/* ── 3. 靜音 ────────────────────────────────────────────── */
console.log('\n3) 靜音要真的安靜，而且單字改成顯示在畫面上');
{
  const before = await page.evaluate(() => ({
    muted: window.__spellbee.isMuted(),
    gain: window.__spellbee.masterGain(),
    shows: window.__spellbee.showsWord()
  }));
  const after = await page.evaluate(() => {
    window.__spellbee.setMuted(true);
    return {
      muted: window.__spellbee.isMuted(),
      gain: window.__spellbee.masterGain(),
      shows: window.__spellbee.showsWord()
    };
  });
  check('靜音前主音量大於 0', before.gain > 0, String(before.gain));
  check('靜音後主音量為 0', after.gain === 0, String(after.gain));
  check('靜音後改成顯示單字（否則聽寫遊戲沒得玩）', after.shows === true);

  const restored = await page.evaluate(() => {
    window.__spellbee.setMuted(false);
    return window.__spellbee.masterGain();
  });
  check('取消靜音後音量回來', restored > 0, String(restored));
}

/* ── 3.5 沒有喇叭的電腦 ─────────────────────────────────── */
/*
 * 回報：診所的電腦沒有喇叭，想用靜音模式測手感，結果一個字都看不到。
 *
 * 原本的規則是「靜音或這台裝置沒有英文語音才顯示單字」。規則本身沒錯，
 * 但它把「看得到字」藏在一個講的是**聲音**的按鈕後面——Windows 上一定
 * 裝得有語音，所以自動規則判定不用顯示；而他聽不到任何東西，畫面上又是
 * 一片空白，唯一的解法竟然是去按「靜音」。沒有人猜得到。
 *
 * 這一段要開一個**獨立的頁面**：上面那些測試都帶 show=1，而那個參數
 * 會蓋過一切（無頭瀏覽器沒有語音，不強制顯示就看不到題目），
 * 在那種頁面上這顆按鈕怎麼按都不會變——第一次就是這樣假性失敗的。
 */
console.log('\n3.5) 沒喇叭也要能看得到單字');
{
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // 重現診所電腦：有安裝英文語音、沒有靜音
  await ctx2.addInitScript(() => {
    localStorage.setItem('sb:v2:shared:gameMuted', JSON.stringify('0'));
    localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
    localStorage.removeItem('sb:v2:shared:gameShowWord');
    const voices = [{ voiceURI: 'en1', lang: 'en-US', name: 'Stub', default: true, localService: true }];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        onvoiceschanged: null,
        getVoices: () => voices,
        cancel() {},
        speak(u) { setTimeout(() => u.onend && u.onend(), 40); }
      }
    });
  });
  const page2 = await ctx2.newPage();

  // 不帶 order= 才會停在開場畫面
  await page2.goto(`${BASE}/game?group=p1&n=50&difficulty=easy`, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });

  /*
   * 開場畫面就要能選。只放在遊戲外框那一排是不夠的——
   * 等他找到按鈕，第一隻蟲已經撞進蜂巢了。
   */
  check('開場畫面上就有聲音開關', (await page2.locator('#pregame-mute').count()) === 1);
  check('開場畫面上就有顯示單字開關', (await page2.locator('#pregame-show-word').count()) === 1);

  const read = () =>
    page2.evaluate(() => ({
      shows: window.__spellbee.showsWord(),
      pregame: document.getElementById('pregame-show-word').textContent.trim(),
      chrome: document.getElementById('btn-show-word').textContent.trim(),
      disabled: document.getElementById('pregame-show-word').disabled
    }));

  const before = await read();
  check('有語音又沒靜音時，預設不顯示單字（這就是他遇到的狀態）', before.shows === false, JSON.stringify(before));

  await page2.click('#pregame-show-word');
  await page2.waitForTimeout(200);
  const on = await read();
  check('按一下就看得到單字了', on.shows === true, JSON.stringify(on));
  /*
   * 按鈕上寫的要是**現在的狀態**，不是「按下去會變成什麼」。
   * 寫成動作的話小孩會完全反過來理解。
   */
  check('按鈕寫的是現況', on.pregame.includes('👁'), on.pregame);
  check('開場與外框那兩顆講同一件事', on.pregame === on.chrome, `${on.pregame} / ${on.chrome}`);

  // 設定要能帶進戰鬥，不是只在開場畫面有效
  await page2.click('[data-order="sequential"]');
  await page2.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  await page2.waitForTimeout(500);
  const inBattle = await page2.evaluate(() => ({
    shows: window.__spellbee.showsWord(),
    alpha: window.__spellbeeScene.wordText.alpha,
    text: window.__spellbeeScene.wordText.text
  }));
  check('開打之後單字真的畫出來了', inBattle.alpha === 1 && inBattle.text.length > 0,
    JSON.stringify(inBattle));

  /*
   * 靜音又不顯示 = 完全沒得玩，而「靜音也要能玩」是硬性要求。
   * 多按一下就會進到那個狀態，畫面上又不會有任何說明——
   * 所以靜音時這顆要鎖住，而不是讓他按了沒反應。
   */
  await page2.evaluate(() => window.__spellbee.setMuted(true));
  await page2.waitForTimeout(200);
  const muted = await read();
  check('靜音時一定顯示單字', muted.shows === true, JSON.stringify(muted));
  check('而且關不掉（按鈕鎖住，不是按了沒反應）', muted.disabled === true, String(muted.disabled));

  await ctx2.close();
}

/* ── 4. 三個聽力鍵 ──────────────────────────────────────── */
console.log('\n4) 再聽／慢唸／例句都要有聲音，而且各自付出代價');
{
  const result = await page.evaluate(async () => {
    const out = { listens: 0, progressGrew: 0 };
    const before = window.__spellbee.state();
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowRight']) {
      const s0 = window.__spellbee.state();
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      /*
       * 等佇列排空再比對。
       *
       * 擊殺頓挫期間按鍵會先排隊，所以「按下去的下一格」不一定已經套用；
       * 直接比較會量到頓挫而不是重聽的代價。
       */
      for (let i = 0; i < 40 && window.__spellbee.queue().size > 0; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      await new Promise(requestAnimationFrame);
      const s1 = window.__spellbee.state();
      // 換字了就跳過這一筆（progress 會歸零，比了沒意義）
      if (s1.wordIndex === s0.wordIndex && s1.progress > s0.progress) out.progressGrew += 1;
      else if (s1.wordIndex !== s0.wordIndex) out.progressGrew += 1;
    }
    out.listens = window.__spellbee.state().stats.listens - before.stats.listens;
    return out;
  });
  check('三個鍵都被記成重聽', result.listens === 3, `listens +${result.listens}`);
  check('三次都讓敵人前進（重聽有代價）', result.progressGrew === 3, `${result.progressGrew}/3`);
}

/* ── 5. 音訊節點不會累積 ────────────────────────────────── */
console.log('\n5) 連續發聲不會讓記憶體一路往上');
{
  const heapBefore = await page.evaluate(() => {
    if (window.gc) {
      window.gc();
      window.gc();
    }
    return performance.memory ? performance.memory.usedJSHeapSize : 0;
  });
  for (let i = 0; i < 300; i += 1) {
    const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
    if (!ch) break;
    await page.keyboard.press(ch);
  }
  // 讓已排程的聲音播完並被回收
  await page.waitForTimeout(1200);
  const heapAfter = await page.evaluate(() => {
    if (window.gc) {
      window.gc();
      window.gc();
    }
    return performance.memory ? performance.memory.usedJSHeapSize : 0;
  });
  const growthMB = (heapAfter - heapBefore) / 1048576;
  check('再打 300 下之後 GC 留下 ≤ 1.5MB', growthMB <= 1.5, `${growthMB.toFixed(2)}MB`);
}

await browser.close();

console.log('\n驗收');
check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
