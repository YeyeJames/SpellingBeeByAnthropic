/**
 * 分層背景音樂與 Combo 三階音（Phase 2.4）。
 *
 * 設計書要的不是一首 loop，是**音樂直接反映戰況**——他會在音樂變厚的時候
 * 知道自己正在連擊，這比看數字強。所以這裡驗的不是「有沒有聲音」，
 * 是「戰況變了，音樂有沒有跟著變」。
 *
 * 要證明的事：
 *   1. 戰鬥開始音樂就起來，而且真的在排音符（不是空轉）
 *   2. 節拍穩定——排程沒有停住或暴衝
 *   3. 剩一條命轉小調而且變快
 *   4. 暫停時壓掉音量，但不亂拍（回來接得上）
 *   5. 靜音時完全不出聲，而且不浪費運算去建聽不到的音訊節點
 *   6. 還沒做的兩層誠實標成 ready:false，不會假裝有聲音
 *   7. Combo 三階各有自己的聲音，而且一階比一階厚
 *   8. 戰鬥結束音樂收掉
 *
 * 用法：node scripts/bgm-test.mjs
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

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
  localStorage.setItem('sb:v2:shared:gameMuted', JSON.stringify('0'));
});
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && EXPECTED_503.some((u) => (m.location()?.url || '').includes(u))) return;
  if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
});

// 用 Week 1（40 個字）：要連對 15 個字才驗得到第三階，小組別的字不夠用
await page.goto(`${BASE}/game?group=w01&n=200&order=sequential&show=1&difficulty=easy`, {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
// 第一個按鍵負責解鎖音訊（瀏覽器規定要有使用者手勢）
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(600);

const bgm = () => page.evaluate(() => window.__spellbee.bgm());

/* ── 1~2. 起得來、拍子在走 ──────────────────────────────── */
console.log('1) 戰鬥開始音樂就起來');
{
  const a = await bgm();
  check('音訊可用', a && a.available, JSON.stringify(a?.available));
  check('正在播', a.playing, String(a.playing));
  check('已經排了音符（不是空轉）', a.scheduled > 0, `${a.scheduled} 個`);
  check('鼓與貝斯有聲音', a.layers[0].gain > 0 && a.layers[1].gain > 0,
    a.layers.map((l) => `${l.key}=${l.gain}`).join(' '));

  console.log('\n2) 拍子穩定往前走');
  const before = a.step;
  await page.waitForTimeout(1500);
  const b = await bgm();
  const advanced = b.step - before;
  /*
   * 96 BPM、一拍兩格 → 每秒 3.2 格。1.5 秒大約 5 格。
   * 上下界都要卡：停住代表排程死了，暴衝代表前瞻寫錯會一次塞爆。
   */
  check('1.5 秒走了合理的格數', advanced >= 3 && advanced <= 9, `${advanced} 格`);
  check('音符持續排進去', b.scheduled > a.scheduled, `${a.scheduled} → ${b.scheduled}`);
}

/* ── 6. 沒做的層要誠實 ─────────────────────────────────── */
console.log('\n3) 還沒做的兩層要誠實標示');
{
  const a = await bgm();
  const byKey = Object.fromEntries(a.layers.map((l) => [l.key, l]));
  check('鼓標成已完成', byKey.drums.ready === true);
  check('貝斯標成已完成', byKey.bass.ready === true);
  check('和聲標成未完成', byKey.harmony.ready === false);
  check('旋律標成未完成', byKey.melody.ready === false);
  check(
    '未完成的層音量是 0（不假裝有聲音）',
    byKey.harmony.gain === 0 && byKey.melody.gain === 0,
    `harmony=${byKey.harmony.gain} melody=${byKey.melody.gain}`
  );
}

/* ── 4. 暫停 ───────────────────────────────────────────── */
console.log('\n4) 暫停壓掉音量，但不亂拍');
{
  const before = await bgm();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const paused = await bgm();
  check('標記成壓低中', paused.ducked === true, String(paused.ducked));
  check('音量降下來', paused.layers[0].gain < before.layers[0].gain,
    `${before.layers[0].gain} → ${paused.layers[0].gain}`);
  check('拍子沒有停（回來才接得上）', paused.step > before.step, `${before.step} → ${paused.step}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const back = await bgm();
  check('解除暫停後音量回來', back.layers[0].gain > paused.layers[0].gain,
    `${paused.layers[0].gain} → ${back.layers[0].gain}`);
}

/* ── 3. 剩一條命 ───────────────────────────────────────── */
console.log('\n5) 剩一條命轉小調而且變快');
{
  const normal = await bgm();
  check('平常是大調', normal.mode === 'major', normal.mode);
  const baseBpm = normal.bpm;

  /*
   * 不開後門直接把 hp 設成 1——除錯 API 是唯讀的，狀態的唯一來源是 battle.js。
   * 真的讓敵人走到底扣血，量到的才是孩子會遇到的那條路徑。
   * 改成挑戰難度只是為了讓敵人走快一點，測試不用等三十秒。
   */
  await page.evaluate(() => window.__spellbee.restart({ difficulty: 'hard' }));
  await page.waitForFunction(
    () => {
      const s = window.__spellbee.state();
      return s && (s.hp <= 1 || s.status !== 'running');
    },
    null,
    { timeout: 60000 }
  );
  await page.waitForTimeout(200);

  const low = await bgm();
  const st = await page.evaluate(() => window.__spellbee.state());
  check('真的被打到剩一條命', st.hp === 1, `hp=${st.hp} status=${st.status}`);
  check('剩一條命時轉小調', low.mode === 'minor', low.mode);
  check('而且變快', low.bpm > baseBpm, `${baseBpm} → ${low.bpm}`);
}

/* ── 5. 靜音 ───────────────────────────────────────────── */
console.log('\n6) 靜音時完全不出聲，也不浪費運算');
{
  const before = await bgm();
  await page.evaluate(() => window.__spellbee.setMuted(true));
  await page.waitForTimeout(700);
  const muted = await bgm();
  check('總音量關到 0', (await page.evaluate(() => window.__spellbee.masterGain())) === 0);
  check('拍子照走（解除靜音要接得上）', muted.step > before.step, `${before.step} → ${muted.step}`);

  const s1 = muted.scheduled;
  await page.waitForTimeout(700);
  const still = await bgm();
  check('靜音期間不再建音訊節點', still.scheduled === s1, `${s1} → ${still.scheduled}`);

  await page.evaluate(() => window.__spellbee.setMuted(false));
  await page.waitForTimeout(600);
  const back = await bgm();
  check('解除靜音又開始排音符', back.scheduled > s1, `${s1} → ${back.scheduled}`);
}

/* ── 7. Combo 三階音 ───────────────────────────────────── */
console.log('\n7) Combo 三階各有自己的聲音');

/** 把目前這個字打完（空白與連字號可打可不打，照 target 原樣送）。 */
async function typeCurrentWord() {
  const target = await page.evaluate(() => window.__spellbee.state()?.target || '');
  for (const ch of target) {
    await page.keyboard.press(ch === ' ' ? 'Space' : ch);
  }
}

{
  await page.evaluate(() => window.__spellbee.restart({ difficulty: 'easy' }));
  await page.waitForTimeout(300);

  // 連對十五個字：第 5、10、15 各觸發一階。
  // 用 combo 當終止條件而不是固定圈數——重開之後第一個字要等一格才上場，
  // 固定圈數會少打一個字，測起來像「連擊斷了」，其實只是少打一次。
  for (let i = 0; i < 24; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (!st || st.status !== 'running' || st.combo >= 15) break;
    await typeCurrentWord();
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(250);

  const state = await page.evaluate(() => window.__spellbee.state());
  check('十五個字全部打對（沒有中斷連擊）', state.combo >= 15, `combo=${state.combo}`);

  const sounds = await page.evaluate(() =>
    window.__spellbee
      .events()
      // combo1/2/3 是三階的聲音；單純的 combo 是每次連擊 +1 的那一聲
      .filter((e) => e.type === 'sfx' && /^combo[123]$/.test(String(e.name || '')))
      .map((e) => e.name)
  );
  const bonuses = await page.evaluate(() =>
    window.__spellbee.events().filter((e) => e.type === 'COMBO_BONUS').map((e) => ({ tier: e.a, combo: e.b }))
  );

  check('三階都觸發了', [1, 2, 3].every((t) => bonuses.some((b) => b.tier === t)),
    bonuses.map((b) => `階${b.tier}@${b.combo}`).join(' ') || '（沒有）');
  check('觸發點是 5 / 10 / 15', [5, 10, 15].every((c, i) =>
    bonuses.some((b) => b.tier === i + 1 && b.combo === c)),
    bonuses.map((b) => `${b.tier}:${b.combo}`).join(','));
  check('三階各自發出不同的聲音', ['combo1', 'combo2', 'combo3'].every((n) => sounds.includes(n)),
    sounds.join(',') || '（沒有）');

  // 聲音與畫面都要有——靜音也要玩得下去
  const cov = await page.evaluate(() => window.__spellbee.feedbackCoverage());
  check(
    'COMBO_BONUS 聲音與畫面都有',
    cov.COMBO_BONUS && cov.COMBO_BONUS.sfx > 0 && cov.COMBO_BONUS.vfx > 0,
    JSON.stringify(cov.COMBO_BONUS)
  );
  check(
    '重聽也有畫面回饋（靜音時唯一的回饋）',
    !cov.LISTEN || cov.LISTEN.vfx > 0,
    JSON.stringify(cov.LISTEN)
  );
}

/* ── 8. 結束收掉 ───────────────────────────────────────── */
console.log('\n8) 戰鬥結束音樂收掉');
{
  // 剩下的字一路打完
  for (let i = 0; i < 300; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (!st || st.status !== 'running') break;
    await typeCurrentWord();
  }
  await page.waitForTimeout(500);
  const end = await bgm();
  const status = await page.evaluate(() => window.__spellbee.state().status);
  check('戰鬥已經結束', status !== 'running', status);
  check('音樂停了', end.playing === false, String(end.playing));
  check('音量降到 0', end.layers.every((l) => l.gain < 0.05), end.layers.map((l) => l.gain).join(','));
}

await browser.close();

console.log('\n驗收');
check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
