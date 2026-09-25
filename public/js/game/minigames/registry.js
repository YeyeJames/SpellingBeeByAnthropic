/**
 * 商店小遊戲的登記表。
 *
 * ── 為什麼要有這個檔案 ──────────────────────────────────────
 * 本來只有一個接金幣，商店的程式直接寫死它：標題寫在 HTML 裡、開啟時
 * 直接 import 那一支、事件名稱也是它專用的。要加第二個遊戲就得把商店
 * 整段複製一次。家長很明確地說商店要「非常豐富」，小遊戲會一直加，
 * 所以把「一個小遊戲長什麼樣子」固定下來，商店只認這個形狀。
 *
 * ── 每一個小遊戲都要給的東西 ───────────────────────────────
 *   title   標題
 *   howTo   一句話玩法（打開時顯示在畫面上，他不需要先讀說明）
 *   load()  動態載入遊戲模組（用到才載，商店頁本身不必背 Phaser）
 *
 * 模組 export 一個 create(parentId, { onScore, onEnd })，回傳：
 *   { game, finish(), autoplay(), score() }
 *   - onScore(n)  分數變了就呼叫（商店拿來播「叮」一聲）
 *   - onEnd(n)    一局結束呼叫一次
 *   - finish()    立刻結束這一局（關閉視窗、測試用）
 *   - autoplay()  測試用：替玩家玩幾下，回傳得到的分數
 *
 * 用回呼而不是 window 事件是刻意的：舊版用 window 事件，每打開一次
 * 就多掛一個監聽，打開第五次時接到一枚金幣會「叮」五聲。
 *
 * ── 價格不在這裡 ───────────────────────────────────────────
 * 解鎖價與每玩一次的價格在 server/data/shop-items.js，由伺服器決定。
 * 這裡只管「怎麼玩」，不管「多少錢」——兩邊各寫一份遲早會對不起來。
 */

export const MINIGAMES = {
  minigame_coincatch: {
    title: '🪙 接金幣',
    howTo: '用滑鼠或 ← → 移動拼字蜂，接住掉下來的金幣！30 秒倒數。',
    load: () => import('./coincatch.js')
  },
  minigame_beeflap: {
    title: '🐝 蜜蜂飛行',
    howTo: '按空白鍵（或點一下）往上飛，穿過花莖中間的空隙！碰到就結束。',
    load: () => import('./beeflap.js')
  },
  minigame_whack: {
    title: '🔨 打蟲大作戰',
    howTo: '蟲冒出來時，按牠身上的字母（或直接點牠）把牠打回去！30 秒倒數。',
    load: () => import('./whack.js')
  }
};

/*
 * 所有小遊戲共用的畫布大小。
 *
 * 用 FIT 縮放：邏輯座標固定 360×400，實際畫多大跟著視窗走。
 * 手機上商店視窗只有 300 像素左右寬，寫死像素的話畫布會凸出去。
 */
export const MINIGAME_SIZE = { width: 360, height: 400 };

export function phaserConfig(parentId, scene) {
  const P = window.Phaser;
  return {
    type: P.AUTO,
    parent: parentId,
    transparent: true,
    scale: {
      mode: P.Scale.FIT,
      autoCenter: P.Scale.CENTER_HORIZONTALLY,
      width: MINIGAME_SIZE.width,
      height: MINIGAME_SIZE.height
    },
    scene: [scene]
  };
}
