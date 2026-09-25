/* global Phaser */

/**
 * 小遊戲：蜜蜂飛行。按一下往上飛，穿過花莖中間的空隙，碰到就結束。
 *
 * 分數是好玩用的，**不會**加到真正的金幣（見 registry.js 與 economy-test）。
 *
 * ── 為什麼這樣調 ───────────────────────────────────────────
 * 這種遊戲的樂趣來自「差一點點」，但對十歲的孩子，太難的版本只剩挫折：
 *   - 開場蜜蜂停在原地上下晃，**按了第一下才開始**。不然打開視窗的那一刻
 *     他還在看說明，蜜蜂已經掉下去了——那一局等於白付錢。
 *   - 空隙開得很寬（150），碰撞判定比畫出來的蜜蜂小一圈。
 *     「明明沒碰到」的死法最讓人不想再玩。
 *   - 速度從慢開始，每過一關加一點，有上限——前幾關一定過得去。
 *
 * 邏輯都在 step(dt) 裡，update() 只負責把時間餵進去。
 * 這樣測試可以用固定的時間一步一步推，不用真的等畫面跑。
 */

import { phaserConfig, MINIGAME_SIZE } from './registry.js';

const W = MINIGAME_SIZE.width;
const H = MINIGAME_SIZE.height;
const BEE_X = 90;
const HIT_R = 13; // 比畫出來的蜜蜂小一圈，「明明沒碰到」的死法最讓人不想再玩
/*
 * 重力偏輕：第一版 950，截圖時按兩下、停一秒半就撞地了。
 * 這是他累了之後的休息，要的是「差一點點」，不是反應測驗。
 */
const GRAVITY = 820;
const FLAP_V = -290;
const GAP = 150;
const STEM_W = 46;
const SPACING = 210;
const SPEED0 = 140;
const SPEED_STEP = 4;
const SPEED_MAX = 230;

class BeeFlapScene extends Phaser.Scene {
  constructor(hooks) {
    super('BeeFlap');
    this.hooks = hooks;
  }

  init() {
    this.score = 0;
    this.started = false;
    this.over = false;
    this.vy = 0;
    this.speed = SPEED0;
    this.stems = [];
    this.bob = 0;
  }

  preload() {
    this.load.svg('bee', '/assets/sprites/bee-mascot.svg', { width: 220, height: 220 });
  }

  create() {
    this.add.rectangle(W / 2, H - 6, W, 12, 0x6ab04c); // 地面
    this.bee = this.add.image(BEE_X, H / 2, 'bee').setScale(0.28).setDepth(5);
    // 白邊：分數常常剛好疊在綠色花莖上，深藍字壓在綠底上幾乎看不見
    this.scoreText = this.add.text(W / 2, 14, '0', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '30px', color: '#004e98',
      stroke: '#ffffff', strokeThickness: 6
    }).setOrigin(0.5, 0).setDepth(6);
    this.hint = this.add.text(W / 2, H / 2 + 60, '按空白鍵或點一下開始', {
      fontFamily: 'sans-serif', fontSize: '18px', color: '#1f2937', backgroundColor: '#ffffffcc',
      padding: { x: 10, y: 6 }
    }).setOrigin(0.5).setDepth(6);

    if (this.input.keyboard) {
      this.input.keyboard.addCapture('SPACE,UP');
      this.input.keyboard.on('keydown-SPACE', () => this.flap());
      this.input.keyboard.on('keydown-UP', () => this.flap());
    }
    this.input.on('pointerdown', () => this.flap());
    this.hooks.onReady();
  }

  flap() {
    if (this.over) return;
    if (!this.started) {
      this.started = true;
      this.hint.setVisible(false);
      this.spawnStem(W + 20);
    }
    this.vy = FLAP_V;
  }

  spawnStem(x) {
    const gapY = Phaser.Math.Between(90 + GAP / 2, H - 70 - GAP / 2);
    const top = this.add.rectangle(x, (gapY - GAP / 2) / 2, STEM_W, gapY - GAP / 2, 0x2e8b57);
    const bottomH = H - (gapY + GAP / 2);
    const bottom = this.add.rectangle(x, gapY + GAP / 2 + bottomH / 2, STEM_W, bottomH, 0x2e8b57);
    // 空隙兩端各一朵花：讓他一眼看出「要從這裡過」
    const f1 = this.add.circle(x, gapY - GAP / 2, 16, 0xff7eb6);
    const f2 = this.add.circle(x, gapY + GAP / 2, 16, 0xffd166);
    this.stems.push({ x, gapY, parts: [top, bottom, f1, f2], passed: false });
  }

  update(time, delta) {
    this.step(Math.min(delta, 50));
  }

  step(dtMs) {
    const dt = dtMs / 1000;
    if (this.over) return;
    if (!this.started) {
      this.bob += dt * 4;
      this.bee.y = H / 2 + Math.sin(this.bob) * 8;
      return;
    }

    this.vy += GRAVITY * dt;
    this.bee.y += this.vy * dt;
    this.bee.setRotation(Phaser.Math.Clamp(this.vy / 900, -0.4, 0.8));

    for (const s of this.stems) {
      s.x -= this.speed * dt;
      for (const p of s.parts) p.x = s.x;
      if (!s.passed && s.x + STEM_W / 2 < BEE_X - HIT_R) {
        s.passed = true;
        this.score += 1;
        this.speed = Math.min(SPEED_MAX, this.speed + SPEED_STEP);
        this.scoreText.setText(String(this.score));
        this.hooks.onScore(this.score);
      }
    }
    // 滑出畫面的收掉，右邊不夠就補一組
    while (this.stems.length && this.stems[0].x < -STEM_W) {
      this.stems.shift().parts.forEach((p) => p.destroy());
    }
    const last = this.stems[this.stems.length - 1];
    if (!last || last.x < W + 20 - SPACING) this.spawnStem((last ? last.x : W) + SPACING);

    if (this.hits()) this.finish();
  }

  hits() {
    const y = this.bee.y;
    if (y - HIT_R < 0 || y + HIT_R > H - 12) return true;
    return this.stems.some((s) => {
      const inX = Math.abs(s.x - BEE_X) < STEM_W / 2 + HIT_R;
      const inGap = y - HIT_R > s.gapY - GAP / 2 && y + HIT_R < s.gapY + GAP / 2;
      return inX && !inGap;
    });
  }

  finish() {
    if (this.over) return;
    this.over = true;
    this.hooks.onEnd(this.score);
  }

  /**
   * 測試用：自動駕駛。每一步把蜜蜂放在下一組空隙的正中間，
   * 用真的 step() 把時間往前推，直到穿過兩組。
   */
  autoplay() {
    if (!this.started) this.flap();
    for (let i = 0; i < 2000 && this.score < 2 && !this.over; i += 1) {
      const next = this.stems.find((s) => !s.passed);
      if (next) { this.bee.y = next.gapY; this.vy = 0; }
      this.step(16);
    }
    return this.score;
  }
}

export function create(parentId, { onScore, onEnd, onReady }) {
  const scene = new BeeFlapScene({ onScore, onEnd, onReady });
  const game = new Phaser.Game(phaserConfig(parentId, scene));
  return {
    game,
    finish: () => scene.finish(),
    autoplay: () => scene.autoplay(),
    score: () => scene.score,
    // 測試用，只讀
    peekStarted: () => scene.started
  };
}
