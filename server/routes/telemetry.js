/**
 * 行為紀錄與家長報告。
 *
 * ── 為什麼要有這個 ──────────────────────────────────────────
 * 家長不可能每一場都坐在旁邊看。孩子的口頭回饋很重要，但有些問題只有資料
 * 回答得了：他英打有沒有變快？漏掉的字是不會拼還是來不及？三選一是認真選
 * 還是亂按？練習和小遊戲的時間比例是多少？
 *
 * ── 記什麼、不記什麼 ────────────────────────────────────────
 * 記：看了哪一頁、停了多久、按了哪個按鈕、三選一選了什麼花多久、
 *     小遊戲玩了幾次、每一場的完整按鍵錄影（重播得出每個字怎麼打的）
 * 不記：滑鼠座標軌跡。資料量大、對平衡幾乎沒幫助，也超出需要。
 * 孩子的資料夠用就好。
 *
 * ── 保存期限 ────────────────────────────────────────────────
 * events、eventBatches、battleLogs 都有 TTL 索引，90 天後資料庫自己刪（db.js）。
 * 刪帳號時一起刪（User.OWNED_COLLECTIONS）。
 *
 * ── 誰看得到 ────────────────────────────────────────────────
 * 這個 app 沒有密碼，家裡任何一個帳號登入都算「家裡的人」，報告列出全部帳號——
 * 跟首頁本來就列出全部帳號與金幣是同一個信任範圍。資料只存在這個家自己的
 * 資料庫裡；要給別人分析，是家長按「下載分析檔」自己把檔案交出去。
 */

const express = require('express');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');
const wordBank = require('../data/word-bank');

const router = express.Router();
router.use(requireAuth);

const DAY = 24 * 60 * 60 * 1000;
/* 只收這些種類。不認得的直接丟：紀錄的範圍要是明確的，不是「什麼都往裡塞」 */
const KINDS = new Set([
  'page_view', 'page_leave', 'click', 'perk_pick', 'minigame', 'practice_answer', 'practice_session', 'game_start'
]);
const MAX_EVENTS_PER_BATCH = 200;
const MAX_DATA_CHARS = 1000;
const MAX_LOG_CHARS = 400 * 1024;

let analysisPromise = null;
function analysis() {
  if (!analysisPromise) analysisPromise = import('../../public/js/game/core/analysis.js');
  return analysisPromise;
}

function clean(v, max) {
  return String(v == null ? '' : v).slice(0, max);
}

/** 一批行為事件。背景佇列會重送，用 opId 去重。 */
router.post('/events', async (req, res, next) => {
  try {
    const { opId, events } = req.body || {};
    if (!opId || typeof opId !== 'string') return res.status(400).json({ error: '缺少 opId' });
    if (!Array.isArray(events)) return res.status(400).json({ error: '缺少 events' });
    const db = getDB();
    try {
      await db.collection('eventBatches').insertOne({ userId: req.user._id, opId, at: new Date() });
    } catch (err) {
      if (err.code === 11000) return res.json({ ok: true, duplicate: true });
      throw err;
    }
    const now = Date.now();
    const docs = [];
    for (const e of events.slice(0, MAX_EVENTS_PER_BATCH)) {
      if (!e || !KINDS.has(e.kind)) continue;
      let data = e.data && typeof e.data === 'object' ? e.data : {};
      // 太大的就不要內容，只留「發生過」——一筆事件不該大到要擔心
      if (JSON.stringify(data).length > MAX_DATA_CHARS) data = { truncated: true };
      const t = Number(e.t);
      docs.push({
        userId: req.user._id,
        kind: e.kind,
        page: clean(e.page, 40),
        data,
        // 前端的時間只在合理範圍內才採用（裝置時鐘可能是錯的）
        at: Number.isFinite(t) && Math.abs(t - now) < DAY ? new Date(t) : new Date(now)
      });
    }
    for (const d of docs) await db.collection('events').insertOne(d);
    res.json({ ok: true, stored: docs.length });
  } catch (err) {
    next(err);
  }
});

/**
 * 一場遊戲的完整錄影檔。收到當下就重播分析一次，把結果跟原始按鍵一起存：
 * 報告直接讀分析結果；原始按鍵留著，之後分析方法改了還可以重算。
 */
router.post('/battle-log', async (req, res, next) => {
  try {
    const { opId, log } = req.body || {};
    if (!opId || typeof opId !== 'string') return res.status(400).json({ error: '缺少 opId' });
    if (!log || !log.setup || !Array.isArray(log.entries) || !Array.isArray(log.setup.wordIds)) {
      return res.status(400).json({ error: '錄影檔格式不對' });
    }
    if (JSON.stringify(log).length > MAX_LOG_CHARS) return res.status(413).json({ error: '錄影檔太大' });

    // 單字只能是他自己那一本的——分析要查單字，也不收別人課本的東西
    const bankIds = new Set(wordBank.getBank(wordBank.resolveBankId(req.user.wordBankId)).words.map((w) => w.id));
    const words = log.setup.wordIds.map((id) => wordBank.getWordById(id));
    if (!words.length || words.some((w, i) => !w || !bankIds.has(log.setup.wordIds[i]))) {
      return res.status(400).json({ error: '錄影檔裡有不屬於你單字庫的字' });
    }

    const logs = getDB().collection('battleLogs');
    if (await logs.findOne({ userId: req.user._id, opId })) return res.json({ ok: true, duplicate: true });

    const { analyzeLog } = await analysis();
    let summary = null;
    try {
      const a = analyzeLog(log, words);
      summary = {
        status: a.status,
        totalMs: a.totalMs,
        msPerKey: a.msPerKey,
        firstKeyMs: a.firstKeyMs,
        missReasons: a.missReasons,
        stats: a.stats,
        perks: a.perks,
        // 每個字一筆，精簡成陣列：[id, 結果, 漏掉的原因, 按了幾下, 對, 錯, 第一下幾毫秒, 花了幾毫秒]
        words: a.words.map((w) => [w.id, w.result, w.reason || null, w.keys, w.correct, w.wrong, w.firstKeyMs, w.ms])
      };
    } catch (err) {
      // 分析失敗不影響保存——原始按鍵還在，之後可以重算
      summary = { error: err.message };
    }
    try {
      await logs.insertOne({
        userId: req.user._id,
        opId,
        at: new Date(),
        setup: log.setup,
        entries: log.entries,
        summary
      });
    } catch (err) {
      if (err.code === 11000) return res.json({ ok: true, duplicate: true });
      throw err;
    }
    res.json({ ok: true, summary });
  } catch (err) {
    next(err);
  }
});

/* ── 報告 ───────────────────────────────────────────────── */

function median(arr) {
  const a = arr.filter((x) => typeof x === 'number').sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/** 那一週的星期一（當地時間的日期字串） */
function weekOf(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

async function since(name, userId, field, from) {
  return getDB().collection(name).find({ userId, [field]: { $gte: from } }).toArray();
}

async function reportFor(user, from) {
  const id = user._id;
  const [events, logs, results, attempts, completions, plays, campaign] = await Promise.all([
    since('events', id, 'at', from),
    since('battleLogs', id, 'at', from),
    since('gameResults', id, 'finishedAt', from),
    since('attempts', id, 'attemptedAt', from),
    since('groupCompletions', id, 'completedAt', from),
    since('minigamePlays', id, 'playedAt', from),
    getDB().collection('campaignProgress').findOne({ userId: id })
  ]);

  // 時間花在哪裡
  const byPage = {};
  for (const e of events.filter((x) => x.kind === 'page_leave')) {
    const ms = Math.max(0, Math.min(Number(e.data?.ms) || 0, 3 * 60 * 60 * 1000));
    byPage[e.page] = (byPage[e.page] || 0) + ms;
  }

  // 英打速度，一週一個點
  const weeks = {};
  for (const l of logs) {
    if (!l.summary || typeof l.summary.msPerKey !== 'number') continue;
    const w = weekOf(l.at);
    (weeks[w] = weeks[w] || { msPerKey: [], firstKeyMs: [] }).msPerKey.push(l.summary.msPerKey);
    if (typeof l.summary.firstKeyMs === 'number') weeks[w].firstKeyMs.push(l.summary.firstKeyMs);
  }
  const typing = Object.keys(weeks).sort().map((w) => ({
    week: w,
    battles: weeks[w].msPerKey.length,
    msPerKey: median(weeks[w].msPerKey),
    firstKeyMs: median(weeks[w].firstKeyMs)
  }));

  // 漏掉的字為什麼漏掉
  const misses = { slow: 0, unknown: 0, idle: 0 };
  const unknownWords = {};
  for (const l of logs) {
    for (const k of Object.keys(misses)) misses[k] += Number(l.summary?.missReasons?.[k]) || 0;
    for (const w of l.summary?.words || []) {
      if (w[1] === 'missed' && w[2] === 'unknown') unknownWords[w[0]] = (unknownWords[w[0]] || 0) + 1;
    }
  }
  const topUnknown = Object.entries(unknownWords).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([wid, n]) => ({ id: wid, english: wordBank.getWordById(wid)?.english || wid, times: n }));

  // 三選一
  const picks = events.filter((e) => e.kind === 'perk_pick');
  const pickCount = {};
  for (const p of picks) pickCount[p.data?.picked] = (pickCount[p.data?.picked] || 0) + 1;
  const pickMs = picks.map((p) => Number(p.data?.ms)).filter((x) => Number.isFinite(x));

  // 戰役：哪幾關打最多次
  const byLevel = {};
  for (const r of results.filter((x) => x.mode === 'level').sort((a, b) => a.finishedAt - b.finishedAt)) {
    const k = r.level;
    (byLevel[k] = byLevel[k] || { level: k, tries: 0, wonFirst: null, won: false });
    byLevel[k].tries += 1;
    if (byLevel[k].wonFirst === null) byLevel[k].wonFirst = !!r.won;
    if (r.won) byLevel[k].won = true;
  }
  const levels = Object.values(byLevel);

  const correct = attempts.filter((a) => a.correct).length;
  return {
    nickname: user.nickname,
    wordBankId: user.wordBankId || null,
    practice: {
      sessions: completions.length,
      answers: attempts.length,
      accuracy: attempts.length ? correct / attempts.length : null
    },
    games: {
      played: results.length,
      won: results.filter((r) => r.won).length,
      byMode: results.reduce((acc, r) => ({ ...acc, [r.mode || 'group']: (acc[r.mode || 'group'] || 0) + 1 }), {})
    },
    campaign: {
      highestCleared: campaign?.highestCleared || 0,
      played: levels.length,
      firstTryFail: levels.length ? levels.filter((l) => l.wonFirst === false).length / levels.length : null,
      hardest: levels.sort((a, b) => b.tries - a.tries).slice(0, 5)
    },
    typing,
    misses: { ...misses, total: misses.slow + misses.unknown + misses.idle, topUnknown },
    time: { byPage, totalMs: Object.values(byPage).reduce((a, b) => a + b, 0) },
    perks: {
      decisions: picks.length,
      medianMs: median(pickMs),
      // 一秒內就選好，多半沒有在看卡片上寫什麼
      fastShare: pickMs.length ? pickMs.filter((x) => x < 1000).length / pickMs.length : null,
      picked: pickCount
    },
    minigames: {
      plays: plays.length,
      byKey: plays.reduce((acc, p) => ({ ...acc, [p.itemKey]: (acc[p.itemKey] || 0) + 1 }), {}),
      perPractice: completions.length ? plays.length / completions.length : null
    }
  };
}

function windowFrom(req) {
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
  return { days, from: new Date(Date.now() - days * DAY) };
}

/** 家長報告：家裡每個帳號各一份 */
router.get('/report', async (req, res, next) => {
  try {
    const { days, from } = windowFrom(req);
    const users = await getDB().collection('users').find({}).toArray();
    const reports = [];
    for (const u of users.sort((a, b) => String(a.nickname).localeCompare(String(b.nickname)))) {
      reports.push(await reportFor(u, from));
    }
    res.json({ days, generatedAt: new Date(), reports });
  } catch (err) {
    next(err);
  }
});

/**
 * 下載分析檔：原始資料，給家長交給別人（例如 Claude）分析。
 *
 * 帳號只留分析用得到的欄位；不含 session、不含任何舊密碼欄位。
 */
router.get('/export', async (req, res, next) => {
  try {
    const { days, from } = windowFrom(req);
    const db = getDB();
    const users = await db.collection('users').find({}).toArray();
    const out = { kind: 'spellbee-export', version: 1, days, exportedAt: new Date(), profiles: [] };
    for (const u of users) {
      const id = u._id;
      const [events, battleLogs, gameResults, attempts, groupCompletions, minigamePlays, wordProgress, campaign] =
        await Promise.all([
          since('events', id, 'at', from),
          since('battleLogs', id, 'at', from),
          since('gameResults', id, 'finishedAt', from),
          since('attempts', id, 'attemptedAt', from),
          since('groupCompletions', id, 'completedAt', from),
          since('minigamePlays', id, 'playedAt', from),
          db.collection('wordProgress').find({ userId: id }).toArray(),
          db.collection('campaignProgress').findOne({ userId: id })
        ]);
      const strip = (rows) => rows.map(({ _id, userId, ...rest }) => rest);
      out.profiles.push({
        nickname: u.nickname,
        wordBankId: u.wordBankId || null,
        xp: u.xp || 0,
        coins: u.coins || 0,
        honey: u.honey || 0,
        ownedItemKeys: u.ownedItemKeys || [],
        ownedGear: u.ownedGear || [],
        equipped: u.equipped || null,
        stats: u.stats || null,
        createdAt: u.createdAt || null,
        campaign: campaign ? { highestCleared: campaign.highestCleared || 0, stars: campaign.stars || {} } : null,
        events: strip(events),
        battleLogs: strip(battleLogs),
        gameResults: strip(gameResults),
        attempts: strip(attempts),
        groupCompletions: strip(groupCompletions),
        minigamePlays: strip(minigamePlays),
        wordProgress: strip(wordProgress)
      });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="spellbee-analysis-${stamp}.json"`);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.KINDS = KINDS;
