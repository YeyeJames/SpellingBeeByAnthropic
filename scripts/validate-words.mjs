/**
 * 單字庫檢查。
 *
 * 這份資料是人手抄進來的三百多筆，抄錯不會有任何錯誤訊息——只會在孩子
 * 練習的時候，某個字突然沒有例句、或者例句裡根本沒出現那個字。
 * 所以用腳本把「抄寫時會犯的錯」全部釘住：
 *
 *   1. id 不重複（進度是靠 id 對應的，重複就會互相蓋掉）
 *   2. 同一組裡不會出現兩個一樣的英文（同一場戰鬥打到重複的字很怪）
 *   3. 每個字都有中文、有例句
 *   4. 例句一定包含那個單字本身（聽寫時例句是提示，沒有那個字就沒有用）
 *   5. 例句十二個字以內（太長的句子唸完，敵人已經走到面前了）
 *   6. 例句結尾有標點
 *   7. 每一組都有字，而且能打的字（純 a~z）不能太少
 *
 * 用法：node scripts/validate-words.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WORDS, GROUPS, MAX_GROUP_SIZE, listGroups, wordsByGroup, getWordById } = require('../server/data/word-bank.js');

const MAX_SENTENCE_WORDS = 12;
const MIN_TYPEABLE_PER_GROUP = 10;

const problems = [];
function problem(where, msg) {
  problems.push(`${where}：${msg}`);
}

/* ── 1. id 不重複 ────────────────────────────────────────── */
{
  const seen = new Map();
  for (const w of WORDS) {
    if (seen.has(w.id)) problem(w.id, `id 重複（${seen.get(w.id).english} / ${w.english}）`);
    seen.set(w.id, w);
  }
  console.log(`1) id 唯一性：${WORDS.length} 個字、${seen.size} 個不同的 id`);
}

/* ── 2. 同組內英文不重複 ─────────────────────────────────── */
{
  let dupes = 0;
  for (const g of GROUPS) {
    const seen = new Map();
    for (const w of wordsByGroup(g.id)) {
      const key = w.english.toLowerCase();
      if (seen.has(key)) {
        dupes += 1;
        problem(g.label, `"${w.english}" 在同一組出現兩次`);
      }
      seen.set(key, w);
    }
  }
  console.log(`2) 同組英文不重複：${dupes === 0 ? '沒有重複' : `${dupes} 筆重複`}`);
}

/* ── 3~6. 每個字自己的欄位 ───────────────────────────────── */
{
  let bad = 0;
  for (const w of WORDS) {
    const before = problems.length;

    if (!w.chinese || !w.chinese.trim()) problem(w.id, '沒有中文');
    if (!w.exampleSentence || !w.exampleSentence.trim()) {
      problem(w.id, '沒有例句');
    } else {
      const s = w.exampleSentence.trim();

      // 例句要包含單字本身。用字界比對，"cat" 不能靠 "catch" 蒙混過去。
      const needle = w.english.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`, 'i');
      if (!re.test(s)) problem(w.id, `例句裡沒有 "${w.english}"：${s}`);

      const wordCount = s.split(/\s+/).length;
      if (wordCount > MAX_SENTENCE_WORDS) {
        problem(w.id, `例句 ${wordCount} 個字，超過 ${MAX_SENTENCE_WORDS}：${s}`);
      }
      if (!/[.!?]$/.test(s)) problem(w.id, `例句結尾沒有標點：${s}`);
    }

    if (w.english !== w.english.toLowerCase()) problem(w.id, `英文不是小寫：${w.english}`);
    if (!/^[a-z][a-z' -]*$/.test(w.english)) problem(w.id, `英文有奇怪的字元：${w.english}`);
    if (getWordById(w.id) !== w) problem(w.id, '查不回自己（索引壞了）');

    if (problems.length > before) bad += 1;
  }
  console.log(`3) 欄位檢查：${bad === 0 ? '每個字都完整' : `${bad} 個字有問題`}`);
}

/* ── 6.5 切組不能動到 id ─────────────────────────────────
   一組太大時會切成 Week 11①／Week 11②，但 id 仍然用週次組出來。
   id 是「使用者進度」與「孩子的真人錄音」的對應鍵——改了不會有任何
   錯誤訊息，只會讓錄音默默變成孤兒，下次播出來又是機器語音。 */
{
  let bad = 0;
  for (const g of GROUPS) {
    if (g.kind !== 'week') continue;
    const week = g.id.replace(/[ab]$/, '');
    for (const w of wordsByGroup(g.id)) {
      if (!w.id.startsWith(`${week}-`)) {
        bad += 1;
        problem(w.id, `id 應該以 ${week}- 開頭（切組不能改 id）`);
      }
    }
  }
  console.log(`6) 切組後 id 仍然對應週次：${bad === 0 ? '沒問題' : `${bad} 個字的 id 跑掉了`}`);
}

/* ── 7. 每一組的規模 ─────────────────────────────────────── */
{
  console.log('\n每一組');
  for (const g of listGroups()) {
    const untypeable = wordsByGroup(g.id).filter((w) => !w.typeable);
    const note = untypeable.length
      ? `（${untypeable.length} 個不能打：${untypeable.map((w) => w.english).join('、')}）`
      : '';
    console.log(`  ${g.label.padEnd(8, ' ')} ${String(g.count).padStart(3, ' ')} 字 ${note}`);
    if (g.count === 0) problem(g.label, '這一組是空的');
    if (g.typeableCount < MIN_TYPEABLE_PER_GROUP) {
      problem(g.label, `能打的字只有 ${g.typeableCount} 個，不夠打一場`);
    }
    /*
     * 太大的組會讓他在中途放棄，而放棄的那一次會變成「這個東西很痛苦」
     * 的記憶。超過就該對半切（見 word-bank.js 的 MAX_GROUP_SIZE）。
     */
    if (g.count > MAX_GROUP_SIZE) {
      problem(g.label, `${g.count} 個字，一次練不完，應該對半切`);
    }
  }
  const total = GROUPS.reduce((a, g) => a + g.count, 0);
  const typeable = GROUPS.reduce((a, g) => a + g.typeableCount, 0);
  console.log(`  ${'合計'.padEnd(7, ' ')} ${String(total).padStart(3, ' ')} 字（能打的 ${typeable} 個）`);
  if (total !== WORDS.length) problem('合計', `分組加起來 ${total}，但單字庫有 ${WORDS.length} 個——有字沒被分到組`);
}

/* ── 結果 ────────────────────────────────────────────────── */
if (problems.length === 0) {
  console.log('\n全部通過');
  process.exit(0);
}
console.log(`\n有 ${problems.length} 個問題：`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);
