/**
 * 漏掉一個字的原因：來不及、不會拼、沒動作。
 *
 * 伺服器的錄影分析（analysis.js）與戰鬥核心（battle.js，給難度建議用）用同一份，
 * 兩邊說的「不會拼」才會是同一件事。純函式，瀏覽器與 Node 都能跑。
 *
 *   slow     來不及：蟲到的時候，他已經打對一半以上，而且幾乎沒打錯
 *   unknown  不會拼：打錯兩個字母以上，或打不到一半就卡住
 *   idle     沒動作：整個字一個鍵都沒按（沒聽到、分心、或根本不知道從哪開始）
 */

/* 分類的門檻。寫在這裡是為了報告能照實說「怎麼算的」 */
export const MISS_RULES = {
  slowTypedRatio: 0.5, // 打對超過一半、
  slowMaxWrong: 1, //     打錯不超過 1 個 → 來不及
  unknownMinWrong: 2 //   打錯 2 個以上 → 不會拼
};

/** @param w { keys, correct, wrong, len }：這個字按了幾個字母鍵、對幾個、錯幾個、字母數（不含空白與連字號） */
export function classifyMiss(w) {
  if (w.keys === 0) return 'idle';
  if (w.wrong >= MISS_RULES.unknownMinWrong) return 'unknown';
  if (w.correct / Math.max(1, w.len) >= MISS_RULES.slowTypedRatio && w.wrong <= MISS_RULES.slowMaxWrong) return 'slow';
  return 'unknown';
}
