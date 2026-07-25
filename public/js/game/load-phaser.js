/**
 * 延後載入 Phaser。
 *
 * Phaser 壓縮後仍有約 1.4MB，即使已在瀏覽器快取中，每次開啟頁面
 * 都還是要重新解析，在手機上是明顯的延遲。實際上只有「開始練習」
 * 與「玩小遊戲」才用得到，所以改成需要時才載入。
 *
 * 另外 game/*.js 在模組載入當下就會 extends Phaser.Scene，
 * 因此必須等 Phaser 進到全域之後才能 import 那些模組（用動態 import）。
 */
let loadingPromise = null;

export function loadPhaser() {
  if (window.Phaser) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/phaser.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadingPromise = null;
      reject(new Error('遊戲引擎載入失敗'));
    };
    document.head.appendChild(script);
  });
  return loadingPromise;
}
