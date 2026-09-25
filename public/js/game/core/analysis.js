/**
 * 把一場的錄影檔重播一次，還原出每個字他實際上是怎麼打的。
 *
 * ── 為什麼要有這個 ──────────────────────────────────────────
 * 家長不可能每一場都坐在旁邊看，而問小孩「好不好玩」得到的答案是「還好」。
 * 但錄影檔記下了每一個按鍵與它發生的邏輯步，重播一次就能還原他到底做了什麼。
 * 那是他騙不了、也演不出來的東西。
 *
 * 這支是**純函式**：瀏覽器、伺服器（收到錄影檔時）、scripts/analyze-log.mjs
 * 都用同一份。重建戰鬥走 recorder.js 的 battleFromSetup——舊版分析工具自己組參數、
 * 漏帶了等級與裝備與速度，重播出來是另一場。
 *
 * ── 最重要的一個數字：漏掉的字為什麼漏掉 ────────────────────
 * C9 的平衡建立在家長的觀察上：「不會拼的比例非常小，失敗來自來不及」。
 * 這裡把每一個漏掉的字分成三類，讓這件事可以被量，而不是只能靠旁邊看：
 *
 *   slow     來不及：蟲到的時候，他已經打對一半以上，而且幾乎沒打錯
 *   unknown  不會拼：打錯兩個字母以上，或打不到一半就卡住
 *   idle     沒動作：整個字一個鍵都沒按（沒聽到、分心、或根本不知道從哪開始）
 *
 * ⚠️ 這是從按鍵推出來的，不是讀心。「打錯兩個字母」可能是真的不會，
 * 也可能是手指太快打歪；報告裡會照實說這是推估。
 */

import { EV } from './battle.js';
import { applyAction, stepBattle, clearEvents } from './battle.js';
import { battleFromSetup, entryToAction } from './recorder.js';
import { BALANCE } from './balance.js';

const MS_PER_TICK = BALANCE.logicStepMs;
const tickMs = (t) => Math.round(t * MS_PER_TICK);

/* 分類的門檻。寫在這裡是為了報告能照實說「怎麼算的」 */
export const MISS_RULES = {
  slowTypedRatio: 0.5, // 打對超過一半、
  slowMaxWrong: 1, //     打錯不超過 1 個 → 來不及
  unknownMinWrong: 2 //   打錯 2 個以上 → 不會拼
};

export function classifyMiss(w) {
  if (w.keys === 0) return 'idle';
  if (w.wrong >= MISS_RULES.unknownMinWrong) return 'unknown';
  if (w.correct / Math.max(1, w.len) >= MISS_RULES.slowTypedRatio && w.wrong <= MISS_RULES.slowMaxWrong) return 'slow';
  return 'unknown';
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * @param log   錄影檔（recorder.js 的格式）
 * @param words 照 log.setup.wordIds 順序排好的單字（呼叫端從單字庫查）
 */
export function analyzeLog(log, words) {
  const state = battleFromSetup(log.setup, words);
  const entries = log.entries || [];
  const lastTick = entries.length ? entries[entries.length - 1][0] : 0;

  const perWord = []; // 每一次「有一個字冒出來」一筆
  let cur = null;
  const start = () => {
    cur = {
      id: words[state.wordIndex]?.id || null,
      english: state.target,
      len: state.target.replace(/[\s-]/g, '').length,
      startTick: state.tick,
      firstKeyTick: null,
      keys: 0,
      correct: 0,
      wrong: 0,
      listens: 0,
      result: null
    };
  };
  const finish = (result) => {
    if (!cur) return;
    cur.result = result;
    cur.ms = tickMs(state.tick - cur.startTick);
    cur.firstKeyMs = cur.firstKeyTick === null ? null : tickMs(cur.firstKeyTick - cur.startTick);
    if (result === 'missed') cur.reason = classifyMiss(cur);
    delete cur.startTick;
    delete cur.firstKeyTick;
    perWord.push(cur);
    cur = null;
  };
  const readEvents = () => {
    for (let i = 0; i < state.evCount; i += 1) {
      const ev = state.ev[i];
      if (ev.type === EV.WORD_KILLED) finish('killed');
      else if (ev.type === EV.WORD_MISSED) finish('missed');
      else if (ev.type === EV.WORD_START) start();
      else if (ev.type === EV.LISTEN && cur) cur.listens += 1;
    }
    clearEvents(state);
  };

  // 建立戰鬥時第一個字已經出來了
  readEvents();
  if (!cur && state.status === 'running' && state.wordIndex >= 0) start();

  /*
   * 打字節奏：同一個字裡、字母與字母之間的間隔。
   * **排除每個字的第一下**——那一段包含聽單字的時間，會把基準線拉高。
   * 超過 8 秒的間隔多半是他去做別的事了，也不算。
   */
  const gaps = [];
  let lastKeyTick = null;
  let lastKeyWord = null;
  const perks = [];

  let ei = 0;
  const maxTicks = 120 * 60 * 40;
  while (state.status === 'running' && state.tick <= maxTicks) {
    while (ei < entries.length && entries[ei][0] === state.tick) {
      const action = entryToAction(entries[ei]);
      ei += 1;
      if (!action) continue;
      if (action.kind === 'perk') {
        const offer = state.perkOffer ? state.perkOffer.slice() : [];
        applyAction(state, action);
        perks.push({ offer, picked: offer[action.pick] || null, atKill: state.stats.wordsKilled });
        readEvents();
        continue;
      }
      if (action.kind === 'letter' && cur && !state.perkOffer) {
        const typedBefore = state.typed;
        const wordBefore = state.wordIndex;
        if (cur.firstKeyTick === null) cur.firstKeyTick = state.tick;
        if (lastKeyTick !== null && lastKeyWord === wordBefore) {
          const g = tickMs(state.tick - lastKeyTick);
          if (g < 8000) gaps.push(g);
        }
        lastKeyTick = state.tick;
        lastKeyWord = wordBefore;
        const keyOwner = cur;
        keyOwner.keys += 1;
        applyAction(state, action);
        // 先把這一下造成的事件（打完、漏掉、下一個字出來）處理掉，再判斷這一下算對還是錯
        readEvents();
        /*
         * 這一下有沒有被接受：打對會往前、或整個字打完換到下一個。
         * 換字不一定是打完——打錯的那一下也可能把蟲推進蜂巢（漏掉、換下一個字），
         * 所以換字時要看上一個字是「打掉」還是「漏掉」。
         */
        const finished = keyOwner.result !== null; // 這一下讓這個字結束了（打完或漏掉）
        const advanced = finished ? keyOwner.result === 'killed' : state.typed > typedBefore;
        if (advanced) keyOwner.correct += 1;
        else keyOwner.wrong += 1;
        continue;
      }
      applyAction(state, action);
      readEvents();
    }
    if (state.status !== 'running') break;
    // 三選一停在那裡、又沒有選卡紀錄（錄影檔被截斷）：停下來
    if (state.perkOffer) break;
    if (ei >= entries.length && state.tick > lastTick + 120 * 60) break;
    stepBattle(state);
    readEvents();
  }
  if (cur) finish(state.status === 'running' ? 'abandoned' : 'unfinished');

  const missed = perWord.filter((w) => w.result === 'missed');
  const reasons = { slow: 0, unknown: 0, idle: 0 };
  for (const w of missed) reasons[w.reason] += 1;
  const firstKeys = perWord.map((w) => w.firstKeyMs).filter((x) => x !== null);

  return {
    status: state.status,
    totalMs: tickMs(state.tick),
    hp: state.hp,
    stats: { ...state.stats },
    words: perWord,
    missReasons: reasons,
    /* 英打速度：同一個字裡兩個按鍵之間的中位數（毫秒）。越小越快 */
    msPerKey: median(gaps),
    keyGaps: gaps.length,
    /* 聽完單字到按下第一個鍵的中位數：反應時間，包含聽的時間 */
    firstKeyMs: median(firstKeys),
    perks
  };
}
