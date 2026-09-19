/**
 * 模擬玩家。
 *
 * 一個小四生的打字行為，簡化成三個參數：每字母平均間隔、間隔的抖動、打錯機率。
 * 自動化玩家 bot（瀏覽器裡真的按鍵盤）與平衡模擬器（Node 裡純跑邏輯）
 * 共用這一份模型，這樣兩邊測出來的東西才可以互相對照。
 *
 * 跟亂數一樣，它吃一個可設種子的 rng，所以同一個種子會打出一模一樣的一場。
 */

/** 三種預設手速，對應難度校準想分辨的那三段。 */
export const PLAYER_PRESETS = {
  slow: { msPerLetter: 900, jitterMs: 300, errorRate: 0.1 },
  medium: { msPerLetter: 550, jitterMs: 180, errorRate: 0.06 },
  fast: { msPerLetter: 320, jitterMs: 100, errorRate: 0.03 }
};

export function createPlayerModel(rng, preset = 'medium') {
  const cfg = typeof preset === 'string' ? PLAYER_PRESETS[preset] || PLAYER_PRESETS.medium : preset;
  return {
    cfg,
    rng,
    nextKeyAtMs: 0,
    // 上一次看到的單字，換字時重新排程第一次按鍵（模擬「聽完才開始打」）
    lastWordIndex: -1
  };
}

function scheduleNext(model, nowMs) {
  const { msPerLetter, jitterMs } = model.cfg;
  // 對稱抖動，均值仍是 msPerLetter
  const jitter = (model.rng.next() * 2 - 1) * jitterMs;
  model.nextKeyAtMs = nowMs + Math.max(60, msPerLetter + jitter);
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

  // 換了新的字：等一段「聽的時間」再開始打，不要一出現就狂敲
  if (state.wordIndex !== model.lastWordIndex) {
    model.lastWordIndex = state.wordIndex;
    scheduleNext(model, state.timeMs);
    return null;
  }

  if (state.timeMs < model.nextKeyAtMs) return null;

  const expected = state.target[state.typed];
  if (!expected) return null;

  scheduleNext(model, state.timeMs);

  if (model.rng.next() < model.cfg.errorRate) {
    return { kind: 'letter', ch: wrongLetterFor(model, expected) };
  }
  return { kind: 'letter', ch: expected };
}
