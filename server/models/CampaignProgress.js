/**
 * 戰役進度（C3）：每個帳號一列 { userId, highestCleared, stars, clearedAt }。
 *
 * 本來只有 routes/campaign.js 在讀它。100 關是整個遊戲的終點，進度要在
 * 每一頁都看得到（導覽列、選帳號、練習頁、個人檔案、遊戲結算），
 * 所以讀的那幾行搬到這裡大家共用。
 */

const { getDB } = require('../db');
const wordBank = require('../data/word-bank');

function collection() {
  return getDB().collection('campaignProgress');
}

let rulesPromise = null;
/* 關卡表跟前端同一份（public/js/shared/campaign.js），ES module 只能動態載入 */
function campaignRules() {
  if (!rulesPromise) rulesPromise = import('../../public/js/shared/campaign.js');
  return rulesPromise;
}

/** 這個帳號的戰役進度。沒有紀錄就是還沒開始（第 1 關解開著）。 */
async function progressFor(userId) {
  const row = await collection().findOne({ userId });
  return {
    highestCleared: row?.highestCleared || 0,
    clearedAt: row?.clearedAt || null,
    stars: row?.stars || {}
  };
}

/** 這個帳號那一本課本的整張關卡表 */
async function campaignFor(user) {
  const { buildCampaign } = await campaignRules();
  return buildCampaign(wordBank.listGroups(user.wordBankId));
}

/**
 * 進度摘要：打到第幾關、下一關、下一個王還有幾關、星星幾顆。
 * 練習頁、個人檔案、遊戲結算都用這一份，寫法才會到處一樣。
 */
async function summaryFor(user) {
  const { campaignSummary } = await campaignRules();
  const [campaign, progress] = await Promise.all([campaignFor(user), progressFor(user._id)]);
  return campaignSummary(campaign, progress.highestCleared, progress.stars);
}

/**
 * 很多個帳號各打到第幾關。選帳號那一頁用：一次查完，不要一個帳號查一次。
 * 回傳 Map(userId 字串 → highestCleared)。
 */
async function clearedByUser(userIds) {
  if (!userIds.length) return new Map();
  const rows = await collection()
    .find({ userId: { $in: userIds } }, { projection: { userId: 1, highestCleared: 1 } })
    .toArray();
  return new Map(rows.map((r) => [String(r.userId), r.highestCleared || 0]));
}

/* 每一本課本的關數（還沒有每週單字的課本是 0）。表是算出來的，算一次就好 */
const totalCache = new Map();
async function totalLevels(wordBankId) {
  const key = wordBank.resolveBankId(wordBankId);
  if (!totalCache.has(key)) {
    const { buildCampaign } = await campaignRules();
    totalCache.set(key, buildCampaign(wordBank.listGroups(key)).length);
  }
  return totalCache.get(key);
}

module.exports = { campaignRules, progressFor, campaignFor, summaryFor, clearedByUser, totalLevels };
