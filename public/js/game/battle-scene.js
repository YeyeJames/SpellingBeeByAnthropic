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
import { ENEMY_KINDS, enemyKindFor } from './core/enemy-kind.js';
import { createRng } from './core/rng.js';

const SCAFFOLD_NOTE = '（靜音或裝置沒有語音時才顯示）';

const LANE_LEFT = 0.18; // 蜂巢位置（畫面寬度的比例）
/*
 * 入侵口。從 0.92 往左移，右邊那一截留給排隊的敵人站。
 *
 * 0.76 是量出來的：設計要求畫面上同時看得到 3~5 隻，而站位是
 * 入侵口再往右每隔一個間隔排一隻。留 0.82 的話，1440 寬的螢幕上
 * 有兩隻會排到畫面外，只剩三隻——壓力就少了一半。
 *
 * 這只影響畫面上走的距離，不影響時間：推進是時間算的，不是像素算的。
 */
const LANE_RIGHT = 0.76;

/* 擊殺頓挫：短暫凍結世界，讓「打掉了」這件事有重量。 */
const HIT_STOP_MS = 80;

/*
 * 漏字時把正確拼法亮出來。
 *
 * 沒打完就是不知道怎麼拼。這時候如果只是扣一滴血、換下一個字，他什麼也沒學到，
 * 而且會一直在同一個字上重複失敗（漏掉的字會排回隊伍尾端，本場之內還會再遇到）。
 * 所以一定要讓他看見那個字長什麼樣子。
 *
 * 不凍結畫面：凍結的同時得把輸入擋掉，而擋下來的按鍵解凍後會打在「下一個字」上，
 * 平白多出幾次打錯。下一個敵人走完全程至少好幾秒，兩秒的提示來得及看完。
 */
const MISS_REVEAL_MS = 2200;
const MISS_FADE_MS = 500;

/*
 * Combo 三階的橫幅。
 *
 * 效果如果只改數值、畫面不講，他只會覺得「這次好像比較好打」，
 * 不會知道是自己連對五個換來的——而「我做對了才有的」正是獎勵的全部意義。
 */
const BONUS_BANNER_MS = 1600;
const BONUS_FADE_MS = 400;
/*
 * 橫幅要寫出**具體數字**，不是只寫效果名稱。
 *
 * 「蜂群衝刺！」他讀得懂字但不知道發生了什麼；「敵人速度 −50%，持續 3 秒」
 * 他才會把畫面上的變化跟這行字連起來。數字全部從 balance.js 現場算，
 * 調平衡不用回來改文案（跟 rules.js 同一個理由）。
 */
const cb = BALANCE.combo;
const BONUS_LABELS = {
  1: {
    text: `🐝 蜂群衝刺　敵人速度 −${Math.round((1 - cb.dashSpeedFactor) * 100)}%　${cb.dashMs / 1000} 秒`,
    color: '#67e8f9'
  },
  2: {
    text: `🍯 蜜糖時間　下一個字時間 ×${cb.sweetTimeFactor}`,
    color: '#fbbf24'
  },
  3: {
    text: `⚡ 狂蜂狀態　擊退 ×${cb.frenzyKnockbackFactor}、蜂蜜 ×${cb.frenzyHoneyFactor}　${cb.frenzyMs / 1000} 秒`,
    color: '#fb923c'
  }
};

/*
 * 懲罰的「衝刺」演出。
 *
 * 重聽會讓敵人前進 1.5 秒的距離，但畫面上是瞬間跳過去的——看起來像瞬移，
 * 而瞬移不會讓人覺得「我剛剛付出了代價」。改成用 320ms 滑過去之後，
 * 他會**看著**蟲往前衝那一段，那個焦慮感本身就是代價。
 *
 * 重點：這純粹是畫面。state.progress 仍然當下就變更（戰鬥邏輯不能為了
 * 演出而延遲，那會破壞確定性與重播）。畫面上的蟲用一個逐漸歸零的位移
 * 去追邏輯位置，320ms 內追上。
 */
const PENALTY_DASH_MS = 320;
/*
 * 重聽的畫面回饋。
 *
 * 重聽原本只有聲音：按下去，單字再唸一次，畫面完全不動。靜音的時候
 * （在客廳、在車上）他按了就完全沒有反應，只會以為按鍵壞了——而重聽
 * 是要付代價的（敵人會前進），沒有回饋等於白白被扣。
 */
const LISTEN_BANNER_MS = 900;
const LISTEN_LABELS = {
  [LISTEN_KIND.REPLAY]: '🔊 再聽一次',
  [LISTEN_KIND.SLOW]: '🐢 放慢唸',
  [LISTEN_KIND.SENTENCE]: '📖 例句'
};
/*
 * 已經拼對的字母，列在血條下面。
 *
 * 打錯字母不會清掉已經打對的部分（見 battle.js，清空重來對小孩來說
 * 是前功盡棄）。但這件好事在畫面上完全看不出來：他按錯一下，畫面閃紅、
 * 蟲往前衝，然後呢？那個錯的字母到底算不算數、他現在該從第幾個字母
 * 接下去——沒有任何東西回答得了。於是他只能從頭猜起。
 *
 * 所以把「目前已經拼對的」直接寫出來。只寫打對的部分，後面不補格子：
 * 補了等於告訴他這個字有幾個字母，而這是聽寫遊戲，長度也是題目的一部分。
 * 結尾那個底線是「下一個打這裡」。
 */
const TRAIL_CARET = '_';
/* 打錯時整排閃一下紅：意思是「這一下沒算進去，你還在原地」 */
const TRAIL_BAD_MS = 260;
const TRAIL_COLOR = '#f5b301';
const TRAIL_BAD_COLOR = '#f87171';

/* 敵人減速中的光環。冰藍色，跟橫幅同一個色系，看得出是同一件事 */
const SLOW_AURA_COLOR = 0x67e8f9;

/* 事件帶的是代號，代價表的鍵是字串，這張表把兩者對起來 */
const LISTEN_COST_KEY = {
  [LISTEN_KIND.REPLAY]: 'replay',
  [LISTEN_KIND.SLOW]: 'slow',
  [LISTEN_KIND.SENTENCE]: 'sentence'
};

/* 敵人被擊中的擠壓與閃白時間 */
const ENEMY_HIT_MS = 130;

/*
 * 危險區。
 *
 * 設計要求「壓力是看得見的：是敵人在逼近，不是一條抽象的進度條」。
 * 但只有位置在動的話，眼睛很容易到最後一刻才注意到——尤其小孩的注意力
 * 都在鍵盤上。所以過了這個比例之後，畫面本身要開始警告他。
 */
const DANGER_AT = 0.72;
/* 敵人由遠而近的透視縮放：遠的時候小一點，逼近時脹大 */
const ENEMY_SCALE_FAR = 0.82;
const ENEMY_SCALE_NEAR = 1.2;

const ENEMY_BASE_COLOR = 0x2b3350;
const ENEMY_FLASH_COLOR = 0xffffff;
/* 排隊中的敵人：比當前目標暗，才不會搶走注意力 */
const ENEMY_QUEUE_COLOR = 0x222a44;
const ENEMY_QUEUE_STROKE = 0x7f3d3d;

/*
 * 三層視差背景的定義。
 *
 * 貼圖一次畫好轉成材質，之後只動 tilePositionX——每格不配置任何東西。
 * 速度單位是「每秒幾個像素」。遠山 4px/s 幾乎看不出在動，那是刻意的：
 * 鏡頭其實固定，飄太快就變成蜂巢在往右跑，反而假。
 */
/* 蜂巢的素材尺寸。跟敵人一樣以兩倍點陣化，載入後縮 0.5。 */
const HIVE = { width: 110, height: 125 };

/*
 * 跑道離畫面底部（工具列上緣）至少要留這麼多。
 *
 * 蜂巢與敵人都是以 laneY 為中心畫的，所以真正該留的是「最高的東西的一半」：
 * 蜂巢 125/2 ≈ 63，最近距離的蜘蛛 124×1.2/2 ≈ 75。取 80 再留一點餘裕。
 * 寫死一個小數字的話，矮螢幕上蜂巢下半截會被工具列切掉——而蜂巢正是
 * 他要保護的東西，看不到就不知道敵人離家有多近。
 */
const LANE_BOTTOM_CLEARANCE = 80;

const PARALLAX_TEX_W = 960;
const PARALLAX_TEX_H = 200;

const PARALLAX_LAYERS = [
  {
    key: 'bg-far',
    seed: 0x5eed01,
    speed: 4,
    yFactor: 0.58, // 這一層的底邊落在畫面高度的幾成
    hFactor: 0.26,
    /** 遠山：幾道重疊的鈍圓丘陵，最暗。 */
    draw(g, rng, w, h) {
      for (let band = 0; band < 2; band += 1) {
        g.fillStyle(band === 0 ? 0x141a2c : 0x18203a, 1);
        let x = -80;
        while (x < w + 80) {
          const rx = 120 + rng.int(160);
          const ry = 46 + rng.int(46) + band * 10;
          g.fillEllipse(x, h - 6 + band * 8, rx * 2, ry * 2);
          x += rx * (1.1 + rng.next() * 0.5);
        }
      }
    }
  },
  {
    key: 'bg-mid',
    seed: 0x5eed02,
    speed: 11,
    yFactor: 0.7,
    hFactor: 0.2,
    /** 中景：一排樹叢，比遠山亮一階。 */
    draw(g, rng, w, h) {
      let x = 10;
      while (x < w + 40) {
        const trunkH = 34 + rng.int(38);
        const crownR = 18 + rng.int(20);
        g.fillStyle(0x151d33, 1);
        g.fillRect(x - 3, h - trunkH, 6, trunkH);
        g.fillStyle(0x1a2440, 1);
        g.fillEllipse(x, h - trunkH - crownR * 0.6, crownR * 2.2, crownR * 1.7);
        x += 46 + rng.int(70);
      }
    }
  },
  {
    key: 'bg-near',
    seed: 0x5eed03,
    speed: 26,
    yFactor: 0.945,
    hFactor: 0.1,
    /** 近景：草葉與零星小花，最亮也跑最快。 */
    draw(g, rng, w, h) {
      let x = 0;
      while (x < w + 20) {
        const bladeH = 18 + rng.int(34);
        const lean = rng.int(11) - 5;
        g.lineStyle(3, 0x263454, 1);
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + lean, h - bladeH);
        g.strokePath();
        // 偶爾插一朵花，讓重複沒那麼明顯
        if (rng.next() < 0.08) {
          g.fillStyle(0x4a5a2f, 1);
          g.fillCircle(x + lean, h - bladeH - 4, 3.5);
        }
        x += 8 + rng.int(14);
      }
    }
  }
];

/**
 * 把整張貼圖染成同一個顏色（受擊閃白用）。
 *
 * Phaser 4 拿掉了 setTintFill，要改成 setTint + setTintMode(FILL)。
 * 舊的呼叫不會拋例外，只會在主控台印一行警告然後「什麼都不做」——
 * 也就是閃白整個失效卻看不出來。測試裡「不准有 console 錯誤」那一條
 * 就是抓到這個。
 */
function fillTint(image, color) {
  image.setTint(color);
  if (image.setTintMode) {
    const FILL = window.Phaser?.TintModes?.FILL;
    image.setTintMode(FILL === undefined ? 1 : FILL);
  }
}

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
      this.lastDanger = null;
      // 特效用的計時器（毫秒，-1 代表沒在跑）
      this.enemyHitT = -1;
      this.hitStopUntil = 0;
      this.energyPulseT = -1;
      /*
       * 懲罰衝刺：畫面位置落後邏輯位置多少（progress 單位）。
       * 0 代表畫面已經追上邏輯。只影響畫面，不影響任何遊戲結果。
       */
      this.penaltyLag = 0;
      this.penaltyLagFrom = 0;
      this.penaltyT = 0;
    }

    /*
     * 敵人的 SVG。
     *
     * 手寫 SVG 而不是點陣圖：可無限縮放、檔案小、風格一致，而且
     * 「換圖插槽」是真的——想換成自己畫的圖，覆蓋同名檔案即可，程式不用動。
     *
     * 用兩倍尺寸點陣化，高解析度螢幕上才不會糊（載進來之後縮回 0.5）。
     * 載不到就退回原本的橢圓，遊戲照玩——素材不該是能不能玩的前提。
     */
    preload() {
      this.enemyArtOk = true;
      this.load.on('loaderror', (file) => {
        if (String(file?.key || '').startsWith('enemy-')) this.enemyArtOk = false;
      });
      // 蜂巢：跟敵人同一套畫風，暖色而不是紅色——它是要保護的東西
      this.load.svg('hive', '/assets/base/hive.svg', {
        width: HIVE.width * 2,
        height: HIVE.height * 2
      });
      for (const kind of ENEMY_KINDS) {
        const url = `/assets/enemies/${kind.file}`;
        if (kind.file.endsWith('.svg')) {
          // SVG 可以指定點陣化尺寸，直接要兩倍
          this.load.svg(`enemy-${kind.key}`, url, {
            width: kind.width * 2,
            height: kind.height * 2
          });
        } else {
          // PNG 本來就該存成兩倍尺寸（見 core/enemy-kind.js 的換圖說明）
          this.load.image(`enemy-${kind.key}`, url);
        }
      }
    }

    /** 建一隻敵人的身體：有素材就用 SVG，沒有就退回橢圓。 */
    makeEnemyBody(kindKey) {
      if (this.enemyArtOk && this.textures.exists(`enemy-${kindKey}`)) {
        return this.add.image(0, 0, `enemy-${kindKey}`).setScale(0.5);
      }
      return this.add.ellipse(0, 0, 68, 52, ENEMY_BASE_COLOR).setStrokeStyle(3, 0xff5d5d);
    }

    /**
     * 畫出三層背景的貼圖。
     *
     * 用固定種子的亂數擺形狀，所以每次啟動長得一樣——不這樣的話
     * 截圖比對永遠不會過，而且每次重開背景都變樣會讓人分心。
     */
    buildParallaxTextures() {
      for (const def of PARALLAX_LAYERS) {
        if (this.textures.exists(def.key)) continue;
        const g = this.make.graphics({ add: false });
        const rng = createRng(def.seed);
        def.draw(g, rng, PARALLAX_TEX_W, PARALLAX_TEX_H);
        g.generateTexture(def.key, PARALLAX_TEX_W, PARALLAX_TEX_H);
        g.destroy();
      }
    }

    /** 三層各自以不同速度緩慢飄移。 */
    updateParallax(delta) {
      for (let i = 0; i < this.bgLayers.length; i += 1) {
        this.bgLayers[i].tilePositionX += (PARALLAX_LAYERS[i].speed * delta) / 1000;
      }
    }

    /** 換一種敵人外形。橢圓版本沒有貼圖可換，就維持原樣。 */
    setEnemyKind(body, kindKey) {
      if (body.setTexture && this.enemyArtOk && this.textures.exists(`enemy-${kindKey}`)) {
        body.setTexture(`enemy-${kindKey}`);
      }
    }

    create() {
      const { width, height } = this.scale;

      /*
       * 三層視差背景。
       *
       * 貼圖是程式畫出來再轉成材質的，不吃任何外部圖檔——這個環境
       * 連不到素材站，而手寫一張 1920 寬的背景 SVG 又不會比較好維護。
       * 形狀用固定種子亂數擺，所以每次跑起來長得一模一樣（視覺回歸才比得了）。
       *
       * 三層速度不同才有深度：遠山幾乎不動，草叢跑得最快。
       * 鏡頭其實是固定的，這個緩慢的飄移是為了讓畫面「活著」，
       * 所以刻意壓得很慢——快了就變成蜂巢在往右跑，那是假的。
       */
      this.bgFar = this.add.rectangle(0, 0, width, height, 0x0c0f1a).setOrigin(0);
      this.buildParallaxTextures();
      this.bgLayers = PARALLAX_LAYERS.map((def) =>
        this.add.tileSprite(0, 0, width, 10, def.key).setOrigin(0, 0)
      );
      this.ground = this.add.rectangle(0, height * 0.7, width, height * 0.3, 0x1b2137).setOrigin(0);
      // 地面要蓋在最遠的兩層上面、但在最近那層下面，層次才對
      this.children.bringToTop(this.bgLayers[2]);

      /*
       * 蜂巢與敵人用 ellipse / rectangle 這種定位語意明確的基本圖形。
       *
       * 試過用 Polygon 畫六角形與甲蟲外形，但 Phaser 的 Polygon 是以外框
       * 左上角定位、setOrigin 對它無效，本體與附掛物總是錯開一段。
       * 真正的 SVG 素材本來就要另外做，沒必要為了中繼版本去猜引擎的行為。
       */
      /*
       * 這顆圓現在只負責「敵人逼近」的警告閃爍。
       * 平常透明——蜂巢素材自己帶了暖色輝光，兩層疊起來會變成一圈灰盤子。
       */
      this.hiveGlow = this.add.circle(0, 0, 62, 0xf5b301, 0);
      this.hive = this.textures.exists('hive')
        ? this.add.image(0, 0, 'hive').setScale(0.5)
        : this.add.ellipse(0, 0, 84, 84, 0xf5b301);
      // 危險線：敵人越過它就代表快到家了
      this.dangerLine = this.add.rectangle(0, 0, 3, 120, 0xff5d5d, 0).setOrigin(0.5);

      /*
       * 排隊中的敵人。
       *
       * 設計書要求畫面上同時看得到 3~5 隻，但**只有最前面那隻是當前目標**——
       * 聽寫一次只能聽一個字。所以這些純粹是畫面：戰鬥邏輯完全沒變，
       * 仍然只有一隻在推進。這件事很重要，因為現在的時間公式與失敗率
       * 是模擬器掃出來的，動到邏輯就得整組重跑。
       *
       * 它們的作用是壓力：看得到後面還有四隻，跟看不到，緊張感差很多。
       *
       * 在 this.enemy 之前建立，這樣排隊的會畫在當前目標後面。
       */
      this.WAITING_SLOTS = 4;
      this.waiting = [];
      for (let i = 0; i < this.WAITING_SLOTS; i += 1) {
        const container = this.add.container(0, 0);
        const body = this.makeEnemyBody(ENEMY_KINDS[0].key);
        // 不上色調，只靠透明度與縮放拉開層次——上了色調剪影就糊掉了
        if (!body.setTint) body.setFillStyle(ENEMY_QUEUE_COLOR).setStrokeStyle(3, ENEMY_QUEUE_STROKE);
        container.add(body);
        // 越後面越小越淡：讀起來像「排在遠處」，不會跟當前目標搶注意力
        container.setScale(0.74 - i * 0.05).setAlpha(0.5 - i * 0.07).setVisible(false);
        this.waiting.push({ container, body, x: 0, kind: '' });
      }
      /* 隊伍往前踏一步的動畫進度：1 = 剛換字，0 = 已經就定位 */
      this.waitShift = 0;

      // 敵人包成 Container：移動容器時裡面的裂痕必然跟著走
      this.enemy = this.add.container(0, 0);
      /*
       * 減速光環。連到 5 的獎勵是「敵人速度 −50%、3 秒」。
       *
       * 橫幅會把這句話寫出來，但接下來三秒畫面上什麼都沒變——唯一的提示是
       * 右上角一個 16px 的小字。他打得順的時候時間本來就很充裕，
       * 速度慢一半根本感覺不出來，於是那三秒等於沒發生。
       *
       * 所以把效果畫在敵人身上：他的眼睛本來就盯著那隻蟲。
       * 畫在本體後面、而且不動 tint——tint 是受擊閃白在用的，兩邊搶會互相蓋掉。
       */
      this.slowAura = this.add.circle(0, 0, 52, SLOW_AURA_COLOR, 0);
      this.enemy.add(this.slowAura);
      this.lastSlowed = false;
      this.enemyBody = this.makeEnemyBody(ENEMY_KINDS[0].key);
      this.enemyKind = '';
      this.enemy.add(this.enemyBody);

      this.effects = createEffects(this, ctx.getSeed());
      this.effects.attachCracksTo(this.enemy);

      // ── HUD ────────────────────────────────────────────────
      this.hpDots = [];
      for (let i = 0; i < BALANCE.maxHp; i += 1) {
        this.hpDots.push(this.add.circle(0, 0, 11, 0xf5b301));
      }

      /*
       * 已經拼對的字母。等寬字型，貼在血條正下方。
       *
       * 等寬是必要的：他是照著這一排數「我打到第幾個」的，比例字型下
       * i 跟 m 寬度差一倍，數起來會錯。
       */
      this.trailText = this.add
        .text(0, 0, TRAIL_CARET, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '24px',
          color: TRAIL_COLOR
        })
        .setOrigin(0, 0.5);
      this.trailBadMs = 0;
      this.lastTrailColor = TRAIL_COLOR;
      this.lastTrailTyped = -1;
      this.lastTrailWord = -1;
      this.lastTrailStatus = '';

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

      /*
       * 漏字時亮出正確拼法。用紅色，跟平常的單字顯示分得開——
       * 他要一眼看出「這是我剛剛沒打完的那個字」，不是新的題目。
       */
      this.missText = this.add
        .text(0, 0, '', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '40px',
          color: '#fca5a5'
        })
        .setOrigin(0.5)
        .setAlpha(0);
      this.missHint = this.add
        .text(0, 0, '', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '18px',
          color: '#f87171'
        })
        .setOrigin(0.5)
        .setAlpha(0);
      this.missRemainMs = 0;

      /* Combo 三階觸發時的橫幅，以及效果還在生效時的常駐標示 */
      this.bonusText = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '30px', color: '#67e8f9' })
        .setOrigin(0.5)
        .setAlpha(0);
      this.bonusRemainMs = 0;
      this.effectLabel = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: '#67e8f9' })
        .setOrigin(1, 0.5);
      this.lastEffectLabel = null;

      /* 重聽的畫面回饋（靜音時這是唯一的回饋） */
      this.listenText = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '18px', color: '#a5b4fc' })
        .setOrigin(0.5)
        .setAlpha(0);
      this.listenRemainMs = 0;

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
      this.ground.setPosition(0, height * 0.7).setSize(width, height * 0.3);
      PARALLAX_LAYERS.forEach((def, i) => {
        const layer = this.bgLayers[i];
        const h = height * def.hFactor;
        layer.setPosition(0, height * def.yFactor - h);
        layer.setSize(width, h);
        // 貼圖是固定高度畫的，用縮放讓它填滿這一層的高度
        layer.setTileScale(1, h / PARALLAX_TEX_H);
      });

      /*
       * 戰場擺在地面帶「裡面」，不是上緣。
       *
       * 原本在 0.68，正好卡在天空與地面的交界：敵人是深色剪影，背後也是
       * 深色天空，等於剪影疊剪影，看不出輪廓。挪到地面帶中間之後，
       * 背後是比較亮的地面，蟲的形狀才讀得出來。
       *
       * 矮螢幕要再往上收：iPad 橫向把螢幕鍵盤叫出來只剩 430px 高，
       * 照比例算會直接撞到下面那條工具列，敵人走到最後幾步會被按鈕蓋住——
       * 而那正是最需要看清楚的時刻。
       */
      /*
       * 下面那條工具列的高度是量出來的，不是猜的。
       *
       * 它現在有兩排（大字的狀態列 + 按鈕列），寫死一個常數的話，
       * 文案一長換行就會多一排，敵人走到最後幾步剛好被蓋住——
       * 而那正是最需要看清楚的時刻。量出來就永遠對得上。
       */
      const chromeH = document.getElementById('game-chrome')?.offsetHeight || 0;
      this.laneY = Math.min(height * 0.8, height - chromeH - LANE_BOTTOM_CLEARANCE);
      this.hiveX = width * LANE_LEFT;
      this.hive.setPosition(this.hiveX, this.laneY);
      this.hiveGlow.setPosition(this.hiveX, this.laneY);
      /*
       * 排隊站位：入侵口再往右，一隻接一隻。
       * 最後一隻會有一部分在畫面外，那是刻意的——讀起來像「後面還有」。
       */
      this.waitGap = Math.min(74, width * 0.052);
      this.waitSlotX = this.waitSlotX || new Array(this.WAITING_SLOTS);
      for (let i = 0; i < this.WAITING_SLOTS; i += 1) {
        this.waitSlotX[i] = width * LANE_RIGHT + this.waitGap * (i + 1);
      }

      this.dangerX = Phaser.Math.Linear(width * LANE_RIGHT, width * LANE_LEFT, DANGER_AT);
      this.dangerLine.setPosition(this.dangerX, this.laneY).setSize(3, height * 0.16);

      const hudY = height * 0.12;
      this.hpDots.forEach((dot, i) => dot.setPosition(width * 0.06 + i * 30, hudY));
      /*
       * 血條正下方，左緣對齊第一顆血點的左緣（圓心往左一個半徑）。
       * 對齊很重要：兩排東西左邊切齊，讀起來才是「同一組狀態」。
       */
      this.trailText.setPosition(width * 0.06 - 11, hudY + 34);

      const barW = Math.min(520, width * 0.4);
      this.energyBg.setPosition(width * 0.5 - barW / 2, hudY).setSize(barW, 16);
      this.energyFill.setPosition(width * 0.5 - barW / 2, hudY).setSize(1, 16);
      this.energyBarWidth = barW;
      this.energyBarX = width * 0.5 - barW / 2;

      this.comboText.setPosition(width * 0.94, hudY);
      this.honeyText.setPosition(width * 0.94, hudY + 30);
      this.effectLabel.setPosition(width * 0.94, hudY + 56);

      /*
       * 字級跟著畫面高度縮放。
       *
       * 位置是高度的比例、字級卻是固定像素的話，畫面一矮就會疊在一起——
       * iPad 橫向把螢幕鍵盤叫出來只剩 430px 高，題目、漏字提示與結束訊息
       * 三段文字剛好撞在一起。上下限是為了避免大螢幕上大得誇張、
       * 小螢幕上小到看不清。
       */
      const ui = Math.max(0.62, Math.min(1.15, height / 720));
      this.bonusText.setFontSize(Math.round(30 * ui));
      this.effectLabel.setFontSize(Math.round(16 * ui));
      this.bonusText.setPosition(width * 0.5, height * 0.2);
      this.wordText.setFontSize(Math.round(44 * ui));
      this.scaffoldNote.setFontSize(Math.round(13 * ui));
      this.missText.setFontSize(Math.round(40 * ui));
      this.missHint.setFontSize(Math.round(18 * ui));
      this.statusText.setFontSize(Math.round(30 * ui));

      this.listenText.setFontSize(Math.round(18 * ui));
      this.trailText.setFontSize(Math.round(24 * ui));
      this.wordText.setPosition(width * 0.5, height * 0.3);
      this.scaffoldNote.setPosition(width * 0.5, height * 0.3 + 40 * ui);
      // 貼在題目上方：看得到，又不跟下面那疊提示文字搶位置
      this.listenText.setPosition(width * 0.5, height * 0.3 - 40 * ui);
      /*
       * 放在題目下面、戰場上面：看得到，又不會擋住正在走過來的敵人。
       * 也要跟 statusText（0.5）錯開——最後一條命是被這個字打掉的時候，
       * 「蜂巢被攻破了」與正確拼法會同時出現。
       */
      this.missText.setPosition(width * 0.5, height * 0.4);
      this.missHint.setPosition(width * 0.5, height * 0.4 + 34 * ui);
      // 0.52 而不是 0.5：螢幕鍵盤彈出後的矮畫面上，跟上面那行要留得開
      this.statusText.setPosition(width * 0.5, height * 0.52);
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
        this.updateMissReveal(delta);
        this.updatePenaltyDash(delta);
        this.updateListenBanner(delta);
        this.updateTrailFlash(delta);
        this.updateWaitingLine(state, delta);
        this.updateBonusBanner(state, delta);
        this.updateParallax(delta);
      }
      this.render(state);
      ctx.syncHud(state);
      /*
       * 把戰況餵給音樂。每格呼叫，但值沒變就不做事——
       * 音樂要「直接反映戰況」，所以連擊與血量一變就要跟著走。
       */
      ctx.bgm?.setState({ combo: state.combo, hp: state.hp, paused: ctx.isPaused() });

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

      /*
       * 畫面端登記。
       *
       * 只有真的畫了東西才登記——這個計數器的唯一用途是回答
       * 「靜音的時候這個回饋還在嗎」，在迴圈開頭無條件登記的話，
       * 每個事件都會顯示「有畫面」，檢查就永遠通過，等於沒有檢查。
       * （重聽原本就是這樣混過去的：只有聲音，畫面完全不動。）
       */
      const vfx = (ev) => ctx.debug._recordChannel(EV_NAME[ev.type] || `EV_${ev.type}`, 'vfx');

      for (let i = 0; i < state.evCount; i += 1) {
        const ev = state.ev[i];
        ctx.debug._recordBattleEvent(ev);
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
            /*
             * 加了幾分要看得見。
             *
             * 蜂蜜一直都有在算，但畫面從來沒講——右上角的數字默默跳動，
             * 他不會把「我剛剛打對了這個字母」跟那個數字連在一起。
             * 狂蜂狀態時是 +2，所以金額直接從事件帶出來（見 battle.js 的 emit）。
             */
            this.effects.floatText(`+${ev.c}`, ex, ey - 34, {
              // 有加倍就換色放大，一眼看得出「現在賺比較多」
              color: ev.c > BALANCE.honey.perCorrectLetter ? '#fde047' : '#f5b301',
              scale: ev.c > BALANCE.honey.perCorrectLetter ? 1.35 : 1
            });
            vfx(ev);
            break;
          }
          case EV.LETTER_BAD:
            this.cameras.main.flash(90, 255, 60, 60, false);
            this.cameras.main.shake(60, 0.003);
            // 打錯的代價也要看得見：紅字寫出前進了幾秒，而且蟲真的往前衝
            this.effects.floatText(
              `-${BALANCE.wrongLetterPenaltyMs / 1000} 秒`,
              this.enemy.x,
              this.enemy.y - 46,
              { color: '#f87171', scale: 1.15, fan: false }
            );
            this.startPenaltyDash(state, BALANCE.wrongLetterPenaltyMs);
            /*
             * 那一排拼對的字母閃紅。
             *
             * 打錯不會清掉已經打對的部分，所以那一排「不動」才是對的——
             * 但不動也代表他看不出按鍵到底有沒有讀到。閃一下就把兩件事
             * 同時講完了：這一下沒算進去，而你還站在原地，從底線繼續打。
             */
            this.trailBadMs = TRAIL_BAD_MS;
            vfx(ev);
            break;
          case EV.WORD_KILLED: {
            /*
             * 擊殺獎勵拆成兩行飄。
             *
             * 「+15」他看不出那 15 是怎麼來的；「+5」加上「+10 長字！」
             * 他就知道長字有額外獎勵——而那正是我們希望他去挑長字的原因。
             */
            const isLong = ev.b >= BALANCE.honey.longWordFrom;
            /*
             * ev.c 是「擊殺 + 長字」的總額，而且已經乘過狂蜂倍率。
             * 把倍率反推回來才能把兩筆拆開顯示——比在這裡重算一次倍率可靠：
             * 倍率只有 battle.js 知道，重算遲早會跟它走散。
             */
            const unit = BALANCE.honey.perKill + (isLong ? BALANCE.honey.longWordBonus : 0);
            const factor = unit > 0 ? ev.c / unit : 1;
            const base = BALANCE.honey.perKill * factor;
            this.effects.floatText(`+${Math.round(base)}`, this.enemy.x, this.enemy.y - 56, {
              color: '#fde047',
              scale: 1.4,
              fan: false
            });
            if (isLong) {
              this.effects.floatText(
                `+${Math.round(ev.c - base)} 長字！`,
                this.enemy.x,
                this.enemy.y - 100,
                { color: '#fb923c', scale: 1.2, fan: false }
              );
            }
            this.effects.burst(this.enemy.x, this.enemy.y, 18);
            this.effects.setCrackProgress(0);
            this.cameras.main.shake(70, 0.004);
            // 頓挫：凍結世界，同時讓輸入排隊而不是打在看不見的畫面上
            this.hitStopUntil = performance.now() + HIT_STOP_MS;
            ctx.blockInput(HIT_STOP_MS);
            this.enemyHitT = -1;
            this.enemyBody.setScale(this.enemyBody.setTexture ? 0.5 : 1);
            if (this.enemyBody.clearTint) this.enemyBody.clearTint();
            vfx(ev);
            break;
          }
          case EV.WORD_MISSED: {
            this.cameras.main.shake(180, 0.01);
            this.effects.setCrackProgress(0);
            /*
             * 沒打完就是不知道怎麼拼——這時候一定要讓他看見那個字。
             * 不然他只會被扣一滴血，然後在同一個字上再失敗一次
             * （漏掉的字會排回隊伍尾端，本場之內還會再遇到）。
             */
            const missed = state.words[ev.a];
            if (missed) {
              this.missText.setText(missed.english || '');
              this.missHint.setText(
                missed.chinese ? `正確拼法・${missed.chinese}` : '正確拼法'
              );
              this.missRemainMs = MISS_REVEAL_MS;
            }
            vfx(ev);
            break;
          }
          case EV.LISTEN:
            // 玩家已經付出敵人前進的代價，這裡把單字再唸一次給他
            ctx.speakCurrentWord(
              ev.a === LISTEN_KIND.SLOW ? 'slow' : ev.a === LISTEN_KIND.SENTENCE ? 'sentence' : 'normal'
            );
            // 靜音時這是唯一的回饋：按了要看得出來有按到
            this.listenText.setText(LISTEN_LABELS[ev.a] || '🔊');
            this.listenRemainMs = LISTEN_BANNER_MS;
            /*
             * 重聽的代價要看得見。
             *
             * 這是設計書 §9 特別點名的一條：他按了重聽、蟲突然前進一段，
             * 但因為是瞬移，他不知道那是自己造成的還是遊戲怪怪的。
             * 紅字寫出前進幾秒 + 蟲真的滑過去，因果才連得起來。
             */
            {
              const cost = BALANCE.listenCostMs[LISTEN_COST_KEY[ev.a]] || 0;
              if (cost > 0) {
                this.effects.floatText(
                  `-${cost / 1000} 秒`,
                  this.enemy.x,
                  this.enemy.y - 46,
                  { color: '#f87171', scale: 1.25, fan: false }
                );
                this.startPenaltyDash(state, cost);
              }
            }
            vfx(ev);
            break;
          case EV.COMBO_BONUS: {
            const label = BONUS_LABELS[ev.a];
            if (label) {
              this.bonusText.setText(label.text).setColor(label.color);
              this.bonusRemainMs = BONUS_BANNER_MS;
              this.cameras.main.flash(120, 120, 220, 255, false);
              // 連擊數也飄一個出來：他才知道剛剛那一串是怎麼換到這個效果的
              this.effects.floatText(`${ev.b} 連擊！`, this.enemy.x, this.enemy.y - 140, {
                color: label.color,
                scale: 1.5,
                // 大事要出現在指定的位置，散開會撞到旁邊那一串小加分
                fan: false
              });
              vfx(ev);
            }
            break;
          }
          /*
           * 下面這三個的畫面在 render() 裡跟著狀態走（連擊數字、血量圓點、
           * 結束訊息），不需要在這裡另外演出；登記一筆是因為對帳表只認事件，
           * 不登記會被誤判成「只有聲音沒有畫面」。
           */
          case EV.COMBO_UP:
          case EV.HP_LOST:
            vfx(ev);
            break;
          case EV.BATTLE_END:
            // 音樂跟著戰鬥起停：一場結束就收掉，結算畫面要安靜
            ctx.bgm?.stop();
            // 分數記在目前這個帳號底下（a=1 是打完整組，0 是蜂巢被攻破）
            ctx.onBattleEnd?.(state, ev.a === 1);
            vfx(ev);
            break;
          case EV.WORD_START: {
            this.effects.setCrackProgress(0);
            // 換字了，上一隻還沒補完的衝刺要丟掉——不然新的蟲會從跑道外面滑進來
            this.penaltyLag = 0;
            // 前面那隻進場了，整排往前踏一步（下面用動畫補回來）
            this.waitShift = 1;
            // 換上這個字對應的敵人：字越長、蟲越大（見 core/enemy-kind.js）
            const kind = enemyKindFor(state.target).key;
            if (kind !== this.enemyKind) {
              this.enemyKind = kind;
              this.setEnemyKind(this.enemyBody, kind);
            }
            ctx.speakCurrentWord();
            vfx(ev);
            break;
          }
          default:
            break;
        }
      }
      clearEvents(state);
      ctx.soundBridge?.reset();
    }

    /**
     * 正確拼法的提示：撐兩秒再淡出。
     *
     * 用累加 delta 而不是 performance.now()，暫停時提示才不會自己走完——
     * 他按 Esc 去問「這個字怎麼唸」，回來提示還在。
     */
    updateMissReveal(delta) {
      if (this.missRemainMs <= 0) return;
      this.missRemainMs -= delta;
      if (this.missRemainMs <= 0) {
        this.missRemainMs = 0;
        this.missText.setAlpha(0);
        this.missHint.setAlpha(0);
        return;
      }
      const alpha = Math.min(1, this.missRemainMs / MISS_FADE_MS);
      this.missText.setAlpha(alpha);
      this.missHint.setAlpha(alpha);
    }

    /**
     * 懲罰的衝刺演出。
     *
     * 邏輯上 state.progress 已經加上去了（那一步不能延遲，否則重播與確定性
     * 都會壞掉）。這裡只是讓畫面上的蟲**先留在原地**，再用 PENALTY_DASH_MS
     * 滑到新位置——他會看著蟲往前衝那一段，代價才變成一個體驗而不是一個數字。
     *
     * @param ms 這次懲罰讓蟲前進多少毫秒的距離
     */
    startPenaltyDash(state, ms) {
      if (!state || !state.crossMs) return;
      // 累加而不是覆寫：連續打錯兩次時兩段距離要一起補，不是只補最後一次
      this.penaltyLag = Math.min(1, this.penaltyLag + ms / state.crossMs);
      this.penaltyLagFrom = this.penaltyLag;
      this.penaltyT = 0;
    }

    /**
     * 衝刺推進。
     *
     * 用「已經過了多少毫秒」算，不是每格扣掉一個比例。
     * 指數衰減看起來很順，但它永遠到不了零，而且**推進速度取決於影格數**——
     * 掉格的機器上蟲會滑得比較久，無頭瀏覽器上甚至滑不完。
     * 綁在時間上才保證每一台機器都剛好在 PENALTY_DASH_MS 追上。
     */
    updatePenaltyDash(delta) {
      if (this.penaltyLag <= 0) return;
      this.penaltyT += delta;
      const k = Math.min(1, this.penaltyT / PENALTY_DASH_MS);
      if (k >= 1) {
        this.penaltyLag = 0;
        return;
      }
      // easeOutCubic：一開始衝得快、收尾慢下來，像被撞了一下往前滑
      const eased = 1 - (1 - k) ** 3;
      this.penaltyLag = this.penaltyLagFrom * (1 - eased);
    }

    /** 重聽提示：亮一下就淡掉，不擋住題目。 */
    updateListenBanner(delta) {
      if (this.listenRemainMs <= 0) return;
      this.listenRemainMs -= delta;
      if (this.listenRemainMs <= 0) {
        this.listenRemainMs = 0;
        this.listenText.setAlpha(0);
        return;
      }
      this.listenText.setAlpha(Math.min(1, this.listenRemainMs / (LISTEN_BANNER_MS * 0.5)));
    }

    /**
     * 拼對的字母那一排打錯時閃紅，然後回到原本的顏色。
     *
     * 用時間算而不是影格數算：同一段紅色在 30fps 的舊平板與 120Hz 的螢幕上
     * 要一樣長，不然慢機器會紅到下一次按鍵都還沒退。
     */
    updateTrailFlash(delta) {
      if (this.trailBadMs <= 0) return;
      this.trailBadMs -= delta;
      const bad = this.trailBadMs > 0;
      if (!bad) this.trailBadMs = 0;
      const color = bad ? TRAIL_BAD_COLOR : TRAIL_COLOR;
      if (color !== this.lastTrailColor) {
        this.lastTrailColor = color;
        this.trailText.setColor(color);
      }
    }

    /**
     * 排隊中的敵人。
     *
     * 純畫面：邏輯上永遠只有一隻在推進（見 create 裡的說明）。
     * 這裡只做兩件事——顯示還剩幾隻，以及換字時讓整排往前踏一步。
     */
    updateWaitingLine(state, delta) {
      // 還沒登場的數量。當前這隻已經被 startNextWord 取走了，所以不算在內
      const pending = state.status === 'running' ? state.queue.length - state.queueHead : 0;

      if (this.waitShift > 0) {
        // 往 0 收斂就是「踏回定位」。用 delta 而不是固定值，掉格時才不會瞬移
        this.waitShift -= this.waitShift * Math.min(1, delta / 140);
        if (this.waitShift < 0.01) this.waitShift = 0;
      }

      for (let i = 0; i < this.WAITING_SLOTS; i += 1) {
        const slot = this.waiting[i];
        const show = i < pending;
        if (slot.container.visible !== show) slot.container.setVisible(show);
        if (!show) continue;

        /*
         * 排隊的也要換成該單字對應的外形。
         * 不換的話後面排的全是同一隻，看不出「等一下有一隻大的要來」——
         * 而那正是排隊要製造的壓力。
         */
        const word = state.words[state.queue[state.queueHead + i]];
        const kind = word ? enemyKindFor(word.english).key : '';
        if (kind && kind !== slot.kind) {
          slot.kind = kind;
          this.setEnemyKind(slot.body, kind);
        }

        slot.container.setPosition(this.waitSlotX[i] + this.waitShift * this.waitGap, this.laneY);
      }
    }

    /**
     * Combo 橫幅與「效果還在生效中」的常駐標示。
     *
     * 常駐標示不是裝飾：敵人突然變慢的時候，他要知道那是自己換來的，
     * 而不是遊戲怪怪的。
     */
    updateBonusBanner(state, delta) {
      if (this.bonusRemainMs > 0) {
        this.bonusRemainMs -= delta;
        if (this.bonusRemainMs <= 0) {
          this.bonusRemainMs = 0;
          this.bonusText.setAlpha(0);
        } else {
          this.bonusText.setAlpha(Math.min(1, this.bonusRemainMs / BONUS_FADE_MS));
        }
      }

      /*
       * 減速中：敵人身上罩一層冰藍光環，還會呼吸。
       * 用遊戲時間當相位，暫停時會跟著停（跟危險線同一個做法）。
       */
      const slowed = state.dashMs > 0;
      if (slowed) {
        this.slowAura.setFillStyle(SLOW_AURA_COLOR, 0.22 + 0.16 * Math.sin(state.timeMs * 0.013));
      } else if (this.lastSlowed) {
        this.slowAura.setFillStyle(SLOW_AURA_COLOR, 0);
      }
      this.lastSlowed = slowed;

      // 只有在狀態真的改變時才動 DOM／文字，避免每格配置字串
      let label = '';
      // 「衝刺中」會被讀成「我在衝刺」，但變慢的是敵人——直接寫誰慢了
      if (state.dashMs > 0) label = '🐌 敵人慢一半';
      else if (state.frenzyMs > 0) label = '🔥 狂蜂中';
      else if (state.sweetActive) label = '🍯 蜜糖時間';
      else if (state.sweetNext) label = '🍯 下個字加倍';
      if (label !== this.lastEffectLabel) {
        this.lastEffectLabel = label;
        this.effectLabel.setText(label);
      }
    }

    /** 換一場時把提示收掉，否則上一場的字會留在新的一場上。 */
    clearMiss() {
      this.missRemainMs = 0;
      this.missText.setAlpha(0);
      this.missHint.setAlpha(0);
      this.bonusRemainMs = 0;
      this.bonusText.setAlpha(0);
      this.listenRemainMs = 0;
      this.listenText.setAlpha(0);
      this.penaltyLag = 0;
      this.lastEffectLabel = null;
      this.effectLabel.setText('');
      // 上一場的減速光環不可以留到新的一場
      this.lastSlowed = false;
      this.slowAura.setFillStyle(SLOW_AURA_COLOR, 0);
      // 拼字那一排也要歸零，否則新的一場開場會掛著上一場最後那幾個字母
      this.trailBadMs = 0;
      this.lastTrailTyped = -1;
      this.lastTrailWord = -1;
      this.lastTrailStatus = '';
    }

    /** 敵人被擊中時的擠壓與閃白，自己算不用 tween。 */
    updateEnemyHit(delta) {
      if (this.enemyHitT >= 0) {
        this.enemyHitT += delta;
        const k = this.enemyHitT / ENEMY_HIT_MS;
        const isImage = !!this.enemyBody.setTexture;
        // 貼圖版本的基準縮放是 0.5（SVG 以兩倍尺寸點陣化，見 preload）
        const base = isImage ? 0.5 : 1;
        if (k >= 1) {
          this.enemyHitT = -1;
          this.enemyBody.setScale(base, base);
          if (isImage) this.enemyBody.clearTint();
          else this.enemyBody.setFillStyle(ENEMY_BASE_COLOR);
        } else {
          // 先被擠扁再彈回來
          this.enemyBody.setScale(base * lerp(1.22, 1, k), base * lerp(0.78, 1, k));
          const flash = lerpColor(ENEMY_FLASH_COLOR, ENEMY_BASE_COLOR, k);
          if (isImage) fillTint(this.enemyBody, flash);
          else this.enemyBody.setFillStyle(flash);
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
      /*
       * 畫面位置 = 邏輯位置 − 還沒補完的懲罰距離。
       *
       * 平常 penaltyLag 是 0，兩者完全相同。剛被懲罰的那 0.3 秒內蟲會從
       * 舊位置滑到新位置——看得到的衝刺，而不是一次瞬移。
       * 邏輯位置本身一點都沒被動到（見 startPenaltyDash）。
       */
      const shown = Math.max(0, Math.min(1, state.progress - this.penaltyLag));
      const x = Phaser.Math.Linear(width * LANE_RIGHT, width * LANE_LEFT, shown);
      this.enemy.setPosition(x, this.laneY);

      /*
       * 由遠而近的透視放大。
       *
       * 位置變化在寬螢幕上其實不太明顯——930px 的跑道，逼近一秒也只移動幾十像素。
       * 體積變大是更直覺的「它要到了」，而且縮放放在容器上，
       * 不會跟本體的受擊擠壓打架（兩者相乘剛好）。
       */
      this.enemy.setScale(
        // 縮放也跟著畫面位置，不然衝刺時蟲會先變大再滑過去，看起來很怪
        Phaser.Math.Linear(ENEMY_SCALE_FAR, ENEMY_SCALE_NEAR, shown)
      );

      /*
       * 越過危險線之後，畫面本身開始警告。
       * 小孩的眼睛都在鍵盤上，只靠位置移動很容易到最後一刻才發現。
       */
      if (shown >= DANGER_AT) {
        const k = (shown - DANGER_AT) / (1 - DANGER_AT);
        // 越近閃得越快：用遊戲時間當相位，暫停時也會跟著停
        const pulse = 0.35 + 0.35 * Math.sin(state.timeMs * (0.008 + k * 0.02));
        this.dangerLine.setFillStyle(0xff5d5d, 0.25 + k * 0.45);
        this.hiveGlow.setFillStyle(0xff5d5d, 0.1 + pulse * k * 0.35);
      } else if (this.lastDanger !== false) {
        this.dangerLine.setFillStyle(0xff5d5d, 0);
        this.hiveGlow.setFillStyle(0xf5b301, 0);
      }
      this.lastDanger = shown >= DANGER_AT;

      this.hpDots.forEach((dot, i) => dot.setFillStyle(i < state.hp ? 0xf5b301 : 0x334155));

      const ratio = state.target.length ? state.typed / state.target.length : 0;
      this.energyFill.setSize(Math.max(1, this.energyBarWidth * ratio), 16);

      /*
       * 已經拼對的字母。
       *
       * 跟上面那幾個一樣，只有值真的變了才 setText——每影格組一次字串
       * 等於每秒配置一兩百個物件，GC 遲早會在某個隨機時間點介入掉格。
       * 比的是三個數字而不是組出來的鍵：組鍵本身就是在配置字串，
       * 那等於為了省配置而每影格配置一次。
       */
      if (
        state.typed !== this.lastTrailTyped ||
        state.wordIndex !== this.lastTrailWord ||
        state.status !== this.lastTrailStatus
      ) {
        this.lastTrailTyped = state.typed;
        this.lastTrailWord = state.wordIndex;
        this.lastTrailStatus = state.status;
        this.trailText.setText(
          state.status === 'running'
            ? state.target.slice(0, state.typed).toUpperCase() + TRAIL_CARET
            : ''
        );
      }

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
