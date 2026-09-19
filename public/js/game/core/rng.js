/**
 * 可設種子的亂數。
 *
 * 遊戲裡任何一處都不准用 Math.random()——沒有種子就沒有重播，
 * 沒有重播就查不了偶發的 bug，平衡模擬器的結果也不可信。
 *
 * 用 mulberry32：32 位元狀態、品質對遊戲來說綽綽有餘，
 * 而且狀態只有一個整數，做狀態指紋時可以直接一起算進去。
 */

export function createRng(seed) {
  return {
    // 狀態刻意公開：存檔、重播、指紋都要讀它
    s: seed >>> 0,
    next() {
      this.s = (this.s + 0x6d2b79f5) >>> 0;
      let t = this.s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    // [0, n) 的整數
    int(n) {
      return Math.floor(this.next() * n);
    }
  };
}

/** Fisher-Yates，原地洗牌。同一個種子必然洗出同一個順序。 */
export function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
