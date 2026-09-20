/**
 * 邏輯事件 → 聲音的對照表。
 *
 * 獨立成一個模組有兩個理由：
 *   1. 聲音要在「動作套用的當下」就發出去，不能等下一個影格——
 *      邏輯是 120Hz、畫面是 60Hz，等一格就吃掉延遲預算的一半
 *   2. 「所有聲音回饋都必須有對應的視覺回饋」這條設計要求，
 *      要能被機器檢查而不是靠我記得。下面那張表就是檢查的依據
 *
 * 游標的用途：事件緩衝區每個影格才清一次，但套用動作是在影格之間發生的。
 * 記住「唸到哪裡」就不會重複發聲，也不會漏掉邏輯步產生的事件。
 */

import { EV, EV_NAME } from './core/battle.js';

/**
 * 必須同時有聲音與畫面回饋的事件。
 *
 * 不含 WORD_START：那是唸單字本身，本來就只存在於聲音裡（這是聽寫遊戲）。
 * 靜音或裝置沒有語音時，畫面會改成直接顯示單字，所以靜音仍然玩得下去。
 * 也不含 WORD_MISSED：扣血的聲音由緊接著的 HP_LOST 負責，重複播只會吵。
 */
export const DUAL_CHANNEL_EVENTS = [
  EV.LETTER_OK,
  EV.LETTER_BAD,
  EV.WORD_KILLED,
  EV.HP_LOST,
  EV.COMBO_UP,
  EV.LISTEN,
  EV.BATTLE_END
];

export function createSoundBridge(sfx, debug) {
  let cursor = 0;

  function record(evType) {
    debug?._recordChannel?.(EV_NAME[evType] || `EV_${evType}`, 'sfx');
  }

  return {
    /**
     * 把還沒發過聲的事件唸出來。
     * @param t0 這批事件是哪一次 keydown 造成的（沒有就傳 null，例如敵人自己走到）
     */
    flush(state, t0 = null) {
      for (let i = cursor; i < state.evCount; i += 1) {
        const ev = state.ev[i];
        switch (ev.type) {
          case EV.LETTER_OK:
            // ev.a 是「已打對幾個」，音階的索引要從 0 起算
            sfx.letter(ev.a - 1, state.combo, t0);
            record(ev.type);
            break;
          case EV.LETTER_BAD:
            sfx.wrong(t0);
            record(ev.type);
            break;
          case EV.WORD_KILLED:
            sfx.kill(ev.b, t0);
            record(ev.type);
            break;
          case EV.HP_LOST:
            sfx.hpLost(null);
            record(ev.type);
            break;
          case EV.COMBO_UP:
            // 只有跨過門檻才響，否則每個字都叮一聲太吵
            if (ev.a === 5 || ev.a === 10 || ev.a === 15) {
              sfx.combo(ev.a, null);
              record(ev.type);
            }
            break;
          case EV.LISTEN:
            sfx.listen(t0);
            record(ev.type);
            break;
          case EV.BATTLE_END:
            sfx.finish(ev.a === 1, null);
            record(ev.type);
            break;
          default:
            break;
        }
      }
      cursor = state.evCount;
    },

    /** 事件緩衝區被清空時呼叫，游標跟著歸零。 */
    reset() {
      cursor = 0;
    }
  };
}
