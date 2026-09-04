/**
 * Spelling Bee Grade 3A 競賽單字庫（100 字，Part 1~4 各 25 字）。
 *
 * 這份清單是寫死在程式碼裡的，不存資料庫、也不從網頁新增。
 * 要增修單字就直接改這個檔案再重新部署——競賽範圍是固定的，
 * 這樣比開一個新增介面單純，也不會被誤刪或改錯。
 *
 * id 一旦定下就不要更動：使用者的答題進度是靠它對應的，改了會讓進度對不上。
 */

const WORDS = [
  // ── Part 1 ──────────────────────────────────────────────
  { id: 'p1-account', part: 1, english: 'account', chinese: '帳戶；說明', exampleSentence: 'I opened a bank account to save my money.' },
  { id: 'p1-addition', part: 1, english: 'addition', chinese: '加法；增加', exampleSentence: 'We learned addition in math class today.' },
  { id: 'p1-announce', part: 1, english: 'announce', chinese: '宣布', exampleSentence: 'The teacher will announce the winner tomorrow.' },
  { id: 'p1-approach', part: 1, english: 'approach', chinese: '接近；方法', exampleSentence: 'The train will approach the station soon.' },
  { id: 'p1-apron', part: 1, english: 'apron', chinese: '圍裙', exampleSentence: 'Mom wears an apron when she cooks dinner.' },
  { id: 'p1-arrest', part: 1, english: 'arrest', chinese: '逮捕', exampleSentence: 'The police will arrest the man who stole the bike.' },
  { id: 'p1-attack', part: 1, english: 'attack', chinese: '攻擊', exampleSentence: 'The little dog tried to attack my shoe.' },
  { id: 'p1-avocado', part: 1, english: 'avocado', chinese: '酪梨', exampleSentence: 'I like to eat avocado on my toast.' },
  { id: 'p1-bagpipe', part: 1, english: 'bagpipe', chinese: '風笛', exampleSentence: 'He played the bagpipe in the parade.' },
  { id: 'p1-bamboo', part: 1, english: 'bamboo', chinese: '竹子', exampleSentence: 'Pandas love to eat fresh bamboo.' },
  { id: 'p1-basement', part: 1, english: 'basement', chinese: '地下室', exampleSentence: 'We keep our bikes in the basement.' },
  { id: 'p1-beagle', part: 1, english: 'beagle', chinese: '米格魯（獵犬）', exampleSentence: 'Our beagle has long ears and a loud bark.' },
  { id: 'p1-behold', part: 1, english: 'behold', chinese: '看見；注視', exampleSentence: 'Behold, the sun is rising over the hill!' },
  { id: 'p1-billboard', part: 1, english: 'billboard', chinese: '廣告看板', exampleSentence: 'A huge billboard showed a picture of a burger.' },
  { id: 'p1-bookcase', part: 1, english: 'bookcase', chinese: '書櫃', exampleSentence: 'My bookcase is full of comic books.' },
  { id: 'p1-brief', part: 1, english: 'brief', chinese: '簡短的', exampleSentence: 'The teacher gave us a brief break.' },
  { id: 'p1-broad', part: 1, english: 'broad', chinese: '寬闊的', exampleSentence: 'The river is very broad here.' },
  { id: 'p1-buttermilk', part: 1, english: 'buttermilk', chinese: '酪乳；白脫牛奶', exampleSentence: 'Grandma uses buttermilk to make pancakes.' },
  { id: 'p1-capitalize', part: 1, english: 'capitalize', chinese: '用大寫字母寫', exampleSentence: 'Remember to capitalize the first letter of your name.' },
  { id: 'p1-catnip', part: 1, english: 'catnip', chinese: '貓薄荷', exampleSentence: 'My cat gets excited when she smells catnip.' },
  { id: 'p1-cease', part: 1, english: 'cease', chinese: '停止', exampleSentence: 'The rain did not cease until noon.' },
  { id: 'p1-chapter', part: 1, english: 'chapter', chinese: '章節', exampleSentence: 'I read one chapter of my book every night.' },
  { id: 'p1-charm', part: 1, english: 'charm', chinese: '魅力；小飾物', exampleSentence: 'She wears a lucky charm on her bracelet.' },
  { id: 'p1-churn', part: 1, english: 'churn', chinese: '攪拌（製作奶油）', exampleSentence: 'Long ago, people had to churn milk into butter.' },
  { id: 'p1-clever', part: 1, english: 'clever', chinese: '聰明的', exampleSentence: 'My little sister is very clever at puzzles.' },

  // ── Part 2 ──────────────────────────────────────────────
  { id: 'p2-colony', part: 2, english: 'colony', chinese: '群體；殖民地', exampleSentence: 'An ant colony lives under our garden.' },
  { id: 'p2-combine', part: 2, english: 'combine', chinese: '結合；混合', exampleSentence: 'Combine the eggs and flour in a big bowl.' },
  { id: 'p2-comfortable', part: 2, english: 'comfortable', chinese: '舒服的', exampleSentence: 'This old chair is very comfortable.' },
  { id: 'p2-compare', part: 2, english: 'compare', chinese: '比較', exampleSentence: 'Let us compare our answers after the test.' },
  { id: 'p2-complete', part: 2, english: 'complete', chinese: '完成；完整的', exampleSentence: 'I will complete my homework before dinner.' },
  { id: 'p2-condition', part: 2, english: 'condition', chinese: '狀況；條件', exampleSentence: 'My old bike is still in good condition.' },
  { id: 'p2-consent', part: 2, english: 'consent', chinese: '同意', exampleSentence: 'You need your parents to give consent for the trip.' },
  { id: 'p2-construct', part: 2, english: 'construct', chinese: '建造', exampleSentence: 'The workers will construct a new bridge.' },
  { id: 'p2-content', part: 2, english: 'content', chinese: '內容；滿足的', exampleSentence: 'The cat looks content sleeping in the sun.' },
  { id: 'p2-couple', part: 2, english: 'couple', chinese: '一對；兩個', exampleSentence: 'I ate a couple of cookies after school.' },
  { id: 'p2-crater', part: 2, english: 'crater', chinese: '火山口；坑洞', exampleSentence: 'The moon has a big crater on its surface.' },
  { id: 'p2-creature', part: 2, english: 'creature', chinese: '生物', exampleSentence: 'The whale is the largest creature in the sea.' },
  { id: 'p2-delight', part: 2, english: 'delight', chinese: '高興；喜悅', exampleSentence: 'The puppy jumped with delight.' },
  { id: 'p2-depend', part: 2, english: 'depend', chinese: '依靠', exampleSentence: 'Baby birds depend on their mother for food.' },
  { id: 'p2-display', part: 2, english: 'display', chinese: '展示', exampleSentence: 'The store will display new toys in the window.' },
  { id: 'p2-electric', part: 2, english: 'electric', chinese: '電的', exampleSentence: 'We ride an electric bus to school.' },
  { id: 'p2-entrap', part: 2, english: 'entrap', chinese: '誘捕；使陷入', exampleSentence: "The spider's web can entrap small flies." },
  { id: 'p2-everybody', part: 2, english: 'everybody', chinese: '每個人', exampleSentence: 'Everybody in my class likes music.' },
  { id: 'p2-explode', part: 2, english: 'explode', chinese: '爆炸', exampleSentence: 'The balloon will explode if you blow too hard.' },
  { id: 'p2-familiar', part: 2, english: 'familiar', chinese: '熟悉的', exampleSentence: 'That song sounds familiar to me.' },
  { id: 'p2-favorite', part: 2, english: 'favorite', chinese: '最喜愛的', exampleSentence: 'Blue is my favorite color.' },
  { id: 'p2-feature', part: 2, english: 'feature', chinese: '特色；特徵', exampleSentence: 'The best feature of our park is the big slide.' },
  { id: 'p2-freedom', part: 2, english: 'freedom', chinese: '自由', exampleSentence: 'The bird enjoyed its freedom in the sky.' },
  { id: 'p2-funnel', part: 2, english: 'funnel', chinese: '漏斗', exampleSentence: 'Use a funnel to pour the juice into the bottle.' },
  { id: 'p2-grace', part: 2, english: 'grace', chinese: '優雅', exampleSentence: 'The dancer moved with grace.' },

  // ── Part 3 ──────────────────────────────────────────────
  { id: 'p3-grunt', part: 3, english: 'grunt', chinese: '咕噥；哼聲', exampleSentence: 'The pig gave a loud grunt.' },
  { id: 'p3-hobby', part: 3, english: 'hobby', chinese: '嗜好', exampleSentence: 'My hobby is collecting stamps.' },
  { id: 'p3-hospital', part: 3, english: 'hospital', chinese: '醫院', exampleSentence: 'The nurse works at the hospital near my house.' },
  { id: 'p3-human', part: 3, english: 'human', chinese: '人類', exampleSentence: 'A dog can hear much better than a human.' },
  { id: 'p3-improve', part: 3, english: 'improve', chinese: '改善；進步', exampleSentence: 'I practice every day to improve my spelling.' },
  { id: 'p3-include', part: 3, english: 'include', chinese: '包括', exampleSentence: 'Please include your name on the paper.' },
  { id: 'p3-invite', part: 3, english: 'invite', chinese: '邀請', exampleSentence: 'I will invite ten friends to my party.' },
  { id: 'p3-jacket', part: 3, english: 'jacket', chinese: '夾克', exampleSentence: 'Put on your jacket; it is cold outside.' },
  { id: 'p3-knock', part: 3, english: 'knock', chinese: '敲', exampleSentence: 'Please knock before you open the door.' },
  { id: 'p3-latter', part: 3, english: 'latter', chinese: '後者', exampleSentence: 'I like apples and pears, but I prefer the latter.' },
  { id: 'p3-leaning', part: 3, english: 'leaning', chinese: '傾斜的', exampleSentence: 'The leaning tree almost touches the ground.' },
  { id: 'p3-library', part: 3, english: 'library', chinese: '圖書館', exampleSentence: 'I borrowed three books from the library.' },
  { id: 'p3-lobster', part: 3, english: 'lobster', chinese: '龍蝦', exampleSentence: 'The lobster has two big claws.' },
  { id: 'p3-locate', part: 3, english: 'locate', chinese: '找出位置', exampleSentence: 'Can you locate Taiwan on the map?' },
  { id: 'p3-locket', part: 3, english: 'locket', chinese: '小盒項鍊', exampleSentence: 'She keeps a tiny photo inside her locket.' },
  { id: 'p3-madness', part: 3, english: 'madness', chinese: '瘋狂', exampleSentence: 'The crowd cheered with madness when our team won.' },
  { id: 'p3-matching', part: 3, english: 'matching', chinese: '相配的', exampleSentence: 'We wore matching hats to the game.' },
  { id: 'p3-model', part: 3, english: 'model', chinese: '模型；模範', exampleSentence: 'He built a model airplane out of paper.' },
  { id: 'p3-needle', part: 3, english: 'needle', chinese: '針', exampleSentence: 'Be careful with that sharp needle.' },
  { id: 'p3-owe', part: 3, english: 'owe', chinese: '欠', exampleSentence: 'I owe my brother five dollars.' },
  { id: 'p3-panther', part: 3, english: 'panther', chinese: '黑豹', exampleSentence: 'A black panther moved quietly through the jungle.' },
  { id: 'p3-perfect', part: 3, english: 'perfect', chinese: '完美的', exampleSentence: 'Today is a perfect day for a picnic.' },
  { id: 'p3-plastic', part: 3, english: 'plastic', chinese: '塑膠', exampleSentence: 'We should use fewer plastic bags.' },
  { id: 'p3-pour', part: 3, english: 'pour', chinese: '倒；灌', exampleSentence: 'Please pour the milk into my cup.' },
  { id: 'p3-prison', part: 3, english: 'prison', chinese: '監獄', exampleSentence: 'The thief was sent to prison.' },

  // ── Part 4 ──────────────────────────────────────────────
  { id: 'p4-quest', part: 4, english: 'quest', chinese: '探索；追尋', exampleSentence: 'The knight went on a quest to find the treasure.' },
  { id: 'p4-range', part: 4, english: 'range', chinese: '範圍；山脈', exampleSentence: 'A wide range of animals live in the forest.' },
  { id: 'p4-rank', part: 4, english: 'rank', chinese: '等級；排名', exampleSentence: 'Our team moved up one rank this week.' },
  { id: 'p4-recall', part: 4, english: 'recall', chinese: '回想起', exampleSentence: 'I cannot recall where I put my keys.' },
  { id: 'p4-remind', part: 4, english: 'remind', chinese: '提醒', exampleSentence: 'Please remind me to feed the fish.' },
  { id: 'p4-scale', part: 4, english: 'scale', chinese: '磅秤；比例；鱗片', exampleSentence: 'The nurse asked me to stand on the scale.' },
  { id: 'p4-scrapbook', part: 4, english: 'scrapbook', chinese: '剪貼簿', exampleSentence: 'I put all my photos in a scrapbook.' },
  { id: 'p4-shiny', part: 4, english: 'shiny', chinese: '閃亮的', exampleSentence: 'My new shoes are black and shiny.' },
  { id: 'p4-solid', part: 4, english: 'solid', chinese: '固體的；堅固的', exampleSentence: 'Ice is water in a solid form.' },
  { id: 'p4-spruce', part: 4, english: 'spruce', chinese: '雲杉', exampleSentence: 'A tall spruce grows beside our house.' },
  { id: 'p4-stray', part: 4, english: 'stray', chinese: '流浪的；走失的', exampleSentence: 'We found a stray cat behind the school.' },
  { id: 'p4-tender', part: 4, english: 'tender', chinese: '溫柔的；柔軟的', exampleSentence: 'The meat is soft and tender.' },
  { id: 'p4-terror', part: 4, english: 'terror', chinese: '恐懼', exampleSentence: 'The loud noise filled the little boy with terror.' },
  { id: 'p4-thunder', part: 4, english: 'thunder', chinese: '雷', exampleSentence: 'The thunder woke me up last night.' },
  { id: 'p4-tower', part: 4, english: 'tower', chinese: '塔', exampleSentence: 'We climbed to the top of the tower.' },
  { id: 'p4-twine', part: 4, english: 'twine', chinese: '細繩', exampleSentence: 'She tied the box with a piece of twine.' },
  { id: 'p4-twirl', part: 4, english: 'twirl', chinese: '旋轉', exampleSentence: 'The dancer began to twirl on the stage.' },
  { id: 'p4-unto', part: 4, english: 'unto', chinese: '對；向（古語）', exampleSentence: 'The king spoke unto his people.' },
  { id: 'p4-upper', part: 4, english: 'upper', chinese: '上面的', exampleSentence: 'My room is on the upper floor.' },
  { id: 'p4-upset', part: 4, english: 'upset', chinese: '難過的；使不安', exampleSentence: 'Do not be upset about such a small mistake.' },
  { id: 'p4-upstairs', part: 4, english: 'upstairs', chinese: '樓上', exampleSentence: 'My bedroom is upstairs.' },
  { id: 'p4-vanish', part: 4, english: 'vanish', chinese: '消失', exampleSentence: 'The magician made the coin vanish.' },
  { id: 'p4-westward', part: 4, english: 'westward', chinese: '向西', exampleSentence: 'The birds flew westward for the winter.' },
  { id: 'p4-worth', part: 4, english: 'worth', chinese: '值得；價值', exampleSentence: 'This old coin is worth a lot of money.' },
  { id: 'p4-written', part: 4, english: 'written', chinese: '書寫的（write 的過去分詞）', exampleSentence: 'The letter was written by my grandma.' }
];

const PARTS = [1, 2, 3, 4];

const BY_ID = new Map(WORDS.map((w) => [w.id, w]));

function allWords() {
  return WORDS;
}

function wordsByPart(part) {
  return WORDS.filter((w) => w.part === Number(part));
}

function getWordById(id) {
  return BY_ID.get(id) || null;
}

module.exports = { WORDS, PARTS, allWords, wordsByPart, getWordById };
