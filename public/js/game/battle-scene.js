/**
 * 戰鬥場景（渲染端）。
 *
 * 這裡只做兩件事：把 battle.js 的狀態畫出來、把事件演成聲光。
 * 絕對不可以反過來改狀態——規則的唯一來源是 battle.js。
 *
 * 1.1 的畫面刻意樸素：幾何圖形、沒有粒子、沒有音效。
 * 這一步要驗證的是骨架（固定時間步、重播一致、bot 跑得動），
 * 手感與美術從 1.3、1.4 才開始堆。
 *
 * 紀律：所有顯示物件都在 create() 建好，update() 裡不新建任何東西。
 * 這個習慣現在養成，1.3 加粒子時才不會變成 GC 卡頓的來源。
 */

import { BALANCE } from './core/balance.js';
import { createClock, advanceClock } from './core/clock.js';
import { stepBattle, clearEvents, EV } from './core/battle.js';
import { samplePerf } from './perf.js';

const SCAFFOLD_NOTE = '（1.1 臨時顯示：發音做好後會拿掉）';

const LANE_LEFT = 0.18; // 蜂巢位置（畫面寬度的比例）
const LANE_RIGHT = 0.92; // 入侵口

export function createBattleScene(ctx) {
  const Phaser = window.Phaser;

  return new (class BattleScene extends Phaser.Scene {
    constructor() {
      super({ key: 'battle' });
      this.clock = createClock();
      this.lastFrameMs = 0;
    }

    create() {
      const { width, height } = this.scale;

      // ── 背景：三層，之後 1.3 會換成真正的視差 ──────────────
      this.bgFar = this.add.rectangle(0, 0, width, height, 0x10131f).setOrigin(0);
      this.bgMid = this.add.rectangle(0, height * 0.55, width, height * 0.45, 0x171c2e).setOrigin(0);
      this.ground = this.add.rectangle(0, height * 0.78, width, height * 0.22, 0x1e2540).setOrigin(0);

      // ── 蜂巢（你的基地） ───────────────────────────────────
      this.hive = this.add.polygon(0, 0, hexPoints(46), 0xf5b301).setOrigin(0.5);
      this.hiveGlow = this.add.circle(0, 0, 62, 0xf5b301, 0.12);

      // ── 敵人：1.1 先用一個帶描邊的多邊形 ───────────────────
      this.enemy = this.add.polygon(0, 0, beetlePoints(34), 0x2b3350).setStrokeStyle(3, 0xff5d5d);
      this.enemyCrack = this.add.rectangle(0, 0, 4, 44, 0xff9f43).setOrigin(0.5).setAlpha(0);

      // ── HUD ────────────────────────────────────────────────
      this.hpDots = [];
      for (let i = 0; i < BALANCE.maxHp; i += 1) {
        this.hpDots.push(this.add.circle(0, 0, 11, 0xf5b301));
      }

      this.energyBg = this.add.rectangle(0, 0, 10, 14, 0x000000, 0.35).setOrigin(0, 0.5);
      this.energyFill = this.add.rectangle(0, 0, 10, 14, 0x6ee7b7).setOrigin(0, 0.5);

      this.comboText = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '26px', color: '#ffd166' })
        .setOrigin(1, 0.5);

      this.honeyText = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '20px', color: '#cbd5e1' })
        .setOrigin(1, 0.5);

      /*
       * 臨時鷹架：1.1 還沒有發音（音效是 1.4），不把單字顯示出來就沒辦法玩。
       * 1.4 接上發音之後這一行就會拿掉——設計上畫面是不顯示字母的，
       * 壓力要來自敵人逼近，不是來自讀字。
       */
      this.wordText = this.add
        .text(0, 0, '', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '44px',
          color: '#e2e8f0'
        })
        .setOrigin(0.5);
      this.scaffoldNote = this.add
        .text(0, 0, SCAFFOLD_NOTE, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '13px',
          color: '#64748b'
        })
        .setOrigin(0.5);

      this.statusText = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '30px', color: '#f8fafc' })
        .setOrigin(0.5)
        .setAlpha(0);

      this.layout();
      this.scale.on('resize', this.layout, this);
      ctx.onSceneReady?.(this);
    }

    /** 所有位置都從畫面尺寸算出來，換解析度或 iPad 都不必改程式。 */
    layout() {
      const width = this.scale.width;
      const height = this.scale.height;

      this.bgFar.setSize(width, height);
      this.bgMid.setPosition(0, height * 0.55).setSize(width, height * 0.45);
      this.ground.setPosition(0, height * 0.78).setSize(width, height * 0.22);

      // 戰場：畫面下方 65%；HUD 與敵人隊列在上方
      this.laneY = height * 0.62;
      this.hive.setPosition(width * LANE_LEFT, this.laneY);
      this.hiveGlow.setPosition(width * LANE_LEFT, this.laneY);

      const hudY = height * 0.12;
      this.hpDots.forEach((dot, i) => dot.setPosition(width * 0.06 + i * 30, hudY));

      const barW = Math.min(520, width * 0.4);
      this.energyBg.setPosition(width * 0.5 - barW / 2, hudY).setSize(barW, 16);
      this.energyFill.setPosition(width * 0.5 - barW / 2, hudY).setSize(1, 16);
      this.energyBarWidth = barW;

      this.comboText.setPosition(width * 0.94, hudY);
      this.honeyText.setPosition(width * 0.94, hudY + 30);

      this.wordText.setPosition(width * 0.5, height * 0.3);
      this.scaffoldNote.setPosition(width * 0.5, height * 0.3 + 40);
      this.statusText.setPosition(width * 0.5, height * 0.5);
    }

    update(time, delta) {
      samplePerf(ctx.perf, delta);

      const state = ctx.getState();
      if (!state) return;

      /*
       * 先把按鍵產生的事件演掉，再跑邏輯步。
       *
       * 玩家的動作是在影格與影格之間套用的（為了壓低延遲，見 game.js），
       * 它產生的事件會留在緩衝區裡。如果等跑完第一個邏輯步才處理，
       * 這些回饋就會平白晚一格；暫停中也要清，否則恢復時會一次爆出來。
       */
      this.consumeEvents(state);

      if (!ctx.isPaused()) {
        const steps = advanceClock(this.clock, delta);
        for (let i = 0; i < steps && state.status === 'running'; i += 1) {
          stepBattle(state);
          this.consumeEvents(state);
        }
      }
      this.render(state);
    }

    /** 把這一步產生的邏輯事件轉成演出與紀錄。1.4 之後這裡也會觸發音效。 */
    consumeEvents(state) {
      for (let i = 0; i < state.evCount; i += 1) {
        const ev = state.ev[i];
        ctx.debug._recordBattleEvent(ev);
        switch (ev.type) {
          case EV.LETTER_OK:
            this.enemyCrack.setAlpha(Math.min(1, ev.a / Math.max(1, ev.b)));
            break;
          case EV.LETTER_BAD:
            this.cameras.main.flash(90, 255, 60, 60, false);
            break;
          case EV.WORD_KILLED:
            this.enemyCrack.setAlpha(0);
            this.cameras.main.shake(70, 0.004);
            break;
          case EV.WORD_MISSED:
            this.cameras.main.shake(180, 0.01);
            break;
          default:
            break;
        }
      }
      clearEvents(state);
    }

    render(state) {
      const width = this.scale.width;
      const x = Phaser.Math.Linear(width * LANE_RIGHT, width * LANE_LEFT, state.progress);
      this.enemy.setPosition(x, this.laneY);
      this.enemyCrack.setPosition(x, this.laneY);

      this.hpDots.forEach((dot, i) => dot.setFillStyle(i < state.hp ? 0xf5b301 : 0x334155));

      const ratio = state.target.length ? state.typed / state.target.length : 0;
      this.energyFill.setSize(Math.max(1, this.energyBarWidth * ratio), 16);

      this.comboText.setText(state.combo > 1 ? `x${state.combo}` : '');
      this.honeyText.setText(`🍯 ${state.honey}`);

      if (state.status === 'running') {
        const typedPart = state.target.slice(0, state.typed).toUpperCase();
        const restPart = state.target.slice(state.typed);
        this.wordText.setText(`${typedPart}${restPart}`);
        this.scaffoldNote.setText(SCAFFOLD_NOTE);
        this.statusText.setAlpha(0);
      } else {
        this.wordText.setText('');
        // 只是隱藏，不是清空——重開一場時要能復原
        this.scaffoldNote.setText('');
        this.statusText
          .setText(state.status === 'won' ? '全部打完了！' : '蜂巢被攻破了')
          .setAlpha(1);
      }
    }
  })();
}

/* ── 幾何：1.3 會換成真正的 SVG 素材 ──────────────────────── */

function hexPoints(r) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(r * Math.cos(a), r * Math.sin(a));
  }
  return pts;
}

function beetlePoints(r) {
  return [-r, 0, -r * 0.5, -r * 0.7, r * 0.5, -r * 0.6, r, 0, r * 0.5, r * 0.6, -r * 0.5, r * 0.7];
}
