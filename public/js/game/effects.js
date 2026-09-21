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
const STINGER_COUNT = 10; // 130ms 存活，最快約 35ms 一發
const FRAGMENT_COUNT = 18; // 420ms 存活，最快約 35ms 一片
const SPLASH_COUNT = 64; // 620ms 存活，一次擊殺 18 顆，要容得下連續三次
const CRACK_COUNT = 14;
/*
 * 飄分：每打對一個字母、每擊殺、每次懲罰都飄一個。
 *
 * 存活 800ms，而最快的情況是快手速連打（約 120ms 一個字母）再加上擊殺
 * 與長字獎勵同時出現，所以同時存在大概 8~9 個。12 是寬鬆的上限。
 */
const FLOAT_COUNT = 12;

const STINGER_MS = 130;
const MUZZLE_MS = 110;
const MUZZLE_COUNT = 8;
const FRAGMENT_MS = 420;
const SPLASH_MS = 620;
const FLOAT_MS = 800;

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
  /* 飄分的排位序號，見 floatText */
  let floatSeq = 0;

  /*
   * 蜂針改成「曳光」而不是飛行物。
   *
   * 原本是一個 38×6 的小方塊用 110ms 飛完 930px 的跑道。實機上的回報是
   * 「只看到有東西從敵人彈回左邊的圓，不像有射出去」——也就是說射擊這一段
   * 根本沒被看見，因果關係整個反過來了。
   *
   * 一格 60fps 只有約 7 格可看，每格位移 150px，沒有動態模糊的情況下
   * 那就是一次閃爍。曳光的做法是整條路徑瞬間出現再淡掉：既看得見方向，
   * 也不會像飛行物那樣把「打中」的感覺往後延——敵人是當下就該閃白的。
   */
  /*
   * 曳光用 1×1 的方塊配 setScale 拉長，而不是 setSize。
   *
   * Phaser 的 Shape 是照內部 geom 產生圖形的，setSize 改得到寬高屬性
   * 卻不一定重建那個 geom——實測就是整條線完全沒畫出來。
   * 縮放是變換矩陣，一定生效，而且不必每格重建幾何。
   */
  const stingers = createPool(STINGER_COUNT, () => ({
    node: scene.add.rectangle(0, 0, 1, 1, COLOR_STINGER).setOrigin(0, 0.5).setVisible(false),
    t: 0,
    len: 0
  }));

  // 蜂巢的發射閃光，讓「從這裡射出去」有個起點
  const muzzles = createPool(MUZZLE_COUNT, () => ({
    node: scene.add.circle(0, 0, 16, COLOR_STINGER).setVisible(false),
    t: 0
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

  /*
   * 飄分。
   *
   * 設計書 §9：規則要從演出中長出來，不是從說明書讀進去。蜂蜜的加減一直
   * 都有在算，但畫面從來沒講過——右上角的數字默默跳動，他不會把「我剛剛
   * 打對了這個字母」跟「+1」連在一起。飄一個數字出來就連起來了，成本極低。
   */
  const floats = createPool(FLOAT_COUNT, () => ({
    node: scene.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#f5b301',
        stroke: '#10131f',
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setVisible(false),
    t: 0,
    x0: 0,
    y0: 0,
    vx: 0,
    rise: 0,
    scale: 1
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
    pools: { stingers, fragments, splashes, cracks, muzzles, floats },

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

    /** 從蜂巢往敵人打一道曳光，整條路徑瞬間出現再淡掉。 */
    fireStinger(x0, y0, x1, y1) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);

      const s = obtain(stingers);
      s.t = 0;
      s.len = len;
      s.node
        .setPosition(x0, y0)
        .setRotation(Math.atan2(dy, dx))
        .setScale(len, 5)
        .setVisible(true)
        .setAlpha(0.95);

      const m = obtain(muzzles);
      m.t = 0;
      m.node.setPosition(x0, y0).setVisible(true).setAlpha(0.9).setScale(0.6);
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

    /**
     * 飄一個數字出來。
     *
     * @param text  要飄的字，例如 "+1"、"-1.5 秒"、"+5 長字！"
     * @param opts.color 顏色。加分用金色、扣時間用紅色、Combo 加成用亮金色
     * @param opts.scale 大小倍率。越重要的事越大，他不用讀字就知道有差
     */
    floatText(text, x, y, { color = '#f5b301', scale = 1, fan = true } = {}) {
      const f = obtain(floats);
      f.t = 0;

      /*
       * fan=false 給「大事」用（連擊達標、擊殺獎勵）。
       * 那種訊息只會一次出現一個，而且必須出現在指定的位置——
       * 跟著散開的話反而會撞到旁邊那一串小加分。
       */
      if (!fan) {
        f.x0 = x;
        f.y0 = y;
        f.vx = 0;
        f.rise = 44;
        f.scale = scale;
        f.node.setText(text).setColor(color);
        f.node.setPosition(x, y).setVisible(true).setAlpha(1).setScale(scale);
        return;
      }

      /*
       * 散開的方式是「輪流排位」，不是純亂數。
       *
       * 快手速連打時五六個 +1 會在 100ms 內從同一個點冒出來，純亂數靠運氣
       * 分不開——實測就是糊成一團完全看不出數字，等於白飄。
       * 用一個循環的序號扇形排開，最少也保證相鄰兩個差一格；
       * 亂數只負責加一點抖動，讓它不要整齊得像表格。
       */
      const slot = floatSeq % 5;
      floatSeq = (floatSeq + 1) % 15;
      const spread = (slot - 2) * 30 + (rng.next() - 0.5) * 14;

      f.x0 = x + spread;
      // 起點高度也錯開，同一時間冒出來的才不會在同一條水平線上
      f.y0 = y - (floatSeq % 3) * 18;
      f.vx = spread * 0.5;
      f.rise = 56 + rng.next() * 20;
      f.scale = scale;
      f.node.setText(text).setColor(color);
      f.node.setPosition(f.x0, f.y0).setVisible(true).setAlpha(1).setScale(scale);
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
        // 整條長度不變，用變細＋變淡收掉，看起來像一道殘留的軌跡
        s.node.setAlpha(0.95 * (1 - k));
        s.node.setScale(s.len, Math.max(1, 5 * (1 - k * 0.8)));
      }

      for (let i = 0; i < muzzles.size; i += 1) {
        const m = muzzles.items[i];
        if (!m.active) continue;
        m.t += dtMs;
        const k = m.t / MUZZLE_MS;
        if (k >= 1) {
          m.active = false;
          m.node.setVisible(false);
          continue;
        }
        m.node.setAlpha(0.9 * (1 - k));
        m.node.setScale(0.6 + k * 0.9);
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

      for (let i = 0; i < floats.size; i += 1) {
        const f = floats.items[i];
        if (!f.active) continue;
        f.t += dtMs;
        const k = f.t / FLOAT_MS;
        if (k >= 1) {
          f.active = false;
          f.node.setVisible(false);
          continue;
        }
        const e = easeOutCubic(k);
        f.node.setPosition(f.x0 + f.vx * e, f.y0 - f.rise * e);
        // 前 15% 先彈大一下再回來：小小的「跳出來」，眼睛才會被抓到
        const pop = k < 0.15 ? 1 + (0.15 - k) * 2 : 1;
        f.node.setScale(f.scale * pop);
        // 後半才開始淡出，不然數字還沒讀完就不見了
        f.node.setAlpha(k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45);
      }
    },

    /** F3 疊加層與測試要看的池子使用量。分開列，才知道是哪一個池子太小。 */
    stats() {
      return {
        stingers: activeCount(stingers),
        fragments: activeCount(fragments),
        splashes: activeCount(splashes),
        floats: activeCount(floats),
        recycled:
          stingers.recycled + fragments.recycled + splashes.recycled + muzzles.recycled +
          floats.recycled,
        spawned:
          stingers.spawned + fragments.spawned + splashes.spawned + muzzles.spawned +
          floats.spawned,
        recycledBy: {
          stingers: stingers.recycled,
          fragments: fragments.recycled,
          splashes: splashes.recycled,
          floats: floats.recycled
        }
      };
    },

    reset() {
      releaseAll(muzzles);
      releaseAll(stingers);
      releaseAll(fragments);
      releaseAll(splashes);
      releaseAll(floats);
      for (let i = 0; i < CRACK_COUNT; i += 1) cracks.items[i].node.setVisible(false);
    }
  };
}

export const EFFECT_COLORS = { COLOR_STINGER, COLOR_FRAGMENT, COLOR_SPLASH, COLOR_CRACK };
