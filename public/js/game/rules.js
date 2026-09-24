/**
 * 遊戲規則說明。
 *
 * ── 為什麼要有這個檔案 ──────────────────────────────────────
 * 規則本來只存在於程式碼裡：按 ↑ 會重聽，但「重聽要付什麼代價」畫面上
 * 一個字都沒有；連擊到 5 會有效果，但要連幾次、給的是什麼，他只能自己猜。
 * 結果就是他按了重聽、敵人突然衝了一段，他不知道是自己按的還是遊戲壞了。
 *
 * **看不懂的規則等於不存在。** 所以這裡把每一條都寫出來，而且寫清楚代價。
 *
 * ── 為什麼從 BALANCE 算出來，不直接寫字串 ──────────────────
 * 數字寫死在說明裡的話，平衡一調（而平衡本來就會一直調）說明就變成謊言，
 * 而且不會有任何錯誤——他只會照著一段過時的說明玩，然後覺得遊戲怪怪的。
 * 這裡每一個數字都是從 balance.js 現場算出來的，調平衡不用回來改文案。
 */

import { BALANCE, knockbackMsFor } from './core/balance.js';
import { XP, levelRewards } from '../shared/levels.js';

/**
 * 毫秒寫成小孩看得懂的秒數：1500 →「1.5 秒」、620 →「0.62 秒」。
 *
 * 保留到小數兩位而不是一位：每個字母 620ms 四捨五入成「0.6 秒」的話，
 * 說明上的數字就跟 balance.js 對不起來了。說明的價值在於「照著算得出來」，
 * 一旦開始四捨五入，他自己算的跟畫面顯示的會差一截。
 * 尾巴的零去掉——「2 秒」比「2.00 秒」好讀。
 */
function secs(ms) {
  const s = ms / 1000;
  return `${Number(s.toFixed(2))} 秒`;
}

const DIFFICULTY_LABELS = { easy: '輕鬆', normal: '標準', hard: '挑戰' };

/**
 * 規則分段。
 * @param {string} difficulty 目前難度——擊退量與時間都跟難度有關，
 *   寫一個「平均值」只會跟他實際玩到的對不起來
 * @returns {{title:string, icon:string, lines:string[]}[]}
 */
export function buildRules(difficulty = BALANCE.defaultDifficulty) {
  const d = BALANCE.difficulty[difficulty] || BALANCE.difficulty[BALANCE.defaultDifficulty];
  const c = BALANCE.combo;
  const h = BALANCE.honey;
  const listen = BALANCE.listenCostMs;
  const knockback = knockbackMsFor(difficulty);

  return [
    {
      icon: '🎯',
      title: '怎麼玩',
      lines: [
        '蟲從右邊走過來，把牠身上那個單字拼出來就能打掉牠。',
        '打錯不會清空已經打對的部分，繼續打正確的字母就好。',
        '單字裡的空白和連字號可以打、也可以不打，兩種都算對。',
        `蟲走到蜂巢就扣一顆血，扣完 ${BALANCE.maxHp} 顆就結束；漏掉的字會排回隊伍最後面再來一次。`
      ]
    },
    {
      icon: '🎧',
      title: '聽不清楚怎麼辦（每一種都要付代價）',
      lines: [
        `↑ 或 🔊 再聽一次　→　蟲會前進 ${secs(listen.replay)}`,
        `↓ 或 🐢 放慢唸　　→　蟲會前進 ${secs(listen.slow)}`,
        `→ 或 💬 唸例句　　→　蟲會前進 ${secs(listen.sentence)}`,
        '代價不是懲罰，是讓你自己決定「要不要花這個時間」——聽懂了再打，通常比亂猜划算。'
      ]
    },
    {
      icon: '🔥',
      title: `連續答對的加成（現在是「${DIFFICULTY_LABELS[difficulty] || difficulty}」難度）`,
      lines: [
        '一個單字從頭到尾都沒打錯，連擊就 +1。中間打錯一個字母，連擊立刻歸零。',
        `連擊 ${c.dashAt}　→　🐝 蜂群衝刺：${secs(c.dashMs)}內蟲的速度慢一半`,
        `連擊 ${c.sweetTimeAt}　→　🍯 蜜糖時間：下一個單字的時間變成 ${c.sweetTimeFactor} 倍`,
        `連擊 ${c.frenzyAt}　→　⚡ 狂蜂狀態：${secs(c.frenzyMs)}內擊退 ×${c.frenzyKnockbackFactor}、蜂蜜 ×${c.frenzyHoneyFactor}`,
        `連擊 ${c.frenzyAt} 之後每再 ${c.frenzyRepeatEvery} 次，狂蜂狀態就再來一次。`,
        '三種加成都只讓「比較好打」，沒有任何一種會幫你少打字母。'
      ]
    },
    {
      icon: '🍯',
      title: '蜂蜜（分數）怎麼算',
      lines: [
        `打對一個字母　　　+${h.perCorrectLetter}`,
        `打掉一隻蟲　　　　+${h.perKill}`,
        `${h.longWordFrom} 個字母以上的長單字　再 +${h.longWordBonus}`,
        `狂蜂狀態中拿到的蜂蜜全部 ×${c.frenzyHoneyFactor}。`
      ]
    },
    {
      icon: '⬆️',
      title: '等級與經驗值',
      lines: [
        '左上角血條下面那條紫色的細線就是經驗條，滿了就升一級。',
        `打對一個字母 +${XP.perCorrectLetter}　打掉一隻蟲 +${XP.perKill}　${XP.longWordFrom} 個字母以上再 +${XP.longWordBonus}`,
        /*
         * 這一行是整個經驗設計的重點，所以在說明裡也要講得最清楚。
         * 就算他不看說明，戰鬥中那句「學回來了！+20 XP」也會告訴他同一件事。
         */
        `⭐ 以前打錯過的字，這次打對 +${XP.relearnBonus}　——一隻普通的蟲 ${XP.perKill} 分，這種 ${XP.perKill + XP.relearnBonus} 分，差五倍。`,
        `打完整組再加「字數 ×${XP.perWordOnClear}」；完全沒失誤的話整場經驗 ×${XP.perfectFactor}。`,
        `每升一級，打對字母把蟲推回去的距離 +${Math.round(levelRewards(2).knockbackFactor * 100 - 100)}%；練到 ${levelRewards(1).nextHpAt} 級多一顆血。`,
        '等級只會讓同樣的字更好打，不會讓你少打字母。'
      ]
    },
    {
      icon: '⚔️',
      title: '裝備（在商店買）',
      lines: [
        '遊戲裡賺到的 🍯 蜂蜜可以拿去商店買裝備——武器、護甲、飾品各裝一件。',
        '武器讓你把蟲推得更遠、護甲讓打錯沒那麼痛、飾品各有各的特殊規則。',
        '每一階要練到一定等級才解得開，先從 10 級那一批開始。',
        /*
         * 這一行是 §1 的鐵律，說明裡一定要寫出來。
         * 他要知道「變強」在這個遊戲裡是什麼意思：同樣的字更好打，
         * 不是同樣的字打得更少。
         */
        '⚠️ 裝備只會讓同樣的字更好打，永遠不會幫你少打一個字母——蟲的血量就是單字的字母數。'
      ]
    },
    {
      icon: '⏱️',
      title: '時間是怎麼算的',
      lines: [
        `每隻蟲走完全程的時間 = ${secs(d.baseMs)} + 每個字母 ${secs(d.perLetterMs)}。字越長，給的時間越多。`,
        `打對一個字母會把牠推回去約 ${secs(Math.round(knockback))}——打得越順，牠越走不動。`,
        `打錯一個字母，牠會前進 ${secs(BALANCE.wrongLetterPenaltyMs)}。`,
        '蟲的大小看單字長度：甲蟲最短、黃蜂中等、蜘蛛最長。看到蜘蛛就知道這個字比較長，但時間也比較多。'
      ]
    },
    {
      icon: '⌨️',
      title: '按鍵',
      lines: [
        '↑ 再聽　↓ 慢唸　→ 例句',
        'Backspace 刪掉上一個字母（不用付代價，蟲不會前進）',
        'Esc 暫停　F1 打開這張說明　F2 靜音　F3 除錯資訊',
        '打不出字母的話，先確認輸入法切回英文（注音模式下遊戲收不到字母）。'
      ]
    }
  ];
}

/** 開場畫面用的濃縮版：三行，講最容易誤會的三件事。 */
export function buildQuickRules(difficulty = BALANCE.defaultDifficulty) {
  const c = BALANCE.combo;
  const listen = BALANCE.listenCostMs;
  return [
    `🎧 ↑再聽（蟲前進 ${secs(listen.replay)}）　↓慢唸（${secs(listen.slow)}）　→例句（${secs(listen.sentence)}）`,
    `🔥 一個字都沒打錯才算連擊：${c.dashAt} 減速、${c.sweetTimeAt} 時間加倍、${c.frenzyAt} 狂蜂`,
    '❓ 想看完整規則按 F1'
  ];
}
