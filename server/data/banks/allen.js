/**
 * Allen 的單字庫。
 *
 * ⏳ **還在等單字。** 結構跟 Pierce 那一本一樣（四個 Part 為核心，
 * 後面接 Week 1~18），但內容是他自己那本課本的，所以要另外抄一次。
 *
 * ── 要把單字放進來的時候 ──────────────────────────────────
 * 1. 競賽單字填進下面的 CONTEST_WORDS，格式跟 g3a.js 一模一樣：
 *      { id: 'p1-account', part: 1, english: 'account',
 *        chinese: '帳戶；說明', exampleSentence: 'I opened a bank account.' }
 *    id 寫成 `p1-xxx` 就好，**不要自己加前綴**——組裝的時候會自動套上
 *    下面的 idPrefix（見 ../build-bank.js）。
 *
 * 2. 每週單字放到 ../words/allen-weeks.js，格式照 ../words/weeks.js：
 *      { id: 'w01', label: 'Week 1', words: [[英文, 中文, 例句], ...] }
 *    然後把下面的 weeks 換成 require 進來的那一份。
 *
 * 3. 例句要過 scripts/validate-words.mjs 的規矩（一定要包含那個單字本身、
 *    十二個英文字以內、句尾有標點）。跑 `npm run test:words` 會逐條檢查。
 *
 * ── ⚠️ idPrefix 不要改 ────────────────────────────────────
 * 'a' 是這一本的命名空間。改掉的話，Allen 已經錄的音與已經練的進度
 * 會全部對不上——跟 Pierce 那一本的 '' 一樣，定了就不要動。
 */

const CONTEST_WORDS = [
  // ⏳ 等 Allen 的競賽單字（Part 1~4，各 25 字）
];

const WEEKS = [
  // ⏳ 等 Allen 的每週單字（Week 1~18）
];

module.exports = {
  id: 'allen',
  label: 'Allen 的課本',
  owner: 'Allen',
  // ⚠️ 定了就不要改（見檔頭）
  idPrefix: 'a',
  contestWords: CONTEST_WORDS,
  weeks: WEEKS
};
