/**
 * 單字庫。現在是**好幾本**：兩個孩子各有各的課本。
 *
 *   g3a    Pierce  Grade 3A Intensive Course（100 競賽字 + 649 週單字）
 *   allen  Allen   結構相同，內容還在等（見 banks/allen.js）
 *
 * 每本課本的原始資料在 banks/，組裝的邏輯在 build-bank.js，
 * 這個檔案只做兩件事：把它們組起來、提供查詢。
 *
 * 這些清單是寫死在程式碼裡的，不存資料庫、也不從網頁新增。
 * 要增修單字就直接改檔案再重新部署——範圍是固定的，
 * 這樣比開一個新增介面單純，也不會被誤刪或改錯。
 *
 * ── 「組」是什麼 ────────────────────────────────────────────
 * 練習的單位是「一組」：Part 1 是一組、Week 1 是一組。孩子一次練一組，
 * 練到接近全對五六次就算過關。所以遊戲、進度、關卡通通以 group 為單位，
 * part 只是競賽單字沿用下來的舊欄位（週單字沒有 part）。
 *
 * ── id 不能改 ──────────────────────────────────────────────
 * id 一旦定下就不要更動：使用者的答題進度**與真人錄音**都是靠它對應的，
 * 改了會讓進度對不上、錄音變成孤兒，而且不會有任何錯誤訊息。
 * 每一本課本有自己的 id 命名空間（idPrefix），Pierce 那一本永遠是空字串。
 *
 * ── 查詢為什麼大多不用指定課本 ────────────────────────────
 * id 全域唯一（靠 idPrefix 保證），所以 getWordById / wordsByGroup 拿著 id
 * 就查得到，不必先知道是哪一本。只有「列出有哪些組」需要指定課本——
 * 那是「這個孩子看得到什麼」的問題。
 */

const { BANK_SOURCES } = require('./banks');
const { buildBank, MAX_GROUP_SIZE } = require('./build-bank');

const BANKS = BANK_SOURCES.map(buildBank);
const DEFAULT_BANK_ID = BANKS[0].id;

const BANK_BY_ID = new Map(BANKS.map((b) => [b.id, b]));

/* 全部課本的字與組攤平在一起，查 id 用 */
const WORDS = BANKS.flatMap((b) => b.words);
const GROUPS = BANKS.flatMap((b) => b.groups);

const BY_ID = new Map(WORDS.map((w) => [w.id, w]));
const BY_GROUP = new Map(GROUPS.map((g) => [g.id, WORDS.filter((w) => w.group === g.id)]));

/**
 * 這個帳號用哪一本。
 *
 * 認不得（欄位還沒有、或課本被拿掉了）就退回預設那一本——
 * 舊帳號沒有這個欄位是正常的，不該因此打不開。
 */
function resolveBankId(bankId) {
  return BANK_BY_ID.has(String(bankId)) ? String(bankId) : DEFAULT_BANK_ID;
}

function getBank(bankId) {
  return BANK_BY_ID.get(resolveBankId(bankId));
}

/** 有哪幾本課本。帳號設定頁用這個列選項。 */
function listBanks() {
  return BANKS.map((b) => ({
    id: b.id,
    label: b.label,
    owner: b.owner,
    ready: b.ready,
    groupCount: b.groups.length,
    wordCount: b.words.length
  }));
}

/** 某一本課本裡有哪些組。不給就是預設那一本。 */
function listGroups(bankId) {
  return getBank(bankId).groups;
}

/** 這一組屬於哪一本課本。用來擋「拿別人課本的組」。 */
function bankIdForGroup(groupId) {
  const g = GROUPS.find((x) => x.id === String(groupId));
  return g ? g.bank : null;
}

function allWords() {
  return WORDS;
}

function wordsByPart(part, bankId) {
  return getBank(bankId).words.filter((w) => w.part === Number(part));
}

function wordsByGroup(groupId) {
  const id = String(groupId);
  const exact = BY_GROUP.get(id);
  if (exact) return exact;
  /*
   * 切開之前存在過的組（w06）現在變成 w06a / w06b。
   * 孩子的瀏覽器歷史或既有連結還指著舊的 id，直接報錯就是「昨天還能開，
   * 今天壞了」。對到上半組，畫面標題會誠實寫 Week 6①，他看得出來拿到哪一半。
   */
  return BY_GROUP.get(`${id}a`) || [];
}

function getWordById(id) {
  return BY_ID.get(String(id)) || null;
}

module.exports = {
  WORDS,
  GROUPS,
  BANKS,
  DEFAULT_BANK_ID,
  MAX_GROUP_SIZE,
  /* 相容：以前只有一本的時候這兩個是直接匯出的 */
  CONTEST_WORDS: WORDS.filter((w) => w.part != null),
  PARTS: BANKS[0].parts,
  listBanks,
  resolveBankId,
  getBank,
  bankIdForGroup,
  allWords,
  wordsByPart,
  wordsByGroup,
  listGroups,
  getWordById
};
