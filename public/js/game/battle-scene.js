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
      // 上一影格畫出來的值，用來避免沒必要的 setText（見 render）
      this.lastCombo = -1;
      this.lastHoney = -1;
      this.lastTyped = -1;
      this.lastWordIndex = -2;
      this.lastStatus = '';
    }

    create() {
      const { width, height } = this.scale;

      // ── 背景：三層，之後 1.3 會換成真正的視差 ──────────────
      this.bgFar = this.add.rectangle(0, 0, width, height, 0x10131f).setOrigin(0);
      this.bgMid = this.add.rectangle(0, height * 0.55, width, height * 0.45, 0x171c2e).setOrigin(0);
      this.ground = this.add.rectangle(0, height * 0.78, width, height * 0.22, 0x1e2540).setOrigin(0);

      /*
       * 蜂巢與敵人先用 ellipse / rectangle 這種定位語意明確的基本圖形。
       *
       * 試過用 Polygon 畫出六角形與甲蟲外形，但 Phaser 的 Polygon 是以外框
       * 左上角定位、setOrigin 對它無效，結果本體與裂痕標記總是錯開一段。
       * 1.3 本來就要換成真正的 SVG 素材，沒必要為了中繼版本去猜引擎的行為——
       * 改用原點可預測的圖形，一次消掉這整類問題。
       */
      this.hiveGlow = this.add.circle(0, 0, 62, 0xf5b301, 0.12);
      this.hive = this.add.ellipse(0, 0, 84, 84, 0xf5b301);

      /*
       * 敵人放進 Container。
       *
       * Phaser 的 Polygon 是以外框的左上角定位的，setOrigin 對它沒有作用，
       * 所以直接把本體與裂痕各自設座標時，兩者會錯開一段（實測就是這樣）。
       * 包成 Container 之後只要移動容器，裡面的東西必然跟著走——
       * 1.3 要往敵人身上加動畫與粒子時，這個結構也正好用得上。
       */
      this.enemy = this.add.container(0, 0);
      const body = this.add.ellipse(0, 0, 68, 52, 0x2b3350).setStrokeStyle(3, 0xff5d5d);
      this.enemyCrack = this.add.rectangle(0, 0, 5, 40, 0xff9f43).setAlpha(0);
      this.enemy.add([body, this.enemyCrack]);

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
      this.bgMid.setPosition(0, height * 0.52).setSize(width, height * 0.48);
      this.ground.setPosition(0, height * 0.72).setSize(width, height * 0.28);

      // 戰場：地面帶的稍微上方，讓角色站在地上而不是浮在半空
      this.laneY = height * 0.68;
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
      const workStart = performance.now();

      const state = ctx.getState();
      if (!state) {
        samplePerf(ctx.perf, delta, 0);
        return;
      }

      /*
       * 先把按鍵產生的事件演掉，再跑邏輯步。
       *
       * 玩家的動作是在影格與影格之間套用的（為了壓低延遲，見 game.js），
       * 它產生的事件會留在緩衝區裡。如果等跑完第一個邏輯步才處理，
       * 這些回饋就會平白晚一格；暫停中也要清，否則恢復時會一次爆出來。
       */
      this.consumeEvents(state);

      // 空窗期間排隊的按鍵，在這裡照原順序補上（見 input-queue.js）
      if (ctx.drainQueue() > 0) this.consumeEvents(state);

      if (!ctx.isPaused()) {
        const steps = advanceClock(this.clock, delta);
        for (let i = 0; i < steps && state.status === 'running'; i += 1) {
          stepBattle(state);
          this.consumeEvents(state);
        }
      }
      this.render(state);

      const now = performance.now();
      // 新狀態已經畫出來了，結算這一格的按鍵延遲
      ctx.markRendered(now);
      // interval 是「實際跑到幾 fps」，work 是「這一格花了多少 CPU」。
      // 無頭瀏覽器量得準的是後者，所以兩個都記。
      samplePerf(ctx.perf, delta, now - workStart);
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

      this.hpDots.forEach((dot, i) => dot.setFillStyle(i < state.hp ? 0xf5b301 : 0x334155));

      const ratio = state.target.length ? state.typed / state.target.length : 0;
      this.energyFill.setSize(Math.max(1, this.energyBarWidth * ratio), 16);

      /*
       * 只有值真的變了才 setText。
       *
       * 每個影格組字串等於每秒配置一兩百個字串物件，GC 遲早會在某個
       * 隨機時間點介入造成掉格——正是「戰鬥中不新建物件」要防的東西。
       * 量測有抓到：修之前一場 12 個字 heap 成長 6.9MB。
       */
      if (state.combo !== this.lastCombo) {
        this.lastCombo = state.combo;
        this.comboText.setText(state.combo > 1 ? `x${state.combo}` : '');
      }
      if (state.honey !== this.lastHoney) {
        this.lastHoney = state.honey;
        this.honeyText.setText(`🍯 ${state.honey}`);
      }

      if (state.status === 'running') {
        if (state.wordIndex !== this.lastWordIndex || state.typed !== this.lastTyped) {
          this.lastWordIndex = state.wordIndex;
          this.lastTyped = state.typed;
          const typedPart = state.target.slice(0, state.typed).toUpperCase();
          this.wordText.setText(`${typedPart}${state.target.slice(state.typed)}`);
        }
        if (this.lastStatus !== 'running') {
          this.lastStatus = 'running';
          this.scaffoldNote.setText(SCAFFOLD_NOTE); // 重開一場要能復原
          this.wordText.setAlpha(1);
          this.statusText.setAlpha(0);
        }
      } else if (this.lastStatus !== state.status) {
        this.lastStatus = state.status;
        this.wordText.setAlpha(0);
        this.scaffoldNote.setText('');
        this.statusText
          .setText(state.status === 'won' ? '全部打完了！' : '蜂巢被攻破了')
          .setAlpha(1);
      }
    }
  })();
}

