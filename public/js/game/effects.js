/**
 * 打擊特效（Phase 1.3）。
 *
 * 這一層負責把「打對了一個字母」變成看得見的事：
 *   - 蜂針從蜂巢飛出去打到敵人（約 0.1 秒）
 *   - 敵人閃白、被擠扁一下
 *   - 一片字母碎片飛回蜂巢
 *   - 敵人身上多一道裂痕
 *   - 打完整個字：蜂蜜噴濺 + 畫面頓挫
 *
 * 兩個紀律：
 *   1. 所有顯示物件都在建構時配好，update 裡不新建任何東西（見 pool.js）
 *   2. 動畫自己算，不用 Phaser 的 tween——tween 每次都會配置物件，
 *      而這些特效每秒會觸發好幾次
 *
 * 粒子的隨機方向用的是可設種子的亂數，所以同一個種子跑出來的畫面一模一樣，
 * 視覺回歸截圖才比對得了。這裡的亂數跟戰鬥邏輯是分開的兩條流，
 * 特效再怎麼抽也不會影響到遊戲結果。
 */

import { createPool, obtain, activeCount, releaseAll } from './pool.js';
import { createRng } from './core/rng.js';

/*
 * 池子大小是算出來的，不是猜的：同時存在的上限 = 生成頻率 × 存活時間。
 *
 * 噴濺一次擊殺放 18 顆、存活 620ms，而連續擊殺可以密到 600ms 一次，
 * 所以要能同時容納兩次擊殺（耐久測試就是這樣抓到 28 太小的：一分鐘回收 102 次）。
 * 多開 20 顆圓形的成本可以忽略，池子太小造成粒子被中途抽掉反而看得出來。
 */
const STINGER_COUNT = 10; // 110ms 存活，最快約 35ms 一發
const FRAGMENT_COUNT = 18; // 420ms 存活，最快約 35ms 一片
const SPLASH_COUNT = 64; // 620ms 存活，一次擊殺 18 顆，要容得下連續三次
const CRACK_COUNT = 14;

const STINGER_MS = 110;
const FRAGMENT_MS = 420;
const SPLASH_MS = 620;

const COLOR_STINGER = 0xffe08a;
const COLOR_FRAGMENT = 0x6ee7b7;
const COLOR_SPLASH = 0xf5b301;
const COLOR_CRACK = 0xff9f43;

/** 平滑的收尾曲線，讓東西飛過去時不會等速得很假。 */
function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function createEffects(scene, seed) {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);

  const stingers = createPool(STINGER_COUNT, () => ({
    node: scene.add.rectangle(0, 0, 38, 6, COLOR_STINGER).setVisible(false),
    t: 0,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0
  }));

  const fragments = createPool(FRAGMENT_COUNT, () => ({
    node: scene.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '22px',
        color: '#6ee7b7'
      })
      .setOrigin(0.5)
      .setVisible(false),
    t: 0,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    arc: 0
  }));

  const splashes = createPool(SPLASH_COUNT, () => ({
    node: scene.add.circle(0, 0, 5, COLOR_SPLASH).setVisible(false),
    t: 0,
    x0: 0,
    y0: 0,
    vx: 0,
    vy: 0
  }));

  // 敵人身上的裂痕：固定掛在敵人容器裡，按進度一道一道顯示
  const cracks = createPool(CRACK_COUNT, (i) => ({
    node: scene.add.rectangle(0, 0, 3, 14, COLOR_CRACK).setVisible(false),
    slot: i
  }));

  // 裂痕的位置在敵人身上隨機散佈，但用固定種子，所以每次都在同一個地方
  const crackLayout = new Float32Array(CRACK_COUNT * 3);
  for (let i = 0; i < CRACK_COUNT; i += 1) {
    crackLayout[i * 3] = (rng.next() - 0.5) * 46; // x
    crackLayout[i * 3 + 1] = (rng.next() - 0.5) * 34; // y
    crackLayout[i * 3 + 2] = (rng.next() - 0.5) * 1.6; // 角度（弧度）
  }

  return {
    pools: { stingers, fragments, splashes, cracks },

    /** 把裂痕掛進敵人容器，這樣敵人移動時裂痕會跟著走。 */
    attachCracksTo(container) {
      for (let i = 0; i < CRACK_COUNT; i += 1) {
        const c = cracks.items[i];
        c.node.setPosition(crackLayout[i * 3], crackLayout[i * 3 + 1]);
        c.node.setRotation(crackLayout[i * 3 + 2]);
        container.add(c.node);
      }
    },

    /** 敵人身上該顯示幾道裂痕（0~1 的比例）。 */
    setCrackProgress(ratio) {
      const shown = Math.round(ratio * CRACK_COUNT);
      for (let i = 0; i < CRACK_COUNT; i += 1) {
        cracks.items[i].node.setVisible(i < shown);
      }
    },

    fireStinger(x0, y0, x1, y1) {
      const s = obtain(stingers);
      s.t = 0;
      s.x0 = x0;
      s.y0 = y0;
      s.x1 = x1;
      s.y1 = y1;
      s.node.setPosition(x0, y0).setVisible(true).setAlpha(1);
      s.node.setRotation(Math.atan2(y1 - y0, x1 - x0));
    },

    /** 一片字母碎片從敵人飛回蜂巢。 */
    spawnFragment(letter, x0, y0, x1, y1) {
      const f = obtain(fragments);
      f.t = 0;
      f.x0 = x0;
      f.y0 = y0;
      f.x1 = x1;
      f.y1 = y1;
      f.arc = -60 - rng.next() * 60; // 往上拋一點，不要直線飛
      f.node.setText(letter.toUpperCase());
      f.node.setPosition(x0, y0).setVisible(true).setAlpha(1).setScale(1);
    },

    /** 擊殺時的蜂蜜噴濺。 */
    burst(x, y, count) {
      for (let i = 0; i < count; i += 1) {
        const p = obtain(splashes);
        const angle = rng.next() * Math.PI * 2;
        const speed = 90 + rng.next() * 230;
        p.t = 0;
        p.x0 = x;
        p.y0 = y;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed - 120; // 稍微往上噴
        p.node.setPosition(x, y).setVisible(true).setAlpha(1).setScale(1);
      }
    },

    /** 每影格推進所有特效。dt 是毫秒。 */
    update(dtMs) {
      const dt = dtMs / 1000;

      for (let i = 0; i < stingers.size; i += 1) {
        const s = stingers.items[i];
        if (!s.active) continue;
        s.t += dtMs;
        const k = s.t / STINGER_MS;
        if (k >= 1) {
          s.active = false;
          s.node.setVisible(false);
          continue;
        }
        const e = easeOutCubic(k);
        s.node.setPosition(s.x0 + (s.x1 - s.x0) * e, s.y0 + (s.y1 - s.y0) * e);
        s.node.setAlpha(1 - k * k);
      }

      for (let i = 0; i < fragments.size; i += 1) {
        const f = fragments.items[i];
        if (!f.active) continue;
        f.t += dtMs;
        const k = f.t / FRAGMENT_MS;
        if (k >= 1) {
          f.active = false;
          f.node.setVisible(false);
          continue;
        }
        const e = easeOutCubic(k);
        // 拋物線：水平線性、垂直帶一個上拋再落下
        const y = f.y0 + (f.y1 - f.y0) * e + f.arc * Math.sin(Math.PI * k);
        f.node.setPosition(f.x0 + (f.x1 - f.x0) * e, y);
        f.node.setAlpha(1 - k);
        f.node.setScale(1 - k * 0.45);
      }

      for (let i = 0; i < splashes.size; i += 1) {
        const p = splashes.items[i];
        if (!p.active) continue;
        p.t += dtMs;
        const k = p.t / SPLASH_MS;
        if (k >= 1) {
          p.active = false;
          p.node.setVisible(false);
          continue;
        }
        const secs = p.t / 1000;
        p.vy += 900 * dt; // 重力
        p.node.setPosition(p.x0 + p.vx * secs, p.y0 + p.vy * secs);
        p.node.setAlpha(1 - k);
        p.node.setScale(1 - k * 0.6);
      }
    },

    /** F3 疊加層與測試要看的池子使用量。分開列，才知道是哪一個池子太小。 */
    stats() {
      return {
        stingers: activeCount(stingers),
        fragments: activeCount(fragments),
        splashes: activeCount(splashes),
        recycled: stingers.recycled + fragments.recycled + splashes.recycled,
        spawned: stingers.spawned + fragments.spawned + splashes.spawned,
        recycledBy: {
          stingers: stingers.recycled,
          fragments: fragments.recycled,
          splashes: splashes.recycled
        }
      };
    },

    reset() {
      releaseAll(stingers);
      releaseAll(fragments);
      releaseAll(splashes);
      for (let i = 0; i < CRACK_COUNT; i += 1) cracks.items[i].node.setVisible(false);
    }
  };
}

export const EFFECT_COLORS = { COLOR_STINGER, COLOR_FRAGMENT, COLOR_SPLASH, COLOR_CRACK };
