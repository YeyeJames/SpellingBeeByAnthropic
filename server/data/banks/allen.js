/**
 * Allen 的單字庫：Spelling Bee Grade 4D MWF。
 *
 * 結構跟 Pierce 那一本一樣（四個 Part 為核心，後面接 Week 1~18），
 * 但內容是他自己那本課本的。
 *
 * ── 現況 ──────────────────────────────────────────────────
 *   ✅ 競賽單字 Part 1~4（75 字，2026-09 對照照片逐格核過）
 *   ⏳ Week 1~18 還在等照片
 *
 * Part 的字數跟 Pierce 那一本不同（他是每個 Part 25 字，Allen 是
 * 20 / 20 / 20 / 15），照課本原樣，不要湊成一樣。
 *
 * ── 要把每週單字放進來的時候 ──────────────────────────────
 * 1. 放到 ../words/allen-weeks.js，格式照 ../words/weeks.js：
 *      { id: 'w01', label: 'Week 1', words: [[英文, 中文, 例句], ...] }
 * 2. 把下面的 WEEKS 換成 require 進來的那一份。
 * 3. 例句要過 scripts/validate-words.mjs 的規矩（一定要包含那個單字本身、
 *    十二個英文字以內、句尾有標點）。跑 `npm run test:words` 會逐條檢查。
 *
 * ── ⚠️ idPrefix 不要改 ────────────────────────────────────
 * 'a' 是這一本的命名空間。改掉的話，Allen 已經錄的音與已經練的進度
 * 會全部對不上——跟 Pierce 那一本的 '' 一樣，定了就不要動。
 * 為什麼非有不可，見 ../build-bank.js 的檔頭。
 */

/*
 * 2026-09 對照課本照片逐格核過：75 個字、拼字與順序全數相符。
 * 課本這份清單是嚴格照字母排的，validate-words.mjs 有一條在守這個順序。
 */
const CONTEST_WORDS = [
  // ── Part 1 ──────────────────────────────────────────────
  { id: 'p1-acquaint', part: 1, english: 'acquaint', chinese: '使認識；使熟悉', exampleSentence: 'Let me acquaint you with the new rules.' },
  { id: 'p1-adobe', part: 1, english: 'adobe', chinese: '泥磚', exampleSentence: 'The old house is built of adobe bricks.' },
  { id: 'p1-agriculture', part: 1, english: 'agriculture', chinese: '農業', exampleSentence: 'Agriculture feeds the whole country.' },
  { id: 'p1-amethyst', part: 1, english: 'amethyst', chinese: '紫水晶', exampleSentence: 'She wore a purple amethyst ring.' },
  { id: 'p1-anxious', part: 1, english: 'anxious', chinese: '焦慮的', exampleSentence: 'I felt anxious before the big test.' },
  { id: 'p1-appetite', part: 1, english: 'appetite', chinese: '食慾', exampleSentence: 'Running gave me a huge appetite.' },
  { id: 'p1-atmosphere', part: 1, english: 'atmosphere', chinese: '大氣層；氣氛', exampleSentence: 'The atmosphere protects us from the sun.' },
  { id: 'p1-bargain', part: 1, english: 'bargain', chinese: '便宜貨；討價還價', exampleSentence: 'This warm coat was a real bargain.' },
  { id: 'p1-behavior', part: 1, english: 'behavior', chinese: '行為', exampleSentence: 'His behavior in class was excellent today.' },
  { id: 'p1-blizzard', part: 1, english: 'blizzard', chinese: '暴風雪', exampleSentence: 'The blizzard closed every road in town.' },
  { id: 'p1-boulevard', part: 1, english: 'boulevard', chinese: '林蔭大道', exampleSentence: 'We walked down the wide boulevard.' },
  { id: 'p1-broccoli', part: 1, english: 'broccoli', chinese: '青花菜', exampleSentence: 'I eat broccoli with my dinner.' },
  { id: 'p1-bureau', part: 1, english: 'bureau', chinese: '局；辦事處', exampleSentence: 'She works at the travel bureau.' },
  { id: 'p1-casserole', part: 1, english: 'casserole', chinese: '砂鍋菜', exampleSentence: 'Mom baked a chicken casserole tonight.' },
  { id: 'p1-cauliflower', part: 1, english: 'cauliflower', chinese: '白花椰菜', exampleSentence: 'The cauliflower is white and round.' },
  { id: 'p1-circular', part: 1, english: 'circular', chinese: '圓形的', exampleSentence: 'The table has a circular top.' },
  { id: 'p1-conceive', part: 1, english: 'conceive', chinese: '想出；構想', exampleSentence: 'He could not conceive a better plan.' },
  { id: 'p1-consequence', part: 1, english: 'consequence', chinese: '後果', exampleSentence: 'Every choice has a consequence.' },
  { id: 'p1-convenient', part: 1, english: 'convenient', chinese: '方便的', exampleSentence: 'This shop is very convenient for us.' },
  { id: 'p1-corporation', part: 1, english: 'corporation', chinese: '公司；企業', exampleSentence: 'My uncle works for a large corporation.' },

  // ── Part 2 ──────────────────────────────────────────────
  { id: 'p2-diamond', part: 2, english: 'diamond', chinese: '鑽石', exampleSentence: 'The ring holds a bright diamond.' },
  { id: 'p2-emperor', part: 2, english: 'emperor', chinese: '皇帝', exampleSentence: 'The emperor ruled for forty years.' },
  { id: 'p2-encourage', part: 2, english: 'encourage', chinese: '鼓勵', exampleSentence: 'Please encourage your little brother.' },
  { id: 'p2-endeavor', part: 2, english: 'endeavor', chinese: '努力；盡力', exampleSentence: 'We will endeavor to finish on time.' },
  { id: 'p2-engineer', part: 2, english: 'engineer', chinese: '工程師', exampleSentence: 'The engineer designed a new bridge.' },
  { id: 'p2-enthusiasm', part: 2, english: 'enthusiasm', chinese: '熱情', exampleSentence: 'She sang with great enthusiasm.' },
  { id: 'p2-expedition', part: 2, english: 'expedition', chinese: '遠征；探險', exampleSentence: 'They joined an expedition to the pole.' },
  { id: 'p2-flourish', part: 2, english: 'flourish', chinese: '茂盛；興旺', exampleSentence: 'Plants flourish in warm spring rain.' },
  { id: 'p2-fortunate', part: 2, english: 'fortunate', chinese: '幸運的', exampleSentence: 'We were fortunate to find a seat.' },
  { id: 'p2-fugitive', part: 2, english: 'fugitive', chinese: '逃亡者', exampleSentence: 'The police finally caught the fugitive.' },
  { id: 'p2-fundamental', part: 2, english: 'fundamental', chinese: '基本的', exampleSentence: 'Reading is a fundamental skill.' },
  { id: 'p2-gesture', part: 2, english: 'gesture', chinese: '手勢', exampleSentence: 'He made a friendly gesture.' },
  { id: 'p2-graduate', part: 2, english: 'graduate', chinese: '畢業；畢業生', exampleSentence: 'My sister will graduate in June.' },
  { id: 'p2-handkerchief', part: 2, english: 'handkerchief', chinese: '手帕', exampleSentence: 'He wiped his face with a handkerchief.' },
  { id: 'p2-horizon', part: 2, english: 'horizon', chinese: '地平線', exampleSentence: 'The sun sank below the horizon.' },
  { id: 'p2-illustration', part: 2, english: 'illustration', chinese: '插圖', exampleSentence: 'The book has a lovely illustration.' },
  { id: 'p2-ingredient', part: 2, english: 'ingredient', chinese: '原料；成分', exampleSentence: 'Sugar is the main ingredient here.' },
  { id: 'p2-intelligent', part: 2, english: 'intelligent', chinese: '聰明的', exampleSentence: 'Dolphins are very intelligent animals.' },
  { id: 'p2-laboratory', part: 2, english: 'laboratory', chinese: '實驗室', exampleSentence: 'We did the test in the laboratory.' },
  { id: 'p2-lieutenant', part: 2, english: 'lieutenant', chinese: '中尉；副官', exampleSentence: 'The lieutenant gave the order.' },

  // ── Part 3 ──────────────────────────────────────────────
  { id: 'p3-magnificent', part: 3, english: 'magnificent', chinese: '壯麗的', exampleSentence: 'We saw a magnificent waterfall.' },
  { id: 'p3-marvelous', part: 3, english: 'marvelous', chinese: '了不起的', exampleSentence: 'You did a marvelous job today.' },
  { id: 'p3-mischief', part: 3, english: 'mischief', chinese: '惡作劇', exampleSentence: 'The kitten got into mischief again.' },
  { id: 'p3-narcissus', part: 3, english: 'narcissus', chinese: '水仙花', exampleSentence: 'A white narcissus grew by the pond.' },
  { id: 'p3-nasturtium', part: 3, english: 'nasturtium', chinese: '金蓮花', exampleSentence: 'She planted nasturtium in the garden.' },
  { id: 'p3-nightingale', part: 3, english: 'nightingale', chinese: '夜鶯', exampleSentence: 'A nightingale sang all night long.' },
  { id: 'p3-nucleus', part: 3, english: 'nucleus', chinese: '核心；細胞核', exampleSentence: 'Every cell has a nucleus.' },
  { id: 'p3-papyrus', part: 3, english: 'papyrus', chinese: '紙莎草紙', exampleSentence: 'Ancient people wrote on papyrus.' },
  { id: 'p3-peculiar', part: 3, english: 'peculiar', chinese: '奇特的', exampleSentence: 'That noise sounds very peculiar.' },
  { id: 'p3-persimmon', part: 3, english: 'persimmon', chinese: '柿子', exampleSentence: 'The persimmon tastes sweet in autumn.' },
  { id: 'p3-pheasant', part: 3, english: 'pheasant', chinese: '雉雞', exampleSentence: 'A pheasant flew out of the grass.' },
  { id: 'p3-political', part: 3, english: 'political', chinese: '政治的', exampleSentence: 'They watched a political debate.' },
  { id: 'p3-pomegranate', part: 3, english: 'pomegranate', chinese: '石榴', exampleSentence: 'A pomegranate is full of red seeds.' },
  { id: 'p3-precious', part: 3, english: 'precious', chinese: '珍貴的', exampleSentence: 'This old photo is precious to me.' },
  { id: 'p3-procession', part: 3, english: 'procession', chinese: '行列；隊伍', exampleSentence: 'A long procession marched down the street.' },
  { id: 'p3-professor', part: 3, english: 'professor', chinese: '教授', exampleSentence: 'The professor taught us about stars.' },
  { id: 'p3-proportion', part: 3, english: 'proportion', chinese: '比例', exampleSentence: 'Mix the paint in equal proportion.' },
  { id: 'p3-remedy', part: 3, english: 'remedy', chinese: '療法；補救', exampleSentence: 'Honey is a good remedy for coughs.' },
  { id: 'p3-responsible', part: 3, english: 'responsible', chinese: '負責的', exampleSentence: 'You are responsible for your own bag.' },
  { id: 'p3-sacrifice', part: 3, english: 'sacrifice', chinese: '犧牲', exampleSentence: 'He made a sacrifice for his family.' },

  // ── Part 4 ──────────────────────────────────────────────
  { id: 'p4-sassafras', part: 4, english: 'sassafras', chinese: '黃樟', exampleSentence: 'Tea can be made from sassafras roots.' },
  { id: 'p4-sausage', part: 4, english: 'sausage', chinese: '香腸', exampleSentence: 'I ate a sausage for breakfast.' },
  { id: 'p4-sculptor', part: 4, english: 'sculptor', chinese: '雕刻家', exampleSentence: 'The sculptor carved a horse from stone.' },
  { id: 'p4-secretary', part: 4, english: 'secretary', chinese: '祕書', exampleSentence: 'The secretary answered the phone.' },
  { id: 'p4-splendor', part: 4, english: 'splendor', chinese: '壯麗；輝煌', exampleSentence: 'We admired the splendor of the palace.' },
  { id: 'p4-stallion', part: 4, english: 'stallion', chinese: '種馬', exampleSentence: 'A black stallion ran across the field.' },
  { id: 'p4-suspicion', part: 4, english: 'suspicion', chinese: '懷疑', exampleSentence: 'Her strange story raised my suspicion.' },
  { id: 'p4-sycamore', part: 4, english: 'sycamore', chinese: '梧桐樹', exampleSentence: 'A tall sycamore shades our yard.' },
  { id: 'p4-sympathy', part: 4, english: 'sympathy', chinese: '同情', exampleSentence: 'She showed sympathy for the lost dog.' },
  { id: 'p4-thyme', part: 4, english: 'thyme', chinese: '百里香', exampleSentence: 'Add a little thyme to the soup.' },
  { id: 'p4-tobacco', part: 4, english: 'tobacco', chinese: '菸草', exampleSentence: 'Tobacco is very bad for your lungs.' },
  { id: 'p4-tremendous', part: 4, english: 'tremendous', chinese: '巨大的', exampleSentence: 'The storm made a tremendous noise.' },
  { id: 'p4-valuable', part: 4, english: 'valuable', chinese: '貴重的', exampleSentence: 'This old coin is very valuable.' },
  { id: 'p4-veterinarian', part: 4, english: 'veterinarian', chinese: '獸醫', exampleSentence: 'The veterinarian helped our sick cat.' },
  { id: 'p4-wilderness', part: 4, english: 'wilderness', chinese: '荒野', exampleSentence: 'They camped alone in the wilderness.' }
];

/* ⏳ 等 Allen 的每週單字（Week 1~18）——見檔頭的步驟 */
const WEEKS = [];

module.exports = {
  id: 'allen',
  label: 'Grade 4D',
  owner: 'Allen',
  // ⚠️ 定了就不要改（見檔頭）
  idPrefix: 'a',
  contestWords: CONTEST_WORDS,
  weeks: WEEKS
};
