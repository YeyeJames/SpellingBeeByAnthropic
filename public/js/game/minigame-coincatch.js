/* global Phaser */

/**
 * 商店解鎖的小獎勵遊戲：接金幣。純粹好玩用，跟金幣經濟系統無關（玩多少次都不會改變真正的金幣餘額）。
 */
export class CoinCatchScene extends Phaser.Scene {
  constructor() {
    super('CoinCatchScene');
  }

  init() {
    this.score = 0;
    this.timeLeft = 30;
  }

  preload() {
    this.load.svg('bee', '/assets/sprites/bee-mascot.svg', { width: 220, height: 220 });
    this.load.svg('coin', '/assets/icons/coin.svg', { width: 48, height: 48 });
  }

  create() {
    this.bee = this.add.image(160, 300, 'bee').setScale(0.45);
    this.coinsGroup = this.add.group();

    this.scoreText = this.add.text(10, 10, 'Score: 0', {
      fontFamily: 'Arial Black',
      fontSize: '18px',
      color: '#004e98'
    });
    this.timerText = this.add.text(250, 10, '30', {
      fontFamily: 'Arial Black',
      fontSize: '18px',
      color: '#ff6b35'
    });

    this.cursors = this.input.keyboard ? this.input.keyboard.createCursorKeys() : null;
    this.input.on('pointermove', (pointer) => {
      this.bee.x = Phaser.Math.Clamp(pointer.x, 30, 290);
    });

    this.spawnEvent = this.time.addEvent({ delay: 650, loop: true, callback: () => this.spawnCoin() });
    this.countdownEvent = this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tickCountdown() });

    window.dispatchEvent(new CustomEvent('coincatch-scene-ready'));
  }

  spawnCoin() {
    const x = Phaser.Math.Between(20, 300);
    const coin = this.add.image(x, -20, 'coin').setScale(0.45);
    coin.fallSpeed = Phaser.Math.Between(110, 210);
    this.coinsGroup.add(coin);
  }

  tickCountdown() {
    this.timeLeft -= 1;
    this.timerText.setText(String(this.timeLeft));
    if (this.timeLeft <= 0) this.endGame();
  }

  update(time, delta) {
    if (this.cursors) {
      if (this.cursors.left.isDown) this.bee.x -= 4;
      if (this.cursors.right.isDown) this.bee.x += 4;
      this.bee.x = Phaser.Math.Clamp(this.bee.x, 30, 290);
    }

    this.coinsGroup.getChildren().slice().forEach((coin) => {
      coin.y += (coin.fallSpeed * delta) / 1000;
      const caught = Math.abs(coin.x - this.bee.x) < 30 && coin.y > 270 && coin.y < 310;
      if (caught) {
        this.score += 1;
        this.scoreText.setText(`Score: ${this.score}`);
        window.dispatchEvent(new CustomEvent('coincatch-coin', { detail: { score: this.score } }));
        coin.destroy();
      } else if (coin.y > 340) {
        coin.destroy();
      }
    });
  }

  endGame() {
    this.spawnEvent.remove();
    this.countdownEvent.remove();
    window.dispatchEvent(new CustomEvent('coincatch-ended', { detail: { score: this.score } }));
  }
}

export function createCoinCatchGame(containerId) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: containerId,
    width: 320,
    height: 340,
    transparent: true,
    scene: [CoinCatchScene]
  });
}
