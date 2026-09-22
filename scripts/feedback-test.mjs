/**
 * 即時回饋——規則要從演出中長出來，不是從說明書讀進去（campaign-design §9）。
 *
 * 上一輪做了 F1 玩法說明，那是必要的保底；但如果演出夠好，說明書就不會有人按。
 * 這支驗的是「已經在發生的事，畫面有沒有講出來」：
 *
 *   1. 打對一個字母 → 飄出 +1（而且數字跟實際加的蜂蜜一致）
 *   2. 狂蜂狀態下加倍 → 飄的是 +2，不是 +1
 *   3. 打掉一隻蟲 → 飄出擊殺獎勵；長字另外飄一行，他才知道長字有額外好處
 *   4. 打錯 → 紅字寫出前進幾秒，而且蟲**真的滑過去**而不是瞬移
 *   5. 重聽 → 同上。這是設計書特別點名的一條：他按了重聽、蟲突然前進，
 *      因為是瞬移，他不知道那是自己造成的還是遊戲壞了
 *   6. Combo 橫幅要寫出具體數字，不是只寫效果名稱
 *   7. 飄分不會把物件池打爆（戰鬥中不新建物件是硬性紀律）
 *   8. 衝刺純粹是畫面：邏輯位置一點都沒被延遲
 *
 * 用法：node scripts/feedback-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

const EXPECTED_503 = ['/api/words/recorded', '/api/game/access', '/api/game/result'];

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// 飄的數字必須跟這份設定一致，不是照抄一段文案
const { BALANCE } = await import('../public/js/game/core/balance.js');

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('easy'));
});
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && EXPECTED_503.some((u) => (m.location()?.url || '').includes(u))) return;
  if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
});

// Week 1 有 40 個字，連擊打得到 15（狂蜂狀態要用）
await page.goto(`${BASE}/game?group=w01&n=200&order=sequential&show=1&difficulty=easy`, {
  waitUntil: 'domcontentloaded'
});
await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });

const floats = () => page.evaluate(() => window.__spellbee.floats());
const state = () => page.evaluate(() => window.__spellbee.state());
const lag = () => page.evaluate(() => window.__spellbee.penaltyLag());

async function typeOne() {
  const ch = await page.evaluate(() => window.__spellbee.expectedLetter());
  if (!ch) return null;
  await page.keyboard.press(ch === ' ' ? 'Space' : ch);
  return ch;
}

async function typeWord() {
  const target = await page.evaluate(() => window.__spellbee.state()?.target || '');
  for (const ch of target) await page.keyboard.press(ch === ' ' ? 'Space' : ch);
  return target;
}

/* ── 1. 打對一個字母 ───────────────────────────────────── */
console.log('1) 打對一個字母，加了幾分要看得見');
{
  await typeOne();
  await page.waitForTimeout(120);
  const f = await floats();
  const plus = f.filter((x) => /^\+\d+$/.test(x.text));
  check('有飄出加分', plus.length > 0, f.map((x) => x.text).join(',') || '（沒有）');
  check(
    `飄的是 +${BALANCE.honey.perCorrectLetter}（跟實際加的蜂蜜一致）`,
    plus.some((x) => x.text === `+${BALANCE.honey.perCorrectLetter}`),
    plus.map((x) => x.text).join(',')
  );

  // 蜂蜜真的有加，而且加的量跟飄出來的數字一樣
  const s = await state();
  check('蜂蜜確實加上去了', s.honey === BALANCE.honey.perCorrectLetter, String(s.honey));
}

/* ── 2. 打錯的懲罰要看得見 ─────────────────────────────── */
console.log('\n2) 打錯的代價：紅字 + 蟲真的往前滑');
{
  const before = await state();
  // 找一個一定不對的字母
  const expected = await page.evaluate(() => window.__spellbee.expectedLetter());
  const wrong = expected === 'q' ? 'z' : 'q';
  await page.keyboard.press(wrong);
  await page.waitForTimeout(60);

  const f = await floats();
  const penalty = f.find((x) => x.text.includes('秒'));
  check(
    `飄出「-${BALANCE.wrongLetterPenaltyMs / 1000} 秒」`,
    penalty && penalty.text === `-${BALANCE.wrongLetterPenaltyMs / 1000} 秒`,
    penalty ? penalty.text : f.map((x) => x.text).join(',') || '（沒有）'
  );
  check('用紅色，不是加分的金色', penalty && penalty.color.toLowerCase() === '#f87171',
    penalty?.color || '');

  /*
   * 這一條是重點：蟲要「滑」過去，不是瞬移。
   * penaltyLag > 0 代表畫面位置還落後邏輯位置，也就是正在滑。
   */
  const l = await lag();
  check('蟲正在往前滑（不是瞬移）', l > 0, `落後 ${l.toFixed(4)}`);

  // 但邏輯位置當下就變了——演出絕對不能延遲邏輯，否則重播與確定性會壞掉
  const after = await state();
  check(
    '邏輯位置當下就更新了（演出沒有延遲邏輯）',
    after.progress > before.progress,
    `${before.progress} → ${after.progress}`
  );

  /*
   * 0.32 秒內要追上。
   *
   * 兩個地方以前會偶發假失敗：
   *   - 固定睡 700ms。衝刺是用時間算的，但整套測試一起跑時無頭瀏覽器的
   *     影格會變稀疏，最後一格有時候就落在 700ms 之後。改成等條件成立。
   *   - check() 原本呼叫 lag() 兩次——判斷一次、印出來又一次。兩次之間
   *     值會變，所以出現過「判斷失敗但印出來是 0」這種看不懂的紀錄。
   *     取樣一次，判斷與印出用同一個值。
   */
  await page
    .waitForFunction(() => window.__spellbee.penaltyLag() === 0, null, { timeout: 3000 })
    .catch(() => {});
  const settled = await lag();
  check('追上了（衝刺結束）', settled === 0, String(settled));
}

/* ── 3. 重聽的懲罰 ─────────────────────────────────────── */
console.log('\n3) 重聽的代價：設計書特別點名的那一條');
{
  await page.keyboard.press('ArrowUp'); // 再聽一次
  await page.waitForTimeout(60);
  const f = await floats();
  const cost = BALANCE.listenCostMs.replay / 1000;
  check(`飄出「-${cost} 秒」`, f.some((x) => x.text === `-${cost} 秒`),
    f.map((x) => x.text).join(',') || '（沒有）');
  check('蟲往前滑', (await lag()) > 0, String(await lag()));

  await page.waitForTimeout(700);

  // 慢唸的代價比較貴，飄出來的數字要跟著不同
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(60);
  const f2 = await floats();
  const slow = BALANCE.listenCostMs.slow / 1000;
  check(`慢唸飄的是「-${slow} 秒」（三種代價不一樣）`,
    f2.some((x) => x.text === `-${slow} 秒`),
    f2.map((x) => x.text).join(','));
  await page.waitForTimeout(700);
}

/* ── 4. 擊殺與長字 ─────────────────────────────────────── */
console.log('\n4) 打掉一隻蟲：擊殺獎勵與長字獎勵要分開看得到');
{
  await page.evaluate(() => window.__spellbee.restart({ difficulty: 'easy' }));
  await page.waitForTimeout(300);

  // 一路打到一個長字為止
  let longWord = null;
  for (let i = 0; i < 40; i += 1) {
    const s = await state();
    if (!s || s.status !== 'running') break;
    const isLong = s.target.length >= BALANCE.honey.longWordFrom;
    /*
     * 狂蜂狀態會讓蜂蜜加倍，所以預期值要看打到這個字的當下有沒有在狂蜂。
     * 直接寫死 +5 的話，這條會在連擊夠長時假性失敗——而那不是程式的錯。
     */
    const factor = s.frenzyMs > 0 ? BALANCE.combo.frenzyHoneyFactor : 1;
    await typeWord();
    await page.waitForTimeout(90);
    const f = await floats();
    if (isLong) {
      longWord = { target: s.target, floats: f.map((x) => x.text), factor };
      break;
    }
  }

  check('找得到一個長字來測', !!longWord, longWord ? longWord.target : '這一組沒有長字');
  if (longWord) {
    const kill = BALANCE.honey.perKill * longWord.factor;
    const bonus = BALANCE.honey.longWordBonus * longWord.factor;
    check(
      `${longWord.target}（${longWord.target.length} 字母）有飄出「長字」獎勵 +${bonus}`,
      longWord.floats.some((t) => t === `+${bonus} 長字！`),
      longWord.floats.join(' | ')
    );
    check(
      `擊殺獎勵 +${kill} 單獨飄一行`,
      longWord.floats.some((t) => t === `+${kill}`),
      longWord.floats.join(' | ')
    );
  }
}

/* ── 5. Combo 橫幅要有具體數字 ─────────────────────────── */
console.log('\n5) Combo 橫幅寫出具體數字，不是只寫效果名稱');
{
  await page.evaluate(() => window.__spellbee.restart({ difficulty: 'easy' }));
  await page.waitForTimeout(250);
  for (let i = 0; i < 8; i += 1) {
    const s = await state();
    if (!s || s.status !== 'running' || s.combo >= BALANCE.combo.dashAt) break;
    await typeWord();
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(120);

  const banner = await page.evaluate(() => {
    const scene = window.__spellbeeScene;
    return scene?.bonusText?.text || '';
  });
  const c = BALANCE.combo;
  check('橫幅出現了', banner.length > 0, banner || '（空的）');
  check('寫出減速幾 %', banner.includes(`${Math.round((1 - c.dashSpeedFactor) * 100)}%`), banner);
  check('寫出持續幾秒', banner.includes(`${c.dashMs / 1000} 秒`), banner);

  const f = await floats();
  check(`飄出「${c.dashAt} 連擊！」`, f.some((x) => x.text === `${c.dashAt} 連擊！`),
    f.map((x) => x.text).join(',') || '（沒有）');
}

/* ── 6. 狂蜂狀態的加倍要看得出來 ───────────────────────── */
console.log('\n6) 狂蜂狀態下，飄的數字要跟著加倍');
{
  // 連到 15 觸發狂蜂
  for (let i = 0; i < 20; i += 1) {
    const s = await state();
    if (!s || s.status !== 'running' || s.combo >= BALANCE.combo.frenzyAt) break;
    await typeWord();
    await page.waitForTimeout(40);
  }
  const s = await state();
  check('進入狂蜂狀態', s.frenzyMs > 0, `frenzyMs=${s.frenzyMs} combo=${s.combo}`);

  if (s.frenzyMs > 0) {
    await typeOne();
    await page.waitForTimeout(100);
    const f = await floats();
    const doubled = BALANCE.honey.perCorrectLetter * BALANCE.combo.frenzyHoneyFactor;
    check(
      `飄的是 +${doubled} 而不是 +${BALANCE.honey.perCorrectLetter}`,
      f.some((x) => x.text === `+${doubled}`),
      f.map((x) => x.text).join(',')
    );
  }
}

/* ── 7. 池子不會被打爆 ─────────────────────────────────── */
console.log('\n7) 飄分不會把物件池打爆');
{
  const before = await page.evaluate(() => window.__spellbee.effects());
  // 連打一整組，製造最密集的飄分
  for (let i = 0; i < 30; i += 1) {
    const st = await state();
    if (!st || st.status !== 'running') break;
    await typeWord();
  }
  const after = await page.evaluate(() => window.__spellbee.effects());
  /*
   * 回收本身不是問題（池子就是要回收），被中途抽掉才是。
   * 所以看的是「同時存在的數量有沒有頂到池子上限」。
   */
  check('同時存在的飄分沒有頂到上限', after.floats < 12, `最多 ${after.floats} / 12`);
  check('沒有瀏覽器錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  void before;
}

await browser.close();
console.log(`\n${failures === 0 ? '全部通過' : `有 ${failures} 項失敗`}`);
process.exit(failures === 0 ? 0 : 1);
