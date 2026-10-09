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
  },
  /*
   * 2026-10 加的三個。價格跟上面兩個一樣（家長說現在的價格剛好）：
   * 解鎖 1800、每玩一次 150。三個玩法刻意都不一樣——
   * 疊疊樂是抓時機、翻牌是記性、跳跳蜂是左右操控，跟接金幣／飛行／打蟲也不重複。
   */
  {
    key: 'minigame_stack',
    type: 'minigame',
    name: '蜂巢疊疊樂',
    description: '蜂巢塊左右滑，抓準時機放下去，放歪的會被切掉——看你能疊幾層！',
    cost: 1800,
    playCost: 150,
    iconAsset: '/assets/icons/minigame-stack.svg',
    active: true
  },
  {
    key: 'minigame_memory',
    type: 'minigame',
    name: '翻牌配對',
    description: '16 張牌裡藏著 8 對，60 秒內把一樣的兩張翻出來！',
    cost: 1800,
    playCost: 150,
    iconAsset: '/assets/icons/minigame-memory.svg',
    active: true
  },
  {
    key: 'minigame_jump',
    type: 'minigame',
    name: '跳跳蜂',
    description: '蜜蜂踩著花一路往上彈，左右移動接住下一朵，看能爬多高！',
    cost: 1800,
    playCost: 150,
    iconAsset: '/assets/icons/minigame-jump.svg',
    active: true
  },

  /*
   * ── 外觀（2026-10）──────────────────────────────────────────
   *
   * 家長的原則：增加趣味，**不再增加幫助戰鬥的東西**。這幾類全部只改「看起來、
   * 聽起來」，戰鬥的數字一個都不碰（遊戲邏輯根本讀不到這些欄位）。
   *
   * type 一律是 'cosmetic'，slot 是它穿在哪一格。每一格同時只能用一個，
   * 換一個就自動取代上一個；「卸下」就回到預設。存在 user.cosmetics.<slot>。
   *
   *   killFx     打掉蟲的特效＋蜂針的顏色（遊戲模式）
   *   beeColor   拼字蜂的顏色（練習畫面、個人檔案、小遊戲）
   *   soundPack  答對的聲音（練習答對、遊戲打掉一隻蟲）
   *   title      名字旁邊的稱號（導覽列、個人檔案、排行榜）
   *
   * 價格跟現有的同一個量級（家長說現在的價格剛好）：最便宜 600，最貴 2000。
   */
  { key: 'fx_confetti', type: 'cosmetic', slot: 'killFx', name: '彩帶特效', cost: 1200,
    description: '打掉蟲的時候噴出五顏六色的彩帶，蜂針也變成水藍色！',
    iconAsset: '/assets/icons/fx-confetti.svg', active: true },
  { key: 'fx_hearts', type: 'cosmetic', slot: 'killFx', name: '愛心特效', cost: 1200,
    description: '打掉蟲的時候飄出一堆愛心，蜂針變成粉紅色！',
    iconAsset: '/assets/icons/fx-hearts.svg', active: true },
  { key: 'fx_stars', type: 'cosmetic', slot: 'killFx', name: '星星特效', cost: 1200,
    description: '打掉蟲的時候星星四散，蜂針變成金色！',
    iconAsset: '/assets/icons/fx-stars.svg', active: true },
  { key: 'fx_fireworks', type: 'cosmetic', slot: 'killFx', name: '煙火特效', cost: 1500,
    description: '每打掉一隻蟲就放一朵煙火，蜂針變成紫色！',
    iconAsset: '/assets/icons/fx-fireworks.svg', active: true },

  { key: 'bee_pink', type: 'cosmetic', slot: 'beeColor', name: '粉紅蜂', cost: 900,
    description: '把拼字蜂染成粉紅色！', iconAsset: '/assets/sprites/bee-pink.svg', active: true },
  { key: 'bee_sky', type: 'cosmetic', slot: 'beeColor', name: '天藍蜂', cost: 900,
    description: '把拼字蜂染成天空藍！', iconAsset: '/assets/sprites/bee-sky.svg', active: true },
  { key: 'bee_mint', type: 'cosmetic', slot: 'beeColor', name: '薄荷蜂', cost: 900,
    description: '把拼字蜂染成清涼的薄荷綠！', iconAsset: '/assets/sprites/bee-mint.svg', active: true },
  { key: 'bee_violet', type: 'cosmetic', slot: 'beeColor', name: '紫晶蜂', cost: 900,
    description: '把拼字蜂染成神秘的紫色！', iconAsset: '/assets/sprites/bee-violet.svg', active: true },
  { key: 'bee_rainbow', type: 'cosmetic', slot: 'beeColor', name: '彩虹蜂', cost: 1500,
    description: '全身七彩的拼字蜂，超級稀有！', iconAsset: '/assets/sprites/bee-rainbow.svg', active: true },

  { key: 'sound_laser', type: 'cosmetic', slot: 'soundPack', name: '雷射音效', cost: 800,
    description: '答對的時候「咻——」一聲雷射！', iconAsset: '/assets/icons/sound-laser.svg', active: true },
  { key: 'sound_drum', type: 'cosmetic', slot: 'soundPack', name: '鼓聲音效', cost: 800,
    description: '答對的時候「咚咚鏘」打一段鼓！', iconAsset: '/assets/icons/sound-drum.svg', active: true },
  { key: 'sound_bubble', type: 'cosmetic', slot: 'soundPack', name: '泡泡音效', cost: 800,
    description: '答對的時候「啵啵」冒泡泡！', iconAsset: '/assets/icons/sound-bubble.svg', active: true },
  { key: 'sound_chime', type: 'cosmetic', slot: 'soundPack', name: '魔法鈴音效', cost: 800,
    description: '答對的時候響起閃亮亮的魔法鈴！', iconAsset: '/assets/icons/sound-chime.svg', active: true },
  // 2026-10 加的六個：他很喜歡答對音效，價格跟上面四個一樣
  { key: 'sound_coin', type: 'cosmetic', slot: 'soundPack', name: '金幣音效', cost: 800,
    description: '答對的時候「叮——」一聲，像撿到金幣！', iconAsset: '/assets/icons/sound-coin.svg', active: true },
  { key: 'sound_fanfare', type: 'cosmetic', slot: 'soundPack', name: '勝利號角音效', cost: 800,
    description: '答對的時候吹一段「嗒嗒嗒——噠！」', iconAsset: '/assets/icons/sound-fanfare.svg', active: true },
  { key: 'sound_whistle', type: 'cosmetic', slot: 'soundPack', name: '滑哨音效', cost: 800,
    description: '答對的時候「咻～」往上滑！', iconAsset: '/assets/icons/sound-whistle.svg', active: true },
  { key: 'sound_spring', type: 'cosmetic', slot: 'soundPack', name: '彈簧音效', cost: 800,
    description: '答對的時候「啵～嗡嗡嗡」彈一下！', iconAsset: '/assets/icons/sound-spring.svg', active: true },
  { key: 'sound_levelup', type: 'cosmetic', slot: 'soundPack', name: '電玩升級音效', cost: 800,
    description: '答對的時候響起電玩升級的音樂！', iconAsset: '/assets/icons/sound-levelup.svg', active: true },
  { key: 'sound_xylophone', type: 'cosmetic', slot: 'soundPack', name: '木琴音效', cost: 800,
    description: '答對的時候敲一段清脆的木琴！', iconAsset: '/assets/icons/sound-xylophone.svg', active: true },

  { key: 'title_star', type: 'cosmetic', slot: 'title', name: '稱號：拼字新星', titleText: '🌟 拼字新星', cost: 600,
    description: '名字旁邊掛上「拼字新星」！', iconAsset: '/assets/icons/title-badge.svg', active: true },
  { key: 'title_hunter', type: 'cosmetic', slot: 'title', name: '稱號：單字獵人', titleText: '🏹 單字獵人', cost: 800,
    description: '名字旁邊掛上「單字獵人」！', iconAsset: '/assets/icons/title-badge.svg', active: true },
  { key: 'title_flash', type: 'cosmetic', slot: 'title', name: '稱號：閃電手指', titleText: '⚡ 閃電手指', cost: 1000,
    description: '名字旁邊掛上「閃電手指」！', iconAsset: '/assets/icons/title-badge.svg', active: true },
  { key: 'title_guard', type: 'cosmetic', slot: 'title', name: '稱號：蜂巢守護者', titleText: '🛡️ 蜂巢守護者', cost: 1200,
    description: '名字旁邊掛上「蜂巢守護者」！', iconAsset: '/assets/icons/title-badge.svg', active: true },
  { key: 'title_master', type: 'cosmetic', slot: 'title', name: '稱號：拼字大師', titleText: '🎓 拼字大師', cost: 1500,
    description: '名字旁邊掛上「拼字大師」！', iconAsset: '/assets/icons/title-badge.svg', active: true },
  { key: 'title_legend', type: 'cosmetic', slot: 'title', name: '稱號：傳說拼字王', titleText: '👑 傳說拼字王', cost: 2000,
    description: '最難存到的稱號：「傳說拼字王」！', iconAsset: '/assets/icons/title-badge.svg', active: true }
];

/* 某一格（slot）有哪些外觀可以選。前後端都會用到這個對應，所以只寫在這裡一份 */
const COSMETIC_SLOTS = ['killFx', 'beeColor', 'soundPack', 'title'];

module.exports = { SHOP_ITEMS, COSMETIC_SLOTS };
