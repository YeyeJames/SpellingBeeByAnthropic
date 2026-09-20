/**
 * 鍵盤輸入層（Phase 1.2）。
 *
 * 這一層要處理的，都是「沒做就會覺得怪怪的，但說不出哪裡怪」的東西：
 *
 *   - e.repeat：按著不放會連續觸發 keydown，那不是玩家的意圖
 *   - 中文輸入法：停在注音模式時按字母會跳選字視窗，遊戲完全不能玩，
 *     而小孩不會自己想到要切輸入法
 *   - 觸控裝置：沒有輸入框的話 iOS/iPadOS 根本不會叫出螢幕鍵盤，
 *     等於完全不能打字（實機開起來就是這樣：只能眼睜睜看敵人走進來）
 *   - 時間戳：每個按鍵都要帶上 keydown 當下的時間，延遲才量得準
 *
 * 事件綁在 window 上而不是靠某個 <input> 的值，理由是避開輸入法與焦點問題：
 * 玩家不會遇到「打了半天發現沒打進去」。觸控裝置上那個隱藏輸入框只負責
 * 「把螢幕鍵盤叫出來」，實際的按鍵仍然由 window 的 keydown 收。
 */

import { isTypeableChar } from './core/charset.js';

const LISTEN_KEYS = {
  ArrowUp: 'replay',
  ArrowDown: 'slow',
  ArrowRight: 'sentence'
};

/** 輸入法正在組字時，瀏覽器送來的 keyCode 固定是這個值。 */
const IME_KEYCODE = 229;

export function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  );
}

export function createInput({
  onAction,
  onPause,
  onToggleOverlay,
  onToggleMute,
  onImeSuspected,
  onImeCleared
}) {
  let enabled = true;
  let imeSuspected = false;
  // keydown 收到過真正的字母之後，就不必再理會 input 事件的備援路徑
  let lastKeyDownAt = 0;

  function flagIme() {
    if (imeSuspected) return;
    imeSuspected = true;
    onImeSuspected?.();
  }

  function clearIme() {
    if (!imeSuspected) return;
    imeSuspected = false;
    onImeCleared?.();
  }

  function handleKeyDown(e) {
    const t0 = performance.now();

    // 讓瀏覽器自己的組合鍵通過（重新整理、開發者工具等）
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    /*
     * 靜音用 F2 而不是 M——M 是要拿來拼字的，任何字母鍵都不能挪作他用。
     * F3 是除錯疊加層，跟 Minecraft 一樣的位置。
     */
    if (e.key === 'F2') {
      e.preventDefault();
      onToggleMute?.();
      return;
    }

    if (e.key === 'F3') {
      e.preventDefault();
      onToggleOverlay?.();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      onPause?.();
      return;
    }

    if (!enabled) return;

    /*
     * 輸入法偵測。
     *
     * 組字中的按鍵一律是 keyCode 229、或 isComposing 為真。收到這種事件
     * 代表玩家的電腦停在中文輸入法，接下來他打什麼我們都收不到正確的字母。
     * 與其讓他對著不動的畫面困惑，不如直接把話講明白。
     */
    if (e.isComposing || e.keyCode === IME_KEYCODE) {
      e.preventDefault();
      flagIme();
      return;
    }

    // 按著不放不該連發
    if (e.repeat) return;

    const listen = LISTEN_KEYS[e.key];
    if (listen) {
      e.preventDefault();
      onAction({ kind: 'listen', listen }, t0);
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault(); // 否則某些情況下瀏覽器會往上一頁
      onAction({ kind: 'backspace' }, t0);
      return;
    }

    /*
     * 空白鍵也是一個字母。
     *
     * 課本有 "alarm clock"、"a couple of" 這種詞條，要打完就得按空白。
     * preventDefault 在這裡特別重要——沒擋的話空白鍵會把整頁往下捲。
     */
    if (e.key.length === 1) {
      const ch = e.key.toLowerCase();
      if (isTypeableChar(ch)) {
        e.preventDefault();
        lastKeyDownAt = t0;
        // 收到正常的字元，代表輸入法已經切回來了
        clearIme();
        onAction({ kind: 'letter', ch }, t0);
      }
    }
  }

  /*
   * 觸控裝置的備援路徑。
   *
   * 螢幕鍵盤在部分瀏覽器上不會送出有意義的 keydown（key 會是
   * 'Unidentified' 或 keyCode 229），但一定會送出 input 事件。
   * 所以從 input 事件裡把字母撿回來，並用時間差避免跟 keydown 重複計算。
   */
  function handleBeforeInput(e) {
    if (!enabled) return;
    const data = e.data;
    if (!data || data.length !== 1) return;
    const ch = data.toLowerCase();
    if (!isTypeableChar(ch)) return;

    const t0 = performance.now();
    if (t0 - lastKeyDownAt < 100) return; // keydown 已經處理過同一次按鍵
    clearIme();
    onAction({ kind: 'letter', ch }, t0);
  }

  function handleCompositionStart() {
    flagIme();
  }

  function handleBlur() {
    onPause?.({ reason: 'blur', force: true });
  }

  function handleVisibility() {
    if (document.hidden) onPause?.({ reason: 'hidden', force: true });
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('compositionstart', handleCompositionStart, true);
  window.addEventListener('blur', handleBlur);
  document.addEventListener('visibilitychange', handleVisibility);

  /* ── 觸控：把螢幕鍵盤叫出來 ───────────────────────────── */

  let touchInput = null;
  if (isTouchDevice()) {
    touchInput = document.createElement('input');
    touchInput.type = 'text';
    touchInput.className = 'touch-input';
    touchInput.setAttribute('autocomplete', 'off');
    touchInput.setAttribute('autocapitalize', 'off');
    touchInput.setAttribute('autocorrect', 'off');
    touchInput.setAttribute('spellcheck', 'false');
    touchInput.setAttribute('aria-label', '打字區');
    document.body.appendChild(touchInput);

    // 永遠保持空的：它只是用來叫出鍵盤，真正的輸入走 keydown / beforeinput
    touchInput.addEventListener('input', () => {
      touchInput.value = '';
    });
    touchInput.addEventListener('beforeinput', handleBeforeInput);
  }

  return {
    /** 觸控裝置上要由使用者的點擊觸發，否則 iOS 不會叫出鍵盤。 */
    focusForTyping() {
      if (touchInput) touchInput.focus();
    },
    hasTouchInput() {
      return !!touchInput;
    },
    isImeSuspected() {
      return imeSuspected;
    },
    setEnabled(v) {
      enabled = v;
    },
    destroy() {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('compositionstart', handleCompositionStart, true);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
      touchInput?.remove();
    }
  };
}
