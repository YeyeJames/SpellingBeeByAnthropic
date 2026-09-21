/**
 * 把一次遊玩的錄影檔跑成一份報告。
 *
 * ── 為什麼需要這個 ──────────────────────────────────────────
 * 問小孩「好不好玩」得到的答案是「還好」。問「剛剛那個紅色的字有看到嗎」
 * 他會說「有」——因為他知道你想聽這個。**小孩的自述是這件事最不可靠的資料。**
 *
 * 但遊戲把每一個按鍵連同它發生的邏輯步都記下來了。重播一次就能還原出
 * 他到底做了什麼：在哪個字停住、有沒有用重聽、打錯之後有沒有愣一下。
 * 那些是他騙不了也演不出來的東西。
 *
 * ── 這份報告要回答的問題 ────────────────────────────────────
 * 對應 campaign-design.md §9 之後的那次實測，四個觀察點裡有兩個
 * 可以用資料回答（另外兩個要用眼睛看）：
 *
 *   A. 他有沒有注意到懲罰？   → 打錯之後的停頓時間 vs 平常的節奏
 *   E. 他有沒有玩完一場？     → 每一場的結局與長度
 *
 * 另外順帶產出的東西其實更長期有用：**他到底哪幾個字不會**。
 *
 * ── 誠實說明 ────────────────────────────────────────────────
 * 「打錯之後有停頓」只能說明他察覺到了什麼，**不能分辨**那是看到紅字、
 * 聽到聲音，還是自己心裡知道打錯了。報告裡會照實寫，不會替它加戲。
 *
 * 用法：
 *   node scripts/analyze-log.mjs <錄影檔.json>
 *   node scripts/analyze-log.mjs <錄影檔.json> --json    # 給程式吃的格式
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wordBank = require('../server/data/word-bank.js');

const { createBattle, applyAction, stepBattle, clearEvents, EV, EV_NAME, LISTEN_KIND } =
  await import('../public/js/game/core/battle.js');
const { BALANCE } = await import('../public/js/game/core/balance.js');

/* 邏輯固定 120Hz，所以 tick 直接換算得到遊戲時間（暫停不會前進，正好是我們要的） */
const MS_PER_TICK = BALANCE.logicStepMs;
const tickMs = (t) => t * MS_PER_TICK;

const LISTEN_NAME = {
  [LISTEN_KIND.REPLAY]: '再聽一次',
  [LISTEN_KIND.SLOW]: '放慢唸',
  [LISTEN_KIND.SENTENCE]: '例句'
};

/* ── 讀檔 ──────────────────────────────────────────────── */

function loadBundle(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  // 新版匯出是一整次開機的多場；舊版是單獨一場。兩種都要吃得下
  if (raw && raw.kind === 'session' && Array.isArray(raw.battles)) return raw;
  if (raw && Array.isArray(raw.entries)) {
    return { kind: 'session', createdAt: raw.createdAt, battles: [raw] };
  }
  throw new Error('這個檔案看起來不是拼字蜂的錄影檔');
}

/* ── 有插樁的重播 ──────────────────────────────────────────
   recorder.js 的 replayLog 只回傳最終狀態，而我們要的是過程，
   所以這裡自己跑一次一樣的迴圈，差別只在讀完事件才清空。 */

const KIND_BACK = { 1: 'letter', 2: 'backspace', 3: 'listen' };
const LISTEN_BACK = { 1: 'replay', 2: 'slow', 3: 'sentence' };

function entryToAction(entry) {
  const kind = KIND_BACK[entry[1]];
  if (kind === 'letter') return { kind: 'letter', ch: String.fromCharCode(entry[2]) };
  if (kind === 'backspace') return { kind: 'backspace' };
  if (kind === 'listen') return { kind: 'listen', listen: LISTEN_BACK[entry[2]] };
  return null;
}

function analyzeBattle(log) {
  const words = log.setup.wordIds.map((id) => {
    const w = wordBank.getWordById(id);
    return w || { id, english: id, chinese: '', exampleSentence: '' };
  });

  const state = createBattle({
    words,
    seed: log.setup.seed,
    difficulty: log.setup.difficulty,
    order: log.setup.order,
    maxHp: log.setup.maxHp
  });

  const entries = log.entries;
  const lastTick = entries.length ? entries[entries.length - 1][0] : 0;

  /* 一場裡每個單字的一筆紀錄 */
  const attempts = [];
  let current = null;
  let firstLetterOfWord = true;
  const startWord = (tick) => {
    firstLetterOfWord = true;
    current = {
      english: state.target,
      startTick: tick,
      endTick: tick,
      correctLetters: 0,
      wrongLetters: 0,
      wrongDetail: [], // { typed, expected, pos }
      backspaces: 0,
      listens: [],
      result: 'unfinished'
    };
  };
  const finishWord = (tick, result) => {
    if (!current) return;
    current.endTick = tick;
    current.result = result;
    attempts.push(current);
    current = null;
  };

  /*
   * 按鍵之間的間隔，用來看打字節奏。
   *
   * 基準線**刻意排除每個字的第一個字母**：那一段包含「聽完新單字」的時間，
   * 對人來說是好幾秒。不排除的話基準線會被拉高，而基準線一高，
   * 「打錯之後有沒有變慢」的倍率就會被系統性低估——
   * 也就是會傾向誤判成「他沒注意到」。
   */
  const letterGaps = []; // 同一個字裡面，字母與字母之間
  const gapsAfterWrong = []; // 打錯之後那一下
  let lastLetterTick = null;
  let prevLetterWasWrong = false;

  const combo = { max: 0, tiers: [] };
  let hpLost = 0;

  if (state.status === 'running') startWord(0);

  let ei = 0;
  const maxTicks = 120 * 60 * 40; // 保險絲
  while (state.status === 'running' && state.tick <= maxTicks) {
    while (ei < entries.length && entries[ei][0] === state.tick) {
      const entry = entries[ei];
      const action = entryToAction(entry);

      if (action?.kind === 'letter') {
        const gap = lastLetterTick === null ? null : tickMs(state.tick - lastLetterTick);
        // 超過 8 秒的間隔多半是他去做別的事了，不算打字節奏
        if (gap !== null && gap < 8000 && !firstLetterOfWord) {
          if (prevLetterWasWrong) gapsAfterWrong.push(gap);
          else letterGaps.push(gap);
        }
        lastLetterTick = state.tick;
        firstLetterOfWord = false;
      }

      const typedBefore = state.typed;
      const targetBefore = state.target;
      applyAction(state, action);

      if (action?.kind === 'letter') {
        const advanced = state.typed > typedBefore || state.target !== targetBefore;
        if (advanced) {
          if (current) current.correctLetters += 1;
          prevLetterWasWrong = false;
        } else {
          if (current) {
            current.wrongLetters += 1;
            current.wrongDetail.push({
              typed: action.ch,
              expected: targetBefore[typedBefore] || '',
              pos: typedBefore
            });
          }
          prevLetterWasWrong = true;
        }
      } else if (action?.kind === 'backspace') {
        if (current) current.backspaces += 1;
      }

      // 事件讀完才清掉——這正是 replayLog 沒做、而我們需要的那一段
      for (let i = 0; i < state.evCount; i += 1) {
        const ev = state.ev[i];
        if (ev.type === EV.LISTEN && current) current.listens.push(LISTEN_NAME[ev.a] || '重聽');
        if (ev.type === EV.COMBO_UP) combo.max = Math.max(combo.max, ev.a);
        if (ev.type === EV.COMBO_BONUS) combo.tiers.push({ tier: ev.a, atCombo: ev.b });
        if (ev.type === EV.HP_LOST) hpLost += 1;
        if (ev.type === EV.WORD_KILLED) finishWord(state.tick, 'killed');
        if (ev.type === EV.WORD_MISSED) finishWord(state.tick, 'missed');
        if (ev.type === EV.WORD_START) startWord(state.tick);
      }
      clearEvents(state);
      ei += 1;
    }

    if (state.status !== 'running') break;
    if (ei >= entries.length && state.tick > lastTick + 120 * 60) break;

    stepBattle(state);
    for (let i = 0; i < state.evCount; i += 1) {
      const ev = state.ev[i];
      if (ev.type === EV.HP_LOST) hpLost += 1;
      if (ev.type === EV.WORD_KILLED) finishWord(state.tick, 'killed');
      if (ev.type === EV.WORD_MISSED) finishWord(state.tick, 'missed');
      if (ev.type === EV.WORD_START) startWord(state.tick);
    }
    clearEvents(state);
  }

  // 還在打到一半就結束了（他中途離開，或錄影檔就到這裡）
  if (current) finishWord(state.tick, state.status === 'running' ? 'abandoned' : 'unfinished');

  return {
    setup: log.setup,
    createdAt: log.createdAt,
    status: state.status,
    hp: state.hp,
    hpLost,
    honey: state.honey,
    stats: { ...state.stats },
    totalMs: tickMs(state.tick),
    wordsInGroup: words.length,
    attempts,
    letterGaps,
    gapsAfterWrong,
    combo
  };
}

/* ── 統計小工具 ─────────────────────────────────────────── */

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))];
}

const secs = (ms) => `${(ms / 1000).toFixed(1)} 秒`;

/* ── 報告 ──────────────────────────────────────────────── */

function report(bundle) {
  const battles = bundle.battles.map(analyzeBattle);
  const out = [];
  const say = (s = '') => out.push(s);

  const allGaps = battles.flatMap((b) => b.letterGaps);
  const allAfterWrong = battles.flatMap((b) => b.gapsAfterWrong);
  const allAttempts = battles.flatMap((b) => b.attempts);
  const allListens = allAttempts.flatMap((a) => a.listens);

  say('═══ 這次玩了什麼 ═══');
  say();
  if (bundle.groupLabel) say(`單字組：${bundle.groupLabel}`);
  say(`總共 ${battles.length} 場`);
  battles.forEach((b, i) => {
    const RESULT = { won: '✅ 打完整組', lost: '💀 蜂巢被攻破', running: '⏸️ 沒打完就離開' };
    const killed = b.stats.wordsKilled;
    say(
      `  第 ${i + 1} 場　${RESULT[b.status] || b.status}　` +
        `${secs(b.totalMs)}　打掉 ${killed}/${b.wordsInGroup}　漏 ${b.stats.wordsMissed}　` +
        `難度 ${b.setup.difficulty}`
    );
  });
  say();

  /* ── 有沒有玩完（失敗模式 E） ─────────────────────────── */
  say('═══ 他有沒有玩完？ ═══');
  say();
  const abandoned = battles.filter((b) => b.status === 'running').length;
  if (abandoned === 0) {
    say('每一場都有打到結束（贏或輸），沒有中途離開。');
  } else {
    say(`⚠️ 有 ${abandoned} 場沒打完就離開。`);
    say('   如果是第一場就離開，那是長度或難度的問題，回饋做得再好也輪不到。');
  }
  if (battles.length >= 2) {
    say(`這次開了 ${battles.length} 場。`);
    say('→ 有人按了「重開一場」。如果是他自己伸手去按的，那是「還想玩」最直接的證據；');
    say('   如果是你叫他再玩一次的，這一條就不算數——錄影檔分不出是誰按的。');
  } else {
    say('只玩了一場。他有沒有「還想再一場」的反應，要靠你在旁邊看。');
  }
  say();

  /* ── 打字節奏（失敗模式 A 的背景資料） ───────────────── */
  say('═══ 打字節奏 ═══');
  say();
  if (allGaps.length < 5) {
    say('按鍵太少，看不出節奏。');
  } else {
    const med = median(allGaps);
    const p90 = percentile(allGaps, 90);
    say(`每個字母間隔：中位數 ${Math.round(med)}ms、p90 ${Math.round(p90)}ms（樣本 ${allGaps.length}）`);
    const cal = BALANCE.calibration;
    if (med > cal.slowerThanMs) {
      say(`→ 比 ${cal.slowerThanMs}ms 慢，屬於「慢手速」。難度應該用輕鬆。`);
    } else if (med < cal.fasterThanMs) {
      say(`→ 比 ${cal.fasterThanMs}ms 快，屬於「快手速」。`);
    } else {
      say('→ 中等手速。');
    }
    /*
     * 節奏的離散程度。一個字一個字找鍵的人，間隔會忽長忽短
     * （好找的鍵很快、難找的鍵很久）；會盲打的人節奏穩定。
     * 這是「他的眼睛是不是在鍵盤上」的間接線索，不是證據。
     */
    const spread = p90 / med;
    say(`節奏穩定度：p90 是中位數的 ${spread.toFixed(1)} 倍`);
    if (spread > 3) {
      say('→ 忽快忽慢，很像在鍵盤上找鍵。**如果是這樣，畫面上的回饋他大半沒看到**，');
      say('   因為眼睛在鍵盤上。這一點請務必在旁邊親眼確認。');
    } else {
      say('→ 還算穩定，比較不像在逐鍵尋找。');
    }
  }
  say();

  /* ── 打錯之後有沒有停頓（失敗模式 A 的核心） ─────────── */
  say('═══ 他有沒有注意到「打錯」？ ═══');
  say();
  /*
   * 樣本數門檻訂在 6。
   *
   * 三、四次就下「他沒注意到」的結論太便宜了——那種數量一個偶然的停頓
   * 就會把中位數翻過來。寧可說「測不到」，也不要給一個看起來很篤定
   * 其實是雜訊的判斷，然後讓人照著它去改設計。
   */
  const MIN_SAMPLES = 6;
  if (allAfterWrong.length === 0) {
    say('他一次都沒打錯，所以這一項沒有素材。');
    say('（不打錯本身是好事，只是這樣就測不到這個訊號。）');
  } else if (allAfterWrong.length < MIN_SAMPLES) {
    const base = median(allGaps);
    const after = median(allAfterWrong);
    say(`只打錯 ${allAfterWrong.length} 次（平常 ${Math.round(base)}ms、打錯後 ${Math.round(after)}ms）。`);
    say(`⚪ 樣本不足 ${MIN_SAMPLES} 次，**不下結論**——這種數量一個偶然的停頓就會把答案翻過來。`);
  } else {
    const base = median(allGaps);
    const after = median(allAfterWrong);
    const ratio = after / base;
    say(`平常每個字母間隔中位數　　${Math.round(base)}ms（同一個字裡面，不含開頭那一下）`);
    say(`打錯之後那一下的間隔　　　${Math.round(after)}ms（${allAfterWrong.length} 次）`);
    say(`→ 打錯之後慢了 ${ratio.toFixed(2)} 倍`);
    say();
    if (ratio >= 1.5) {
      say('✅ 他打錯之後明顯停了一下，代表**他察覺到發生了什麼事**。');
    } else if (ratio >= 1.15) {
      say('🟡 有一點停頓，但不明顯。回饋可能有傳到，也可能只是他自己知道打錯了。');
    } else {
      say('🔴 打錯之後完全沒有停頓——他很可能**根本沒注意到懲罰發生了**。');
      say('   這正是要驗的那件事沒過。優先考慮：把回饋搬到他眼睛在的地方，或改用聲音。');
    }
    if (allAfterWrong.length < 12) {
      say(`（樣本只有 ${allAfterWrong.length} 次，方向參考就好，不要當定論。）`);
    }
    say();
    say('⚠️ 這個訊號只能說明他察覺到了什麼，**分不出**是看到紅字、聽到聲音，');
    say('   還是自己心裡知道打錯了。要分辨得靠你在旁邊看他的眼睛。');
  }
  say();

  /* ── 聽力鍵 ─────────────────────────────────────────── */
  say('═══ 他有沒有用重聽？ ═══');
  say();
  if (allListens.length === 0) {
    const struggled = allAttempts.filter((a) => a.result === 'missed' || a.wrongLetters > 0).length;
    say('一次都沒用過。');
    if (struggled > 0) {
      say(`但他有 ${struggled} 個字打錯或漏掉——**他很可能不知道有這個功能**。`);
      say('→ 三個聽力鍵的存在感要加強（開場畫面、或第一次漏字時直接提示）。');
    } else {
      say('而且他幾乎沒失誤，所以也可能是真的不需要。');
    }
  } else {
    const byKind = {};
    allListens.forEach((k) => {
      byKind[k] = (byKind[k] || 0) + 1;
    });
    say(`總共用了 ${allListens.length} 次：` + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join('、'));
    say('→ 他知道這些鍵的存在，而且願意付代價去用。這是好訊號。');
  }
  say();

  /* ── 連擊 ───────────────────────────────────────────── */
  say('═══ 連擊 ═══');
  say();
  const maxCombo = Math.max(0, ...battles.map((b) => b.combo.max));
  const tiers = battles.flatMap((b) => b.combo.tiers);
  say(`最高連擊 ${maxCombo}`);
  const c = BALANCE.combo;
  if (tiers.length === 0) {
    say(`一次加成都沒觸發（第一階要 ${c.dashAt} 連擊）。`);
    say('→ 他完全沒體驗到 Combo 系統。所有連擊相關的演出他都沒看到，');
    say('   所以「連擊回饋好不好」這件事這次根本沒被測到。');
  } else {
    const counts = {};
    tiers.forEach((t) => {
      counts[t.tier] = (counts[t.tier] || 0) + 1;
    });
    const NAMES = { 1: '蜂群衝刺', 2: '蜜糖時間', 3: '狂蜂狀態' };
    say('觸發過：' + Object.entries(counts).map(([t, n]) => `${NAMES[t]} ×${n}`).join('、'));
  }
  say();

  /* ── 卡住的字（長期最有用的一段） ─────────────────────── */
  say('═══ 哪些字他不會 ═══');
  say();
  const missed = allAttempts.filter((a) => a.result === 'missed');
  if (missed.length) {
    // 漏掉的字會排回隊伍尾端，所以同一個字可能漏很多次——合併計次才讀得出輕重
    const byWord = new Map();
    missed.forEach((a) => byWord.set(a.english, (byWord.get(a.english) || 0) + 1));
    const rows = [...byWord.entries()].sort((a, b) => b[1] - a[1]);
    say(`漏掉的字（${rows.length} 個字、共 ${missed.length} 次）：`);
    rows.forEach(([w, n]) => say(`  ❌ ${w}${n > 1 ? `　漏了 ${n} 次` : ''}`));
    say();
  }
  const withErrors = allAttempts
    .filter((a) => a.wrongLetters > 0)
    .sort((a, b) => b.wrongLetters - a.wrongLetters)
    .slice(0, 10);
  if (withErrors.length) {
    say('打錯最多的字：');
    withErrors.forEach((a) => {
      const detail = a.wrongDetail
        .slice(0, 4)
        .map((d) => `第${d.pos + 1}個字母打成「${d.typed}」（應該是「${d.expected}」）`)
        .join('、');
      say(`  ${a.english}　錯 ${a.wrongLetters} 次　${detail}`);
    });
    say();
  }

  const slow = allAttempts
    .filter((a) => a.result === 'killed')
    .map((a) => ({ english: a.english, ms: tickMs(a.endTick - a.startTick) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);
  if (slow.length) {
    say('花最久才打完的字：');
    slow.forEach((a) => say(`  ${a.english}　${secs(a.ms)}`));
    say();
  }

  if (!missed.length && !withErrors.length) {
    say('這次沒有漏字也沒有打錯——對「學了什麼」來說是好事，');
    say('但也代表難度可能偏低，而且複習關這次沒有素材。');
    say();
  }

  say('═══ 用眼睛看才知道的兩件事 ═══');
  say();
  say('這份報告答不出來，只能靠你在旁邊看：');
  say('  1. 他打字時眼睛在鍵盤還是在螢幕？（決定所有視覺回饋有沒有意義）');
  say('  2. 他有沒有自發的「喔！」「欸」？（不是回答問題，是自己冒出來的）');

  return { text: out.join('\n'), battles };
}

/* ── 進入點 ────────────────────────────────────────────── */

const path = process.argv[2];
if (!path) {
  console.error('用法：node scripts/analyze-log.mjs <錄影檔.json> [--json]');
  process.exit(2);
}

const bundle = loadBundle(path);
const result = report(bundle);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ createdAt: bundle.createdAt, battles: result.battles }, null, 2));
} else {
  console.log(result.text);
}
