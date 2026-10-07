/* global Phaser */

/**
 * 小遊戲：翻牌配對。16 張牌（8 對），60 秒內把一樣的翻出來。
 *
 * 分數是好玩用的，**不會**加到真正的金幣（見 registry.js 與 economy-test）。
 *
 * ── 玩法 ───────────────────────────────────────────────────
 *   - 一次翻兩張：一樣就留著，不一樣過一下就蓋回去
 *   - 每配對一組 10 分；全部配完，剩幾秒再加幾分
 *   - 用滑鼠／手指點牌，或 方向鍵 移動、空白鍵（Enter）翻牌
 *
 * ── 為什麼這樣調 ───────────────────────────────────────────
 *   - 沒有翻錯的懲罰：記性遊戲本來就是靠翻錯才記得住的
 *   - 翻錯之後停 0.7 秒才蓋回去：太快的話他還沒看清楚第二張是什麼
 *   - 圖案用一眼分得出來的東西（顏色、形狀都不一樣），不是考眼力
 */

import { phaserConfig, MINIGAME_SIZE } from './registry.js';

const W = MINIGAME_SIZE.width;
const H = MINIGAME_SIZE.height;
const SECONDS = 60;
const COLS = 4;
const ROWS = 4;
const TOP = 52;
const FACES = ['🍯', '🌻', '🐝', '🍎', '🦋', '🌈', '⭐', '🍀'];
const PAIR_POINTS = 10;
const MISMATCH_MS = 700;

class MemoryScene extends Phaser.Scene {
  constructor(hooks) {
    super('Memory');
    this.hooks = hooks;
  }

  init() {
    this.score = 0;
    this.pairs = 0;
    this.timeLeft = SECONDS;
    this.over = false;
    this.open = []; // 翻開、還沒配對的牌（最多兩張）
    this.locked = false;
    this.cursor = 0;
  }

  create() {
    const faces = Phaser.Utils.Array.Shuffle([...FACES, ...FACES]);
    const cellW = W / COLS;
    const cellH = (H - TOP - 8) / ROWS;
    this.cards = faces.map((face, i) => {
      const x = cellW * (i % COLS) + cellW / 2;
      const y = TOP + cellH * Math.floor(i / COLS) + cellH / 2;
      const back = this.add.rectangle(x, y, cellW - 12, cellH - 10, 0xf5a623).setStrokeStyle(3, 0x9a6400)
        .setInteractive({ useHandCursor: true });
      const mark = this.add.text(x, y, '?', { fontFamily: 'Arial Black, sans-serif', fontSize: '28px', color: '#ffffff' })
        .setOrigin(0.5);
      const front = this.add.text(x, y, face, { fontSize: '38px' }).setOrigin(0.5).setVisible(false);
      const card = { i, face, x, y, back, mark, front, state: 'hidden' };
      back.on('pointerdown', () => { this.cursor = i; this.drawCursor(); this.flip(i); });
      return card;
    });

    // 鍵盤選牌的外框：看得到現在選的是哪一張
    this.frame = this.add.rectangle(0, 0, cellW - 4, cellH - 2).setStrokeStyle(4, 0x004e98).setFillStyle();
    this.drawCursor();

    const style = { fontFamily: 'Arial Black, sans-serif', fontSize: '20px', color: '#004e98' };
    this.scoreText = this.add.text(12, 12, '配對 0 / 8', style);
    this.timerText = this.add.text(W - 12, 12, `${SECONDS}`, { ...style, color: '#ff6b35' }).setOrigin(1, 0);

    if (this.input.keyboard) {
      this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
      const move = (dx, dy) => {
        const c = this.cursor % COLS;
        const r = Math.floor(this.cursor / COLS);
        this.cursor = ((r + dy + ROWS) % ROWS) * COLS + ((c + dx + COLS) % COLS);
        this.drawCursor();
      };
      this.input.keyboard.on('keydown-LEFT', () => move(-1, 0));
      this.input.keyboard.on('keydown-RIGHT', () => move(1, 0));
      this.input.keyboard.on('keydown-UP', () => move(0, -1));
      this.input.keyboard.on('keydown-DOWN', () => move(0, 1));
      this.input.keyboard.on('keydown-SPACE', () => this.flip(this.cursor));
      this.input.keyboard.on('keydown-ENTER', () => this.flip(this.cursor));
    }

    this.clock = this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    this.hooks.onReady();
  }

  drawCursor() {
    const c = this.cards[this.cursor];
    this.frame.setPosition(c.x, c.y);
  }

  flip(i) {
    if (this.over || this.locked) return;
    const card = this.cards[i];
    if (!card || card.state !== 'hidden') return;
    this.show(card, true);
    card.state = 'open';
    this.open.push(card);
    if (this.open.length < 2) return;

    const [a, b] = this.open;
    this.open = [];
    if (a.face === b.face) {
      a.state = 'matched';
      b.state = 'matched';
      [a, b].forEach((c) => c.back.setFillStyle(0x9be15d));
      this.pairs += 1;
      this.score += PAIR_POINTS;
      this.scoreText.setText(`配對 ${this.pairs} / ${FACES.length}`);
      this.hooks.onScore(this.score);
      if (this.pairs === FACES.length) {
        // 全部配完：剩下的秒數當加分
        this.score += Math.max(0, this.timeLeft);
        this.time.delayedCall(500, () => this.finish());
      }
    } else {
      this.locked = true;
      this.time.delayedCall(MISMATCH_MS, () => {
        [a, b].forEach((c) => { c.state = 'hidden'; this.show(c, false); });
        this.locked = false;
      });
    }
  }

  show(card, up) {
    card.front.setVisible(up);
    card.mark.setVisible(!up);
    card.back.setFillStyle(up ? 0xfff4d6 : 0xf5a623);
  }

  tick() {
    if (this.over) return;
    this.timeLeft -= 1;
    this.timerText.setText(String(Math.max(0, this.timeLeft)));
    if (this.timeLeft <= 0) this.finish();
  }

  finish() {
    if (this.over) return;
    this.over = true;
    this.clock.remove();
    this.hooks.onEnd(this.score);
  }

  /** 測試用：找一對一樣的、還蓋著的牌，真的翻開它們。 */
  autoplay() {
    const hidden = this.cards.filter((c) => c.state === 'hidden');
    const a = hidden[0];
    const b = a && hidden.find((c) => c !== a && c.face === a.face);
    if (a && b) {
      this.flip(a.i);
      this.flip(b.i);
    }
    return this.score;
  }
}

export function create(parentId, { onScore, onEnd, onReady }) {
  const scene = new MemoryScene({ onScore, onEnd, onReady });
  const game = new Phaser.Game(phaserConfig(parentId, scene));
  return {
    game,
    finish: () => scene.finish(),
    autoplay: () => scene.autoplay(),
    score: () => scene.score,
    // 測試用，只讀：翻開的牌、選框在哪
    peekMemory: () => ({
      cursor: scene.cursor,
      open: scene.cards ? scene.cards.filter((c) => c.state === 'open').map((c) => c.i) : [],
      pairs: scene.pairs
    })
  };
}
