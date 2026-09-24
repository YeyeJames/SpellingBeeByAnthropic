/**
 * 特殊敵人（C6）。
 *
 * 設計出處：docs/campaign-design.md §5。這是第 2 章之後「難度真的變難」的
 * 唯一來源——前面幾段（等級、裝備）都是在讓玩家變強，而模擬器量出來的結論
 * 很清楚：到 20 級時光靠等級就已經把失敗率壓到 3%，三段式的時間難度標籤
 * 也已經沒有空間（normal → hard 是懸崖不是階梯）。難度必須從敵人身上來。
 *
 * ── 跟外形是兩件事 ────────────────────────────────────────
 * enemy-kind.js 的甲蟲／黃蜂／蜘蛛看的是**字母數**，那是「這個字有多長」
 * 的資訊。這裡的特性是「這隻有什麼特殊規則」，兩者互相垂直：
 * 一隻有護甲的蜘蛛是完全合理的。
 *
 * ── ⚠️ §1 的鐵律 ─────────────────────────────────────────
 * **沒有任何一種特性會改變要打的字母數。** 敵人的血量永遠等於單字的字母數。
 * 三種特性動到的分別是「擊退何時生效」「牠自己會不會前進」「能不能重聽」，
 * 沒有一個會讓他少打或多打一個字母。
 *
 * ── 指派必須是確定性的 ────────────────────────────────────
 * 用單字在佇列裡的位置 + 種子算出來，不看真實時間也不另外抽亂數。
 * 同一場重播必然配到同一批敵人，否則「剛剛怪怪的」那顆按鈕就失效了。
 */

export const TRAITS = {
  NONE: 'none',
  ARMORED: 'armored',
  DASHER: 'dasher',
  SILENT: 'silent'
};

/* 護甲要打掉幾個字母才碎。兩個：夠痛，但短字也還有機會。 */
export const ARMOR_LETTERS = 2;

/* 衝刺蟲多久衝一次、一次衝多遠（相當於前進幾毫秒的距離）。 */
export const DASH_EVERY_MS = 2000;
export const DASH_PUSH_MS = 450;

/*
 * 每一種的規則、名字、以及第一次遇到時要說的那一句話。
 *
 * 那句話是 §5 特別要求的：「每一種新敵人第一次出現時，遊戲要停半秒、
 * 放大牠、標出牠的名字與一句話規則」。成本很低，效果很大——
 * 他不需要讀說明書就會知道這隻不一樣。
 *
 * 規則那一句是從上面的常數算出來的，不是寫死的字串——理由跟 rules.js
 * 開頭寫的一樣：數字一改而文案沒改，說明就變成謊言，而且不會有任何錯誤，
 * 他只會照著一段過時的說明玩，然後覺得遊戲怪怪的。
 * （常數所以要宣告在前面：TRAIT_INFO 是在這裡當場讀它們的值。）
 */
export const TRAIT_INFO = {
  [TRAITS.ARMORED]: {
    key: TRAITS.ARMORED,
    icon: '🛡️',
    label: '護甲蟲',
    rule: `前 ${ARMOR_LETTERS} 個字母打不動牠——外殼碎了才會後退`,
    color: '#94a3b8'
  },
  [TRAITS.DASHER]: {
    key: TRAITS.DASHER,
    icon: '💨',
    label: '衝刺蟲',
    rule: `牠每隔 ${Number((DASH_EVERY_MS / 1000).toFixed(2))} 秒會自己往前衝一小段`,
    color: '#f472b6'
  },
  [TRAITS.SILENT]: {
    key: TRAITS.SILENT,
    icon: '🔇',
    label: '靜音蟲',
    rule: '這個字只唸一次，重聽鍵對牠沒有用',
    color: '#a78bfa'
  }
};

/*
 * 一場裡有多少比例的敵人帶特性。
 *
 * 不是每一隻都帶：全部都帶的話那就不叫「特殊」了，而且他會沒有喘息的
 * 節奏。三分之一左右，剛好是「常常遇到但不會連續」。
 */
const TRAIT_RATE = 3;

/**
 * 這一隻是什麼特性。
 *
 * @param {string[]} pool   這一關允許出現哪些特性（空陣列 = 全部都是普通的）
 * @param {number} queuePos 這個字是這一場的第幾個（從 0 開始）
 * @param {number} seed     這一場的種子
 */
export function traitFor(pool, queuePos, seed) {
  if (!pool || pool.length === 0) return TRAITS.NONE;
  /*
   * 用位置與種子混出一個數字，不抽亂數也不看時間。
   * 不直接用 queuePos % 3 是因為那樣會變成固定的節奏（第 3、6、9 隻），
   * 他很快就會背起來——而背起來之後就不再是壓力了。
   */
  const h = mix(queuePos + 1, seed >>> 0);
  if (h % TRAIT_RATE !== 0) return TRAITS.NONE;
  return pool[Math.floor(h / TRAIT_RATE) % pool.length];
}

/** 小小的整數雜湊（FNV 風格）。純函式，同樣的輸入永遠同樣的輸出。 */
function mix(a, b) {
  let h = (2166136261 ^ a) >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  h = (h ^ b) >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  return h >>> 0;
}

/**
 * 這一關可以出現哪些特性。
 *
 * §3 說第 2 章開始敵人多一層護甲；後面的章節再逐步加上去。
 * 第 1 章完全不加——那一章的工作是把整本課本走一遍，
 * 這時候加規則只會讓他分心。
 */
export function traitPoolForChapter(chapter) {
  const n = Number(chapter) || 1;
  if (n <= 1) return [];
  if (n === 2) return [TRAITS.ARMORED];
  if (n === 3) return [TRAITS.ARMORED, TRAITS.DASHER];
  return [TRAITS.ARMORED, TRAITS.DASHER, TRAITS.SILENT];
}
