/**
 * C3：100 關的戰役。
 *
 * 要證明的事：
 *   1. 表本身：剛好 100 關、四章、三個中王一個大魔王
 *   2. **整本課本都走得到**——第 1 章 24 關要把 24 個週組各用一次，
 *      一組都不能漏。這是這個遊戲的底線：它不是遊戲，是拼字練習。
 *   3. 關卡表是從單字庫算出來的，不是抄一份——單字庫改了表要跟著改
 *   4. 解鎖：只看「前一關過了沒」，不看等級（§6 明訂）
 *   5. 伺服器守門：改網址跳關會被擋，送假的過關結果不會讓進度亂跳
 *   6. 星等：打贏 1 顆、正確率 ≥90% 2 顆、零失誤 3 顆
 *   7. 地圖頁畫得出來，而且「下一關」看得出來
 *
 * 用法：node scripts/campaign-test.mjs
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createFakeDb, installFakeDb } from './lib/fake-mongo.mjs';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const { buildCampaign, levelAt, isUnlocked, campaignSummary, TOTAL_LEVELS, CHAPTERS } = await import(
  '../public/js/shared/campaign.js'
);
const wordBank = require('../server/data/word-bank.js');
const GROUPS = wordBank.listGroups();
const campaign = buildCampaign(GROUPS);

/* ── 1. 表的形狀 ─────────────────────────────────────────── */
console.log('1) 關卡表');
{
  check(`剛好 ${TOTAL_LEVELS} 關`, campaign.length === TOTAL_LEVELS, String(campaign.length));
  check('關號從 1 連到 100，沒有跳號也沒有重複',
    campaign.every((l, i) => l.level === i + 1));
  check('四章', new Set(campaign.map((l) => l.chapter)).size === CHAPTERS.length);

  const bosses = campaign.filter((l) => l.kind === 'midboss').map((l) => l.level);
  check('三個中王，在 25 / 50 / 75', JSON.stringify(bosses) === '[25,50,75]', JSON.stringify(bosses));
  const fin = campaign.filter((l) => l.kind === 'finalboss');
  check('一個大魔王，在第 100 關', fin.length === 1 && fin[0].level === 100);
  check('大魔王是競賽單字全部 100 字', fin[0].wordCount === 100, String(fin[0].wordCount));

  check('每一關都有字', campaign.every((l) => l.wordCount > 0),
    campaign.filter((l) => !l.wordCount).map((l) => l.level).join(','));
  check('每一關都指定了出題順序',
    campaign.every((l) => l.order === 'sequential' || l.order === 'random'));
}

/* ── 2. ⭐ 整本課本都要走得到 ────────────────────────────── */
console.log('2) ⭐ 一組單字都不能漏');
{
  const weekIds = GROUPS.filter((g) => g.kind === 'week').map((g) => g.id);
  check('單字庫有 24 個週組', weekIds.length === 24, String(weekIds.length));

  for (const ch of [1, 2]) {
    const used = campaign
      .filter((l) => l.chapter === ch && l.kind === 'normal')
      .flatMap((l) => l.groupIds);
    const missing = weekIds.filter((id) => !used.includes(id));
    check(`第 ${ch} 章 24 關剛好把 24 組各走一次`,
      used.length === 24 && new Set(used).size === 24 && missing.length === 0,
      missing.length ? `漏了 ${missing.join(',')}` : `${new Set(used).size} 組`);
  }

  /*
   * 第 3 章是混合關，一關三組。它不必「各一次」，但仍然要涵蓋全部——
   * 有哪一組永遠沒被排到的話，那一週的字他在第 3 章就永遠碰不到。
   */
  const ch3 = campaign.filter((l) => l.chapter === 3 && l.kind === 'normal').flatMap((l) => l.groupIds);
  const miss3 = weekIds.filter((id) => !ch3.includes(id));
  check('第 3 章的混合關涵蓋全部 24 組', miss3.length === 0, miss3.join(','));

  const contestIds = GROUPS.filter((g) => g.kind === 'contest').map((g) => g.id);
  const bossGroups = campaign.filter((l) => l.kind !== 'normal').flatMap((l) => l.groupIds);
  check('競賽單字四組都在王關裡出現',
    contestIds.every((id) => bossGroups.includes(id)), contestIds.join(','));
}

/* ── 3. 表是算出來的，不是抄的 ──────────────────────────── */
console.log('3) 單字庫改了，關卡表要跟著改');
{
  /*
   * 拿掉一組再建一次表，內容必須跟著變。
   * 如果表是抄死的，這一條會發現它還在指著一個已經不存在的組——
   * 而那個症狀是「第 12 關打不開」，很難查。
   */
  const fewer = GROUPS.filter((g) => g.id !== 'w07');
  const rebuilt = buildCampaign(fewer);
  const stillThere = rebuilt.some((l) => l.groupIds.includes('w07'));
  check('拿掉一組之後，表裡不會再有它', stillThere === false);
  check('關數不變（章節結構固定）', rebuilt.length === TOTAL_LEVELS, String(rebuilt.length));
}

/* ── 4. 解鎖規則 ─────────────────────────────────────────── */
console.log('4) 解鎖只看前一關');
{
  check('一開始第 1 關就開著', isUnlocked(1, 0) === true);
  check('第 2 關還沒開', isUnlocked(2, 0) === false);
  check('過了第 1 關，第 2 關開了', isUnlocked(2, 1) === true);
  check('過了第 1 關，第 3 關還是沒開', isUnlocked(3, 1) === false);
  check('過了第 40 關，前面的都還開著', isUnlocked(5, 40) === true);

  const s = campaignSummary(campaign, 24);
  check('進度摘要算得出百分比', s.cleared === 24 && s.percent === 24, JSON.stringify(s.percent));
  check('摘要指得出下一關是第 25 關（中王）',
    s.next?.level === 25 && s.next.kind === 'midboss', JSON.stringify(s.next?.level));
}

/* ── 5~6. 伺服器 ─────────────────────────────────────────── */
console.log('5) 伺服器守門與星等');
{
  const store = {
    users: [], campaignProgress: [], purchases: [], gameResults: [],
    groupProgress: [], groupCompletions: [], wordProgress: [], attempts: [], practiceSessions: [], wordAudio: []
  };
  const fake = createFakeDb(store, { uniqueIndexes: { campaignProgress: ['userId'] } });
  installFakeDb(fake);

  const express = require('express');
  const User = require('../server/models/User.js');
  const user = await User.createUser('戰役測試');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: String(user._id), destroy: (cb) => cb && cb() };
    next();
  });
  app.use('/api/campaign', require('../server/routes/campaign.js'));
  const server = app.listen(0);
  const port = server.address().port;
  const call = async (method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const map = await call('GET', '/api/campaign');
  check('拿得到整張表', map.status === 200 && map.body.levels.length === TOTAL_LEVELS,
    `${map.status}、${map.body?.levels?.length} 關`);
  check('新帳號只有第 1 關開著',
    map.body.levels.filter((l) => l.unlocked).length === 1 &&
    map.body.levels[0].unlocked === true,
    `${map.body.levels.filter((l) => l.unlocked).length} 關開著`);

  const lv1 = await call('GET', '/api/campaign/level/1');
  check('第 1 關拿得到題目', lv1.status === 200 && lv1.body.wordIds.length > 0,
    `${lv1.status}、${lv1.body?.wordIds?.length} 個字`);
  check('第 1 關是 Week 1、照順序',
    lv1.body.level.groupIds[0] === 'w01' && lv1.body.order === 'sequential',
    `${lv1.body?.level?.groupIds}、${lv1.body?.order}`);

  /*
   * 改網址跳關要被擋。
   * 只靠地圖頁把格子變灰是不夠的——那顆格子按不按得到是瀏覽器說了算。
   */
  const lv50 = await call('GET', '/api/campaign/level/50');
  check('沒解開的關卡拿不到題目', lv50.status === 403, `${lv50.status} ${lv50.body?.error || ''}`);
  check('而且說得出要先過哪一關', lv50.body?.nextLevel === 1, String(lv50.body?.nextLevel));

  const cheat = await call('POST', '/api/campaign/clear', { level: 100, won: true, accuracy: 1 });
  check('直接送「第 100 關過了」會被擋', cheat.status === 403, `${cheat.status}`);

  // 正常過關
  const clear1 = await call('POST', '/api/campaign/clear', { level: 1, won: true, accuracy: 0.8 });
  check('過了第 1 關', clear1.status === 200 && clear1.body.highestCleared === 1,
    JSON.stringify(clear1.body?.highestCleared));
  check('打贏但正確率普通 → 1 顆星', clear1.body.stars === 1, String(clear1.body.stars));
  check('下一關指向第 2 關', clear1.body.nextLevel === 2, String(clear1.body.nextLevel));

  const lv2 = await call('GET', '/api/campaign/level/2');
  check('第 2 關現在開得起來了', lv2.status === 200, String(lv2.status));

  // 輸掉不會推進度
  const lose = await call('POST', '/api/campaign/clear', { level: 2, won: false, accuracy: 0.5 });
  check('輸了不會解開下一關', lose.body.highestCleared === 1 && lose.body.advanced === false,
    JSON.stringify(lose.body));

  // 星等
  const clear2 = await call('POST', '/api/campaign/clear', { level: 2, won: true, accuracy: 0.95 });
  check('正確率 95% → 2 顆星', clear2.body.stars === 2, String(clear2.body.stars));
  const clear2b = await call('POST', '/api/campaign/clear', { level: 2, won: true, accuracy: 1 });
  check('零失誤 → 3 顆星', clear2b.body.stars === 3, String(clear2b.body.stars));
  /*
   * 星等只進不退：拿過三顆星之後再打一次打得差，不該把紀錄洗掉。
   * 不然「回頭拿三星」這件事就變成有風險的，他就不會去做。
   */
  const clear2c = await call('POST', '/api/campaign/clear', { level: 2, won: true, accuracy: 0.5 });
  check('再打一次打得差，星等不會掉', clear2c.body.stars === 3, String(clear2c.body.stars));

  // 已經過的關再打不會讓進度倒退
  const again1 = await call('POST', '/api/campaign/clear', { level: 1, won: true, accuracy: 1 });
  check('回頭重打第 1 關，進度不會倒退', again1.body.highestCleared === 2,
    String(again1.body.highestCleared));

  const after = await call('GET', '/api/campaign');
  check('地圖上前 3 關是開的', after.body.levels.filter((l) => l.unlocked).length === 3,
    String(after.body.levels.filter((l) => l.unlocked).length));
  check('過了的關卡有記星等', after.body.levels[1].stars === 3, String(after.body.levels[1].stars));

  server.close();
}

/* ── 7. 地圖頁 ───────────────────────────────────────────── */
console.log('6) 地圖頁');
{
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const page = await ctx2.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const FAKE_USER = {
    _id: 'u-camp', nickname: '測試', coins: 0, activeTheme: 'sports',
    ownedItemKeys: [], avatar: { baseCharacter: 'rookie', accessories: [] }
  };
  await ctx2.route('**/api/auth/me*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: FAKE_USER }) }));

  // 假裝已經過了 3 關
  const highestCleared = 3;
  await ctx2.route('**/api/campaign', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chapters: CHAPTERS.map((c) => ({ n: c.n, title: c.title, blurb: c.blurb })),
        summary: campaignSummary(campaign, highestCleared),
        highestCleared,
        levels: campaign.map((l) => ({
          ...l,
          unlocked: isUnlocked(l.level, highestCleared),
          cleared: l.level <= highestCleared,
          stars: l.level <= highestCleared ? 2 : 0
        }))
      })
    }));
  await ctx2.addInitScript((u) => {
    try { localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u)); } catch (e) { /* 無痕 */ }
  }, FAKE_USER);

  await page.goto(`${BASE}/campaign.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.level-cell', { timeout: 8000 }).catch(() => {});

  const ui = await page.evaluate(() => ({
    progress: document.getElementById('campaign-progress')?.textContent || '',
    next: document.getElementById('campaign-next')?.textContent || '',
    chapters: document.querySelectorAll('.chapter').length,
    cells: document.querySelectorAll('.level-cell').length,
    cleared: document.querySelectorAll('.level-cell.is-cleared').length,
    nextCells: document.querySelectorAll('.level-cell.is-next').length,
    locked: document.querySelectorAll('.level-cell.is-locked').length,
    firstHref: document.querySelector('.level-cell.is-next')?.getAttribute('href') || '',
    lockedIsLink: !!document.querySelector('a.level-cell.is-locked')
  }));

  check('寫出打到第幾關', /3\s*\/\s*100/.test(ui.progress), ui.progress);
  check('寫出下一關是什麼', /第 4 關/.test(ui.next), ui.next);
  check('四章都畫出來', ui.chapters === 4, String(ui.chapters));
  check('一百個格子', ui.cells === 100, String(ui.cells));
  check('過了的標成已完成', ui.cleared === 3, String(ui.cleared));
  /*
   * 「下一關」只能有一個，而且要最顯眼。
   * 一百個格子裡他真正需要找到的就是這一個。
   */
  check('「下一關」只有一個', ui.nextCells === 1, String(ui.nextCells));
  check('點下一關會帶到那一關', ui.firstHref === '/game?level=4', ui.firstHref);
  check('鎖著的格子不是連結（點不進去）', ui.lockedIsLink === false);
  check('鎖著的還看得到（他要知道前面有什麼）', ui.locked === 96, String(ui.locked));

  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* ── 7. ⭐ 關卡真的打得開 ────────────────────────────────────
 *
 * 這一段是補上那個讓戰役整個不能玩、卻一路測試全綠的漏洞。
 *
 * 他按下第 1 關（地圖上明明寫著「Week 1・40 字」），畫面回
 * 「無法開始遊戲：這一關沒有可以打的字」。
 *
 * 原因：遊戲頁拿到關卡的 wordIds 之後，會去 /api/wordbank?part=all
 * 把單字內容撈回來配對——而伺服器那邊 part=all 走進 wordsByPart('all')，
 * 也就是 w.part === Number('all') → NaN，跟任何東西比都是 false，
 * 於是安靜地回**空陣列**。沒有 500、沒有錯誤，只是 0 筆。
 *
 * 前面 1～6 節全部都是綠的，因為它們各自測「關卡表算得對」與
 * 「地圖頁畫得出來」，**沒有一節真的把一關打開**。兩邊各自正確，
 * 接起來是斷的——所以這一節測的是那個接縫：
 * 真的開一關，用真的 /api/wordbank，看遊戲有沒有真的開始。
 */
console.log('7) ⭐ 關卡真的打得開（用真的 /api/wordbank）');
{
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx3.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const FAKE_USER = {
    _id: 'u-play', nickname: '測試', coins: 0, xp: 0, activeTheme: 'sports',
    ownedItemKeys: [], avatar: { baseCharacter: 'rookie', accessories: [] }
  };
  await ctx3.route('**/api/auth/me*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: FAKE_USER }) }));

  /*
   * 只假造需要登入的那一支（/api/campaign/level/1），內容照伺服器真正會回的
   * 形狀組出來——單字 id 是從真的單字庫拿的。
   * /api/wordbank 故意**不假造**：壞掉的就是它，假造了這一節就白測了。
   */
  const lvl1 = campaign[0];
  const lvl1Words = lvl1.groupIds.flatMap((g) => wordBank.wordsByGroup(g));
  await ctx3.route('**/api/campaign/level/1', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        level: lvl1,
        wordBankId: 'g3a',
        wordIds: lvl1Words.map((w) => w.id),
        limit: lvl1.wordLimit,
        order: lvl1.order
      })
    }));
  await ctx3.addInitScript((u) => {
    try {
      localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u));
      /*
       * 難度先存好，跳過開場的手速校準。
       *
       * 全新的瀏覽器沒有這個值，遊戲會先要他打 CAT / DOG / SUN 三個字量手速，
       * 這時候 __spellbee.ready 還是 false。不設的話這一節會卡在校準畫面逾時，
       * 看起來像關卡打不開——那是測試自己的問題，不是產品的。
       */
      localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
    } catch (e) { /* 無痕 */ }
  }, FAKE_USER);

  // difficulty 走網址（優先序最高），比塞 localStorage 可靠
  await page.goto(`${BASE}/game?level=1&difficulty=normal`, { waitUntil: 'domcontentloaded' });

  /*
   * 開場有一張「照順序 / 打亂」的設定畫面，要先按過去戰鬥才會開始
   * （__spellbee.ready 在那之前是 false）。
   */
  await page.waitForSelector('.btn-order', { timeout: 20000 }).catch(() => {});
  const preGameText = await page.evaluate(() => document.body.innerText);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.btn-order')].find((e) => e.textContent.includes('照順序'));
    if (b) b.click();
  });

  const started = await page
    .waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  /*
   * 錯誤訊息直接抓出來當佐證——紅掉的時候要一眼看出是哪一種失敗，
   * 而不是只有「逾時」。
   */
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .map((e) => (e.children.length === 0 ? e.textContent.trim() : ''))
      .find((t) => t && t.includes('無法開始遊戲')) || '');

  check('第 1 關開得起來', started, shown || (started ? '' : '逾時'));
  check('沒有「無法開始遊戲」', shown === '', shown);

  /*
   * ⭐ 地圖上寫幾個字，就要真的打幾個字。
   *
   * 修好 part=all 之後關卡開得起來了，但開場畫面寫的是「總共 20 個字」——
   * 地圖明明寫 Week 1 是 40 字。原因是關卡的 wordLimit 是 null（單組不設上限），
   * 而遊戲頁 `ctx.levelLimit || 20` 把 null 當成「用預設 20」。
   *
   * 這比「打不開」更難發現：遊戲照樣開得起來、照樣打得完，只是**每一關都少一半**。
   * 第一章的工作是「把整本課本走過一遍」，少一半就等於這件事沒做到。
   */
  check('開場寫的字數跟地圖一樣',
    preGameText.includes(`總共 ${lvl1.wordCount} 個字`),
    (preGameText.match(/總共 \d+ 個字/) || ['（找不到）'])[0] + ` / 地圖寫 ${lvl1.wordCount}`);

  if (started) {
    const st = await page.evaluate(() => window.__spellbee.state());
    check('真的載到字了', !!st && !!st.target, st ? `第一個字：${st.target}` : '沒有狀態');
  }

  check('沒有 JS 例外', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* ── 8. part=all 的約定 ────────────────────────────────────
 * 上面那個 bug 的根：同一個字串在兩個呼叫端代表同一件事，
 * 但只有其中一種寫法是通的。這裡把約定本身釘住。
 */
console.log('8) /api/wordbank 的 part=all 要給整本');
{
  const all = await fetch(`${BASE}/api/wordbank?part=all&bank=g3a`).then((r) => r.json());
  check('part=all 回整本，不是 0 筆', all.words.length === 749, `${all.words.length} 筆`);

  const none = await fetch(`${BASE}/api/wordbank?bank=g3a`).then((r) => r.json());
  check('不帶 part 也是整本（兩種寫法要一致）',
    none.words.length === all.words.length, `${none.words.length} vs ${all.words.length}`);

  const p1 = await fetch(`${BASE}/api/wordbank?part=1&bank=g3a`).then((r) => r.json());
  check('指定 part 還是只給那一個 part', p1.words.length === 25, `${p1.words.length} 筆`);

  // 亂傳要明講，不可以安靜地回 0 筆——那正是這次沒被發現的原因
  const bad = await fetch(`${BASE}/api/wordbank?part=foo&bank=g3a`);
  check('part 亂傳會回 400 而不是空陣列', bad.status === 400, `HTTP ${bad.status}`);
}

console.log(failures === 0 ? '\n全部通過' : `\n${failures} 項失敗`);
process.exit(failures === 0 ? 0 : 1);
