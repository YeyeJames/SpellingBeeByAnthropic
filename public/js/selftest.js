/**
 * 聲音自我檢查頁。
 *
 * 存在的理由很直接：我在開發環境裡聽不到聲音。所有音效測試能證明的
 * 只有「有被排進音訊佇列」與「延遲夠低」，證明不了「聽起來對不對」。
 * TTS 更徹底——無頭瀏覽器連一個語音都沒裝，那條路徑我一次都沒真的跑過。
 *
 * 所以把這件事變成一個 60 秒的動作：每顆按鈕先寫清楚它代表什麼，
 * 按下去就播。聽的人不需要懂任何技術，只要說「哪一顆不對」。
 */

import { createSfx } from './game/sfx.js';
import { semitoneForIndex } from './game/core/scale.js';
import {
  speakWord,
  speakSentence,
  listEnglishVoices,
  getPreferredVoiceURI,
  setPreferredVoiceURI
} from './audio-player.js';

const DEMO_WORD = 'account';
const DEMO_SENTENCE = 'I opened a bank account to save my money.';

const sfx = createSfx({});
const nowPlaying = document.getElementById('now-playing');

function announce(text) {
  if (nowPlaying) nowPlaying.textContent = text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 環境資訊 ─────────────────────────────────────────── */

function renderEnv() {
  const dl = document.getElementById('env');
  const rep = sfx.latencyReport();
  const voices = listEnglishVoices();
  const rows = [
    ['音訊狀態', rep.contextState === 'running' ? '已啟動' : `${rep.contextState}（按任一顆按鈕會啟動）`],
    ['裝置輸出延遲', rep.outputLatencyMs == null ? '—' : `${rep.outputLatencyMs} ms`],
    ['英文語音數量', voices.length === 0 ? '0 —— 這台裝置沒有英文語音，遊戲會改成顯示單字' : String(voices.length)],
    ['目前音量', sfx.isMuted() ? '靜音' : String(sfx.getVolume())]
  ];
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
}

/* ── 1. 音階 ──────────────────────────────────────────── */

const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C↑'];

function buildLetterButtons() {
  const row = document.getElementById('letters');
  for (let i = 0; i < 8; i += 1) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = `第 ${i + 1} 個字母（${NOTE_NAMES[i]}）`;
    btn.onclick = () => {
      sfx.unlock();
      announce(`第 ${i + 1} 個字母的打擊音（${NOTE_NAMES[i]}，半音 ${semitoneForIndex(i)}）`);
      sfx.letter(i, 0, null);
    };
    row.appendChild(btn);
  }
}

async function playScale() {
  sfx.unlock();
  for (let i = 0; i < 8; i += 1) {
    announce(`音階第 ${i + 1} 音（${NOTE_NAMES[i]}）`);
    sfx.letter(i, 0, null);
    await sleep(260);
  }
  announce('音階播完——應該是穩穩往上，最後一個正好高八度');
}

/* ── 2. 各種回饋音 ────────────────────────────────────── */

const EFFECTS = [
  { key: 'wrong', label: '打錯字母', run: () => sfx.wrong(null) },
  { key: 'kill', label: '打完整個字（擊殺）', run: () => sfx.kill(7, null) },
  { key: 'hp', label: '漏字扣血', run: () => sfx.hpLost(null) },
  { key: 'listen', label: '按「再聽一次」', run: () => sfx.listen(null) },
  { key: 'combo5', label: 'Combo 5', run: () => sfx.combo(5, null) },
  { key: 'combo10', label: 'Combo 10', run: () => sfx.combo(10, null) },
  { key: 'combo15', label: 'Combo 15', run: () => sfx.combo(15, null) },
  { key: 'win', label: '全部打完（勝利）', run: () => sfx.finish(true, null) },
  { key: 'lose', label: '蜂巢被攻破（失敗）', run: () => sfx.finish(false, null) }
];

function buildEffectButtons() {
  const row = document.getElementById('effects');
  for (const e of EFFECTS) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = e.label;
    btn.onclick = () => {
      sfx.unlock();
      announce(e.label);
      e.run();
    };
    row.appendChild(btn);
  }
}

/* ── 3. TTS ───────────────────────────────────────────── */

function buildVoicePicker() {
  const select = document.getElementById('voice-select');
  const hint = document.getElementById('voice-hint');
  const voices = listEnglishVoices();

  if (voices.length === 0) {
    select.innerHTML = '<option>（這台裝置沒有英文語音）</option>';
    select.disabled = true;
    hint.textContent =
      '沒有語音的話遊戲會自動改成把單字顯示在畫面上，還是玩得下去，只是變成看的不是聽的。';
    return;
  }

  const preferred = getPreferredVoiceURI();
  select.innerHTML = '';
  for (const v of voices) {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name}（${v.lang}）`;
    if (v.voiceURI === preferred) opt.selected = true;
    select.appendChild(opt);
  }
  select.onchange = () => {
    setPreferredVoiceURI(select.value);
    speakWord(DEMO_WORD);
  };
  hint.textContent = '語音是這台裝置提供的，所以設定只會套用在這台裝置上。換一個就會立刻唸給你聽。';
}

function bindSpeakButtons() {
  document.querySelectorAll('[data-speak]').forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.speak;
      if (mode === 'sentence') {
        announce(`唸例句：${DEMO_SENTENCE}`);
        speakSentence(DEMO_SENTENCE);
      } else {
        announce(`${mode === 'slow' ? '慢速' : '正常速度'}唸：${DEMO_WORD}`);
        speakWord(DEMO_WORD, { slow: mode === 'slow' });
      }
    };
  });
}

/* ── 4. 全部依序播放 ──────────────────────────────────── */

async function runAll() {
  const btn = document.getElementById('run-all');
  btn.disabled = true;
  sfx.unlock();

  await playScale();
  await sleep(600);

  for (const e of EFFECTS) {
    announce(e.label);
    e.run();
    await sleep(900);
  }

  if (listEnglishVoices().length > 0) {
    announce(`正常速度唸：${DEMO_WORD}`);
    speakWord(DEMO_WORD);
    await sleep(2200);
    announce(`慢速唸：${DEMO_WORD}`);
    speakWord(DEMO_WORD, { slow: true });
    await sleep(3000);
    announce(`唸例句：${DEMO_SENTENCE}`);
    speakSentence(DEMO_SENTENCE);
    await sleep(3500);
  } else {
    announce('這台裝置沒有英文語音，跳過發音的部分');
    await sleep(1200);
  }

  announce('全部播完了。哪一顆聽起來不對，直接跟我說就好。');
  btn.disabled = false;
  renderEnv();
}

/* ── 起動 ─────────────────────────────────────────────── */

buildLetterButtons();
buildEffectButtons();
bindSpeakButtons();
document.querySelector('[data-play="scale"]').onclick = playScale;
document.getElementById('run-all').onclick = runAll;
renderEnv();

// 語音清單在某些瀏覽器是非同步載入的，第一次讀會是空的
buildVoicePicker();
if ('speechSynthesis' in window) {
  setTimeout(() => {
    buildVoicePicker();
    renderEnv();
  }, 700);
}

// 給自動化測試探測用
window.__selftest = {
  sfx,
  effects: EFFECTS.map((e) => e.key),
  voiceCount: () => listEnglishVoices().length,
  nowPlaying: () => nowPlaying?.textContent || ''
};
