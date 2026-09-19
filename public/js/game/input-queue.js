/**
 * 輸入緩衝區。
 *
 * 要解決的是「打得比動畫快時，按鍵被吃掉」這件事。
 *
 * 現在（1.2）遊戲隨時都收得下輸入，所以幾乎用不到；但 1.3 之後會有
 * 擊殺頓挫、換字轉場這些短暫不接受輸入的空窗，那時候如果直接把按鍵丟掉，
 * 手速快的人就會覺得「我明明打了啊」——這是最惱人也最難事後重現的那種問題。
 * 與其等它發生，不如現在就把機制放好，順便寫進測試。
 *
 * 實作上是固定大小的環狀緩衝區，配好記憶體就不再配置，
 * 而且每一筆都保留原本的 keydown 時間戳，延遲統計才不會因為排隊而失真。
 */

const CAPACITY = 32;

export function createInputQueue() {
  const slots = new Array(CAPACITY);
  for (let i = 0; i < CAPACITY; i += 1) {
    slots[i] = { kind: '', ch: '', listen: '', t0: 0 };
  }
  return { slots, head: 0, tail: 0, size: 0, dropped: 0 };
}

export function enqueueInput(q, action, t0) {
  if (q.size >= CAPACITY) {
    // 滿了代表卡住超過半秒以上，那是別的問題；記下來讓報告看得到
    q.dropped += 1;
    return false;
  }
  const slot = q.slots[q.tail];
  slot.kind = action.kind;
  slot.ch = action.ch || '';
  slot.listen = action.listen || '';
  slot.t0 = t0;
  q.tail = (q.tail + 1) % CAPACITY;
  q.size += 1;
  return true;
}

/**
 * 依序取出並交給 apply 處理，直到清空或 apply 回報「現在還不能收」。
 * apply(slot) 回傳 false 代表還不能收，剩下的留在佇列裡等下一次。
 */
export function drainInput(q, apply) {
  let drained = 0;
  while (q.size > 0) {
    const slot = q.slots[q.head];
    if (apply(slot) === false) break;
    q.head = (q.head + 1) % CAPACITY;
    q.size -= 1;
    drained += 1;
  }
  return drained;
}

export function clearInputQueue(q) {
  q.head = 0;
  q.tail = 0;
  q.size = 0;
}
