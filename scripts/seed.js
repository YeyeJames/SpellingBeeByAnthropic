// 建立/更新商店初始品項。執行方式：npm run seed（需先在 .env 設定 MONGODB_URI）
require('dotenv').config();
const { connectDB, client } = require('../server/db');
const { upsertItem } = require('../server/models/ShopItem');

const ITEMS = [
  {
    key: 'theme_space',
    type: 'theme',
    name: '太空主題',
    description: '把介面換成閃亮的星空太空風！',
    cost: 150,
    iconAsset: '/assets/icons/star.svg',
    active: true
  },
  {
    key: 'theme_dino',
    type: 'theme',
    name: '恐龍主題',
    description: '穿越回侏儸紀，來場恐龍大冒險！',
    cost: 150,
    iconAsset: '/assets/icons/star.svg',
    active: true
  },
  {
    key: 'accessory_sunglasses',
    type: 'avatarAccessory',
    name: '酷炫墨鏡',
    description: '幫拼字蜂戴上帥氣墨鏡！',
    cost: 60,
    iconAsset: '/assets/sprites/accessory-sunglasses.svg',
    active: true
  },
  {
    key: 'accessory_cape',
    type: 'avatarAccessory',
    name: '超級披風',
    description: '拼字蜂變身拼字超人！',
    cost: 80,
    iconAsset: '/assets/sprites/accessory-cape.svg',
    active: true
  },
  {
    key: 'accessory_medal',
    type: 'avatarAccessory',
    name: '金牌獎章',
    description: '掛上閃亮亮的第一名獎牌！',
    cost: 100,
    iconAsset: '/assets/sprites/accessory-medal.svg',
    active: true
  },
  {
    key: 'minigame_coincatch',
    type: 'minigame',
    name: '接金幣小遊戲',
    description: '解鎖後可以在商店裡玩「接金幣」小遊戲放鬆一下！',
    cost: 120,
    iconAsset: '/assets/icons/coin.svg',
    active: true
  }
];

async function main() {
  await connectDB();
  for (const item of ITEMS) {
    await upsertItem(item);
    console.log(`已建立/更新商品：${item.name}`);
  }
  console.log('✅ 商店品項建立完成');
  await client.close();
}

main().catch((err) => {
  console.error('❌ seed 失敗:', err);
  process.exit(1);
});
