/**
 * 影格效能量測。
 *
 * 「感覺很順」不算驗證。這裡把每個影格的耗時逐筆記下來，
 * 算出 p50 / p95 / 最差影格 / 掉格次數，直接寫進驗收報告。
 *
 * 同時盯著 JS heap：戰鬥中如果持續上升，代表有在新建物件，
 * 那會變成隨機時間點的 GC 卡頓——玩的人只會說「有時候怪怪的」，最難查，
 * 所以與其等它發生，不如一開始就監控。
 */

const CAPACITY = 1024; // 環狀緩衝區，約 17 秒 @60fps

/*
 * 兩組數字要分開量，混在一起會得到錯誤的結論：
 *
 *   interval = 影格之間的間隔，也就是實際跑到幾 fps。
 *             它會被瀏覽器的節流與垂直同步左右——無頭瀏覽器用軟體渲染時
 *             本來就跑不到 60fps，所以這個數字只有在真實機器上才有意義。
 *
 *   work     = update + render 真正花掉的 CPU 時間，也就是還剩多少餘裕。
 *             這個在無頭環境量得準，是我能自己驗證的那一半。
 *
 * 之前只量 interval，在無頭環境得到 p95 41ms 就誤判成「效能不過關」，
 * 其實那是瀏覽器沒在畫，不是程式太慢。
 */
export function createPerf() {
  return {
    samples: new Float32Array(CAPACITY),
    work: new Float32Array(CAPACITY),
    head: 0,
    count: 0,
    total: 0,
    worst: 0,
    worstWork: 0,
    // 超過 20ms 就算掉了一格（60fps 的預算是 16.7ms）
    dropped: 0,
    heapStartBytes: readHeap(),
    heapLastBytes: readHeap()
  };
}

function readHeap() {
  // 只有 Chromium 系列有這個；沒有就回 0，報告裡會標成不可用
  return performance.memory ? performance.memory.usedJSHeapSize : 0;
}

export function samplePerf(perf, frameMs, workMs) {
  perf.samples[perf.head] = frameMs;
  perf.work[perf.head] = workMs;
  perf.head = (perf.head + 1) % CAPACITY;
  if (perf.count < CAPACITY) perf.count += 1;
  perf.total += 1;
  if (frameMs > perf.worst) perf.worst = frameMs;
  if (workMs > perf.worstWork) perf.worstWork = workMs;
  if (frameMs > 20) perf.dropped += 1;
  // heap 每 64 格讀一次就好，讀太頻繁本身也有成本
  if (perf.total % 64 === 0) perf.heapLastBytes = readHeap();
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function perfReport(perf) {
  const arr = Array.prototype.slice.call(perf.samples, 0, perf.count).sort((a, b) => a - b);
  const workArr = Array.prototype.slice.call(perf.work, 0, perf.count).sort((a, b) => a - b);
  return {
    frames: perf.total,
    // 影格間隔（實際 fps）——會被瀏覽器節流影響
    p50: Number(percentile(arr, 50).toFixed(2)),
    p95: Number(percentile(arr, 95).toFixed(2)),
    worst: Number(perf.worst.toFixed(2)),
    dropped: perf.dropped,
    // 每影格真正的 CPU 工作量——這才是「還有多少餘裕」
    workP50: Number(percentile(workArr, 50).toFixed(3)),
    workP95: Number(percentile(workArr, 95).toFixed(3)),
    workWorst: Number(perf.worstWork.toFixed(3)),
    fps: arr.length ? Number((1000 / (percentile(arr, 50) || 1)).toFixed(1)) : 0,
    heapMB: perf.heapLastBytes ? Number((perf.heapLastBytes / 1048576).toFixed(1)) : null,
    heapGrowthMB: perf.heapStartBytes
      ? Number(((perf.heapLastBytes - perf.heapStartBytes) / 1048576).toFixed(1))
      : null
  };
}

export function resetPerf(perf) {
  perf.head = 0;
  perf.count = 0;
  perf.total = 0;
  perf.worst = 0;
  perf.worstWork = 0;
  perf.dropped = 0;
  perf.heapStartBytes = readHeap();
  perf.heapLastBytes = perf.heapStartBytes;
}
