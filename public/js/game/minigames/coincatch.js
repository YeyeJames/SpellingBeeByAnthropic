/* global Phaser */

/**
 * 小遊戲：接金幣。移動拼字蜂接住掉下來的金幣，30 秒。
 *
 * 分數是好玩用的，**不會**加到真正的金幣（見 registry.js 與 economy-test）。
 *
 * 從舊版 minigame-coincatch.js 改過來，差別：
 *   - 用回呼通知商店，不用 window 事件（舊版每打開一次就多掛一個監聽，
 *     打開第五次時接到一枚金幣會「叮」五聲）
 *   - 畫布 360×400 跟著視窗縮放（手機上不會凸出去）
 *   - 可以 finish()，關視窗時會真的停下來
 */

import { phaserConfig, MINIGAME_SIZE } from './registry.js';

const W = MINIGAME_SIZE.width;
const H = MINIGAME_SIZE.height;
const BEE_Y = H - 60;
const SECONDS = 30;

class CoinCatchScene extends Phaser.Scene {
  constructor(hooks) {
    super('CoinCatch');
    this.hooks = hooks;
  }

  init() {
    this.score = 0;
    this.timeLeft = SECONDS;
    this.over = false;
  }

  preload() {
    this.load.svg('bee', '/assets/sprites/bee-mascot.svg', { width: 220, height: 220 });
    this.load.svg('coin', '/assets/icons/coin.svg', { width: 48, height: 48 });
  }

  create() {
    this.bee = this.add.image(W / 2, BEE_Y, 'bee').setScale(0.45);
    this.coins = [];
    const style = { fontFamily: 'Arial Black, sans-serif', fontSize: '20px', color: '#004e98' };
    this.scoreText = this.add.text(12, 10, '0 分', style);
    this.timerText = this.add.text(W - 12, 10, `${SECONDS}`, { ...style, color: '#ff6b35' }).setOrigin(1, 0);

    this.cursors = this.input.keyboard ? this.input.keyboard.createCursorKeys() : null;
    this.input.on('pointermove', (p) => { this.bee.x = Phaser.Math.Clamp(p.x, 30, W - 30); });

    this.spawnEvent = this.time.addEvent({ delay: 600, loop: true, callback: () => this.spawnCoin() });
    this.clock = this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    this.hooks.onReady();
  }

  spawnCoin(x = Phaser.Math.Between(24, W - 24), y = -20) {
    const coin = this.add.image(x, y, 'coin').setScale(0.5);
    coin.fallSpeed = Phaser.Math.Between(120, 220);
    this.coins.push(coin);
    return coin;
  }

  tick() {
    this.timeLeft -= 1;
    this.timerText.setText(String(Math.max(0, this.timeLeft)));
    if (this.timeLeft <= 0) this.finish();
  }

  update(time, delta) {
    if (this.over) return;
    if (this.cursors) {
      if (this.cursors.left.isDown) this.bee.x -= 5;
      if (this.cursors.right.isDown) this.bee.x += 5;
      this.bee.x = Phaser.Math.Clamp(this.bee.x, 30, W - 30);
    }
    this.moveCoins(delta);
  }

  moveCoins(delta) {
    for (let i = this.coins.length - 1; i >= 0; i -= 1) {
      const coin = this.coins[i];
      coin.y += (coin.fallSpeed * delta) / 1000;
      const caught = Math.abs(coin.x - this.bee.x) < 34 && coin.y > BEE_Y - 30 && coin.y < BEE_Y + 15;
      if (caught) {
        this.score += 1;
        this.scoreText.setText(`${this.score} 分`);
        this.hooks.onScore(this.score);
        coin.destroy();
        this.coins.splice(i, 1);
      } else if (coin.y > H + 20) {
        coin.destroy();
        this.coins.splice(i, 1);
      }
    }
  }

  finish() {
    if (this.over) return;
    this.over = true;
    this.spawnEvent.remove();
    this.clock.remove();
    this.hooks.onEnd(this.score);
  }

  /** 測試用：在蜜蜂頭上放三枚金幣，走一次真的碰撞判定。 */
  autoplay() {
    for (let i = 0; i < 3; i += 1) this.spawnCoin(this.bee.x, BEE_Y - 10);
    this.moveCoins(0);
    return this.score;
  }
}

export function create(parentId, { onScore, onEnd, onReady }) {
  const scene = new CoinCatchScene({ onScore, onEnd, onReady });
  const game = new Phaser.Game(phaserConfig(parentId, scene));
  return {
    game,
    finish: () => scene.finish(),
    autoplay: () => scene.autoplay(),
    score: () => scene.score
  };
}
