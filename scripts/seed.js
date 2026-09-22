/**
 * 手動把商店品項寫進資料庫。執行方式：npm run seed（需先在 .env 設定 MONGODB_URI）
 *
 * ── 現在通常不需要跑這支 ──────────────────────────────────
 * 品項清單搬到 server/data/shop-items.js 之後，伺服器每次連上資料庫都會
 * 自己 upsert 一次（見 server/db.js 的 seedShopItems），所以部署完就是
 * 最新的，不必記得跑任何指令。
 *
 * 這支留著是為了「不啟動伺服器也想確認一下」的情況：改完價格想馬上驗證、
 * 或是要確認某個資料庫裡到底有沒有東西。兩邊讀的是同一份清單，
 * 不會有「跑了指令跟部署出來不一樣」的問題。
 *
 * （原本清單只寫在這支腳本裡，而 Render 上從來沒有人跑過它——
 *   結果商店一直是空的，孩子第一次點進去什麼都沒看到。）
 */
require('dotenv').config();
const { connectDB, getClient } = require('../server/db');
const { upsertItem } = require('../server/models/ShopItem');
const { SHOP_ITEMS } = require('../server/data/shop-items');

async function main() {
  // connectDB 自己就會 upsert 一次，這裡再跑一次是為了把每一項印出來確認
  await connectDB();
  for (const item of SHOP_ITEMS) {
    await upsertItem(item);
    console.log(`已建立/更新商品：${item.name}（${item.cost} 金幣）`);
  }
  console.log(`✅ 商店品項建立完成，共 ${SHOP_ITEMS.length} 項`);
  await getClient().close();
}

main().catch((err) => {
  console.error('❌ seed 失敗:', err);
  process.exit(1);
});
