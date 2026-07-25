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
    this.layout();

    this.bee = this.add.image(this.centerX, this.centerY, 'bee');
    this.scaleBee();
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

    // 答案揭曉時遊戲區會變矮，畫布跟著縮，這裡要重新擺位與縮放
    this.scale.on('resize', () => this.reflow());

    window.dispatchEvent(new CustomEvent('practice-scene-ready'));
  }

  layout() {
    this.centerX = this.scale.width / 2;
    this.centerY = this.scale.height / 2;
  }

  /**
   * 讓蜜蜂依可用空間縮放。
   * 直接指定顯示尺寸而不是換算倍率——素材本身有留白，用倍率推算容易失準。
   */
  scaleBee() {
    const size = Math.max(90, Math.min(this.scale.width, this.scale.height) * 0.8);
    // 先停掉還在跑的縮放動畫，否則它會用舊的目標值覆蓋掉新尺寸
    this.tweens.killTweensOf(this.bee);
    this.bee.setDisplaySize(size, size);
    this.bee.setPosition(this.centerX, this.centerY);
    // 記下基準倍率：所有反應動畫都以它為基礎做相對變化，
    // 不能寫死絕對值，否則畫面一縮放，動畫就會把蜜蜂拉回舊尺寸
    this.baseScale = this.bee.scaleX;
  }

  reflow() {
    if (!this.bee) return;
    this.layout();
    this.bee.setPosition(this.centerX, this.centerY);
    this.scaleBee();
    if (this.idleTween) {
      this.idleTween.stop();
      this.idleTween = this.tweens.add({
        targets: this.bee,
        y: this.centerY - 8,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }
    [this.coinParticles, this.starBurst].forEach((p) => {
      if (p) p.setPosition(this.centerX, this.centerY);
    });
    if (this.fireIcon) this.fireIcon.setPosition(this.centerX + 100, this.centerY - 90);
  }

  reactListening() {
    this.tweens.add({
      targets: this.bee,
      scaleX: this.baseScale * 1.06,
      scaleY: this.baseScale * 0.94,
      duration: 160,
      yoyo: true,
      repeat: 2
    });
  }

  reactCorrect() {
    this.coinParticles.explode(14);
    this.tweens.add({
      targets: this.bee,
      scale: this.baseScale * 1.12,
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
    transparent: true,
    scene: [PracticeScene],
    physics: { default: undefined },
    // RESIZE 讓畫布完全填滿容器（FIT 會依固定比例縮放，在細長的手機版面上會留下大片空白）
    scale: {
      mode: Phaser.Scale.RESIZE,
      parent: containerId,
      width: '100%',
      height: '100%'
    }
  });
}
