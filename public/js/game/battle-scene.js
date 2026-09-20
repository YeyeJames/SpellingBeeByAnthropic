/**
 * 戰鬥場景（渲染端）。
 *
 * 這裡只做兩件事：把 battle.js 的狀態畫出來、把事件演成聲光。
 * 絕對不可以反過來改狀態——規則的唯一來源是 battle.js。
 *
 * 1.3 開始堆手感：蜂針、閃白、擠壓、字母碎片、裂痕、擊殺噴濺與頓挫。
 * 音效是 1.4，真正的美術素材也還沒進來，所以外形仍是基本圖形。
 *
 * 紀律：所有顯示物件都在 create() 建好，update() 裡不新建任何東西。
 * 動畫全部自己算，不用 Phaser 的 tween——tween 每次都會配置物件，
 * 而這些特效每秒會觸發好幾次。
 */

import { BALANCE } from './core/balance.js';
import { createClock, advanceClock } from './core/clock.js';
import { stepBattle, clearEvents, EV, EV_NAME, LISTEN_KIND } from './core/battle.js';
import { samplePerf } from './perf.js';
import { createEffects } from './effects.js';

const SCAFFOLD_NOTE = '（靜音或裝置沒有語音時才顯示）';

const LANE_LEFT = 0.18; // 蜂巢位置（畫面寬度的比例）
const LANE_RIGHT = 0.92; // 入侵口

/* 擊殺頓挫：短暫凍結世界，讓「打掉了」這件事有重量。 */
const HIT_STOP_MS = 80;
/* 敵人被擊中的擠壓與閃白時間 */
const ENEMY_HIT_MS = 130;

const ENEMY_BASE_COLOR = 0x2b3350;
const ENEMY_FLASH_COLOR = 0xffffff;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 兩個 0xRRGGBB 之間插值，用來做閃白後的淡回。 */
function lerpColor(from, to, t) {
  const r = Math.round(lerp((from >> 16) & 0xff, (to >> 16) & 0xff, t));
  const g = Math.round(lerp((from >> 8) & 0xff, (to >> 8) & 0xff, t));
  const b = Math.round(lerp(from & 0xff, to & 0xff, t));
  return (r << 16) | (g << 8) | b;
}

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
      this.lastShowWord = null;
      // 特效用的計時器（毫秒，-1 代表沒在跑）
      this.enemyHitT = -1;
      this.hitStopUntil = 0;
      this.energyPulseT = -1;
    }

    create() {
      const { width, height } = this.scale;

      // ── 背景：三層，之後會換成真正的視差 ──────────────────
      this.bgFar = this.add.rectangle(0, 0, width, height, 0x10131f).setOrigin(0);
      this.bgMid = this.add.rectangle(0, height * 0.52, width, height * 0.48, 0x171c2e).setOrigin(0);
      this.ground = this.add.rectangle(0, height * 0.72, width, height * 0.28, 0x1e2540).setOrigin(0);

      /*
       * 蜂巢與敵人用 ellipse / rectangle 這種定位語意明確的基本圖形。
       *
       * 試過用 Polygon 畫六角形與甲蟲外形，但 Phaser 的 Polygon 是以外框
       * 左上角定位、setOrigin 對它無效，本體與附掛物總是錯開一段。
       * 真正的 SVG 素材本來就要另外做，沒必要為了中繼版本去猜引擎的行為。
       */
      this.hiveGlow = this.add.circle(0, 0, 62, 0xf5b301, 0.12);
      this.hive = this.add.ellipse(0, 0, 84, 84, 0xf5b301);

      // 敵人包成 Container：移動容器時裡面的裂痕必然跟著走
      this.enemy = this.add.container(0, 0);
      this.enemyBody = this.add.ellipse(0, 0, 68, 52, ENEMY_BASE_COLOR).setStrokeStyle(3, 0xff5d5d);
      this.enemy.add(this.enemyBody);

      this.effects = createEffects(this, ctx.getSeed());
      this.effects.attachCracksTo(this.enemy);

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
       * 單字文字：預設不顯示。
       *
       * 這是聽寫遊戲，壓力要來自敵人逼近而不是讀字，所以有語音可用時
       * 只唸不寫。但「靜音也要能玩」也是硬性要求，而單字本身是唯一
       * 只存在於聲音裡的資訊——所以靜音、或裝置根本沒有英文語音時，
       * 就退回顯示文字。兩個要求在這裡是用同一個開關解決的。
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
      this.hiveX = width * LANE_LEFT;
      this.hive.setPosition(this.hiveX, this.laneY);
      this.hiveGlow.setPosition(this.hiveX, this.laneY);

      const hudY = height * 0.12;
      this.hpDots.forEach((dot, i) => dot.setPosition(width * 0.06 + i * 30, hudY));

      const barW = Math.min(520, width * 0.4);
      this.energyBg.setPosition(width * 0.5 - barW / 2, hudY).setSize(barW, 16);
      this.energyFill.setPosition(width * 0.5 - barW / 2, hudY).setSize(1, 16);
      this.energyBarWidth = barW;
      this.energyBarX = width * 0.5 - barW / 2;

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

      /*
       * 擊殺頓挫：短暫凍結邏輯，讓「打掉了」有重量。
       *
       * 凍結期間不推進時鐘，累積的真實時間也一併丟掉——這正是「世界停住」
       * 的意思。這段期間的按鍵會由輸入佇列留著，不會被吃掉（1.2 做的機制
       * 在這裡第一次派上真正的用場）。
       */
      const frozen = performance.now() < this.hitStopUntil;

      if (!ctx.isPaused() && !frozen) {
        const steps = advanceClock(this.clock, delta);
        for (let i = 0; i < steps && state.status === 'running'; i += 1) {
          stepBattle(state);
          this.consumeEvents(state);
        }
      }

      /*
       * 特效在「頓挫」時要繼續播，在「暫停」時要停。
       *
       * 頓挫是演出的一部分，凍結的是遊戲世界不是畫面；暫停則是玩家離開，
       * 整個畫面都該定住。兩者看起來像，但混在一起處理會讓暫停期間的粒子
       * 自己飄完，回來時場面已經不一樣了。
       */
      if (!ctx.isPaused()) {
        this.effects.update(delta);
        this.updateEnemyHit(delta);
      }
      this.render(state);

      const now = performance.now();
      // 新狀態已經畫出來了，結算這一格的按鍵延遲
      ctx.markRendered(now);
      // interval 是「實際跑到幾 fps」，work 是「這一格花了多少 CPU」。
      // 無頭瀏覽器量得準的是後者，所以兩個都記。
      samplePerf(ctx.perf, delta, now - workStart);
    }

    /** 把邏輯事件轉成演出與紀錄。 */
    consumeEvents(state) {
      // 先把還沒發聲的事件唸掉（按鍵造成的那些已經在套用當下發過了）
      ctx.soundBridge?.flush(state, null);

      for (let i = 0; i < state.evCount; i += 1) {
        const ev = state.ev[i];
        ctx.debug._recordBattleEvent(ev);
        ctx.debug._recordChannel(EV_NAME[ev.type] || `EV_${ev.type}`, 'vfx');
        switch (ev.type) {
          case EV.LETTER_OK: {
            const ex = this.enemy.x;
            const ey = this.enemy.y;
            // 蜂針從蜂巢飛出去打到敵人
            this.effects.fireStinger(this.hiveX, this.laneY, ex, ey);
            // 一片字母碎片從敵人飛回蜂巢
            const letter = state.target[ev.a - 1] || '';
            if (letter) this.effects.spawnFragment(letter, ex, ey, this.hiveX, this.laneY);
            this.effects.setCrackProgress(ev.a / Math.max(1, ev.b));
            this.enemyHitT = 0;
            this.energyPulseT = 0;
            break;
          }
          case EV.LETTER_BAD:
            this.cameras.main.flash(90, 255, 60, 60, false);
            this.cameras.main.shake(60, 0.003);
            break;
          case EV.WORD_KILLED:
            this.effects.burst(this.enemy.x, this.enemy.y, 18);
            this.effects.setCrackProgress(0);
            this.cameras.main.shake(70, 0.004);
            // 頓挫：凍結世界，同時讓輸入排隊而不是打在看不見的畫面上
            this.hitStopUntil = performance.now() + HIT_STOP_MS;
            ctx.blockInput(HIT_STOP_MS);
            this.enemyHitT = -1;
            this.enemyBody.setScale(1, 1);
            break;
          case EV.WORD_MISSED:
            this.cameras.main.shake(180, 0.01);
            this.effects.setCrackProgress(0);
            break;
          case EV.LISTEN:
            // 玩家已經付出敵人前進的代價，這裡把單字再唸一次給他
            ctx.speakCurrentWord(
              ev.a === LISTEN_KIND.SLOW ? 'slow' : ev.a === LISTEN_KIND.SENTENCE ? 'sentence' : 'normal'
            );
            break;
          case EV.WORD_START:
            this.effects.setCrackProgress(0);
            ctx.speakCurrentWord();
            break;
          default:
            break;
        }
      }
      clearEvents(state);
      ctx.soundBridge?.reset();
    }

    /** 敵人被擊中時的擠壓與閃白，自己算不用 tween。 */
    updateEnemyHit(delta) {
      if (this.enemyHitT >= 0) {
        this.enemyHitT += delta;
        const k = this.enemyHitT / ENEMY_HIT_MS;
        if (k >= 1) {
          this.enemyHitT = -1;
          this.enemyBody.setScale(1, 1);
          this.enemyBody.setFillStyle(ENEMY_BASE_COLOR);
        } else {
          // 先被擠扁再彈回來
          this.enemyBody.setScale(lerp(1.22, 1, k), lerp(0.78, 1, k));
          this.enemyBody.setFillStyle(lerpColor(ENEMY_FLASH_COLOR, ENEMY_BASE_COLOR, k));
        }
      }

      if (this.energyPulseT >= 0) {
        this.energyPulseT += delta;
        const k = this.energyPulseT / 140;
        if (k >= 1) {
          this.energyPulseT = -1;
          this.energyFill.setAlpha(1);
        } else {
          this.energyFill.setAlpha(lerp(0.55, 1, k));
        }
      }
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
        const show = ctx.shouldShowWord();
        if (show !== this.lastShowWord) {
          this.lastShowWord = show;
          this.wordText.setAlpha(show ? 1 : 0);
          this.scaffoldNote.setText(show ? SCAFFOLD_NOTE : '');
        }
        if (show && (state.wordIndex !== this.lastWordIndex || state.typed !== this.lastTyped)) {
          this.lastWordIndex = state.wordIndex;
          this.lastTyped = state.typed;
          const typedPart = state.target.slice(0, state.typed).toUpperCase();
          this.wordText.setText(`${typedPart}${state.target.slice(state.typed)}`);
        }
        if (this.lastStatus !== 'running') {
          this.lastStatus = 'running';
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
