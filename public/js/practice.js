import { api } from './api.js';
import { requireLogin } from './auth.js';
import { mountNav, refreshNavCoins, setNavCoins, getNavCoins } from './nav-partial.js';
import {
  playWordAudio,
  speakSentence,
  playCompetitionSequence,
  stopSpeaking,
  warmUpSpeech
} from './audio-player.js';
import * as sound from './sound-manager.js';
import { loadPhaser } from './game/load-phaser.js';
import { runPageInit } from './ui-status.js';
import { initOutbox, enqueue, onApplied } from './outbox.js';
import { readUser, writeUser, newId } from './local-store.js';
import { coinsForCorrectAnswer } from './shared/coins.js';
import { track } from './telemetry.js';
import { readPref, writePref } from './prefs.js';
import { isAnswerCorrect } from './shared/answer-match.js';

const setupPanel = document.getElementById('setup-panel');
const practicePanel = document.getElementById('practice-panel');
const summaryPanel = document.getElementById('summary-panel');
const partPicker = document.getElementById('part-picker');
const setupError = document.getElementById('setup-error');
const progressLabel = document.getElementById('progress-label');
const sessionCoinBadge = document.getElementById('session-coin-badge');
const answerInput = document.getElementById('answer-input');
const submitBtn = document.getElementById('submit-answer-btn');
const replayBtn = document.getElementById('replay-btn');
const slowBtn = document.getElementById('slow-btn');
const sentenceBtn = document.getElementById('sentence-btn');
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
let readMode = 'word';

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

/*
 * 要練哪一組。清單由後端給（Part 1~4 是競賽單字，Week 1~10 是課本每週單字），
 * 這裡不自己寫死——以後加 Week 11 只要改資料。
 *
 */
let groups = [];
let selectedGroup = null;

/*
 * 每一組練了幾次、解鎖了沒有。
 *
 * 這是「這個帳號」的進度：哥哥練過不等於弟弟練過。以 groupId 為鍵，
 * 拿不到（離線、剛換帳號）時是空的，畫面就只是少標記號，不會壞掉。
 */
let progress = {};
// 真正的數字由伺服器給（GroupProgress.UNLOCK_AFTER_COMPLETIONS）；這只是拿到之前的預設
let unlockAfter = 1;

function progressFor(groupId) {
  return progress[groupId] || { practiceCompletions: 0, unlocked: false, bestScore: 0 };
}

/** 一組在按鈕上的第二行：練了幾次、解鎖了沒有、最高分多少。 */
function groupSubLabel(group) {
  const p = progressFor(group.id);
  const done = p.practiceCompletions || 0;
  if (!p.unlocked) {
    return `${group.count} 個字・練習 ${done}/${unlockAfter} 次`;
  }
  return p.bestScore
    ? `${group.count} 個字・🔓 最高 ${p.bestScore}`
    : `${group.count} 個字・🔓 可以玩遊戲`;
}

function renderPartPicker() {
  partPicker.innerHTML = '';
  if (!groups.length) {
    partPicker.innerHTML = '<p class="muted">載入單字組別中⋯</p>';
    return;
  }
  const KIND_LABELS = { contest: '競賽單字', week: '課本每週單字' };
  let lastKind = null;

  groups.forEach((group) => {
    if (group.kind !== lastKind) {
      lastKind = group.kind;
      const head = document.createElement('div');
      head.className = 'part-group-label';
      head.textContent = KIND_LABELS[group.kind] || '';
      partPicker.appendChild(head);
    }

    const p = progressFor(group.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    const classes = ['part-btn'];
    if (group.id === selectedGroup) classes.push('selected');
    if (p.unlocked) classes.push('unlocked');
    btn.className = classes.join(' ');
    btn.innerHTML =
      `<span class="part-title">${group.label}</span>` +
      `<span class="part-sub">${groupSubLabel(group)}</span>`;
    btn.addEventListener('click', () => {
      selectedGroup = group.id;
      writePref('lastGroup', group.id);
      renderPartPicker();
      updateGameButton();
    });
    partPicker.appendChild(btn);
  });
}

/*
 * 遊戲鈕會隨著選到的組別改變。
 *
 * 規則：同一組單字要先在練習模式**完整做完一次**，遊戲才開得起來。
 * 不然他會在一堆沒看過的字上一直被打死，學到的只有挫折。
 * 鎖住時不是把鈕藏起來，而是直接在鈕上寫還差幾次——看得到目標才有動力。
 */
function updateGameButton() {
  const btn = document.getElementById('go-game-btn');
  if (!btn) return;
  if (!selectedGroup) {
    btn.textContent = '🐝 玩遊戲';
    btn.disabled = false;
    return;
  }
  const p = progressFor(selectedGroup);
  if (p.unlocked) {
    btn.textContent = '🐝 玩遊戲';
    btn.disabled = false;
  } else {
    const left = Math.max(0, unlockAfter - (p.practiceCompletions || 0));
    btn.textContent = `🔒 再練完 ${left} 次才能玩`;
    btn.disabled = true;
  }
}

/**
 * 這個帳號的解鎖進度。離線時用上次存下來的，總比整片空白好。
 *
 * 快取一定要存在**使用者的命名空間**底下（readUser 而不是 readShared）：
 * 這是家裡共用的裝置，存成共用的話，哥哥解鎖的組別會直接出現在弟弟的畫面上。
 */
async function loadProgress() {
  const userId = currentUser && currentUser._id;
  const cached = readUser(userId, 'groupProgress');
  if (cached && cached.progress) {
    progress = cached.progress;
    unlockAfter = cached.unlockAfter || unlockAfter;
    renderPartPicker();
    updateGameButton();
  }
  /*
   * 刻意用原始 fetch 而不是 api.js。
   *
   * api.js 遇到 503 會重試五次、每次間隔四秒——那是為了喚醒 Render 的睡眠
   * 執行個體。但這一支只是畫面上的記號，資料庫還沒醒的時候不該讓整個練習頁
   * 卡在載入畫面二十秒；卡住的話他連練習都開不了，而練習正是解鎖的唯一辦法。
   */
  try {
    const res = await fetch('/api/practice/progress', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      progress = data.progress || {};
      unlockAfter = data.unlockAfter || 1;
      writeUser(userId, 'groupProgress', { progress, unlockAfter });
    }
  } catch (err) {
    // 拿不到就沿用快取；解鎖狀態不是安全機制，是學習順序的提醒
  }
  renderPartPicker();
  updateGameButton();
}

async function loadGroups() {
  /*
   * 組別清單是**這個帳號那一本**的，快取也要分帳號存。
   *
   * 本來兩件事都錯：
   *   1. /api/wordbank/groups 沒帶 bank，伺服器就給預設那一本（Pierce 的）
   *   2. 快取存在 shared 底下，同一台電腦上兩個孩子共用一份——
   *      就算 1 修好了，Allen 一進來還是先畫出 Pierce 上次留下的清單
   * 這支端點不需要登入（看不到 req.user），課本只能由這邊帶過去。
   */
  const userId = currentUser && currentUser._id;
  const bankId = currentUser && currentUser.wordBankId;
  // 先用上次的清單畫出來，更新丟到背景——這一頁常常是離線開的
  const cached = userId ? readUser(userId, 'groups') : null;
  if (Array.isArray(cached) && cached.length) {
    groups = cached;
    renderPartPicker();
  }
  try {
    const q = bankId ? `?bank=${encodeURIComponent(bankId)}` : '';
    const res = await fetch(`/api/wordbank/groups${q}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    groups = data.groups || [];
    if (userId) writeUser(userId, 'groups', groups);
  } catch (err) {
    if (!groups.length) setupError.textContent = '拿不到單字組別，請檢查網路後重新整理';
  }
  // 記住的那一組如果已經不存在（例如資料改過），就當作沒有選
  if (selectedGroup && !groups.some((g) => g.id === selectedGroup)) selectedGroup = null;
  renderPartPicker();
}

function selectedOrder() {
  const checked = document.querySelector('input[name="order"]:checked');
  return checked ? checked.value : 'sequential';
}

function selectedReadMode() {
  const checked = document.querySelector('input[name="readMode"]:checked');
  return checked ? checked.value : 'word';
}

/** 還原上次的出題順序與朗讀方式 */
function restoreSetupPrefs() {
  const savedOrder = readPref('lastOrder');
  const savedReadMode = readPref('lastReadMode');
  const orderInput = savedOrder && document.querySelector(`input[name="order"][value="${savedOrder}"]`);
  if (orderInput) orderInput.checked = true;
  const readInput = savedReadMode && document.querySelector(`input[name="readMode"][value="${savedReadMode}"]`);
  if (readInput) readInput.checked = true;
}

function showPanel(panel) {
  [setupPanel, practicePanel, summaryPanel].forEach((p) => p.classList.add('hidden'));
  panel.classList.remove('hidden');
}

async function startPractice({ reviewOnly = false } = {}) {
  setupError.textContent = '';

  if (!reviewOnly && !selectedGroup) {
    setupError.textContent = '請先選擇要練習哪一組';
    return;
  }

  sound.startBgm();
  writePref('lastOrder', selectedOrder());
  writePref('lastReadMode', selectedReadMode());
  readMode = selectedReadMode();

  let data;
  try {
    data = await api.post('/practice/session', {
      group: selectedGroup,
      order: selectedOrder(),
      reviewOnly
    });
  } catch (err) {
    setupError.textContent = err.message;
    return;
  }

  session = {
    id: newId(), // 由前端產生，作答紀錄在離線時也能先排隊
    // 複習模式跨組，不屬於任何一組，所以不會計入解鎖進度
    groupId: reviewOnly ? null : selectedGroup,
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
  const cached = readPref('reviewCount');
  if (background && cached !== null) {
    renderReviewButton(cached);
    fetchReviewCount().catch(() => {});
    return;
  }
  await fetchReviewCount().catch(() => renderReviewButton(0));
}

async function fetchReviewCount() {
  const { words } = await api.get('/practice/review-queue');
  writePref('reviewCount', words.length);
  renderReviewButton(words.length);
}

async function showQuestion() {
  const word = session.words[session.index];
  progressLabel.textContent = `${session.index + 1} / ${session.words.length}`;
  sessionCoinBadge.textContent = `本回 🪙 ${session.sessionCoins}`;
  answerInput.value = '';
  answerInput.disabled = false;
  submitBtn.disabled = false;
  revealPanel.classList.add('hidden');
  answerInput.focus();
  // 行為紀錄：這個字從出現到按下送出花了多久、重聽了幾次
  session.shownAt = performance.now();
  session.listens = 0;

  setToolsEnabled(true);
  gameScene.reactListening();
  await playCurrentWord();
}

/** 依設定播放：只唸單字，或競賽模式（單字 → 例句 → 單字） */
async function playCurrentWord() {
  const word = session.words[session.index];
  if (readMode === 'competition') {
    await playCompetitionSequence(word);
  } else {
    await playWordAudio(word);
  }
}

function setToolsEnabled(enabled) {
  [replayBtn, slowBtn, sentenceBtn].forEach((b) => {
    if (b) b.disabled = !enabled;
  });
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
  setToolsEnabled(false);
  stopSpeaking();

  // 判定規則只有一份（shared/answer-match.js），伺服器用的是同一個檔案
  const correct = isAnswerCorrect(userAnswer, word.english);
  /*
   * 行為紀錄：多久答、答對沒有、重聽幾次。不記他打了什麼——
   * 打了什麼已經在作答紀錄（attempts）裡，這裡只補伺服器看不到的「花了多久」。
   */
  track('practice_answer', {
    wordId: word._id,
    correct,
    ms: session.shownAt ? Math.round(performance.now() - session.shownAt) : null,
    listens: session.listens || 0
  });

  // 用與伺服器相同的公式先算出金幣與連勝，讓畫面立刻有反應（公式只有一份：shared/coins.js）
  session.streak = correct ? session.streak + 1 : 0;
  const coinsAwarded = correct ? coinsForCorrectAnswer(session.streak) : 0;

  session.sessionCoins += coinsAwarded;
  sessionCoinBadge.textContent = `本回 🪙 ${session.sessionCoins}`;
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
  /*
   * 練習結束，背景音樂也要結束。
   *
   * 原本只有 startBgm() 沒有對應的 stop，所以做完一組回到清單，音樂還在
   * 那邊循環播放——他第一次玩就問「怎麼背景音樂還在」。音樂是「正在練習」
   * 的訊號，練完還在響，這個訊號就沒有意義了。
   */
  sound.stopBgm();

  /*
   * 這一次賺到多少，以及總共存了多少。
   *
   * 本來只寫「總共賺到 N 枚」——但那個 N 是**這一次**的，每次練完都歸零重算。
   * 他練了三次、每次都看到差不多的數字，就問「錢怎麼還是只有 300」。
   * 「總共」這兩個字放在只算一場的數字前面，等於在騙他。
   * 兩個數字一起寫出來，累積的那個才看得到自己在變大。
   */
  const total = getNavCoins();
  summaryText.textContent =
    typeof total === 'number'
      ? `這次練習了 ${session.words.length} 個單字，賺到 ${session.sessionCoins} 枚金幣！存款總共 ${total} 枚。`
      : `這次練習了 ${session.words.length} 個單字，賺到 ${session.sessionCoins} 枚金幣！`;

  /*
   * 整組做完才算練過一次——解鎖遊戲靠的就是這個計數。
   *
   * 跟作答一樣丟進背景佇列：離線練完的那一次不可以不算。
   * 伺服器會用 opId 去重，重試不會把一次變成兩次。
   */
  if (session.groupId) {
    recordCompletionLocally(session.groupId);
    enqueue({
      kind: 'group-complete',
      path: '/practice/group-complete',
      body: {
        opId: `${session.id}:complete`,
        groupId: session.groupId,
        answered: session.words.length
      }
    });
  }

  showPanel(summaryPanel);
  renderPartPicker();
  updateGameButton();
  refreshReviewButton();
}

/*
 * 本地先把次數加上去，畫面立刻反映。
 *
 * 跟金幣一樣的做法：前端用同一條規則先算，伺服器回來之後校正。
 * 不先加的話，他剛練完第二次卻看到遊戲還鎖著，會以為壞掉了。
 */
function recordCompletionLocally(groupId) {
  const row = progress[groupId] || { practiceCompletions: 0, gamesPlayed: 0, bestScore: 0 };
  const completions = (row.practiceCompletions || 0) + 1;
  progress[groupId] = {
    ...row,
    practiceCompletions: completions,
    unlocked: completions >= unlockAfter
  };
  writeUser(currentUser && currentUser._id, 'groupProgress', { progress, unlockAfter });
}

/*
 * 按下開始的那一刻就是使用者手勢，正好拿來把語音引擎叫醒。
 * 不先叫醒的話，iOS 上第一個單字的開頭會被切掉——而第一個音聽錯，
 * 整個字就拼錯了。
 */
document.getElementById('start-practice-btn').addEventListener('click', () => {
  sound.playClick();
  warmUpSpeech();
  startPractice();
});
reviewBtn.addEventListener('click', () => {
  sound.playClick();
  warmUpSpeech();
  startPractice({ reviewOnly: true });
});

/*
 * 去遊戲，並且把選好的那一組帶過去。
 *
 * 遊戲頁有「← 回練習」，這邊本來卻沒有路回去，等於只能單向走。
 * n 要給一個比最大一組還大的數字：遊戲預設只取 20 個字，不給的話
 * 一組 61 字會被默默砍成 20——畫面寫「總共 20 個字」，跟這一頁對不起來。
 */
document.getElementById('go-game-btn')?.addEventListener('click', () => {
  if (!selectedGroup) {
    setupError.textContent = '請先選擇要玩哪一組';
    return;
  }
  const p = progressFor(selectedGroup);
  if (!p.unlocked) {
    const left = Math.max(0, unlockAfter - (p.practiceCompletions || 0));
    setupError.textContent = `這一組還要在練習模式完整做完 ${left} 次才能玩遊戲`;
    return;
  }
  sound.playClick();
  location.href = `/game?group=${encodeURIComponent(selectedGroup)}&n=200`;
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
  if (session) session.listens = (session.listens || 0) + 1;
  playWordAudio(session.words[session.index]);
});
slowBtn.addEventListener('click', () => {
  sound.playClick();
  if (session) session.listens = (session.listens || 0) + 1;
  playWordAudio(session.words[session.index], { slow: true });
});
sentenceBtn.addEventListener('click', () => {
  sound.playClick();
  if (session) session.listens = (session.listens || 0) + 1;
  const word = session.words[session.index];
  if (word.exampleSentence) speakSentence(word.exampleSentence);
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

/*
 * 伺服器算完之後校正解鎖進度。
 *
 * 正常情況下跟本地算的一樣；不一樣的時候（在別台裝置上也練過、
 * 或是重試被去重擋掉了）一律以伺服器為準。
 */
onApplied('group-complete', (result, op, err) => {
  if (err || !result) {
    // 伺服器不認這一次（例如根本沒做完），本地先加上去的那次要收回來，
    // 不然畫面會顯示已解鎖、按下去卻被擋，那比一開始就鎖著更難理解
    loadProgress();
    return;
  }
  if (!result.progress || !result.progress.groupId) return;
  progress[result.progress.groupId] = result.progress;
  writeUser(currentUser && currentUser._id, 'groupProgress', { progress, unlockAfter });
  renderPartPicker();
  updateGameButton();
});

runPageInit(async () => {
  const user = await requireLogin();
  if (!user) return;
  currentUser = user;
  initOutbox(user._id);
  // 幾件事互不相依，平行處理，避免畫面元素一個接一個冒出來
  selectedGroup = readPref('lastGroup') || null;
  restoreSetupPrefs();
  await Promise.all([
    loadGroups(),
    loadProgress(),
    mountNav(user, 'practice'),
    refreshReviewButton({ background: true })
  ]);
  warmUpGameEngine();
});
