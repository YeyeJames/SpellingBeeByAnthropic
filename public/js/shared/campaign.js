/**
 * 100 關的關卡表（C3）。規則只有一份，瀏覽器與伺服器共用。
 *
 * 設計出處：docs/campaign-design.md §3。
 *
 * ── 關卡表是算出來的，不是抄出來的 ────────────────────────
 * 24 個週組的順序就是單字庫的順序，所以這裡不另外抄一份清單——
 * 抄了之後單字庫一改（例如某一週被切成兩組），兩邊就會悄悄走散，
 * 而症狀是「第 12 關打到的字跟表上寫的不一樣」，沒有人會發現。
 *
 * 這個檔案只做一件事：把「組別清單」換算成「關卡清單」。純函式，好測。
 *
 * ── ⚠️ 難度用的是玩家自己校準出來的那一個，不是關卡指定的 ──
 * §3 原本寫第 1/2/3 章分別是 輕鬆/標準/挑戰。實作時用模擬器量過，
 * 那樣會讓大部分的孩子在第 3 章完全打不過去（Week 1 完整 40 字）：
 *
 *   手速      裝備        easy   normal    hard
 *   slow      全裸       29.2%   100.0%   100.0%
 *   medium    全裸        0.0%    35.8%   100.0%
 *   medium    tier3       0.0%     0.0%   100.0%
 *   fast      全裸        0.0%     0.0%    54.2%
 *   fast      tier3       0.0%     0.0%     0.0%
 *
 * 兩件事很清楚：
 *   1. normal → hard 是懸崖不是階梯。每一種手速都是「這一格還行，
 *      下一格 100%」。calibrate.js 的註解早就寫過同一句話：
 *      「難度選錯不是比較難，是完全不能玩」。
 *   2. 有裝備之後每一格都會被壓到 0%。三段式的難度標籤已經沒有空間了。
 *
 * 所以關卡**不指定時間難度**，時間難度一律用他校準出來的那一個。
 * 章節的提升改成走「內容」這條路，而這也正是 §3 自己對第 3 章的描述
 * （「出題打亂並跨組」）：
 *
 *   第 1 章  單組、照課本順序          ——把整本課本走一遍
 *   第 2 章  單組、打亂                ——不能再靠位置記
 *   第 3 章  跨組混合、打亂            ——不知道下一個字來自哪一週
 *   第 4 章  個人弱點（C4 接上）        ——只打他不會的字
 *
 * **真正的機械難度提升在 C6（護甲蟲、衝刺蟲、靜音蟲）**，§3 自己也是這樣寫的
 * （第 2 章的差異來源寫的是「敵人多一層護甲，見 §5」）。C3 是骨架，
 * C9 會帶著裝備與等級重跑平衡。
 */

import { traitPoolForChapter } from '../game/core/enemy-trait.js';

/* 章節設定。每一章 24 關，後面接一關中王。 */
export const CHAPTERS = [
  {
    n: 1,
    title: '第一章・課本巡禮',
    blurb: '把整本課本的單字走過一遍，照課本的順序。',
    order: 'sequential',
    mix: 1
  },
  {
    n: 2,
    title: '第二章・打亂順序',
    blurb: '同樣的單字，但這次順序是亂的——不能再靠「第幾個」記了。',
    order: 'random',
    mix: 1
  },
  {
    n: 3,
    title: '第三章・跨週混合',
    blurb: '每一關的字來自好幾週，而且順序是亂的。下一個字會是什麼，只有聽了才知道。',
    order: 'random',
    mix: 3
  },
  {
    n: 4,
    title: '第四章・你的弱點',
    blurb: '題目由你自己答錯過的字決定，每個人都不一樣。',
    order: 'random',
    mix: 1,
    // C4 才會真的接上 WordProgress；在那之前退回該章對應的組別
    weakness: true
  }
];

export const LEVELS_PER_CHAPTER = 24;
export const TOTAL_LEVELS = 100;

/* 中王與大魔王的關號。C7 才會給它們真正的特殊規則，C3 先讓它們是「混合關」。 */
export const MIDBOSS_LEVELS = [25, 50, 75];
export const FINAL_BOSS_LEVEL = 100;

/**
 * 第 n 章第 i 關用哪幾組。
 *
 * mix = 1 就是一組一關；mix = 3 是把三組混在一起，
 * 但仍然保證 24 關剛好把 24 組各用到一次（起點錯開，不是隨機抓）——
 * 隨機抓會讓某幾組永遠沒出現，而「整本課本都要走到」是這個遊戲的底線。
 */
function groupsForLevel(weekGroups, chapter, indexInChapter) {
  const n = weekGroups.length;
  // 回傳的是 id 字串，不是整個 group 物件——整份表只存 id，其他欄位要用時再查
  if (chapter.mix <= 1) return [weekGroups[indexInChapter % n].id];
  const out = [];
  for (let k = 0; k < chapter.mix; k += 1) {
    out.push(weekGroups[(indexInChapter + k * Math.floor(n / chapter.mix)) % n].id);
  }
  // 去重（組數不是 mix 的整數倍時可能撞到同一組）
  return [...new Set(out)];
}

/**
 * 建出整張關卡表。
 *
 * @param {Array} groups listGroups() 的結果（要有 id / label / kind / count）
 * @returns {Array} 每一關 { level, chapter, kind, title, subtitle, groupIds, order, wordLimit }
 */
export function buildCampaign(groups = []) {
  const weekGroups = groups.filter((g) => g.kind === 'week');
  const contestGroups = groups.filter((g) => g.kind === 'contest');
  /*
   * 還沒有單字的課本（剛開好、還在等抄進來）要回一張空表，不是爆掉。
   *
   * 兩個孩子各有各的課本，第二本一定會有一段「帳號建好了但單字還沒進去」
   * 的時間。那時候看到「還沒有單字」是可以理解的，看到 500 就只會以為壞了。
   */
  if (weekGroups.length === 0) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const levels = [];

  const labelOf = (ids) => ids.map((id) => byId.get(id)?.label || id).join(' + ');
  const countOf = (ids) => ids.reduce((a, id) => a + (byId.get(id)?.count || 0), 0);

  let level = 0;
  for (const chapter of CHAPTERS) {
    for (let i = 0; i < LEVELS_PER_CHAPTER; i += 1) {
      level += 1;
      const groupIds = groupsForLevel(weekGroups, chapter, i);
      levels.push({
        level,
        chapter: chapter.n,
        kind: 'normal',
        title: `第 ${level} 關`,
        subtitle: chapter.weakness ? '你的弱點單字' : labelOf(groupIds),
        groupIds,
        order: chapter.order,
        weakness: !!chapter.weakness,
        /*
         * 混合關會把好幾組加起來（可能上百個字），一場打不完。
         * 上限抓 30：跟單一組的規模相當，一場大約五到十分鐘。
         */
        wordLimit: groupIds.length > 1 ? 30 : null,
        wordCount: groupIds.length > 1 ? Math.min(30, countOf(groupIds)) : countOf(groupIds),
        /*
         * 這一關會出現哪些特殊敵人（C6）。
         * 第 1 章完全不加——那一章的工作是把整本課本走一遍，
         * 這時候加規則只會讓他分心。
         */
        enemyTraits: traitPoolForChapter(chapter.n)
      });
    }

    /* 每一章後面接一關中王。第 4 章後面接的是大魔王，另外處理。 */
    if (chapter.n < CHAPTERS.length) {
      level += 1;
      const bossGroups =
        chapter.n === 1
          ? weekGroups.slice(0, Math.ceil(weekGroups.length / 2)).map((g) => g.id)
          : chapter.n === 2
            ? contestGroups.slice(0, 2).map((g) => g.id)
            : contestGroups.slice(2).map((g) => g.id);
      levels.push({
        level,
        chapter: chapter.n,
        kind: 'midboss',
        title: `第 ${level} 關・中王`,
        subtitle:
          chapter.n === 1 ? '前半本課本混合' : chapter.n === 2 ? 'Part 1 + Part 2' : 'Part 3 + Part 4',
        groupIds: bossGroups,
        order: 'random',
        weakness: false,
        wordLimit: 20,
        wordCount: Math.min(20, countOf(bossGroups)),
        // 中王用該章的特性池——王關不該比它守的那一章簡單
        enemyTraits: traitPoolForChapter(chapter.n)
      });
    }
  }

  /* 大魔王：競賽單字全部 100 字。整個戰役從第 1 關就是在為這一關練功。 */
  levels.push({
    level: TOTAL_LEVELS,
    chapter: 4,
    kind: 'finalboss',
    title: '第 100 關・大魔王',
    subtitle: '競賽單字全部 100 字',
    groupIds: contestGroups.map((g) => g.id),
    order: 'random',
    weakness: false,
    wordLimit: null,
    wordCount: countOf(contestGroups.map((g) => g.id)),
    // 大魔王：三種特殊敵人全上
    enemyTraits: traitPoolForChapter(4)
  });

  return levels;
}

/** 某一關的資料。找不到回 null。 */
export function levelAt(campaign, level) {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 1) return null;
  return campaign.find((l) => l.level === n) || null;
}

/**
 * 解不解得開。
 *
 * §6 明訂：**等級不是關卡的門票。** 硬鎖等級會逼出刷等級的行為，
 * 而刷等級在這個遊戲裡就是刷已經會的字（§0）。
 * 所以條件只有一個：前一關過了。
 */
export function isUnlocked(level, highestCleared) {
  return Number(level) <= Number(highestCleared || 0) + 1;
}

/** 進度摘要，給地圖頁的頂端用。 */
export function campaignSummary(campaign, highestCleared = 0) {
  const total = campaign.length;
  const cleared = Math.min(Number(highestCleared) || 0, total);
  const next = campaign.find((l) => l.level === cleared + 1) || null;
  return {
    cleared,
    total,
    /*
     * 關卡表是空的時候（課本還沒有每週單字）要回 0，不是 NaN。
     * 0/0 算出來是 NaN，接到畫面上就變成 width: NaN%——進度條會壞掉，
     * 而且完全看不出為什麼。
     */
    percent: total > 0 ? Math.round((cleared / total) * 100) : 0,
    next
  };
}
