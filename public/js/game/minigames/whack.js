/* global Phaser */

/**
 * 小遊戲：打蟲大作戰。蟲從蜂巢洞裡冒出來，按牠身上的字母把牠打回去。30 秒。
 *
 * 分數是好玩用的，**不會**加到真正的金幣（見 registry.js 與 economy-test）。
 *
 * ── 設計 ───────────────────────────────────────────────────
 * 用的是他整天都在打的那些字母鍵，但它是**反應遊戲，不是考試**：
 *   - 按錯沒有懲罰（只閃一下）。這是他累了之後的休息，不該再多一個會被扣分的地方
 *   - 也可以直接點蟲，平板上沒有鍵盤一樣能玩
 *   - 字母顯示大寫：一眼認得出來，按大小寫都算
 *   - 越打越快、後面會同時冒兩隻，但前幾秒一定慢到打得到
 */

import { phaserConfig, MINIGAME_SIZE } from './registry.js';

const W = MINIGAME_SIZE.width;
const H = MINIGAME_SIZE.height;
const SECONDS = 30;
const COLS = 3;
const ROWS = 3;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BUG_COLORS = [0xe63946, 0x8e44ad, 0x2a9d8f, 0xf4a261, 0x3a86ff];

class WhackScene extends Phaser.Scene {
  constructor(hooks) {
    super('Whack');
    this.hooks = hooks;
  }

  init() {
    this.score = 0;
    this.timeLeft = SECONDS;
    this.over = false;
    this.bugs = []; // { hole, letter, parts, until }
    /*
     * 這一局自己的時間（毫秒）。蟲什麼時候縮回去都用它算。
     *
     * 第一版用 this.time.now 算到期、用 update(time) 的 time 比——那是兩個
     * 不同的時鐘：建立場景時 this.time.now 還是 0，而 update 拿到的是頁面
     * 開起來到現在的時間。結果**每一局的第一隻蟲一冒出來就縮回去**，
     * 他打開遊戲的第一秒什麼都打不到。只用自己累加的時間就不會有兩個時鐘。
     */
    this.elapsed = 0;
  }

  create() {
    const top = 70;
    const cellW = W / COLS;
    const cellH = (H - top - 10) / ROWS;
    this.holes = [];
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const x = cellW * c + cellW / 2;
        const y = top + cellH * r + cellH / 2 + 18;
        this.add.ellipse(x, y, 84, 30, 0x5b3a1a); // 洞
        this.holes.push({ x, y, busy: false });
      }
    }

    const style = { fontFamily: 'Arial Black, sans-serif', fontSize: '20px', color: '#004e98' };
    this.scoreText = this.add.text(12, 10, '0 隻', style);
    this.timerText = this.add.text(W - 12, 10, `${SECONDS}`, { ...style, color: '#ff6b35' }).setOrigin(1, 0);
    this.missText = this.add.text(W / 2, 44, '', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#9ca3af'
    }).setOrigin(0.5);

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (e) => {
        if (e.key && e.key.length === 1) this.press(e.key.toUpperCase());
      });
    }
    this.spawnEvent = this.time.addEvent({ delay: 650, loop: true, callback: () => this.maybeSpawn() });
    this.clock = this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    this.maybeSpawn();
    this.hooks.onReady();
  }

  /* 越打越快：一開始一隻蟲停 1.6 秒，打越多停越短，最短 0.85 秒 */
  lifeMs() {
    return Math.max(850, 1600 - this.score * 35);
  }

  maxBugs() {
    return this.score >= 8 ? 2 : 1;
  }

  maybeSpawn() {
    if (this.over || this.bugs.length >= this.maxBugs()) return null;
    const free = this.holes.filter((h) => !h.busy);
    if (!free.length) return null;
    const hole = free[Phaser.Math.Between(0, free.length - 1)];
    // 同時在場的蟲不要同一個字母，不然按下去不知道打的是哪一隻
    const used = new Set(this.bugs.map((b) => b.letter));
    const pool = [...LETTERS].filter((l) => !used.has(l));
    const letter = pool[Phaser.Math.Between(0, pool.length - 1)];
    return this.spawnAt(hole, letter);
  }

  spawnAt(hole, letter) {
    hole.busy = true;
    const color = BUG_COLORS[Phaser.Math.Between(0, BUG_COLORS.length - 1)];
    const body = this.add.circle(hole.x, hole.y - 22, 30, color).setInteractive({ useHandCursor: true });
    // 觸角：沒有的話只是一顆有字的球
    const feelers = this.add.graphics();
    feelers.lineStyle(3, 0x1f2937);
    feelers.lineBetween(hole.x - 9, hole.y - 48, hole.x - 18, hole.y - 64);
    feelers.lineBetween(hole.x + 9, hole.y - 48, hole.x + 18, hole.y - 64);
    feelers.fillStyle(0x1f2937);
    feelers.fillCircle(hole.x - 18, hole.y - 64, 3);
    feelers.fillCircle(hole.x + 18, hole.y - 64, 3);
    const eyeL = this.add.circle(hole.x - 10, hole.y - 40, 5, 0xffffff);
    const eyeR = this.add.circle(hole.x + 10, hole.y - 40, 5, 0xffffff);
    const label = this.add.text(hole.x, hole.y - 18, letter, {
      fontFamily: 'Arial Black, sans-serif', fontSize: '30px', color: '#ffffff'
    }).setOrigin(0.5);
    const bug = { hole, letter, parts: [feelers, body, eyeL, eyeR, label], until: this.elapsed + this.lifeMs() };
    body.on('pointerdown', () => this.whack(bug));
    this.bugs.push(bug);
    return bug;
  }

  press(letter) {
    if (this.over) return;
    const bug = this.bugs.find((b) => b.letter === letter);
    if (bug) this.whack(bug);
    else if (LETTERS.includes(letter)) {
      // 按錯不扣分，只讓他知道沒打到
      this.missText.setText(`${letter} 沒有蟲`);
      this.time.delayedCall(500, () => this.missText.setText(''));
    }
  }

  whack(bug) {
    if (this.over || !this.bugs.includes(bug)) return;
    this.score += 1;
    this.scoreText.setText(`${this.score} 隻`);
    this.hooks.onScore(this.score);
    // 打到的那一下要看得到：一顆星彈出來
    const pop = this.add.text(bug.hole.x, bug.hole.y - 60, '⭐', { fontSize: '26px' }).setOrigin(0.5);
    this.tweens.add({ targets: pop, y: pop.y - 30, alpha: 0, duration: 400, onComplete: () => pop.destroy() });
    this.remove(bug);
  }

  remove(bug) {
    bug.parts.forEach((p) => p.destroy());
    bug.hole.busy = false;
    this.bugs = this.bugs.filter((b) => b !== bug);
  }

  tick() {
    this.timeLeft -= 1;
    this.timerText.setText(String(Math.max(0, this.timeLeft)));
    if (this.timeLeft <= 0) this.finish();
  }

  update(time, delta) {
    if (this.over) return;
    this.elapsed += delta;
    for (const bug of [...this.bugs]) {
      if (this.elapsed >= bug.until) this.remove(bug); // 沒打到就縮回去，不扣分
    }
  }

  finish() {
    if (this.over) return;
    this.over = true;
    this.spawnEvent.remove();
    this.clock.remove();
    [...this.bugs].forEach((b) => this.remove(b));
    this.hooks.onEnd(this.score);
  }

  /** 測試用：冒三隻蟲，照牠們身上的字母真的「按」下去。 */
  autoplay() {
    for (let i = 0; i < 3; i += 1) {
      const bug = this.bugs[0] || this.maybeSpawn();
      if (bug) this.press(bug.letter);
    }
    return this.score;
  }
}

export function create(parentId, { onScore, onEnd, onReady }) {
  const scene = new WhackScene({ onScore, onEnd, onReady });
  const game = new Phaser.Game(phaserConfig(parentId, scene));
  return {
    game,
    finish: () => scene.finish(),
    autoplay: () => scene.autoplay(),
    score: () => scene.score,
    // 測試用，只讀
    peekLetter: () => (scene.bugs[0] ? scene.bugs[0].letter : null)
  };
}
