/**
 * 模擬玩家。
 *
 * 一個小四生的打字行為，簡化成幾個參數：每字母平均間隔、間隔的抖動、
 * 打錯機率，以及**有多少比例的字他根本不會拼**。
 * 自動化玩家 bot（瀏覽器裡真的按鍵盤）與平衡模擬器（Node 裡純跑邏輯）
 * 共用這一份模型，這樣兩邊測出來的東西才可以互相對照。
 *
 * 跟亂數一樣，它吃一個可設種子的 rng，所以同一個種子會打出一模一樣的一場。
 */

/**
 * 三種預設手速，對應難度校準想分辨的那三段。
 *
 * listenDelayMs 是「聽完才開始打」的那段空白，不能省。
 *
 * 一開始的模型是換字之後隔一個按鍵間隔就開始打，等於把時間公式裡
 * 給聽力用的 3 秒當成白送的緩衝——模擬出來每個手速在每個難度都零失誤通關，
 * 看起來像平衡很好，其實是模型把玩家算得太強了。
 * 真實情況是 TTS 唸完一個字就要 0.7~1.2 秒，小孩還要反應一下才動手。
 */
/*
 * ⚠️ unknownRate 是後來補的，而且它補的是一個會讓所有平衡結論失真的洞。
 *
 * 原本的模型只有 errorRate：打錯一下，下一次還是會打對，所以**它永遠會
 * 把每個字拼出來**，只是快慢的差別。於是模擬出來的「失敗率」量的其實只有
 * 「打字夠不夠快」——一旦裝備與等級把時間變寬裕，失敗率就一路掉到 0%，
 * 而且再怎麼加強特殊敵人都動不了它（實際試過：護甲加到 6 格、衝刺加倍，
 * tier3 Lv20 還是 0.0%）。
 *
 * 但這個遊戲真正的失敗來源是**他根本不會拼那個字**。真的不會的時候，
 * 他會一直打錯到蟲走到蜂巢為止，跟打字速度沒有關係。
 * 模型裡沒有這件事，等於整個模擬器在回答一個不是重點的問題。
 *
 * unknownRate 就是「這一場有多少比例的字是他不會的」。遇到不會的字時，
 * 他會以 UNKNOWN_ERROR_RATE 的機率一直打錯——不是完全打不出來
 * （他會猜，也猜得到一些），但慢得多、而且可能來不及。
 *
 * ── 為什麼預設是 0 ───────────────────────────────────────
 * 這幾個 preset 的用途是**難度校準**：把「打字有多快」對應到
 * easy / normal / hard（見 calibration.js）。那是一個純粹關於手速的問題，
 * 摻進「會不會拼」只會讓兩個變數糾在一起，校準就不準了。
 *
 * 所以預設 0（= 原本的行為，既有的平衡結論仍然成立），要量
 * 「不會拼的字造成多少失敗」時再明確傳進來。scripts/sim.mjs 會另外掃描
 * 這一軸，而且把它當成獨立的一張表——因為它其實是**主導變數**：
 *
 *   全裸 Lv1 在 0% / 2% / 5% / 8% / 12% 不會拼時，失敗率是
 *   31% / 52% / 75% / 92% / 96%。
 *
 * 真實數字要等 analyze-log.mjs 蒐集到足夠的實際遊玩紀錄才會知道。
 */
export const UNKNOWN_ERROR_RATE = 0.55;

export const PLAYER_PRESETS = {
  slow: { msPerLetter: 900, jitterMs: 300, errorRate: 0.1, listenDelayMs: 1600, unknownRate: 0 },
  medium: { msPerLetter: 550, jitterMs: 180, errorRate: 0.06, listenDelayMs: 1200, unknownRate: 0 },
  fast: { msPerLetter: 320, jitterMs: 100, errorRate: 0.03, listenDelayMs: 900, unknownRate: 0 }
};

export function createPlayerModel(rng, preset = 'medium') {
  const cfg = typeof preset === 'string' ? PLAYER_PRESETS[preset] || PLAYER_PRESETS.medium : preset;
  return {
    cfg,
    rng,
    nextKeyAtMs: 0,
    // 上一次看到的單字，換字時重新排程第一次按鍵（模擬「聽完才開始打」）
    lastWordIndex: -1,
    /* 現在這個字他會不會拼。換字的時候擲一次，整個字維持同一個答案 */
    knowsCurrentWord: true
  };
}

function scheduleNext(model, nowMs, baseMs) {
  const { msPerLetter, jitterMs } = model.cfg;
  // 對稱抖動，均值仍是 baseMs（預設就是每字母間隔）
  const jitter = (model.rng.next() * 2 - 1) * jitterMs;
  model.nextKeyAtMs = nowMs + Math.max(60, (baseMs ?? msPerLetter) + jitter);
}

function wrongLetterFor(model, expected) {
  let ch = expected;
  // 挑一個不等於正解的字母；最多試幾次，避免理論上的無窮迴圈
  for (let i = 0; i < 8 && ch === expected; i += 1) {
    ch = String.fromCharCode(97 + model.rng.int(26));
  }
  return ch === expected ? 'x' : ch;
}

/**
 * 問模擬玩家：在目前這個狀態下要不要按鍵？
 * 回傳一個 action 或 null。呼叫端每個邏輯步問一次。
 */
export function pollPlayer(model, state) {
  if (state.status !== 'running') return null;

  // 換了新的字：先花時間聽完，才開始打
  if (state.wordIndex !== model.lastWordIndex) {
    model.lastWordIndex = state.wordIndex;
    /*
     * 這個字他會不會拼，換字的時候決定一次，整個字都維持同一個答案。
     * 每按一次鍵重擲的話，「不會拼」就會變成「偶爾手滑」——那是 errorRate
     * 已經在做的事，而兩者是完全不同的失敗來源。
     */
    const rate = model.cfg.unknownRate || 0;
    model.knowsCurrentWord = model.rng.next() >= rate;
    scheduleNext(model, state.timeMs, model.cfg.listenDelayMs);
    return null;
  }

  if (state.timeMs < model.nextKeyAtMs) return null;

  const expected = state.target[state.typed];
  if (!expected) return null;

  scheduleNext(model, state.timeMs);

  /*
   * 不會拼的字：一直猜。猜得到一些（所以不是 100%），但會拖很久，
   * 而且很可能拖到蟲走到蜂巢——那正是這個遊戲真正的失敗來源。
   */
  const errRate = model.knowsCurrentWord ? model.cfg.errorRate : UNKNOWN_ERROR_RATE;
  if (model.rng.next() < errRate) {
    return { kind: 'letter', ch: wrongLetterFor(model, expected) };
  }
  return { kind: 'letter', ch: expected };
}
