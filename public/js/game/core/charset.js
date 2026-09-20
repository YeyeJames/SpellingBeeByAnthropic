/**
 * 遊戲收得下哪些字元。
 *
 * 課本裡有 "alarm clock"、"a couple of"、"high-pitched" 這類詞條。
 * 原本遊戲只收 a~z，那些字只好從遊戲裡濾掉，於是同一組在練習頁是 49 個字、
 * 在遊戲裡是 46 個——兩邊對不起來，而且孩子沒辦法在遊戲裡練到那幾個。
 *
 * 所以空白與連字號一律當成正常字元：要打完 "alarm clock" 就得按空白鍵。
 * 撇號一起收下，"don't" 這種字以後加進來才不會默默壞掉。
 *
 * 這份定義是唯一的來源——輸入層、戰鬥邏輯、單字庫驗證都讀它，
 * 三邊各寫一次遲早會不一致。
 */

/** 單一字元能不能打。 */
export function isTypeableChar(ch) {
  return typeof ch === 'string' && ch.length === 1 && /[a-z '-]/.test(ch);
}

/**
 * 這個字元是不是「兩個字中間那一下」。
 *
 * 分隔符不強制打：正常遊玩看不到單字，他聽到 "alarm clock" 很可能直接
 * 打 alarmclock，然後卡在第六個字元而畫面不會說原因。見 battle.js。
 */
export function isSeparator(ch) {
  return ch === ' ' || ch === '-';
}

/** 整個詞條能不能打。開頭一定是字母，不能有數字或其他符號。 */
export function isTypeableWord(english) {
  return /^[a-z][a-z '-]*$/.test(String(english || ''));
}
