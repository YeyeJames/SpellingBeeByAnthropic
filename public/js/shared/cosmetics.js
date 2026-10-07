/**
 * 外觀（商店的 cosmetic 品項）在畫面上長什麼樣子。
 *
 * 價格、名字、哪一格在 server/data/shop-items.js；這裡只管「穿上之後要畫成什麼」。
 * 全部只碰外觀——戰鬥邏輯（game/core）不 import 這個檔案，也讀不到 cosmetics。
 *
 * user.cosmetics 長這樣：{ killFx: 'fx_hearts', beeColor: 'bee_pink', soundPack: 'sound_drum', title: 'title_star' }
 * 每一格都可以沒有（= 預設）。
 */

export const DEFAULT_BEE = '/assets/sprites/bee-mascot.svg';

/** 拼字蜂的圖。bee_pink → /assets/sprites/bee-pink.svg；沒有或認不得就是預設那隻 */
export function beeSprite(user) {
  const key = user && user.cosmetics && user.cosmetics.beeColor;
  return /^bee_[a-z]+$/.test(key || '') ? `/assets/sprites/bee-${key.slice(4)}.svg` : DEFAULT_BEE;
}

/*
 * 打掉蟲的特效。
 *   stinger   蜂針（曳光）的顏色
 *   kind      粒子畫成什麼：'shape'（色塊）或 'glyph'（一個字元）
 *   colors    粒子輪流用的顏色
 *   glyph     kind = glyph 時畫的字元
 *   speed     噴出去的速度範圍 [最小, 最大]
 *   lift      往上的初速（負的是往上）
 *   gravity   重力；愛心是負的，會往上飄
 *   spin      會不會轉（彩帶要轉才像彩帶）
 *   ms        粒子活多久
 */
export const KILL_FX = {
  fx_confetti: {
    stinger: 0x67e8f9, kind: 'shape', w: 14, h: 7,
    colors: [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xda77f2, 0xff922b],
    speed: [120, 300], lift: -220, gravity: 520, spin: true, ms: 900
  },
  fx_hearts: {
    stinger: 0xff7eb6, kind: 'glyph', glyph: '❤', size: 30,
    colors: ['#ff6b9a', '#ff8fb1', '#f03e3e', '#ffa8c5'],
    speed: [90, 190], lift: -80, gravity: -160, spin: false, ms: 1000
  },
  fx_stars: {
    stinger: 0xffd166, kind: 'glyph', glyph: '★', size: 30,
    colors: ['#ffd43b', '#fab005', '#fff3bf', '#ffe066'],
    speed: [120, 280], lift: -140, gravity: 600, spin: true, ms: 800
  },
  fx_fireworks: {
    stinger: 0xc084fc, kind: 'shape', w: 9, h: 9, round: true,
    colors: [0xff6b6b, 0xffd43b, 0x69db7c, 0x4dabf7, 0xda77f2, 0xffffff],
    speed: [200, 230], lift: 0, gravity: 160, spin: false, ms: 900
  }
};

export function killFxFor(user) {
  const key = user && user.cosmetics && user.cosmetics.killFx;
  return KILL_FX[key] ? key : null;
}

export function soundPackFor(user) {
  const key = user && user.cosmetics && user.cosmetics.soundPack;
  return /^sound_[a-z]+$/.test(key || '') ? key : null;
}

/** 稱號文字。伺服器回的使用者帶著 titleText；剛在商店換上、還沒回來時由商店填 */
export function titleFor(user) {
  return (user && user.titleText) || null;
}
