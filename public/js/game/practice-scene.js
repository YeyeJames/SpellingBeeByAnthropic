/* global Phaser */

/**
 * 聽寫練習畫面的 Phaser 場景：吉祥物蜜蜂反應動畫、金幣飛入、連擊特效。
 * 這裡直接用全域 Phaser（由 /vendor/phaser.min.js 載入），不用 npm 打包。
 */
export class PracticeScene extends Phaser.Scene {
  constructor() {
    super('PracticeScene');
  }

  preload() {
    this.load.svg('bee', '/assets/sprites/bee-mascot.svg', { width: 220, height: 220 });
    this.load.svg('coin', '/assets/icons/coin.svg', { width: 48, height: 48 });
    this.load.svg('star', '/assets/icons/star.svg', { width: 40, height: 40 });
    this.load.svg('fire', '/assets/icons/fire-streak.svg', { width: 48, height: 48 });
  }

  create() {
    const { width, height } = this.scale;
    this.centerX = width / 2;
    this.centerY = height / 2 + 10;

    this.bee = this.add.image(this.centerX, this.centerY, 'bee').setScale(0.9);
    this.idleTween = this.tweens.add({
      targets: this.bee,
      y: this.centerY - 8,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.coinParticles = this.add.particles(0, 0, 'coin', {
      x: this.centerX,
      y: this.centerY,
      lifespan: 700,
      speed: { min: 150, max: 320 },
      angle: { min: 250, max: 290 },
      gravityY: 500,
      scale: { start: 0.5, end: 0.15 },
      quantity: 0,
      emitting: false
    });

    this.starBurst = this.add.particles(0, 0, 'star', {
      x: this.centerX,
      y: this.centerY,
      lifespan: 900,
      speed: { min: 80, max: 260 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.7, end: 0 },
      rotate: { start: 0, end: 360 },
      quantity: 0,
      emitting: false
    });

    this.fireIcon = this.add.image(this.centerX + 100, this.centerY - 90, 'fire').setScale(0).setAlpha(0);

    window.dispatchEvent(new CustomEvent('practice-scene-ready'));
  }

  reactListening() {
    this.tweens.add({
      targets: this.bee,
      scaleX: 0.95,
      scaleY: 0.85,
      duration: 160,
      yoyo: true,
      repeat: 2
    });
  }

  reactCorrect() {
    this.coinParticles.explode(14);
    this.tweens.add({
      targets: this.bee,
      scale: 1.05,
      duration: 180,
      yoyo: true,
      ease: 'Back.easeOut'
    });
  }

  reactIncorrect() {
    this.tweens.add({
      targets: this.bee,
      x: this.centerX - 12,
      duration: 70,
      yoyo: true,
      repeat: 3
    });
  }

  reactStreak() {
    this.starBurst.explode(20);
    this.fireIcon.setScale(0).setAlpha(1);
    this.tweens.add({
      targets: this.fireIcon,
      scale: 1,
      duration: 250,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.fireIcon,
          alpha: 0,
          delay: 700,
          duration: 400
        });
      }
    });
  }
}

export function createPracticeGame(containerId) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: containerId,
    width: 320,
    height: 260,
    transparent: true,
    scene: [PracticeScene],
    physics: { default: undefined }
  });
}
