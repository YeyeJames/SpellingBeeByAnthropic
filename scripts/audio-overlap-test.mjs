/**
 * 自己錄的音不可以在下一題又冒出來（2026-10 家長回報）。
 *
 * 「練習時，有自己錄音的字答對之後，唸下一個字的時候，原本那個字的錄音又出現，
 *   跟下一個字的出題聲音疊在一起。」
 *
 * 兩個原因（見 audio-player.js 的 playGen）：
 *   1. 競賽模式（單字 → 例句 → 單字）停掉例句之後，後面那段「再唸一次單字」照樣排著
 *   2. 停掉還沒開始播的錄音，play() 會失敗——被當成「錄音壞了」，改用機器語音把舊的字再唸一次
 *
 * 這台機器沒有喇叭也沒有語音，所以把 Audio 與 speechSynthesis 換成假的，
 * 記下每一次「開始播」與「開始唸」，再看停掉之後還有沒有舊的字冒出來。
 *
 * 用法：node scripts/audio-overlap-test.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext();
await context.addInitScript(() => {
  const log = [];
  window.__log = log;
  const now = () => Math.round(performance.now());
  /* 假的錄音：50ms 後真的開始播，400ms 播完；src 帶 broken 的播不出來 */
  class FakeAudio extends EventTarget {
    constructor(src) {
      super();
      this.src = src;
      this.playbackRate = 1;
      this.currentTime = 0;
    }
    play() {
      log.push({ t: now(), kind: 'rec', src: this.src });
      if (this.src.includes('broken')) return Promise.reject(new DOMException('not supported', 'NotSupportedError'));
      return new Promise((resolve, reject) => {
        this._reject = reject;
        this._start = setTimeout(() => {
          this._playing = true;
          resolve();
          this._end = setTimeout(() => this.dispatchEvent(new Event('ended')), 400);
        }, 50);
      });
    }
    pause() {
      clearTimeout(this._end);
      if (!this._playing) {
        clearTimeout(this._start);
        this._reject?.(new DOMException('The play() request was interrupted by a call to pause()', 'AbortError'));
      }
    }
  }
  window.Audio = FakeAudio;
  /* 假的語音：唸 300ms；cancel 的時候觸發 onerror（Chrome 的行為） */
  const synth = {
    speaking: false,
    pending: false,
    speak(u) {
      log.push({ t: now(), kind: 'tts', text: u.text });
      this.speaking = true;
      this._cur = u;
      this._t = setTimeout(() => {
        this.speaking = false;
        this._cur = null;
        u.onend?.();
      }, 300);
    },
    cancel() {
      if (!this._cur) return;
      clearTimeout(this._t);
      const u = this._cur;
      this._cur = null;
      this.speaking = false;
      u.onerror?.({ error: 'interrupted' });
    },
    getVoices: () => [{ lang: 'en-US', name: 'Fake', voiceURI: 'fake', localService: true }],
    addEventListener() {}
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/selftest`, { waitUntil: 'domcontentloaded' });

/** 在頁面裡跑一段劇本，回傳停掉之後冒出來的聲音 */
const run = (script) => page.evaluate(async (src) => {
  window.__log.length = 0;
  const m = await import('/js/audio-player.js');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => {
    const t0 = performance.now();
    while (!fn() && performance.now() - t0 < ms) await wait(10);
  };
  const ctx = { m, wait, waitFor, log: window.__log, stopAt: 0 };
  // eslint-disable-next-line no-new-func
  await new Function('ctx', `return (async () => { ${src} })()`)(ctx);
  return { log: window.__log.slice(), stopAt: ctx.stopAt };
}, script);

const W = (id, english, extra = {}) => `({ _id: '${id}', english: '${english}', exampleSentence: 'The ${english} is here.', audio: { type: 'recorded' }, ...${JSON.stringify(extra)} })`;
const after = (r, pred) => r.log.filter((e) => e.t >= r.stopAt && pred(e));

console.log('1) 競賽模式：例句唸到一半就答完了');
{
  const r = await run(`
    ctx.m.playCompetitionSequence(${W('w-alpha', 'alpha')});
    await ctx.waitFor(() => ctx.log.some((e) => e.kind === 'tts'));
    await ctx.wait(100);
    ctx.stopAt = Math.round(performance.now());
    ctx.m.stopSpeaking();
    await ctx.wait(1500);
  `);
  check('（前提）先播了錄音，再唸例句', r.log[0]?.kind === 'rec' && r.log.some((e) => e.kind === 'tts' && /is here/.test(e.text)),
    r.log.map((e) => e.kind + ':' + (e.src || e.text)).join(' → '));
  const late = after(r, () => true);
  check('⭐ 停掉之後，舊的字沒有再播一次', late.length === 0, late.map((e) => e.kind + ':' + (e.src || e.text)).join('、'));
}

console.log('2) 錄音還沒開始播就被停掉');
{
  const r = await run(`
    ctx.m.playWordAudio(${W('w-bravo', 'bravo')});
    await ctx.wait(10);
    ctx.stopAt = Math.round(performance.now());
    ctx.m.stopSpeaking();
    await ctx.wait(1200);
  `);
  const late = after(r, () => true);
  check('⭐ 不會改用機器語音把舊的字唸出來', late.length === 0, late.map((e) => e.kind + ':' + (e.src || e.text)).join('、'));
}

console.log('3) 下一題的錄音蓋掉上一題還沒開始播的錄音');
{
  const r = await run(`
    ctx.m.playWordAudio(${W('w-charlie', 'charlie')});
    await ctx.wait(10);
    ctx.stopAt = Math.round(performance.now());
    ctx.m.playWordAudio(${W('w-delta', 'delta')});
    await ctx.wait(1200);
  `);
  const old = after(r, (e) => (e.src || '').includes('charlie') || e.text === 'charlie');
  check('⭐ 舊的字沒有冒出來', old.length === 0, old.map((e) => e.kind + ':' + (e.src || e.text)).join('、'));
  check('新的字有播', after(r, (e) => (e.src || '').includes('delta')).length === 1);
}

console.log('4) 該唸的還是要唸');
{
  const r = await run(`
    await ctx.m.playCompetitionSequence(${W('w-echo', 'echo')});
  `);
  const seq = r.log.map((e) => (e.kind === 'rec' ? 'rec' : 'tts'));
  check('沒有人喊停：競賽模式完整唸完（錄音 → 例句 → 錄音）', seq.join(',') === 'rec,tts,rec', seq.join(','));
  const b = await run(`
    await ctx.m.playWordAudio(${W('broken', 'foxtrot')});
  `);
  check('錄音真的播不出來：退回機器語音', b.log.some((e) => e.kind === 'tts' && e.text === 'foxtrot'),
    b.log.map((e) => e.kind + ':' + (e.src || e.text)).join(' → '));
}

check('沒有瀏覽器錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `\n${failures} 項失敗` : '\n全部通過');
process.exit(failures ? 1 : 0);
