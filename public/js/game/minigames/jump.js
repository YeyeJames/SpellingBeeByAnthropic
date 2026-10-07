/* global Phaser */

/**
 * 小遊戲：跳跳蜂。蜜蜂踩著花一路往上彈，左右移動接住下一朵花，掉下去就結束。
 *
 * 分數是好玩用的，**不會**加到真正的金幣（見 registry.js 與 economy-test）。
 *
 * ── 玩法 ───────────────────────────────────────────────────
 *   - 蜜蜂落到花上會自動彈起來，只要管左右：← → （或 A D），
 *     也可以用滑鼠／手指，蜜蜂會跟著往那邊飛
 *   - 從左邊飛出去會從右邊回來
 *   - 每踩到一朵更高的花 1 分。爬高了以後有些花會左右移動
 *
 * ── 為什麼這樣調 ───────────────────────────────────────────
 *   - 一開始踩在一整條草地上，不動也不會輸——打開視窗還在看說明，那一局不會白付
 *   - 跳得夠高（最高約 180）、花一開始排得很密，前面一定上得去；越高才越疏
 *   - 碰撞只看「往下掉的時候腳有沒有踩到花」，往上飛時會穿過花——
 *     這種遊戲大家都是這樣玩的，被頭頂的花擋住反而會覺得是 bug
 *
 * 邏輯都在 step(dt) 裡，update() 只負責把時間餵進去，測試可以一步一步推。
 */

import { phaserConfig, MINIGAME_SIZE } from './registry.js';

const W = MINIGAME_SIZE.width;
const H = MINIGAME_SIZE.height;
const GRAVITY = 1000;
const JUMP_V = -600; // 最高大約 v²/2g = 180
const MOVE_V = 250;
const FLOWER_W = 70;
const GAP_MIN = 55;
const GAP_MAX0 = 85; // 一開始最疏的間距
const GAP_MAX = 150; // 再高也不會比這個疏（一定跳得到）
const MOVING_AFTER = 15; // 第幾分之後開始有會動的花
const CAM_LINE = 170; // 蜜蜂在畫面上高過這條線，畫面就往上捲
const BEE_HALF = 16;

class JumpScene extends Phaser.Scene {
  constructor(hooks) {
    super('Jump');
    this.hooks = hooks;
  }

  init() {
    this.score = 0;
    this.over = false;
    this.vy = JUMP_V;
    this.flowers = [];
    this.highestLanded = H; // 踩過最高的那朵花的 y（越小越高）
    this.pointerX = null;
  }

  preload() {
    // 商店買的拼字蜂顏色由商店傳進來（小遊戲自己不讀使用者資料，見 economy-test 第 4 節）
    this.load.svg('bee', this.hooks.bee || '/assets/sprites/bee-mascot.svg', { width: 220, height: 220 });
  }

  create() {
    // 起跳的草地：整條都是，不動也不會掉下去
    this.ground = { x: W / 2, y: H - 16, w: W * 2, vx: 0, isGround: true,
      parts: [this.add.rectangle(W / 2, H - 8, W, 16, 0x6ab04c)] };
    this.flowers.push(this.ground);
    this.topY = H - 16;
    while (this.topY > -H) this.addFlower();

    this.bee = this.add.image(W / 2, H - 60, 'bee').setScale(0.22).setDepth(5);

    const style = { fontFamily: 'Arial Black, sans-serif', fontSize: '22px', color: '#004e98',
      stroke: '#ffffff', strokeThickness: 5 };
    this.scoreText = this.add.text(12, 10, '0 朵', style).setScrollFactor(0).setDepth(6);
    this.hint = this.add.text(W / 2, 70, '← → 或滑鼠，接住上面的花！', {
      fontFamily: 'sans-serif', fontSize: '17px', color: '#1f2937', backgroundColor: '#ffffffcc',
      padding: { x: 10, y: 6 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(6);

    this.keys = this.input.keyboard
      ? this.input.keyboard.addKeys({ left: 'LEFT', right: 'RIGHT', a: 'A', d: 'D' })
      : null;
    if (this.input.keyboard) this.input.keyboard.addCapture('LEFT,RIGHT');
    const follow = (p) => { this.pointerX = p.x; this.hint.setVisible(false); };
    this.input.on('pointerdown', follow);
    this.input.on('pointermove', (p) => { if (p.isDown || p.pointerType === 'mouse') follow(p); });
    this.input.on('pointerup', (p) => { if (p.pointerType !== 'mouse') this.pointerX = null; });

    this.hooks.onReady();
  }

  /* 往上再補一朵花。間距隨分數變大，但不超過跳得到的高度 */
  addFlower() {
    const gapMax = Math.min(GAP_MAX, GAP_MAX0 + this.score * 3);
    this.topY -= Phaser.Math.Between(GAP_MIN, gapMax);
    const x = Phaser.Math.Between(FLOWER_W / 2 + 6, W - FLOWER_W / 2 - 6);
    const moving = this.score >= MOVING_AFTER && Math.random() < 0.3;
    const stem = this.add.rectangle(x, this.topY + 5, FLOWER_W, 10, 0x2e8b57);
    const petals = [-22, 0, 22].map((dx, k) =>
      this.add.circle(x + dx, this.topY - 4, 9, [0xff7eb6, 0xffd166, 0xff7eb6][k]));
    this.flowers.push({ x, y: this.topY, w: FLOWER_W, vx: moving ? Phaser.Math.Between(50, 90) : 0,
      parts: [stem, ...petals], offsets: [0, -22, 0, 22] });
  }

  update(time, delta) {
    this.step(Math.min(delta, 50));
  }

  step(dtMs) {
    const dt = dtMs / 1000;
    if (this.over) return;

    // 左右：鍵盤優先，沒按鍵盤才跟著滑鼠／手指
    let vx = 0;
    const k = this.keys;
    if (k && (k.left.isDown || k.a.isDown)) vx = -MOVE_V;
    else if (k && (k.right.isDown || k.d.isDown)) vx = MOVE_V;
    else if (this.pointerX !== null) {
      const dx = this.pointerX - this.bee.x;
      vx = Math.abs(dx) < 6 ? 0 : Math.sign(dx) * MOVE_V;
    }
    if (vx) this.hint.setVisible(false);
    this.bee.x += vx * dt;
    if (this.bee.x < -BEE_HALF) this.bee.x = W + BEE_HALF;
    if (this.bee.x > W + BEE_HALF) this.bee.x = -BEE_HALF;
    if (vx) this.bee.setFlipX(vx < 0);

    // 會動的花
    for (const f of this.flowers) {
      if (!f.vx) continue;
      f.x += f.vx * dt;
      if (f.x < f.w / 2 || f.x > W - f.w / 2) f.vx = -f.vx;
      f.parts.forEach((p, i) => { p.x = f.x + f.offsets[i]; });
    }

    // 往下掉的時候，腳穿過花的頂端就彈起來
    const prevFeet = this.bee.y + BEE_HALF;
    this.vy += GRAVITY * dt;
    this.bee.y += this.vy * dt;
    const feet = this.bee.y + BEE_HALF;
    if (this.vy > 0) {
      const hit = this.flowers.find((f) => prevFeet <= f.y && feet >= f.y && Math.abs(this.bee.x - f.x) < f.w / 2 + 8);
      if (hit) {
        this.bee.y = hit.y - BEE_HALF;
        this.vy = JUMP_V;
        if (!hit.isGround && hit.y < this.highestLanded) {
          this.highestLanded = hit.y;
          this.score += 1;
          this.scoreText.setText(`${this.score} 朵`);
          this.hooks.onScore(this.score);
        }
      }
    }

    // 畫面往上捲；上面不夠就補花、下面看不到的收掉
    const cam = this.cameras.main;
    if (this.bee.y - cam.scrollY < CAM_LINE) cam.scrollY = this.bee.y - CAM_LINE;
    while (this.topY > cam.scrollY - 60) this.addFlower();
    this.flowers = this.flowers.filter((f) => {
      if (f.y > cam.scrollY + H + 60) { f.parts.forEach((p) => p.destroy()); return false; }
      return true;
    });

    if (this.bee.y - cam.scrollY > H + 40) this.finish();
  }

  finish() {
    if (this.over) return;
    this.over = true;
    this.hooks.onEnd(this.score);
  }

  /**
   * 測試用：自動駕駛。往下掉的時候把蜜蜂移到上面最近那朵花的正上方，
   * 用真的 step() 把時間往前推，直到踩到兩朵。
   */
  autoplay() {
    for (let i = 0; i < 3000 && this.score < 2 && !this.over; i += 1) {
      if (this.vy > 0) {
        const next = this.flowers
          .filter((f) => !f.isGround && f.y < this.highestLanded && f.y > this.bee.y + BEE_HALF - 1)
          .sort((a, b) => b.y - a.y)[0];
        if (next) this.bee.x = next.x;
      } else if (this.vy < 0) {
        const above = this.flowers
          .filter((f) => !f.isGround && f.y < this.highestLanded && f.y < this.bee.y)
          .sort((a, b) => b.y - a.y)[0];
        if (above) this.bee.x = above.x;
      }
      this.step(16);
    }
    return this.score;
  }
}

export function create(parentId, { onScore, onEnd, onReady, bee }) {
  const scene = new JumpScene({ onScore, onEnd, onReady, bee });
  const game = new Phaser.Game(phaserConfig(parentId, scene));
  return {
    game,
    finish: () => scene.finish(),
    autoplay: () => scene.autoplay(),
    score: () => scene.score,
    // 測試用，只讀
    peekJump: () => ({ x: scene.bee ? scene.bee.x : null, over: scene.over })
  };
}
