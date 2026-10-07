/* global Phaser */

/**
 * 小遊戲：蜂巢疊疊樂。蜂巢塊左右滑，按一下放下去，疊得越高越好。
 *
 * 分數是好玩用的，**不會**加到真正的金幣（見 registry.js 與 economy-test）。
 *
 * ── 玩法 ───────────────────────────────────────────────────
 *   - 放歪的那一截會被切掉掉下去，上面那一塊就變窄——越疊越難
 *   - 對得很準（差 6 像素以內）算「完美」，不會變窄；連續三次完美還會長回來一點
 *   - 完全沒有疊到才結束。沒有倒數，是「再一塊就好」的那種遊戲
 *
 * ── 為什麼這樣調 ───────────────────────────────────────────
 * 跟其他幾個小遊戲一樣，這是他練累了之後的休息：
 *   - 第一塊很寬、很慢，打開視窗還在看說明的時候它只是在滑，不會輸
 *   - 速度每疊一層加一點，有上限——再高也不會快到看不清
 *   - 「完美」的判定刻意寬一點：差一點點就被切掉一截，是最讓人想再玩的時刻，
 *     但每次都差一點點只會讓人生氣
 *
 * 邏輯都在 step(dt) 與 drop() 裡，update() 只負責把時間餵進去，測試可以一步一步推。
 */

import { phaserConfig, MINIGAME_SIZE } from './registry.js';

const W = MINIGAME_SIZE.width;
const H = MINIGAME_SIZE.height;
const SLAB_H = 26;
const BASE_W = 200;
const BASE_Y = H - 30;
const PERFECT = 6;
const GROW_AFTER = 3; // 連續幾次完美之後長回來
const GROW_BY = 10;
const SPEED0 = 120;
const SPEED_STEP = 7;
const SPEED_MAX = 270;
const CAM_LINE = 150; // 正在滑的那一塊在畫面上不要高過這條線
const COLORS = [0xffc93c, 0xf5a623, 0xffd97a, 0xe9a23b];

class StackScene extends Phaser.Scene {
  constructor(hooks) {
    super('Stack');
    this.hooks = hooks;
  }

  init() {
    this.score = 0;
    this.over = false;
    this.layers = [];
    this.mover = null;
    this.dir = 1;
    this.speed = SPEED0;
    this.perfectRun = 0;
  }

  create() {
    this.world = this.add.container(0, 0);
    this.layers.push({ x: W / 2, w: BASE_W, y: BASE_Y, obj: this.makeSlab(W / 2, BASE_Y, BASE_W, 0) });

    const style = { fontFamily: 'Arial Black, sans-serif', fontSize: '22px', color: '#004e98' };
    this.scoreText = this.add.text(12, 10, '0 層', style).setDepth(5);
    this.hint = this.add.text(W / 2, 60, '按空白鍵或點一下放下去', {
      fontFamily: 'sans-serif', fontSize: '17px', color: '#1f2937', backgroundColor: '#ffffffcc',
      padding: { x: 10, y: 6 }
    }).setOrigin(0.5).setDepth(5);
    this.flash = this.add.text(W / 2, 100, '', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '24px', color: '#ff6b35',
      stroke: '#ffffff', strokeThickness: 5
    }).setOrigin(0.5).setDepth(5);

    if (this.input.keyboard) {
      this.input.keyboard.addCapture('SPACE,DOWN');
      this.input.keyboard.on('keydown-SPACE', () => this.drop());
      this.input.keyboard.on('keydown-DOWN', () => this.drop());
      this.input.keyboard.on('keydown-ENTER', () => this.drop());
    }
    this.input.on('pointerdown', () => this.drop());

    this.spawnMover();
    this.hooks.onReady();
  }

  makeSlab(x, y, w, i) {
    const slab = this.add.rectangle(x, y, w, SLAB_H, COLORS[i % COLORS.length]).setStrokeStyle(2, 0x9a6400);
    this.world.add(slab);
    return slab;
  }

  top() {
    return this.layers[this.layers.length - 1];
  }

  /* 新的一塊從左右輪流出來，寬度跟最上面那一塊一樣 */
  spawnMover() {
    const top = this.top();
    const fromLeft = this.layers.length % 2 === 1;
    const x = fromLeft ? top.w / 2 : W - top.w / 2;
    const y = top.y - SLAB_H;
    this.dir = fromLeft ? 1 : -1;
    this.mover = { x, y, w: top.w, obj: this.makeSlab(x, y, top.w, this.layers.length) };
  }

  update(time, delta) {
    this.step(Math.min(delta, 50));
  }

  step(dtMs) {
    const dt = dtMs / 1000;
    // 鏡頭：疊高了就整疊往下移，正在滑的那一塊一直在看得到的地方
    const target = Math.max(0, CAM_LINE - (this.mover ? this.mover.y : 0));
    this.world.y += (target - this.world.y) * Math.min(1, dt * 6);
    if (this.over || !this.mover) return;

    const m = this.mover;
    m.x += this.dir * this.speed * dt;
    if (m.x + m.w / 2 > W) { m.x = W - m.w / 2; this.dir = -1; }
    if (m.x - m.w / 2 < 0) { m.x = m.w / 2; this.dir = 1; }
    m.obj.x = m.x;
  }

  drop() {
    if (this.over || !this.mover) return;
    this.hint.setVisible(false);
    const top = this.top();
    const m = this.mover;

    const perfect = Math.abs(m.x - top.x) <= PERFECT;
    if (perfect) m.x = top.x;
    const left = Math.max(m.x - m.w / 2, top.x - top.w / 2);
    const right = Math.min(m.x + m.w / 2, top.x + top.w / 2);
    const overlap = right - left;

    if (overlap <= 0) {
      // 完全沒疊到：整塊掉下去，這一局結束
      this.tweens.add({ targets: m.obj, y: m.obj.y + 320, angle: this.dir * 40, alpha: 0, duration: 700 });
      this.mover = null;
      this.finish();
      return;
    }

    m.obj.destroy();
    let w = overlap;
    let x = (left + right) / 2;
    if (perfect) {
      this.perfectRun += 1;
      if (this.perfectRun >= GROW_AFTER) {
        w = Math.min(BASE_W, w + GROW_BY);
        this.perfectRun = 0;
      }
      this.say(this.perfectRun === 0 ? '完美！變寬了！' : '完美！');
    } else {
      this.perfectRun = 0;
      // 切掉的那一截掉下去：看得到自己差了多少
      const cutW = m.w - overlap;
      const cutX = m.x > top.x ? right + cutW / 2 : left - cutW / 2;
      const cut = this.makeSlab(cutX, m.y, cutW, this.layers.length);
      this.tweens.add({ targets: cut, y: cut.y + 300, angle: m.x > top.x ? 30 : -30, alpha: 0, duration: 800,
        onComplete: () => cut.destroy() });
    }

    this.layers.push({ x, w, y: m.y, obj: this.makeSlab(x, m.y, w, this.layers.length) });
    this.score += 1;
    this.scoreText.setText(`${this.score} 層`);
    this.hooks.onScore(this.score);
    this.speed = Math.min(SPEED_MAX, this.speed + SPEED_STEP);
    this.spawnMover();
  }

  say(text) {
    this.flash.setText(text).setAlpha(1);
    this.tweens.add({ targets: this.flash, alpha: 0, delay: 500, duration: 300 });
  }

  finish() {
    if (this.over) return;
    this.over = true;
    this.hooks.onEnd(this.score);
  }

  /** 測試用：把滑動的那一塊對準下面那一塊，真的「放下去」三次。 */
  autoplay() {
    for (let i = 0; i < 3 && !this.over; i += 1) {
      this.mover.x = this.top().x;
      this.drop();
    }
    return this.score;
  }
}

export function create(parentId, { onScore, onEnd, onReady }) {
  const scene = new StackScene({ onScore, onEnd, onReady });
  const game = new Phaser.Game(phaserConfig(parentId, scene));
  return {
    game,
    finish: () => scene.finish(),
    autoplay: () => scene.autoplay(),
    score: () => scene.score,
    // 測試用，只讀
    peekStack: () => ({ layers: scene.score, moverX: scene.mover ? scene.mover.x : null, over: scene.over })
  };
}
