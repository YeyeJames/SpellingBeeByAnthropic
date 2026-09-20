/**
 * 校準畫面（Phase 1.6）。
 *
 * 第一次玩的時候先出現，用三個一定會拼的短字量手速，然後建議難度。
 * 建議完一定給他改的機會——量測只是起點，不是判決。
 *
 * 用 DOM 而不是畫在 Phaser 裡：這是選單不是遊戲，而且 DOM 的成本
 * 不會算進遊戲的影格預算，之後量效能才不會被它干擾。
 */

import { CALIBRATION_WORDS, computeIntervals, suggestDifficulty, describeSuggestion } from './core/calibration.js';

const DIFFICULTY_LABELS = { easy: '輕鬆', normal: '標準', hard: '挑戰' };

export function runCalibration({ onDone }) {
  const el = document.getElementById('calibrate');
  const wordEl = document.getElementById('calibrate-word');
  const typedEl = document.getElementById('calibrate-typed');
  const progressEl = document.getElementById('calibrate-progress');
  const resultEl = document.getElementById('calibrate-result');
  const promptEl = document.getElementById('calibrate-prompt');
  const choiceEl = document.getElementById('calibrate-choice');
  if (!el) {
    onDone(null);
    return;
  }

  el.hidden = false;
  resultEl.hidden = true;
  choiceEl.hidden = true;

  let wordIndex = 0;
  let typed = 0;
  const keyTimes = CALIBRATION_WORDS.map(() => []);

  function renderWord() {
    const word = CALIBRATION_WORDS[wordIndex];
    wordEl.textContent = word.toUpperCase();
    typedEl.textContent = word.slice(0, typed).toUpperCase();
    progressEl.textContent = `${wordIndex + 1} / ${CALIBRATION_WORDS.length}`;
  }

  function finish() {
    window.removeEventListener('keydown', onKey);
    const intervals = computeIntervals(keyTimes);
    const result = suggestDifficulty(intervals);
    const desc = describeSuggestion(result);

    /*
     * 量完就把題目收起來。
     *
     * 不收的話畫面會停在「BOOK / BOO / 3 of 3」，看起來像還在等他打字，
     * 但其實已經量完了——最後一個字母按下去的那一刻就結束了。
     */
    promptEl.hidden = true;
    wordEl.textContent = '';
    typedEl.textContent = '';
    progressEl.textContent = '';
    resultEl.hidden = false;
    choiceEl.hidden = false;
    document.getElementById('calibrate-label').textContent = desc.label;
    document.getElementById('calibrate-detail').textContent = desc.detail;

    // 把建議的那一顆標起來，但三顆都能按——量測是起點不是判決
    choiceEl.querySelectorAll('[data-difficulty]').forEach((btn) => {
      btn.classList.toggle('is-suggested', btn.dataset.difficulty === result.difficulty);
      btn.onclick = () => {
        el.hidden = true;
        onDone({ ...result, difficulty: btn.dataset.difficulty, chosen: btn.dataset.difficulty });
      };
    });
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;
    const ch = e.key.toLowerCase();
    if (ch < 'a' || ch > 'z') return;
    e.preventDefault();

    const word = CALIBRATION_WORDS[wordIndex];
    if (ch !== word[typed]) return; // 打錯就是不接受，不扣任何東西也不記時間

    keyTimes[wordIndex].push(performance.now());
    typed += 1;

    if (typed >= word.length) {
      wordIndex += 1;
      typed = 0;
      if (wordIndex >= CALIBRATION_WORDS.length) {
        finish();
        return;
      }
    }
    renderWord();
  }

  renderWord();
  window.addEventListener('keydown', onKey);

  // 觸控裝置要先點一下才叫得出鍵盤
  el.addEventListener('click', () => {
    document.querySelector('.touch-input')?.focus();
  });
}

export { DIFFICULTY_LABELS };
