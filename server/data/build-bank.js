/**
 * 把一份原始單字資料組成一個「單字庫」。
 *
 * 這段邏輯本來寫死在 word-bank.js 裡，只服務一個孩子。現在兩個孩子各有
 * 各的課本（Pierce 是 Grade 3A、Allen 另外一本），結構一樣但內容不同，
 * 所以把組裝的部分抽出來變成一個純函式，每一本課本各呼叫一次。
 *
 * ── ⚠️ id 前綴：為什麼非有不可 ────────────────────────────
 * 兩本課本都有「Week 1」，裡面也都可能有 path 這個字。如果兩邊的 id 都叫
 * `w01-path`，會出一個很難查的錯：
 *
 *   **錄音是跨帳號共用的**（wordAudio 只用 wordId 當鍵，這是刻意的設計——
 *   孩子錄過的聲音不該因為換帳號就聽不到）。兩本課本共用 id 的話，
 *   Pierce 錄的 path 會被播到 Allen 那個完全不同的字上面，
 *   而且不會有任何錯誤訊息。
 *
 * 所以每一本課本有自己的 id 命名空間。但是——
 *
 * **Pierce 那一本的 idPrefix 必須永遠是空字串。** 他的進度與錄音都已經
 * 存在資料庫裡、key 就是現在這些 id（`w01-path`、`p1-account`）。
 * 加了前綴等於把他既有的東西全部變成孤兒，一樣沒有錯誤訊息。
 * word-bank.js 開頭那條「id 一旦定下就不要更動」講的就是這件事。
 */

/*
 * 這個詞條打不打得出來。
 *
 * 空白與連字號都收（"alarm clock"、"high-pitched"）——遊戲的空白鍵就是
 * 一個字母，見 public/js/game/core/charset.js。這個旗標是為了擋住以後
 * 不小心抄進數字或奇怪符號的詞條，那種字按不出來，會讓他卡在原地。
 */
const TYPEABLE = /^[a-z][a-z '-]*$/;

/** 'alarm clock' → 'alarm-clock'，用來組 id。 */
function slug(english) {
  return english.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/*
 * 一組最多幾個字。
 *
 * 超過就對半切成上下兩半（Week 11 → Week 11①、Week 11②）。
 * 理由是一次要練完六十一個字，對小學生是一坐四十分鐘——他會在中間放棄，
 * 而放棄的那一次會變成「這個東西很痛苦」的記憶。切一半之後最大三十一個，
 * 跟競賽單字一組二十五個是同一個量級。
 *
 * 不用「隨機抽二十個」：那樣每次練到的字不一樣，永遠不會有一組真的練完，
 * 而「練到接近全對五六次就過關」正是靠固定的一組才成立。
 */
const MAX_GROUP_SIZE = 40;

/*
 * 切開之後 group 變了，但單字的 id 「不」變——id 仍然用週次組出來。
 *
 * id 是使用者進度與真人錄音的對應鍵。孩子已經為唸錯的字錄過自己的聲音，
 * 改 id 會讓那些錄音全部變成孤兒，而且不會有任何錯誤訊息。
 */
function splitWeek(week) {
  if (week.words.length <= MAX_GROUP_SIZE) {
    return [{ id: week.id, label: week.label, words: week.words, weekId: week.id }];
  }
  const half = Math.ceil(week.words.length / 2);
  return [
    { id: `${week.id}a`, label: `${week.label}①`, words: week.words.slice(0, half), weekId: week.id },
    { id: `${week.id}b`, label: `${week.label}②`, words: week.words.slice(half), weekId: week.id }
  ];
}

/**
 * 組一本單字庫。
 *
 * @param {string} id        這本課本的代號（例如 'g3a'）
 * @param {string} label     給人看的名字（例如 'Grade 3A'）
 * @param {string} owner     這本是誰在用的，只是說明用
 * @param {string} idPrefix  id 命名空間。**既有的那一本永遠是 ''**（見檔頭）
 * @param {Array}  contestWords 競賽單字，已經是完整物件（含 id / part）
 * @param {Array}  weeks     每週單字，格式見 words/weeks.js
 */
function buildBank({ id, label, owner = '', idPrefix = '', contestWords = [], weeks = [] }) {
  const pre = idPrefix ? `${idPrefix}-` : '';
  const decorate = (word, group) => ({
    ...word,
    bank: id,
    group,
    typeable: TYPEABLE.test(word.english)
  });

  /*
   * 競賽單字的 id 維持資料裡寫的那個，只加命名空間前綴。
   * 既有那一本 pre 是空字串，所以 id 完全不變。
   */
  const contest = contestWords.map((w) =>
    decorate({ ...w, id: `${pre}${w.id}` }, `${pre}p${w.part}`)
  );

  const weekGroups = weeks.flatMap(splitWeek).map((g) => ({
    ...g,
    id: `${pre}${g.id}`,
    weekId: `${pre}${g.weekId}`
  }));

  const weekly = weekGroups.flatMap((g) =>
    g.words.map(([english, chinese, exampleSentence]) =>
      decorate(
        // id 用週次（w11）而不是切開後的組（w11a）——見 splitWeek 上面的說明
        { id: `${g.weekId}-${slug(english)}`, part: null, english, chinese, exampleSentence },
        g.id
      )
    )
  );

  const words = [...contest, ...weekly];
  const parts = [...new Set(contestWords.map((w) => w.part))].sort((a, b) => a - b);

  const groups = [
    ...parts.map((part) => ({ id: `${pre}p${part}`, label: `Part ${part}`, kind: 'contest', part })),
    ...weekGroups.map((g) => ({ id: g.id, label: g.label, kind: 'week', part: null }))
  ].map((g) => {
    const gw = words.filter((w) => w.group === g.id);
    return {
      ...g,
      bank: id,
      count: gw.length,
      typeableCount: gw.filter((w) => w.typeable).length
    };
  });

  return {
    id,
    label,
    owner,
    idPrefix,
    parts,
    words,
    groups,
    /* 還沒有單字的課本（例如剛開好、還在等照片）要看得出來，不要當成壞掉 */
    ready: words.length > 0
  };
}

module.exports = { buildBank, MAX_GROUP_SIZE, TYPEABLE, slug };
