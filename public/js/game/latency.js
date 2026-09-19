/**
 * 輸入延遲量測。
 *
 * 「感覺很快」不算驗證。這裡量的是：從 keydown 那一刻，到畫面真的畫出
 * 對應變化的那一格為止，中間隔了多久。跑幾百次之後出 p50 / p95，
 * 直接寫進驗收報告。
 *
 * 量法說明（免得數字被誤讀）：
 *   t0 = keydown 事件處理器被呼叫的時間
 *   t1 = 「畫出新狀態的那一格」render 完成的時間
 * 螢幕實際亮起來還要再等合成與掃描，那一段瀏覽器量不到，也不是我們控制得了的。
 * 所以這個數字是「程式這一端的延遲」，不是端到端的光子延遲——但它正是
 * 我們能改善的那一段，而且它超標時手感一定有問題。
 */

const CAPACITY = 1024;
const PENDING_CAPACITY = 64;

export function createLatency() {
  return {
    samples: new Float64Array(CAPACITY),
    head: 0,
    count: 0,
    total: 0,
    worst: 0,
    // 已經套用、但還沒被畫出來的那些按鍵的時間戳
    pending: new Float64Array(PENDING_CAPACITY),
    pendingCount: 0
  };
}

/** 動作已套用到狀態，等待下一次 render。 */
export function markApplied(lat, t0) {
  if (lat.pendingCount >= PENDING_CAPACITY) return; // 滿了就不記，寧可少一筆也不配置記憶體
  lat.pending[lat.pendingCount] = t0;
  lat.pendingCount += 1;
}

/** 這一格已經把新狀態畫出來了，把等待中的按鍵全部結算。 */
export function markRendered(lat, now) {
  for (let i = 0; i < lat.pendingCount; i += 1) {
    const ms = now - lat.pending[i];
    lat.samples[lat.head] = ms;
    lat.head = (lat.head + 1) % CAPACITY;
    if (lat.count < CAPACITY) lat.count += 1;
    lat.total += 1;
    if (ms > lat.worst) lat.worst = ms;
  }
  lat.pendingCount = 0;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function latencyReport(lat) {
  const arr = Array.prototype.slice.call(lat.samples, 0, lat.count).sort((a, b) => a - b);
  return {
    samples: lat.total,
    p50: Number(percentile(arr, 50).toFixed(2)),
    p95: Number(percentile(arr, 95).toFixed(2)),
    p99: Number(percentile(arr, 99).toFixed(2)),
    worst: Number(lat.worst.toFixed(2))
  };
}

export function resetLatency(lat) {
  lat.head = 0;
  lat.count = 0;
  lat.total = 0;
  lat.worst = 0;
  lat.pendingCount = 0;
}
