/**
 * 戰役（100 關）在每一個他會經過的地方都看得到。
 *
 * 家長的觀察（2026-10）：「100 關才是遊戲最終目標，目前介面下存在感太低」。
 * 分析檔也對得上：登入後落在練習頁，練完按「玩遊戲」打的是單組遊戲，
 * 一路上沒有任何地方提到戰役——哥哥打到第 6 關就沒再進去，弟弟一關都沒打過。
 *
 * 要證明的事：
 *   1. 伺服器：/campaign/summary 給得出「下一關、下一個王還有幾關、星星」；
 *      /auth/me 帶著打到第幾關（導覽列用）；/auth/profiles 每個帳號各打到第幾關；
 *      /campaign/clear 回來的時候也帶著摘要（結算畫面用）
 *   2. 練習頁最上面有戰役橫幅，按鈕直接帶到下一關；導覽列寫著 6/100
 *   3. 打不了戰役的帳號（課本還沒有每週單字）：沒有橫幅，也不會去問那支 API
 *   4. 選帳號的格子寫著各自打到第幾關
 *   5. 地圖頁：一顆大的「繼續第 N 關」、一條路、大魔王那一格整排
 *   6. 單組遊戲打完：結算看得到戰役，一鍵去下一關
 *   7. 戰役關卡打完：標題講過關、星星寫在戰役那一塊、主要按鈕變成下一關
 *
 * 用法：node scripts/campaign-presence-test.mjs
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

const { buildCampaign, campaignSummary, isUnlocked, CHAPTERS } = await import('../public/js/shared/campaign.js');
const wordBank = require('../server/data/word-bank.js');
const campaign = buildCampaign(wordBank.listGroups('g3a'));
const STARS = { 1: 2, 2: 2, 3: 3, 4: 2, 5: 1, 6: 2 };

/* ── 1. 摘要本身 ─────────────────────────────────────────── */
console.log('1) 進度摘要');
{
  const s = campaignSummary(campaign, 6, STARS);
  check('打到第 6 關、下一關是第 7 關', s.cleared === 6 && s.next?.level === 7);
  check('下一個王是第 25 關的中王，還有 19 關', s.nextBoss?.level === 25 && s.nextBoss.kind === 'midboss' && s.nextBoss.away === 19,
    JSON.stringify(s.nextBoss));
  check('星星加總', s.starsEarned === 12 && s.starsMax === 300, `${s.starsEarned} / ${s.starsMax}`);
  const s80 = campaignSummary(campaign, 80);
  check('過了第 75 關，下一個王是大魔王', s80.nextBoss?.level === 100 && s80.nextBoss.kind === 'finalboss', JSON.stringify(s80.nextBoss));
  const s100 = campaignSummary(campaign, 100);
  check('一百關全破：done、沒有下一個王', s100.done === true && s100.nextBoss === null && s100.next === null);
  check('沒有每週單字的課本：0 關、不是 done', campaignSummary([], 0).total === 0 && campaignSummary([], 0).done === false);
}

/* ── 2. 伺服器 ───────────────────────────────────────────── */
console.log('2) 伺服器');
{
  const store = {
    users: [], campaignProgress: [], purchases: [], gameResults: [], groupProgress: [], groupCompletions: [],
    wordProgress: [], attempts: [], practiceSessions: [], wordAudio: []
  };
  installFakeDb(createFakeDb(store, { uniqueIndexes: { campaignProgress: ['userId'] } }));
  const express = require('express');
  const User = require('../server/models/User.js');
  const user = await User.createUser('戰役哥哥', 'g3a');
  const other = await User.createUser('還沒打弟弟', 'g3a');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: String(user._id), destroy: (cb) => cb && cb() };
    next();
  });
  app.use('/api/campaign', require('../server/routes/campaign.js'));
  app.use('/api/auth', require('../server/routes/auth.js'));
  const server = app.listen(0);
  const port = server.address().port;
  const call = async (method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  let r = await call('GET', '/api/campaign/summary');
  check('新帳號：第 0 關、下一關第 1 關', r.status === 200 && r.body.summary.cleared === 0 && r.body.summary.next?.level === 1,
    JSON.stringify(r.body?.summary?.next?.level));
  r = await call('GET', '/api/auth/me');
  check('/auth/me 帶著戰役進度', r.body?.user?.campaign?.cleared === 0 && r.body.user.campaign.total === 100,
    JSON.stringify(r.body?.user?.campaign));

  const clear = await call('POST', '/api/campaign/clear', { level: 1, won: true, accuracy: 1 });
  check('過關的回應帶著摘要（結算畫面用）', clear.body?.summary?.cleared === 1 && clear.body.summary.nextBoss?.away === 24,
    JSON.stringify(clear.body?.summary?.nextBoss));
  check('摘要裡的星星算進這一關', clear.body.summary.starsEarned === 3, String(clear.body.summary.starsEarned));
  const lose = await call('POST', '/api/campaign/clear', { level: 2, won: false, accuracy: 0.5 });
  check('輸了也帶著摘要（進度沒動）', lose.body?.summary?.cleared === 1, JSON.stringify(lose.body?.summary?.cleared));

  r = await call('GET', '/api/campaign/summary');
  check('摘要跟著進度走', r.body.summary.cleared === 1 && r.body.summary.next.level === 2);
  r = await call('GET', '/api/auth/me');
  check('/auth/me 也跟著走', r.body.user.campaign.cleared === 1, JSON.stringify(r.body.user.campaign));

  r = await call('GET', '/api/auth/profiles');
  const byName = Object.fromEntries((r.body?.profiles || []).map((p) => [p.nickname, p.campaign]));
  check('選帳號清單：每個人各自打到第幾關',
    byName['戰役哥哥']?.cleared === 1 && byName['還沒打弟弟']?.cleared === 0 && byName['戰役哥哥']?.total === 100,
    JSON.stringify(byName));
  check('（弟弟的帳號也在）', !!other);
  server.close();
}

/* ── 瀏覽器的共用設定 ─────────────────────────────────────── */
const browser = await chromium.launch({ executablePath: CHROME });
const summary6 = campaignSummary(campaign, 6, STARS);
const CAMPAIGN_USER = {
  _id: 'u-presence', nickname: '測試', coins: 0, xp: 0, activeTheme: 'sports', wordBankId: 'g3a',
  ownedItemKeys: [], avatar: { baseCharacter: 'rookie', accessories: [] }, campaign: { cleared: 6, total: 100 }
};
const NO_CAMPAIGN_USER = { ...CAMPAIGN_USER, _id: 'u-none', campaign: { cleared: 0, total: 0 } };

async function openPage(user, path, { routes = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const asked = [];
  await context.route('**/api/auth/me*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) }));
  await context.route('**/api/campaign/summary', (r) => {
    asked.push('summary');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: summary6 }) });
  });
  for (const [pattern, fn] of Object.entries(routes)) await context.route(pattern, fn);
  await context.addInitScript((u) => {
    try {
      localStorage.setItem('sb:v2:shared:currentUser', JSON.stringify(u));
      localStorage.setItem(`sb:v2:u:${u._id}:gameDifficulty`, JSON.stringify('normal'));
      localStorage.setItem('sb:v2:shared:gameDifficulty', JSON.stringify('normal'));
    } catch (e) { /* 無痕 */ }
  }, user);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  return { context, page, errors, asked };
}

/* ── 3. 練習頁 ───────────────────────────────────────────── */
console.log('3) 練習頁的戰役橫幅與導覽列');
{
  const { context, page, errors } = await openPage(CAMPAIGN_USER, '/practice.html');
  await page.waitForSelector('#campaign-banner .cbanner', { timeout: 10000 }).catch(() => {});
  const ui = await page.evaluate(() => ({
    text: document.getElementById('campaign-banner')?.textContent || '',
    go: document.querySelector('#campaign-banner .cbanner-go')?.getAttribute('href') || '',
    nodes: document.querySelectorAll('#campaign-banner .ctrack-node').length,
    final: !!document.querySelector('#campaign-banner .ctrack-node.is-final'),
    nav: document.querySelector('[data-nav-campaign]')?.textContent || '',
    navHidden: document.querySelector('[data-nav-campaign]')?.hidden,
    startBtnBottom: document.getElementById('start-practice-btn')?.getBoundingClientRect().bottom || 9999
  }));
  check('寫出打到第幾關', /第\s*6\s*\/\s*100\s*關/.test(ui.text), ui.text.slice(0, 40));
  check('按鈕直接帶到第 7 關', ui.go === '/game?level=7', ui.go);
  check('寫出離中王還有幾關', /第 25 關（還有 19 關）/.test(ui.text), ui.text.slice(-60));
  check('路上有三個中王＋一頂皇冠', ui.nodes === 4 && ui.final, String(ui.nodes));
  check('導覽列寫著 6/100', ui.nav === '6/100' && ui.navHidden === false, `${ui.nav} hidden=${ui.navHidden}`);
  check('「開始練習」還在 768 高的畫面裡（不用捲）', ui.startBtnBottom <= 768, `bottom=${Math.round(ui.startBtnBottom)}`);
  check('沒有瀏覽器錯誤', errors.length === 0, errors.join(' | '));
  await context.close();
}
{
  const { context, page, errors, asked } = await openPage(NO_CAMPAIGN_USER, '/practice.html');
  await page.waitForSelector('#part-picker button, #part-picker .part-btn', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const ui = await page.evaluate(() => ({
    banner: document.getElementById('campaign-banner')?.innerHTML || '',
    navHidden: document.querySelector('[data-nav-campaign]')?.hidden
  }));
  check('打不了戰役的帳號：沒有橫幅', ui.banner === '', ui.banner.slice(0, 60));
  check('也不會去問 /campaign/summary', asked.length === 0, String(asked.length));
  check('導覽列那一格藏著', ui.navHidden === true, String(ui.navHidden));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.join(' | '));
  await context.close();
}

/* ── 4. 選帳號 ───────────────────────────────────────────── */
console.log('4) 選帳號的格子');
{
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await context.route('**/api/auth/profiles', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      profiles: [
        { _id: 'a', nickname: '哥哥', coins: 10, wordBankId: 'g3a', campaign: { cleared: 6, total: 100 } },
        { _id: 'b', nickname: '弟弟', coins: 10, wordBankId: 'g3a', campaign: { cleared: 0, total: 0 } }
      ],
      banks: [{ id: 'g3a', label: 'Grade 3A', owner: 'Pierce', ready: true, groupCount: 28, wordCount: 749 }]
    })
  }));
  await context.route('**/api/auth/me', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.profile-tile', { timeout: 10000 });
  const lines = await page.$$eval('.profile-tile', (tiles) =>
    tiles.map((t) => [t.querySelector('.nickname')?.textContent, t.querySelector('.tile-campaign')?.textContent || '']));
  const map = Object.fromEntries(lines);
  check('哥哥的格子寫著 6 / 100 關', /6\s*\/\s*100\s*關/.test(map['哥哥'] || ''), map['哥哥']);
  check('打不了戰役的帳號不寫', map['弟弟'] === '', map['弟弟']);
  await context.close();
}

/* ── 5. 地圖頁 ───────────────────────────────────────────── */
console.log('5) 地圖頁');
{
  const { context, page, errors } = await openPage(CAMPAIGN_USER, '/campaign.html', {
    routes: {
      '**/api/campaign': (r) => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          chapters: CHAPTERS.map((c) => ({ n: c.n, title: c.title, blurb: c.blurb })),
          summary: summary6,
          highestCleared: 6,
          levels: campaign.map((l) => ({ ...l, unlocked: isUnlocked(l.level, 6), cleared: l.level <= 6, stars: STARS[l.level] || 0 }))
        })
      })
    }
  });
  await page.waitForSelector('.level-cell', { timeout: 10000 }).catch(() => {});
  const ui = await page.evaluate(() => ({
    go: document.getElementById('campaign-go')?.getAttribute('href') || '',
    goText: document.getElementById('campaign-go')?.innerText || '',
    goTop: document.getElementById('campaign-go')?.getBoundingClientRect().bottom || 9999,
    goal: document.getElementById('campaign-goal-line')?.hidden === false,
    track: !!document.querySelector('#campaign-track .ctrack'),
    stars: document.getElementById('campaign-stars')?.textContent || '',
    finals: document.querySelectorAll('.level-cell.is-final').length,
    states: [...document.querySelectorAll('.chapter .chapter-state')].map((e) => e.textContent)
  }));
  check('大按鈕「繼續第 7 關」帶到第 7 關', ui.go === '/game?level=7' && /繼續第 7 關/.test(ui.goText), `${ui.go} ${ui.goText}`);
  check('不用捲就看得到那顆按鈕', ui.goTop <= 768, `bottom=${Math.round(ui.goTop)}`);
  check('最上面寫著終點是大魔王', ui.goal);
  check('有那條路', ui.track);
  check('寫著星星幾顆', /12\s*\/\s*300/.test(ui.stars), ui.stars);
  check('大魔王那一格只有一個', ui.finals === 1, String(ui.finals));
  check('每一章寫著狀態（正在打、還沒到）',
    ui.states[0]?.includes('正在打') && ui.states.slice(1).every((t) => t.includes('還沒到')), ui.states.join('／'));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.join(' | '));
  await context.close();
}

/** 把一場打完（每個字照著打） */
async function playOut(page) {
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  await page.click('#pregame-order button:not([hidden])');
  await page.waitForFunction(() => window.__spellbee && window.__spellbee.ready, null, { timeout: 15000 });
  for (let i = 0; i < 8; i += 1) {
    const st = await page.evaluate(() => window.__spellbee.state());
    if (st.status !== 'running') break;
    await page.keyboard.type(st.target, { delay: 25 });
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('#postgame:not([hidden])', { timeout: 15000 });
}

const inView = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return false;
  const b = e.getBoundingClientRect();
  const chrome = document.getElementById('game-chrome')?.getBoundingClientRect().top ?? innerHeight;
  return b.bottom <= Math.min(innerHeight, chrome) + 1 && b.height > 0;
}, sel);

/* ── 6. 單組遊戲的結算 ──────────────────────────────────── */
console.log('6) 單組遊戲打完：結算看得到戰役');
{
  const { context, page, errors } = await openPage(CAMPAIGN_USER, '/game?group=w04&n=3&show=1');
  await playOut(page);
  const ui = await page.evaluate(() => ({
    hidden: document.getElementById('postgame-campaign')?.hidden,
    text: document.getElementById('postgame-campaign')?.innerText || '',
    go: document.querySelector('#postgame-campaign .pg-camp-go')?.getAttribute('href') || ''
  }));
  check('戰役那一塊出現了', ui.hidden === false);
  check('寫著打到第幾關、離中王幾關', /6\s*\/\s*100/.test(ui.text) && /還有 19 關/.test(ui.text), ui.text.replace(/\n/g, ' '));
  check('一鍵去戰役第 7 關', ui.go === '/game?level=7', ui.go);
  check('「再打一場」沒有被擠到工具列底下（1366×768）', await inView(page, '#postgame-again'));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.join(' | '));
  await context.close();
}
{
  const { context, page, errors } = await openPage(NO_CAMPAIGN_USER, '/game?group=w04&n=3&show=1');
  await playOut(page);
  check('打不了戰役的帳號：結算沒有戰役那一塊', await page.evaluate(() => document.getElementById('postgame-campaign')?.hidden === true));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.join(' | '));
  await context.close();
}

/* ── 7. 戰役關卡的結算 ──────────────────────────────────── */
console.log('7) 戰役關卡打完');
{
  const lvl7 = campaign[6];
  const ids = lvl7.groupIds.flatMap((g) => wordBank.wordsByGroup(g)).map((w) => w.id);
  const cleared = [];
  const { context, page, errors } = await openPage(CAMPAIGN_USER, '/game?level=7&n=3&show=1', {
    routes: {
      '**/api/campaign/level/7': (r) => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ level: lvl7, wordBankId: 'g3a', wordIds: ids, limit: null, order: lvl7.order })
      }),
      '**/api/campaign/clear': (r) => {
        cleared.push(JSON.parse(r.request().postData() || '{}'));
        return r.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            highestCleared: 7, advanced: true, stars: 3, nextLevel: 8,
            summary: campaignSummary(campaign, 7, { ...STARS, 7: 3 })
          })
        });
      }
    }
  });
  await page.waitForSelector('#pregame:not([hidden])', { timeout: 15000 });
  check('開場寫著「第 7 / 100 關」', /第 7 \/ 100 關/.test(await page.textContent('#pregame-group')),
    await page.textContent('#pregame-group'));
  await playOut(page);
  await page.waitForFunction(() => /★/.test(document.getElementById('postgame-level')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const ui = await page.evaluate(() => ({
    title: document.getElementById('postgame-title')?.textContent || '',
    stars: document.getElementById('postgame-level')?.textContent || '',
    text: document.getElementById('postgame-campaign')?.innerText || '',
    again: document.getElementById('postgame-again')?.textContent || '',
    rows: [...document.querySelectorAll('#postgame-stats .stat-row')].map((e) => e.textContent)
  }));
  check('有送出過關', cleared.length === 1 && cleared[0].level === 7);
  check('標題講過關', /第 7 關過關/.test(ui.title), ui.title);
  check('星星寫在戰役那一塊', ui.stars === '★★★', ui.stars);
  check('成績那幾列不再重複寫關卡', !ui.rows.some((t) => t.includes('🗺️')), ui.rows.join('／'));
  check('戰役那一塊換成過關後的進度（7 / 100、還有 18 關）', /7\s*\/\s*100/.test(ui.text) && /還有 18 關/.test(ui.text),
    ui.text.replace(/\n/g, ' '));
  check('主要按鈕變成下一關', /第 8 關/.test(ui.again), ui.again);
  check('那顆按鈕沒有被擠到工具列底下（1366×768）', await inView(page, '#postgame-again'));
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('sb:v2:shared:currentUser') || '{}').campaign);
  check('快取的進度跟著更新（下一頁的導覽列就是 7/100）', cached?.cleared === 7, JSON.stringify(cached));
  check('沒有瀏覽器錯誤', errors.length === 0, errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} 項失敗` : '\n全部通過');
process.exit(failures ? 1 : 0);
