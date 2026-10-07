/**
 * Allen 的每週單字：Grade 5A Standard Course（Week 1~11）。
 *
 * 來源是課本的 Word List（2026-10 家長拍的 5 頁照片）。格式與規矩跟
 * Pierce 那一本（./weeks.js）一樣：
 *   - 每一週的 Phonics / Spelling / Reading Plus 合併成「一週一組」
 *   - 超過 40 字的週會自動切成上下兩半（Week 1①②、Week 6①②），id 不變
 *   - 資料是三元組 [英文, 中文, 例句]
 *   - 例句要包含那個單字本身、十二個英文字以內、句尾有標點
 *     （scripts/validate-words.mjs 逐條在管）
 *
 * 照片上的 Word List 只有 Week 1~7、9~11。Week 8 不在清單上（跟 Pierce 那本
 * 一樣是空的），不是漏掉。第 5 頁背面透出來的字看得出後面還有頁數
 * （Week 11 Reading Plus 之後），拿到時接在後面——**要在 Allen 開始打戰役之前
 * 一次補齊**，不然戰役的關卡內容會跟著變（docs/audit/step1 的 Q4）。
 *
 * 照課本原樣抄、但有幾格要說明：
 *   - Mexico、Venice 是專有名詞，這裡存小寫：單字庫一律小寫（判定不分大小寫），
 *     中文註明是地名
 *   - 「sharp(turn)」「capture(a scene)」「flat(writing)」：括號裡是課本給的
 *     用法提示，不是要拼的字。只考 sharp / capture / flat，提示寫進中文與例句
 *   - 「focus/ the focus」：同一個字的兩種用法，只考 focus
 *   - 「set limits」是片語，照原樣（空白鍵在遊戲裡就是一個字母）
 *   - Week 2 的 knock 課本列了兩次（KN 一次、CK 一次），同一組只留一筆
 *
 * 跨週重複的字（awful、caught 在 Week 5 與 11；mutter 在 Week 3 與 10；
 * struggle 在 Week 4 與 10）照課本保留——它們在不同組，id 也不同。
 */

const WEEKS = [
  {
    id: 'w01',
    label: 'Week 1',
    words: [
      // Phonics — Hard and Soft C & G
      ['attic', '閣樓', 'We keep our old toys in the attic.'],
      ['become', '變成', 'A caterpillar will become a butterfly.'],
      ['cereal', '穀片', 'I eat cereal with milk every morning.'],
      ['circus', '馬戲團', 'The circus came to our town last week.'],
      ['college', '大學', 'My cousin goes to college in Taipei.'],
      ['costume', '服裝；戲服', 'I wore a pirate costume to the party.'],
      ['decide', '決定', 'I cannot decide which book to read.'],
      ['experience', '經驗', 'Camping in the rain was a new experience.'],
      ['guessed', '猜（guess 的過去式）', 'I guessed the answer on my first try.'],
      ['gymnastics', '體操', 'She practices gymnastics after school.'],
      ['judges', '評審（複數）', 'The judges gave her the highest score.'],
      ['juggling', '雜耍；拋接', 'The clown is juggling three red balls.'],
      ['located', '位於', 'Our school is located near the park.'],
      ['mexico', '墨西哥（國名，寫的時候第一個字母大寫）', 'We flew to Mexico for our vacation.'],
      ['packages', '包裹（複數）', 'Two packages came in the mail today.'],
      ['popcorn', '爆米花', 'We ate popcorn at the movies.'],
      ['practice', '練習', 'I practice the piano every day.'],
      ['religious', '宗教的', 'Christmas is a religious holiday for many people.'],
      ['venice', '威尼斯（義大利城市，寫的時候第一個字母大寫）', 'Venice is a city full of canals.'],
      ['wagon', '四輪拖車', 'The kids pulled a red wagon up the hill.'],
      // Phonics — OLD, OST & IND
      ['almost', '幾乎', 'It is almost time for dinner.'],
      ['behind', '在後面', 'The cat is hiding behind the sofa.'],
      ['blind', '失明的', 'The blind man walks with a guide dog.'],
      ['ghost', '鬼', 'My brother dressed up as a ghost.'],
      ['host', '主人；主持人', 'The host welcomed us at the door.'],
      ['kind', '親切的；種類', 'It was kind of you to help me.'],
      ['most', '大多數；最', 'Most of my friends like soccer.'],
      ['post', '張貼；郵件', 'Please post the notice on the wall.'],
      ['remind', '提醒', 'Please remind me to call Grandma.'],
      ['scold', '責罵', 'Mom will scold me if I am late.'],
      // Spelling — Lesson 1
      ['blanket', '毯子', 'I sleep under a warm blanket.'],
      ['brass', '黃銅', 'The door has a shiny brass handle.'],
      ['cabin', '小木屋', 'We stayed in a cabin by the lake.'],
      ['cabinet', '櫥櫃', 'The cups are in the kitchen cabinet.'],
      ['castle', '城堡', 'The king lived in a stone castle.'],
      ['cancel', '取消', 'We had to cancel the picnic because of rain.'],
      ['catalog', '目錄', 'Mom ordered a lamp from the catalog.'],
      ['glance', '瞥一眼', 'She took a quick glance at the clock.'],
      ['jazz', '爵士樂', 'My dad likes to listen to jazz.'],
      ['lantern', '燈籠', 'We carried a lantern on the night walk.'],
      ['magnet', '磁鐵', 'The magnet picked up the small nails.'],
      ['paddle', '槳；划槳', 'We used a paddle to move the boat.'],
      ['palace', '宮殿', 'The queen lives in a huge palace.'],
      ['pansy', '三色堇', 'A purple pansy grew in the flower pot.'],
      ['salad', '沙拉', 'I made a fruit salad for lunch.'],
      ['sang', '唱（sing 的過去式）', 'We sang a song for our teacher.'],
      ['shampoo', '洗髮精', 'I wash my hair with shampoo.'],
      ['taxi', '計程車', 'We took a taxi to the airport.'],
      ['tractor', '拖拉機', 'The farmer drove a big green tractor.'],
      ['travel', '旅行', 'We like to travel by train.'],
      ['anchor', '錨', 'The sailors dropped the anchor into the sea.'],
      ['cassette', '卡式錄音帶', 'Grandpa still plays music on a cassette.'],
      ['handicap', '障礙；不利條件', 'He did not let his handicap stop him.'],
      ['handsome', '英俊的', 'The prince was tall and handsome.'],
      ['plaid', '格子花紋', 'He wore a red plaid shirt.'],
      // Reading Plus — It Was All a Dream
      ['commotion', '騷動', 'The fire alarm caused a big commotion.'],
      ['errands', '跑腿；差事（複數）', 'Mom ran some errands after work.'],
      ['interview', '訪問；面試', 'The reporter had an interview with the mayor.'],
      ['journalist', '記者', 'The journalist wrote a story about the storm.'],
      ['license', '執照', 'Dad showed his driver license to the officer.'],
      ['rouse', '喚醒', 'The loud bell will rouse me at six.'],
      ['set limits', '設下限制', 'My parents set limits on my screen time.']
    ]
  },
  {
    id: 'w02',
    label: 'Week 2',
    words: [
      // Phonics — Silent Consonants: WR & RH
      ['rhinestone', '水鑽；萊茵石', 'Her dress had a sparkly rhinestone on it.'],
      ['rhinoceros', '犀牛', 'A rhinoceros has a horn on its nose.'],
      ['rhododendrons', '杜鵑花（複數）', 'Pink rhododendrons bloom in our garden.'],
      ['rhubarb', '大黃（一種植物）', 'Grandma baked a rhubarb pie.'],
      ['rhyme', '押韻；韻文', 'Cat and hat rhyme with each other.'],
      ['wreck', '殘骸；毀壞', 'Divers found an old ship wreck.'],
      ['wren', '鷦鷯（一種小鳥）', 'A tiny wren built a nest in the tree.'],
      ['wrench', '扳手', 'Dad used a wrench to fix the bike.'],
      ['wring', '擰乾', 'Please wring out the wet towel.'],
      ['write', '寫', 'I write in my diary every night.'],
      // Phonics — Silent Consonants: KN, WH & SC
      ['knob', '門把；旋鈕', 'Turn the knob to open the door.'],
      ['knock', '敲', 'Please knock before you come in.'],
      ['knot', '結', 'I tied a knot in the rope.'],
      ['knowledge', '知識', 'Reading books gives us knowledge.'],
      ['scene', '場景', 'The last scene of the movie was sad.'],
      ['scent', '氣味；香味', 'The roses have a sweet scent.'],
      ['scientists', '科學家（複數）', 'The scientists studied the strange rock.'],
      ['scissors', '剪刀', 'Use the scissors to cut the paper.'],
      ['whole', '全部的；整個的', 'He ate the whole pizza by himself.'],
      ['whose', '誰的', 'Whose bag is on the floor?'],
      // Phonics — Silent Consonants: CK & MB
      // （課本在這一段又列了一次 knock，同一組只留上面那一筆）
      ['blocks', '積木；街區（複數）', 'The baby stacked the blocks into a tower.'],
      ['checklist', '檢查清單', 'I made a checklist for the trip.'],
      ['cracks', '裂縫（複數）', 'There are cracks in the old wall.'],
      ['crumbs', '碎屑（複數）', 'The birds ate the bread crumbs.'],
      ['lamb', '小羊', 'The little lamb followed its mother.'],
      ['limb', '四肢；大樹枝', 'A big limb fell from the tree.'],
      ['plumber', '水電工', 'The plumber fixed our leaking pipe.'],
      ['pocket', '口袋', 'I keep my keys in my pocket.'],
      ['quickly', '快速地', 'He finished his homework quickly.'],
      // Phonics — Silent Consonants: GN & GH
      ['bright', '明亮的', 'The sun is very bright today.'],
      ['cologne', '古龍水', 'Dad wears a little cologne to work.'],
      ['designed', '設計（design 的過去式）', 'She designed her own birthday card.'],
      ['drought', '乾旱', 'The long drought dried up the river.'],
      ['flight', '航班；飛行', 'Our flight leaves at eight tonight.'],
      ['foreign', '外國的', 'He can speak a foreign language.'],
      ['freight', '貨物；貨運', 'The freight train carried many boxes.'],
      ['night', '夜晚', 'The stars shine at night.'],
      ['sightseeing', '觀光', 'We went sightseeing in the old city.'],
      ['sign', '標誌；簽名', 'The sign says stop.']
    ]
  },
  {
    id: 'w03',
    label: 'Week 3',
    words: [
      // Spelling — Lesson 2
      ['bench', '長椅', 'We sat on a bench in the park.'],
      ['breath', '呼吸', 'Take a deep breath and relax.'],
      ['chest', '胸部；箱子', 'The pirate opened the treasure chest.'],
      ['edit', '編輯；修改', 'Please edit your story before you hand it in.'],
      ['enemy', '敵人', 'The cat is the enemy of the mouse.'],
      ['feather', '羽毛', 'A soft feather fell from the bird.'],
      ['freckles', '雀斑', 'She has freckles on her nose.'],
      ['health', '健康', 'Eating vegetables is good for your health.'],
      ['kennel', '狗屋', 'The puppy sleeps in a warm kennel.'],
      ['leather', '皮革', 'Dad has a brown leather jacket.'],
      ['meant', '意思是（mean 的過去式）', 'I meant to call you yesterday.'],
      ['plenty', '大量；充足', 'We have plenty of food for everyone.'],
      ['quest', '探索；追尋', 'The knight went on a long quest.'],
      ['sense', '感覺；道理', 'Dogs have a strong sense of smell.'],
      ['shelter', '避難所', 'We found shelter from the storm.'],
      ['sweater', '毛衣', 'Grandma knitted me a warm sweater.'],
      ['swept', '掃（sweep 的過去式）', 'I swept the floor after dinner.'],
      ['tennis', '網球', 'We play tennis on Saturday.'],
      ['wealth', '財富', 'The king had great wealth.'],
      ['welcome', '歡迎', 'Welcome to our new classroom.'],
      ['centipede', '蜈蚣', 'A centipede has many legs.'],
      ['necessary', '必要的', 'Water is necessary for all living things.'],
      ['pennant', '三角旗', 'Our team won the pennant this year.'],
      ['president', '總統；會長', 'The president gave a speech on TV.'],
      ['vegetables', '蔬菜（複數）', 'We grow vegetables in our garden.'],
      // Reading Plus — The Important Test
      ['mutter', '低聲抱怨', 'He began to mutter about the homework.'],
      ['gulp', '大口吞', 'I drank the water in one gulp.'],
      ['deadline', '截止期限', 'The deadline for the project is Friday.'],
      ['muffle', '使（聲音）減弱', 'The thick snow can muffle every sound.'],
      ['marker', '麥克筆', 'I drew a map with a blue marker.'],
      ['sharp', '急轉的（sharp turn）；銳利的', 'The road makes a sharp turn here.'],
      ['prospect', '前景；可能性', 'The prospect of a trip made me smile.'],
      ['anxious', '焦慮的', 'I felt anxious before the big test.'],
      ['represent', '代表', 'These stars represent the fifty states.'],
      ['clammy', '濕冷的', 'My hands felt clammy before the speech.']
    ]
  },
  {
    id: 'w04',
    label: 'Week 4',
    words: [
      // Reading Plus — A Success Story
      ['staff', '工作人員', 'The hotel staff were very kind to us.'],
      ['impressed', '印象深刻的', 'The teacher was impressed by my work.'],
      ['admiration', '欽佩', 'She looked at the athlete with admiration.'],
      ['athlete', '運動員', 'The athlete ran faster than everyone else.'],
      ['struggle', '奮鬥；掙扎', 'It was a struggle to finish the race.'],
      ['tip', '訣竅；小費', 'My coach gave me a useful tip.'],
      ['sympathetic', '同情的', 'My friend was sympathetic when I was sick.'],
      ['accepted', '接受（accept 的過去式）', 'She accepted the gift with a smile.'],
      ['crow', '烏鴉；（得意地）誇耀', 'A black crow sat on the fence.'],
      ['enthusiastic', '熱心的；熱情的', 'The fans were enthusiastic about the game.']
    ]
  },
  {
    id: 'w05',
    label: 'Week 5',
    words: [
      // Spelling — Lesson 3
      ['awful', '糟糕的', 'The weather was awful all weekend.'],
      ['bought', '買（buy 的過去式）', 'Mom bought me a new pair of shoes.'],
      ['broad', '寬的', 'The river is broad and deep.'],
      ['brought', '帶來（bring 的過去式）', 'I brought my lunch to school.'],
      ['caught', '抓住（catch 的過去式）', 'He caught the ball with one hand.'],
      ['cause', '原因；造成', 'Heavy rain can cause floods.'],
      ['collar', '衣領；項圈', 'The dog wears a red collar.'],
      ['comet', '彗星', 'We saw a comet in the night sky.'],
      ['common', '常見的', 'Colds are common in winter.'],
      ['congress', '國會', 'The congress will vote on the new law.'],
      ['fought', '打架；戰鬥（fight 的過去式）', 'The two kittens fought over the toy.'],
      ['jolly', '快活的', 'Santa is a jolly old man.'],
      ['otter', '水獺', 'An otter floated on its back.'],
      ['ought', '應該', 'You ought to say thank you.'],
      ['promise', '承諾', 'I promise to clean my room.'],
      ['prompt', '準時的；迅速的', 'Please be prompt for the meeting.'],
      ['proper', '適當的', 'Wear proper shoes for the hike.'],
      ['smog', '霧霾', 'Thick smog covered the city.'],
      ['thought', '想（think 的過去式）', 'I thought the test was easy.'],
      ['topic', '主題', 'The topic of my report is whales.'],
      ['colony', '殖民地；（動物的）群落', 'Ants live together in a large colony.'],
      ['crocodile', '鱷魚', 'The crocodile opened its huge mouth.'],
      ['honest', '誠實的', 'Always be honest with your friends.'],
      ['modern', '現代的', 'We live in a modern apartment.'],
      ['trombone', '長號', 'He plays the trombone in the band.'],
      // Reading Plus — Hopes Run High
      ['journalism', '新聞業', 'She wants to study journalism in college.'],
      ['pleased', '高興的', 'Mom was pleased with my report card.'],
      ['lift', '舉起', 'Can you help me lift this box?'],
      ['gallon', '加侖', 'We bought a gallon of milk.'],
      ['carton', '紙盒', 'Put the eggs back in the carton.'],
      ['stroll', '散步', 'We took a stroll in the park.'],
      ['issue', '問題；（刊物的）一期', 'The new issue of the magazine came today.'],
      ['assignment', '作業；任務', 'I finished my math assignment.']
    ]
  },
  {
    id: 'w06',
    label: 'Week 6',
    words: [
      // Phonics — Vowel Pairs: AI, AY, EI & EY
      ['acquainted', '認識的；熟悉的', 'We became acquainted at summer camp.'],
      ['braid', '辮子', 'She wears her hair in a braid.'],
      ['complain', '抱怨', 'Please do not complain about the food.'],
      ['containers', '容器（複數）', 'Put the leftovers in these containers.'],
      ['crayon', '蠟筆', 'I colored the sun with a yellow crayon.'],
      ['daily', '每天的', 'Walking is part of my daily routine.'],
      ['day', '一天', 'Today is a sunny day.'],
      ['delays', '延誤（複數）', 'Bad weather caused many delays.'],
      ['eight', '八', 'I wake up at eight on Sundays.'],
      ['entertain', '娛樂；招待', 'The clown will entertain the children.'],
      ['faith', '信心；信仰', 'I have faith in my team.'],
      ['neighbor', '鄰居', 'Our neighbor has a friendly dog.'],
      ['paints', '顏料；畫畫', 'She paints pictures of flowers.'],
      ['raise', '舉起；養育', 'Raise your hand if you know the answer.'],
      ['stays', '停留', 'My aunt stays with us every summer.'],
      ['strays', '流浪動物（複數）', 'The shelter takes care of strays.'],
      ['train', '火車；訓練', 'We took the train to the city.'],
      ['wait', '等待', 'Please wait for me at the gate.'],
      ['weigh', '稱重；重', 'How much does your dog weigh?'],
      ['grey', '灰色的', 'The sky was grey and cloudy.'],
      // Phonics — Vowel Pairs: EE, EA & EI
      ['ahead', '在前面', 'The library is just ahead of us.'],
      ['bean', '豆子', 'I planted a bean in a cup.'],
      ['bread', '麵包', 'Mom baked fresh bread this morning.'],
      ['committee', '委員會', 'The committee will meet tomorrow.'],
      ['each', '每一個', 'Each student has a desk.'],
      ['easy', '容易的', 'This puzzle is easy for me.'],
      ['healthy', '健康的', 'Fruit is a healthy snack.'],
      ['heavy', '重的', 'This box is too heavy to carry.'],
      ['keep', '保持；保存', 'Keep your room clean.'],
      ['meat', '肉', 'We grilled meat for dinner.'],
      ['read', '閱讀', 'I like to read before bed.'],
      ['receive', '收到', 'Did you receive my letter?'],
      ['seize', '抓住', 'Seize the chance when it comes.'],
      ['speeds', '速度；加速', 'The train speeds past our house.'],
      ['steel', '鋼', 'The bridge is made of steel.'],
      // Reading Plus — A New Assignment
      ['impatient', '不耐煩的', 'The impatient boy kept asking the time.'],
      ['edition', '版本', 'This is the first edition of the book.'],
      ['personal', '個人的', 'A diary is very personal.'],
      ['blurt', '脫口而出', 'Do not blurt out the answer.'],
      ['apologize', '道歉', 'You should apologize to your sister.'],
      ['shocked', '震驚的', 'We were shocked by the news.'],
      ['proceeds', '繼續進行；收益', 'The teacher proceeds with the lesson.'],
      ['unemployment', '失業', 'Unemployment went down this year.'],
      ['focus', '專注；焦點（the focus）', 'Focus on your work, please.'],
      ['capture', '捕捉（capture a scene 捕捉畫面）', 'She tried to capture the scene in a photo.'],
      ['midstream', '在河中央；在中途', 'The boat stopped in midstream.']
    ]
  },
  {
    id: 'w07',
    label: 'Week 7',
    words: [
      // Spelling — Lesson 4
      ['blizzard', '暴風雪', 'The blizzard closed every road in town.'],
      ['built', '建造（build 的過去式）', 'We built a sandcastle at the beach.'],
      ['crib', '嬰兒床', 'The baby sleeps in a crib.'],
      ['glimpse', '一瞥', 'I caught a glimpse of the deer.'],
      ['guilt', '內疚', 'He felt guilt after telling a lie.'],
      ['igloo', '冰屋', 'They built an igloo out of snow.'],
      ['imitate', '模仿', 'Parrots can imitate human voices.'],
      ['limit', '限制', 'The speed limit here is forty.'],
      ['lyrics', '歌詞', 'I know all the lyrics to this song.'],
      ['mystery', '謎；推理故事', 'The missing cookie is a mystery.'],
      ['myth', '神話', 'We read a Greek myth in class.'],
      ['shift', '移動；輪班', 'Please shift your chair to the left.'],
      ['simple', '簡單的', 'The rules of the game are simple.'],
      ['strict', '嚴格的', 'Our coach is strict but fair.'],
      ['system', '系統', 'The school has a new computer system.'],
      ['thrift', '節儉', 'Thrift helps you save money.'],
      ['twist', '扭轉', 'Twist the cap to open the bottle.'],
      ['visit', '拜訪', 'We visit Grandma every Sunday.'],
      ['whistle', '口哨', 'The coach blew his whistle.'],
      ['width', '寬度', 'Measure the width of the table.'],
      ['biscuit', '餅乾；比司吉', 'I had a biscuit with my tea.'],
      ['gymnast', '體操選手', 'The gymnast did a perfect flip.'],
      ['instinct', '本能', 'Birds fly south by instinct.'],
      ['mischief', '惡作劇', 'The puppy is always up to mischief.'],
      ['typical', '典型的', 'It was a typical rainy day.']
    ]
  },
  {
    id: 'w09',
    label: 'Week 9',
    words: [
      // Phonics — Vowel Pairs: OA, OW & OE
      ['below', '在下面', 'Write your name below the line.'],
      ['borrow', '借入', 'May I borrow your pencil?'],
      ['borrowed', '借入（borrow 的過去式）', 'I borrowed a book from the library.'],
      ['coach', '教練', 'Our coach is very proud of us.'],
      ['coast', '海岸', 'We drove along the coast.'],
      ['doe', '母鹿', 'A doe ran into the woods.'],
      ['groaned', '呻吟（groan 的過去式）', 'He groaned when he saw the homework.'],
      ['hoe', '鋤頭', 'Grandpa used a hoe in the garden.'],
      ['known', '知名的；know 的過去分詞', 'This town is known for its tea.'],
      ['oatmeal', '燕麥粥', 'I eat oatmeal for breakfast.'],
      ['roam', '漫遊', 'Wild horses roam across the plains.'],
      ['shadow', '影子', 'My shadow follows me everywhere.'],
      ['shallow', '淺的', 'The water here is shallow.'],
      ['show', '表演；給…看', 'Show me your new drawing.'],
      ['soaked', '濕透的', 'My shoes were soaked after the rain.'],
      ['tiptoed', '踮著腳走（tiptoe 的過去式）', 'I tiptoed past my sleeping sister.'],
      ['toad', '蟾蜍', 'A fat toad sat by the pond.'],
      ['toast', '吐司', 'I like butter on my toast.'],
      ['window', '窗戶', 'Please close the window.']
    ]
  },
  {
    id: 'w10',
    label: 'Week 10',
    words: [
      // Spelling — Lesson 5
      ['bulb', '燈泡；球莖', 'The light bulb in my room is broken.'],
      ['double', '兩倍的', 'I ate a double scoop of ice cream.'],
      ['study', '讀書；研究', 'I study English every evening.'],
      ['honey', '蜂蜜', 'Bees make sweet honey.'],
      ['mutter', '低聲抱怨', 'Do not mutter when you talk to me.'],
      ['hunger', '飢餓', 'Many people suffer from hunger.'],
      ['none', '沒有一個', 'None of the cookies are left.'],
      ['bundle', '一捆；一包', 'She carried a bundle of sticks.'],
      ['money', '錢', 'I saved money to buy a new book.'],
      ['bumblebee', '大黃蜂', 'A bumblebee landed on the flower.'],
      ['chuckle', '輕笑', 'Dad gave a little chuckle at my joke.'],
      ['country', '國家；鄉下', 'Japan is a beautiful country.'],
      ['struggle', '奮鬥；掙扎', 'The little bird began to struggle in the net.'],
      ['thunder', '雷', 'The thunder woke me up last night.'],
      ['glove', '手套', 'I lost one glove at the park.'],
      ['trumpet', '小號', 'He plays the trumpet in the band.'],
      ['rumble', '隆隆聲', 'I heard the rumble of thunder.'],
      ['clumsy', '笨手笨腳的', 'I am clumsy and often drop things.'],
      ['trouble', '麻煩', 'The naughty dog got into trouble.'],
      ['dusty', '滿是灰塵的', 'The old books were dusty.'],
      ['justice', '正義', 'The judge wants justice for everyone.'],
      ['govern', '治理', 'The king will govern the land.'],
      ['slumber', '睡眠', 'The baby fell into a deep slumber.'],
      ['structure', '結構；建築物', 'The bridge is a strong structure.'],
      ['customer', '顧客', 'The customer paid for her coffee.'],
      // Reading Plus — Tom Learns a Lesson
      ['method', '方法', 'This method helps me learn new words.'],
      ['reject', '拒絕', 'They may reject my idea.'],
      ['print', '印刷；列印', 'Please print this page for me.'],
      ['flat', '平淡的（flat writing 文筆平淡）', 'His story was flat and boring.'],
      ['benefit', '好處', 'Exercise is a great benefit to your health.'],
      ['grateful', '感激的', 'I am grateful for your help.'],
      ['point', '重點；要點', 'What is the point of this story?']
    ]
  },
  {
    id: 'w11',
    label: 'Week 11',
    words: [
      // Phonics — Vowel Pairs: OO, AU & AW
      ['automobile', '汽車', 'Grandpa drove an old automobile.'],
      ['autumn', '秋天', 'Leaves turn red in autumn.'],
      ['awful', '糟糕的', 'The medicine tasted awful.'],
      ['awkward', '尷尬的；笨拙的', 'There was an awkward silence in the room.'],
      ['because', '因為', 'I stayed home because I was sick.'],
      ['caught', '抓住（catch 的過去式）', 'The cat caught a mouse last night.'],
      ['crawl', '爬', 'Babies crawl before they walk.'],
      ['daughter', '女兒', 'Their daughter is five years old.'],
      ['dawn', '黎明', 'The birds sing at dawn.'],
      ['exhausted', '筋疲力盡的', 'I was exhausted after the race.'],
      ['gloom', '陰暗；憂鬱', 'The rainy day was full of gloom.'],
      ['hooked', '鉤住（hook 的過去式）', 'He hooked a big fish.'],
      ['looked', '看（look 的過去式）', 'She looked out of the window.'],
      ['paused', '暫停（pause 的過去式）', 'She paused to tie her shoe.'],
      ['pawed', '用爪子扒（paw 的過去式）', 'The cat pawed at the door.'],
      ['raccoons', '浣熊（複數）', 'Raccoons tipped over our trash can.'],
      ['shook', '搖動（shake 的過去式）', 'The dog shook water off its fur.'],
      ['spooky', '陰森可怕的', 'The old house looked spooky at night.'],
      ['taught', '教（teach 的過去式）', 'My uncle taught me to swim.'],
      ['waterproof', '防水的', 'My new watch is waterproof.'],
      // Phonics — Vowel Pairs: EW & UI
      ['blew', '吹（blow 的過去式）', 'The wind blew my hat away.'],
      ['bruised', '瘀傷（bruise 的過去式）', 'I bruised my knee on the desk.'],
      ['chew', '嚼', 'Chew your food slowly.'],
      ['crews', '工作人員（複數）', 'Two crews fixed the road.'],
      ['cruise', '乘船遊覽', 'We went on a cruise to Japan.'],
      ['dew', '露水', 'Dew covered the grass this morning.'],
      ['few', '一些；很少', 'I have a few friends in this class.'],
      ['fruit', '水果', 'Apples are my favorite fruit.'],
      ['jewelry', '珠寶', 'Mom keeps her jewelry in a box.'],
      ['juice', '果汁', 'I drink orange juice at breakfast.'],
      ['knew', '知道（know 的過去式）', 'I knew the answer right away.'],
      ['news', '新聞；消息', 'Did you hear the good news?'],
      ['nuisance', '討厭的人或事', 'The barking dog is a nuisance.'],
      ['stew', '燉菜', 'Grandma made beef stew for dinner.'],
      ['suit', '西裝；適合', 'Dad wore a suit to the wedding.'],
      ['suitable', '適合的', 'This movie is suitable for kids.'],
      ['view', '景色；觀點', 'The view from the hill is lovely.']
    ]
  }
];

module.exports = { WEEKS };
