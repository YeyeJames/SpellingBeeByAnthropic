import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav, refreshNavCoins } from './nav-partial.js';
import { playWordAudio } from './audio-player.js';
import * as sound from './sound-manager.js';
import { createPracticeGame } from './game/practice-scene.js';
import { runPageInit } from './ui-status.js';

const setupPanel = document.getElementById('setup-panel');
const practicePanel = document.getElementById('practice-panel');
const summaryPanel = document.getElementById('summary-panel');
const tagCheckboxes = document.getElementById('tag-checkboxes');
const wordCountInput = document.getElementById('word-count');
const setupError = document.getElementById('setup-error');
const progressLabel = document.getElementById('progress-label');
const sessionCoinBadge = document.getElementById('session-coin-badge');
const answerInput = document.getElementById('answer-input');
const submitBtn = document.getElementById('submit-answer-btn');
const replayBtn = document.getElementById('replay-btn');
const revealPanel = document.getElementById('reveal-panel');
const revealResult = document.getElementById('reveal-result');
const revealEnglish = document.getElementById('reveal-english');
const revealChinese = document.getElementById('reveal-chinese');
const revealSentence = document.getElementById('reveal-sentence');
const nextBtn = document.getElementById('next-btn');
const summaryText = document.getElementById('summary-text');
const playAgainBtn = document.getElementById('play-again-btn');
const reviewBtn = document.getElementById('review-practice-btn');

let phaserGame = null;
let gameScene = null;
let session = null; // { id, words, index, sessionCoins }

function whenSceneReady() {
  return new Promise((resolve) => {
    if (gameScene) {
      resolve(gameScene);
      return;
    }
    window.addEventListener(
      'practice-scene-ready',
      () => {
        gameScene = phaserGame.scene.keys.PracticeScene;
        resolve(gameScene);
      },
      { once: true }
    );
    phaserGame = createPracticeGame('game-container');
  });
}

async function loadTags() {
  const { tags } = await api.get('/words/tags-list');
  tagCheckboxes.innerHTML = '';
  tags.forEach((tag) => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${escapeAttr(tag)}" /> ${escapeHtml(tag)}`;
    tagCheckboxes.appendChild(label);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function showPanel(panel) {
  [setupPanel, practicePanel, summaryPanel].forEach((p) => p.classList.add('hidden'));
  panel.classList.remove('hidden');
}

async function startPractice({ reviewOnly = false } = {}) {
  setupError.textContent = '';
  const selectedTags = [...tagCheckboxes.querySelectorAll('input:checked')].map((cb) => cb.value);
  const count = Number(wordCountInput.value) || 10;

  sound.startBgm();

  let data;
  try {
    data = await api.post('/practice/session', { tags: selectedTags, count, reviewOnly });
  } catch (err) {
    setupError.textContent = err.message;
    return;
  }

  session = { id: data.session._id, words: data.words, index: 0, sessionCoins: 0 };
  showPanel(practicePanel);
  await whenSceneReady();
  showQuestion();
}

async function refreshReviewButton() {
  try {
    const { words } = await api.get('/practice/review-queue');
    if (words.length > 0) {
      reviewBtn.textContent = `📋 複習到期單字 (${words.length})`;
      reviewBtn.classList.remove('hidden');
    } else {
      reviewBtn.classList.add('hidden');
    }
  } catch (err) {
    reviewBtn.classList.add('hidden');
  }
}

async function showQuestion() {
  const word = session.words[session.index];
  progressLabel.textContent = `${session.index + 1} / ${session.words.length}`;
  sessionCoinBadge.textContent = `🪙 ${session.sessionCoins}`;
  answerInput.value = '';
  answerInput.disabled = false;
  submitBtn.disabled = false;
  revealPanel.classList.add('hidden');
  answerInput.focus();

  gameScene.reactListening();
  await playWordAudio(word);
}

async function submitAnswer() {
  if (answerInput.disabled) return;
  const word = session.words[session.index];
  const userAnswer = answerInput.value;
  answerInput.disabled = true;
  submitBtn.disabled = true;

  let result;
  try {
    result = await api.post(`/practice/session/${session.id}/attempt`, {
      wordId: word._id,
      userAnswer
    });
  } catch (err) {
    setupError.textContent = err.message;
    answerInput.disabled = false;
    submitBtn.disabled = false;
    return;
  }

  session.sessionCoins += result.coinsAwarded;
  sessionCoinBadge.textContent = `🪙 ${session.sessionCoins}`;
  refreshNavCoins(result.coinsAwarded);

  if (result.correct) {
    sound.playCorrect();
    gameScene.reactCorrect();
    revealResult.textContent = '🎉 答對了！';
    revealResult.style.color = 'var(--color-success)';
  } else {
    sound.playIncorrect();
    gameScene.reactIncorrect();
    revealResult.textContent = '再加油一下！';
    revealResult.style.color = 'var(--color-danger)';
  }

  if (result.currentStreak > 0 && result.currentStreak % 5 === 0) {
    sound.playStreak();
    gameScene.reactStreak();
  }

  revealEnglish.textContent = `✏️ ${result.correctSpelling}`;
  revealChinese.textContent = `🀄 ${result.chinese}`;
  revealSentence.textContent = result.exampleSentence ? `💬 ${result.exampleSentence}` : '';
  revealPanel.classList.remove('hidden');
}

async function nextQuestion() {
  session.index += 1;
  if (session.index >= session.words.length) {
    await finishSession();
    return;
  }
  await showQuestion();
}

async function finishSession() {
  await api.post(`/practice/session/${session.id}/complete`);
  summaryText.textContent = `這次練習了 ${session.words.length} 個單字，總共賺到 ${session.sessionCoins} 枚金幣！`;
  showPanel(summaryPanel);
  await refreshReviewButton();
}

document.getElementById('start-practice-btn').addEventListener('click', () => {
  sound.playClick();
  startPractice();
});
reviewBtn.addEventListener('click', () => {
  sound.playClick();
  startPractice({ reviewOnly: true });
});
submitBtn.addEventListener('click', () => {
  sound.playClick();
  submitAnswer();
});
answerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAnswer();
});
replayBtn.addEventListener('click', () => {
  sound.playClick();
  playWordAudio(session.words[session.index]);
});
nextBtn.addEventListener('click', () => {
  sound.playClick();
  nextQuestion();
});
playAgainBtn.addEventListener('click', () => {
  sound.playClick();
  showPanel(setupPanel);
  refreshReviewButton();
});

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  // 三件事互不相依，平行處理，避免畫面元素一個接一個冒出來
  await Promise.all([mountNav(user, 'practice'), loadTags(), refreshReviewButton()]);
});
