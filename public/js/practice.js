import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav, refreshNavCoins, setNavCoins } from './nav-partial.js';
import { playWordAudio } from './audio-player.js';
import * as sound from './sound-manager.js';
import { loadPhaser } from './game/load-phaser.js';
import { runPageInit } from './ui-status.js';
import { initOutbox, enqueue, onApplied } from './outbox.js';
import { readShared, writeShared, newId } from './local-store.js';

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
let currentUser = null;
let session = null; // { id, words, index, sessionCoins, streak }

async function whenSceneReady() {
  if (gameScene) return gameScene;

  // Phaser 與場景都在此時才載入：只有真的要練習才需要它們
  await loadPhaser();
  const { createPracticeGame } = await import('./game/practice-scene.js');

  return new Promise((resolve) => {
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

/** 頁面閒下來時先把 Phaser 抓進快取，等使用者按開始練習就不用等下載 */
function warmUpGameEngine() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => loadPhaser().catch(() => {}));
}

function renderTags(tags) {
  const checked = new Set([...tagCheckboxes.querySelectorAll('input:checked')].map((cb) => cb.value));
  tagCheckboxes.innerHTML = '';
  tags.forEach((tag) => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${escapeAttr(tag)}"${checked.has(tag) ? ' checked' : ''} /> ${escapeHtml(tag)}`;
    tagCheckboxes.appendChild(label);
  });
}

function refreshTags() {
  return api.get('/words/tags-list').then(({ tags }) => {
    writeShared('tags', tags);
    renderTags(tags);
  });
}

/**
 * 有快取就立刻畫出來並「直接返回」，更新丟到背景。
 * 關鍵是不能 await 網路——否則載入閘門會一直等到伺服器回應才放行，
 * 快取畫得再快也沒用。
 */
async function loadTags() {
  const cached = readShared('tags');
  if (cached) {
    renderTags(cached);
    refreshTags().catch(() => {});
    return;
  }
  await refreshTags();
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

  session = {
    id: newId(), // 由前端產生，作答紀錄在離線時也能先排隊
    words: data.words,
    index: 0,
    sessionCoins: 0,
    streak: (currentUser && currentUser.stats.currentStreak) || 0
  };
  showPanel(practicePanel);
  await whenSceneReady();
  showQuestion();
}

function renderReviewButton(count) {
  if (count > 0) {
    reviewBtn.textContent = `📋 複習到期單字 (${count})`;
    reviewBtn.classList.remove('hidden');
  } else {
    reviewBtn.classList.add('hidden');
  }
}

/** 同樣先用上次的數字顯示，實際數量在背景更新 */
async function refreshReviewButton({ background = false } = {}) {
  const cached = readShared('reviewCount');
  if (background && cached !== null) {
    renderReviewButton(cached);
    fetchReviewCount().catch(() => {});
    return;
  }
  await fetchReviewCount().catch(() => renderReviewButton(0));
}

async function fetchReviewCount() {
  const { words } = await api.get('/practice/review-queue');
  writeShared('reviewCount', words.length);
  renderReviewButton(words.length);
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

function normalizeAnswer(str) {
  return (str || '').trim().toLowerCase();
}

/**
 * 在本地判定對錯並立即給畫面回饋，作答紀錄丟進背景佇列補送。
 *
 * 為什麼可以在本地判定：出題時整個單字（含正確拼法）就已經傳到前端了，
 * 本地比對並沒有多洩漏任何資訊，卻可以省掉一次來回等待。
 * 伺服器收到後仍會自行重新判定，金幣與統計最終以伺服器為準。
 */
function submitAnswer() {
  if (answerInput.disabled) return;
  const word = session.words[session.index];
  const userAnswer = answerInput.value;
  answerInput.disabled = true;
  submitBtn.disabled = true;

  const correct = normalizeAnswer(userAnswer) === normalizeAnswer(word.english);

  // 用與伺服器相同的公式先算出金幣與連勝，讓畫面立刻有反應
  session.streak = correct ? session.streak + 1 : 0;
  const coinsAwarded = correct ? 10 + Math.floor(session.streak / 5) * 5 : 0;

  session.sessionCoins += coinsAwarded;
  sessionCoinBadge.textContent = `🪙 ${session.sessionCoins}`;
  if (coinsAwarded) refreshNavCoins(coinsAwarded);

  if (correct) {
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

  if (session.streak > 0 && session.streak % 5 === 0) {
    sound.playStreak();
    gameScene.reactStreak();
  }

  revealEnglish.textContent = `✏️ ${word.english}`;
  revealChinese.textContent = `🀄 ${word.chinese}`;
  revealSentence.textContent = word.exampleSentence ? `💬 ${word.exampleSentence}` : '';
  revealPanel.classList.remove('hidden');

  enqueue({
    kind: 'attempt',
    path: '/practice/attempt',
    body: {
      wordId: word._id,
      userAnswer,
      clientSessionId: session.id,
      attemptedAt: new Date().toISOString()
    }
  });
}

async function nextQuestion() {
  session.index += 1;
  if (session.index >= session.words.length) {
    finishSession();
    return;
  }
  await showQuestion();
}

function finishSession() {
  // 總結畫面用本地資料立刻顯示；作答紀錄由背景佇列負責送出
  summaryText.textContent = `這次練習了 ${session.words.length} 個單字，總共賺到 ${session.sessionCoins} 枚金幣！`;
  showPanel(summaryPanel);
  refreshReviewButton();
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

// 每筆作答成功送達後，用伺服器回傳的金幣數校正畫面。
// 本地與伺服器用同一套公式，正常情況下不會有差異；
// 若因為在別台裝置上也練習過而不一致，一律以伺服器為準。
onApplied('attempt', (result) => {
  if (result && typeof result.coins === 'number') {
    setNavCoins(result.coins);
    if (currentUser) {
      currentUser.coins = result.coins;
      if (result.stats) currentUser.stats = result.stats;
    }
  }
});

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  currentUser = user;
  initOutbox(user._id);
  // 三件事互不相依，平行處理，避免畫面元素一個接一個冒出來
  await Promise.all([mountNav(user, 'practice'), loadTags(), refreshReviewButton({ background: true })]);
  warmUpGameEngine();
});
