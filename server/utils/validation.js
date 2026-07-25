const LIMITS = {
  englishMax: 40,
  chineseMax: 60,
  sentenceMax: 200,
  tagMax: 20,
  tagsMax: 8,
  answerMax: 40
};

function validateWordInput(input) {
  const errors = [];
  const english = (input.english || '').trim();
  const chinese = (input.chinese || '').trim();
  const exampleSentence = (input.exampleSentence || '').trim();
  const tags = normalizeTags(input.tags);

  if (!english) errors.push('請輸入英文單字');
  if (english.length > LIMITS.englishMax) errors.push(`英文單字不能超過 ${LIMITS.englishMax} 字`);
  if (!/^[A-Za-z' -]+$/.test(english)) errors.push('英文單字只能包含英文字母、空格、連字號、撇號');

  if (!chinese) errors.push('請輸入中文翻譯');
  if (chinese.length > LIMITS.chineseMax) errors.push(`中文翻譯不能超過 ${LIMITS.chineseMax} 字`);

  if (exampleSentence.length > LIMITS.sentenceMax) {
    errors.push(`例句不能超過 ${LIMITS.sentenceMax} 字`);
  }

  if (tags.length > LIMITS.tagsMax) errors.push(`標籤最多 ${LIMITS.tagsMax} 個`);
  if (tags.some((t) => t.length > LIMITS.tagMax)) errors.push(`每個標籤不能超過 ${LIMITS.tagMax} 字`);

  return {
    valid: errors.length === 0,
    errors,
    cleaned: { english, chinese, exampleSentence, tags }
  };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
}

module.exports = { validateWordInput, normalizeTags, LIMITS };
