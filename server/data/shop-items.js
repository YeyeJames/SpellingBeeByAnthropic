/**
 * 商店品項。寫死在程式碼裡，跟單字庫同一個做法（見 word-bank.js）。
 *
 * ── 為什麼搬到這裡 ────────────────────────────────────────
 * 這份清單原本只寫在 scripts/seed.js 裡，要手動跑 `npm run seed` 才會進
 * 資料庫。結果 Render 上從來沒有人跑過那個指令——兒子第一次玩就先跑去點
 * 商店想看有什麼，看到的是一片空白（/api/health 的 shopItemCount 是 0）。
 *
 * 那不是「忘了跑指令」，是流程本身有問題：商店品項跟單字庫一樣是靜態資料，
 * 單字庫不需要 seed 就能用，商店沒有道理需要。所以改成連線成功時自動
 * upsert 一次（見 db.js 的 seedShopItems），部署完就是最新的，
 * 不必記得任何額外步驟。
 *
 * ── 改了之後會怎樣 ────────────────────────────────────────
 * 以 key 為準 upsert：改價格、改說明、加新品項，重新部署就生效。
 * 要下架就把 active 改成 false（不要直接刪掉——已經買過的人
 * ownedItemKeys 裡還留著那個 key，刪掉會讓它變成孤兒）。
 */

const SHOP_ITEMS = [
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

module.exports = { SHOP_ITEMS };
