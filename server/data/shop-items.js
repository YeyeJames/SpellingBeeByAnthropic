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
 *
 * ── 價格為什麼是這個量級（2026-09 調整） ──────────────────
 * 他自己講的：「商店東西可以調高單價，賺錢太快了」。
 *
 * 舊價格是 60～150，而練習一輪（30 字全對）就有 900 金幣——第一輪還沒
 * 練完，整間店 660 塊全部買得起。買東西沒有取捨，也就沒有期待。
 *
 * 現在整間店 8,200，大約九輪練習。最便宜的 600 刻意壓在「一輪就買得到」，
 * 這樣他手上已經存的錢不會突然變成廢紙，而且第一次逛就有東西可以拿；
 * 之後才是要存的。
 *
 * 單價只是其中一半——另一半是 utils/coins.js 的連勝加成封頂，
 * 那個沒修的話金幣是指數成長的，單價調幾次都會被追上。
 *
 * ⚠️ 已經買過的東西不會因為漲價被收回（看的是 ownedItemKeys）。
 */

const SHOP_ITEMS = [
  {
    key: 'theme_space',
    type: 'theme',
    name: '太空主題',
    description: '把介面換成閃亮的星空太空風！',
    cost: 2000,
    iconAsset: '/assets/icons/star.svg',
    active: true
  },
  {
    key: 'theme_dino',
    type: 'theme',
    name: '恐龍主題',
    description: '穿越回侏儸紀，來場恐龍大冒險！',
    cost: 2000,
    iconAsset: '/assets/icons/star.svg',
    active: true
  },
  {
    key: 'accessory_sunglasses',
    type: 'avatarAccessory',
    name: '酷炫墨鏡',
    description: '幫拼字蜂戴上帥氣墨鏡！',
    cost: 600,
    iconAsset: '/assets/sprites/accessory-sunglasses.svg',
    active: true
  },
  {
    key: 'accessory_cape',
    type: 'avatarAccessory',
    name: '超級披風',
    description: '拼字蜂變身拼字超人！',
    cost: 900,
    iconAsset: '/assets/sprites/accessory-cape.svg',
    active: true
  },
  {
    key: 'accessory_medal',
    type: 'avatarAccessory',
    name: '金牌獎章',
    description: '掛上閃亮亮的第一名獎牌！',
    cost: 1200,
    iconAsset: '/assets/sprites/accessory-medal.svg',
    active: true
  },
  /*
   * ── 小遊戲 ────────────────────────────────────────────────
   *
   * cost 是「解鎖」的價格（買一次）；playCost 是**每玩一次**的價格。
   *
   * 為什麼每玩一次要付錢（家長決定的）：孩子練累了會先去商店，買了就
   * 無限玩的話，小遊戲很容易變成取代練習的東西。每玩一次付一點，
   * 要玩就得先去練習賺——練習和小遊戲自然形成一個循環。
   *
   * 為什麼是 150：練習一輪（20～30 字）大約賺 400～900，也就是
   * **練一輪可以玩三到六次**，每次 30 秒左右——大約兩三分鐘的休息。
   * 太便宜的話一輪就能玩十幾次，循環就不見了；太貴的話練完一輪
   * 只夠玩一次，那就不像獎勵了。
   *
   * 玩的分數**不會**換成真的金幣（見 economy-test 第 4 節）。
   * 小遊戲如果會產金幣，練拼字就變成賺錢最慢的方法。
   */
  {
    key: 'minigame_coincatch',
    type: 'minigame',
    name: '接金幣小遊戲',
    description: '移動拼字蜂接住掉下來的金幣，30 秒內接越多越好！',
    cost: 1500,
    playCost: 150,
    iconAsset: '/assets/icons/coin.svg',
    active: true
  },
  {
    key: 'minigame_beeflap',
    type: 'minigame',
    name: '蜜蜂飛行',
    description: '按空白鍵讓蜜蜂往上飛，穿過花莖之間的空隙，看你能飛多遠！',
    cost: 1800,
    playCost: 150,
    iconAsset: '/assets/icons/minigame-beeflap.svg',
    active: true
  },
  {
    key: 'minigame_whack',
    type: 'minigame',
    name: '打蟲大作戰',
    description: '蟲從蜂巢洞裡冒出來，按牠身上的字母把牠打回去，30 秒內打越多越好！',
    cost: 1800,
    playCost: 150,
    iconAsset: '/assets/icons/minigame-whack.svg',
    active: true
  }
];

module.exports = { SHOP_ITEMS };
