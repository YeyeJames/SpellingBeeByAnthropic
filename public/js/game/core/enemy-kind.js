/**
 * 哪個單字配哪一種敵人。
 *
 * 不是隨機挑，也不是輪流——**看字母數**。
 *
 * 理由：時間公式本來就跟著字長走（基礎時間 + 每字母時間 × 字母數），
 * 所以長字的敵人實際上走得比較久。既然規則已經這樣，外形就該把它講出來：
 * 看到蜘蛛就知道「這隻大、要打久一點，但時間也給得多」。
 * 隨機外形只是裝飾，照字長分就是資訊——而設計書要的是
 * 「壓力是看得見的」，不是「畫面比較花」。
 *
 * 純函式、不看亂數：同一個字永遠是同一種敵人，重播與視覺回歸才對得起來。
 */

export const ENEMY_KINDS = [
  {
    key: 'beetle',
    label: '甲蟲',
    maxLetters: 4, // 4 個字母以內
    width: 120,
    height: 90
  },
  {
    key: 'wasp',
    label: '黃蜂',
    maxLetters: 7, // 5~7 個字母
    width: 150,
    height: 96
  },
  {
    key: 'spider',
    label: '蜘蛛',
    maxLetters: Infinity, // 8 個字母以上
    width: 182,
    height: 125
  }
];

/**
 * @param {string} english 單字本身（"alarm clock" 這種含空白的照整串算）
 * @returns {object} ENEMY_KINDS 裡的一項
 */
export function enemyKindFor(english) {
  const n = String(english || '').length;
  for (const kind of ENEMY_KINDS) {
    if (n <= kind.maxLetters) return kind;
  }
  return ENEMY_KINDS[ENEMY_KINDS.length - 1];
}
