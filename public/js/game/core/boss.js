/**
 * 王關（C7）：三個中王（第 25 / 50 / 75 關）與大魔王（第 100 關）。
 *
 * 設計出處：docs/campaign-design.md §3、§5、附錄 I。C7 是 C1～C9 裡唯一一直沒做的階段——
 * 在這之前，王關只是「字比較多、蟲比較快」的普通關卡，打起來跟前一關沒有兩樣。
 *
 * ── 王是什麼 ─────────────────────────────────────────────
 * 畫面右邊站著一隻大的王，頭上有一條血。**王的血就是這一關的字數**：
 * 每打掉一個字，蜂針就射到王身上、王的血掉一格。所以打倒王＝把這一關的字全部打完，
 * 一個字都沒有少（§1 的鐵律：要打的字母數永遠不變），只是終於有一個「打倒」的對象。
 *
 * ── 階段 ─────────────────────────────────────────────────
 * 王的血掉到三分之一、三分之二（大魔王是四分之一一段）就換一個階段：
 *   - 停一下、王怒吼（畫面）——給他喘口氣，也讓「我把王打痛了」被看見
 *   - 派出新的小兵（特殊敵人一階一階加上去），最後一階暴怒、蟲變快
 * 本來換階段也會 +1 血。模擬器量出來那會讓中王從 31% 掉到 19%、大魔王變成 0%
 * （第一次就輸的比例），王反而比前一關還好打——拿掉了。翻盤的機會留給金色親衛兵。
 * 中王派出來的新小兵，就是**下一章**才會出現的那一種：中王是下一章的預告，
 * 他在這裡先認識牠，下一章第一關就不會被嚇到。
 *
 * ── 金色親衛兵 ───────────────────────────────────────────
 * 每 6 隻有一隻金色的。**一個字母都沒打錯**就打掉牠：蜂巢 +1 血（滿了就換成蜂蜜 ×3）。
 * 獎勵的是「拼得準」，不是「打得快」——這是拼字遊戲。
 *
 * ── 大魔王：跟真的比賽一樣 ──────────────────────────────────
 *   - 每個字都照比賽的方式唸：單字 → 例句 → 再唸一次單字
 *   - 唸的時候蟲站著等（最多 4 秒）；他一開始打，蟲就開始走——快的人不會被拖慢
 *   - 重聽的代價加倍（比賽只能請評審再唸，次數越多越不利）
 *   - 不顯示單字（畫面那一邊管，見 game.js 的 shouldShowWord）
 *
 * ── 確定性 ───────────────────────────────────────────────
 * 全部是開場設定（王的代號）＋已經打掉幾個字算出來的，不抽亂數、不看時間。
 * 錄影檔記的是王的代號；沒有王的一場（boss = null）跟 C7 之前一模一樣，舊錄影檔的指紋不會變。
 */

export const BOSS = {
  /* 王登場時第一隻蟲站著等多久：讓他把王的名字與一句話規則讀完 */
  introHoldMs: 2600,
  /* 換階段時蟲站著不動多久：王怒吼的演出時間，也是讓他喘口氣 */
  phaseHoldMs: 1800,
  /* 每幾隻有一隻金色親衛兵（第 6、12、18…隻） */
  guardEvery: 6,
  /* 零失誤打掉金色親衛兵：+幾顆血；血是滿的就改成蜂蜜 ×幾 */
  guardHealHp: 1,
  guardHoneyFactor: 3,
  /* 大魔王：每個字唸「單字 → 例句 → 單字」的時候蟲最多等多久 */
  competitionHoldMs: 4000,
  /* 大魔王：重聽的代價 ×幾 */
  competitionListenFactor: 2
};

/*
 * 四隻王。
 *
 * phases[i].at：王的血掉了幾成之後進這一階（第一階是 0）。
 * phases[i].traits：這一階派出哪些特殊敵人（覆蓋關卡原本的特性池）。
 * phases[i].speed：這一階的速度倍率（乘在關卡速度上）。
 * phases[i].line：換階段時畫面上寫的那一句——數字從上面的常數算，不寫死。
 * color 是名字與橫幅的顏色；bar 是血條的顏色（要夠深，上面的白字才讀得出來）。
 */
export const BOSSES = {
  beetle: {
    key: 'beetle',
    bar: '#f59e0b',
    name: '鐵甲將軍',
    icon: '🪲',
    color: '#cbd5e1',
    intro: '牠的小兵越打越硬——把牠的血打光就贏了！',
    phases: [
      { at: 0, traits: [], speed: 1, line: '' },
      { at: 1 / 3, traits: ['armored'], speed: 1, line: '派出護甲兵！前幾個字母打不動牠們' },
      { at: 2 / 3, traits: ['armored'], speed: 1.08, line: '鐵甲將軍暴怒了！蟲變快了' }
    ]
  },
  wasp: {
    key: 'wasp',
    bar: '#ec4899',
    name: '黃蜂女王',
    icon: '🐝',
    color: '#f9a8d4',
    intro: '女王的親兵會衝刺——把她的血打光就贏了！',
    phases: [
      { at: 0, traits: ['armored'], speed: 1, line: '' },
      { at: 1 / 3, traits: ['armored', 'dasher'], speed: 1, line: '派出衝刺兵！牠們會自己往前衝' },
      { at: 2 / 3, traits: ['armored', 'dasher'], speed: 1.08, line: '黃蜂女王暴怒了！蟲變快了' }
    ]
  },
  spider: {
    key: 'spider',
    bar: '#8b5cf6',
    name: '蜘蛛女皇',
    icon: '🕷️',
    color: '#c4b5fd',
    intro: '女皇會讓小兵安靜下來——把她的血打光就贏了！',
    phases: [
      { at: 0, traits: ['armored', 'dasher'], speed: 1, line: '' },
      { at: 1 / 3, traits: ['armored', 'dasher', 'silent'], speed: 1, line: '派出靜音兵！牠的字只唸一次' },
      { at: 2 / 3, traits: ['armored', 'dasher', 'silent'], speed: 1.08, line: '蜘蛛女皇暴怒了！蟲變快了' }
    ]
  },
  king: {
    key: 'king',
    bar: '#ef4444',
    name: '大黃蜂魔王',
    icon: '👑',
    color: '#fbbf24',
    intro: '跟真的比賽一樣：每個字唸「單字 → 例句 → 單字」，不顯示單字。',
    competition: true,
    phases: [
      /*
       * 大魔王每一個形態都快一點（模擬器調的，見附錄 I）：只靠關卡速度的話，
       * 快手速幾乎不會輸、慢手速卻先卡住；一階一階加上去，兩邊才都落在區間裡。
       */
      { at: 0, traits: ['armored'], speed: 1, line: '' },
      { at: 1 / 4, traits: ['armored', 'dasher'], speed: 1.05, line: '第二形態！派出衝刺兵，蟲變快了' },
      { at: 2 / 4, traits: ['armored', 'dasher', 'silent'], speed: 1.1, line: '第三形態！派出靜音兵，蟲又變快了' },
      { at: 3 / 4, traits: ['armored', 'dasher', 'silent'], speed: 1.18, line: '最終形態！魔王暴怒了' }
    ]
  }
};

/* 關號 → 王。關卡表（shared/campaign.js）用它把王掛到那一關上 */
export const BOSS_BY_LEVEL = { 25: 'beetle', 50: 'wasp', 75: 'spider', 100: 'king' };

/* 事件只能帶數字，王也要有代號 */
export const BOSS_CODE = { beetle: 1, wasp: 2, spider: 3, king: 4 };

export function bossFor(key) {
  return (key && BOSSES[key]) || null;
}

/**
 * 打掉 kills 個字之後，王在第幾階（從 0 開始）。
 * 門檻用 ceil：20 個字的中王在第 7、14 個字換階段，100 個字的大魔王在 25、50、75。
 */
export function phaseFor(boss, kills, total) {
  let p = 0;
  for (let i = 1; i < boss.phases.length; i += 1) {
    if (kills >= Math.ceil(boss.phases[i].at * total)) p = i;
  }
  return p;
}

/** 這一場的第幾隻（從 0 開始）是不是金色親衛兵。 */
export function isGuardAt(queuePos) {
  return queuePos % BOSS.guardEvery === BOSS.guardEvery - 1;
}

/**
 * 這一隻王的規則，給開場的王卡與 F1 玩法說明用（兩邊同一份，才不會講得不一樣）。
 * 數字從上面的常數現場組，不寫死：數字一改而文案沒改，說明就變成謊言（跟 rules.js 同一個理由）。
 *
 * @param n 這一關有幾個字（＝王的血）
 */
export function bossRuleLines(boss, n) {
  const cuts = boss.phases.slice(1).map((p) => Math.ceil(p.at * n));
  const lines = [
    `❤️ 王的血就是這一關的 ${n} 個字：打掉一個字，王掉一格血`,
    `◆ 打掉第 ${cuts.join('、')} 個字時王會換階段，派出新的小兵、越來越快`,
    `👑 每 ${BOSS.guardEvery} 隻有一隻金色親衛兵：一個字母都沒打錯就打掉，蜂巢 +${BOSS.guardHealHp} ❤️（血是滿的就換成蜂蜜 ×${BOSS.guardHoneyFactor}）`
  ];
  if (boss.competition) {
    lines.push(
      `🎤 跟真的比賽一樣：每個字唸「單字 → 例句 → 單字」，唸的時候蟲會等你（最多 ${BOSS.competitionHoldMs / 1000} 秒，你一開始打牠就開始走）`,
      `🙈 不顯示單字；重聽的代價 ×${BOSS.competitionListenFactor}`
    );
  }
  return lines;
}
