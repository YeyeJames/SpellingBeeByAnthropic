/**
 * 鍵盤輸入。
 *
 * 1.1 先做到「能正確地把按鍵變成動作」，硬化的部分（輸入緩衝、輸入法偵測、
 * 延遲直方圖）留到 1.2。現在就處理掉的只有兩件最基本的：
 *   - e.repeat：按著不放不該連發
 *   - 視窗失焦：切去看別的東西時自動暫停，回來不會已經死了
 *
 * 事件綁在 window 上而不是某個 <input>，理由是避開輸入法與焦點問題：
 * 玩家不會遇到「打了半天發現沒打進去」。
 */

const LISTEN_KEYS = {
  ArrowUp: 'replay',
  ArrowDown: 'slow',
  ArrowRight: 'sentence'
};

export function createInput({ onAction, onPause, onToggleOverlay }) {
  let enabled = true;

  function handleKeyDown(e) {
    // 讓瀏覽器自己的組合鍵通過（重新整理、開發者工具等）
    if (e.ctrlKey || e.metaKey || e.altKey) return;

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

    // 按著不放會連續觸發 keydown，那不是玩家的意圖
    if (e.repeat) return;

    const listen = LISTEN_KEYS[e.key];
    if (listen) {
      e.preventDefault();
      onAction({ kind: 'listen', listen });
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault(); // 否則某些情況下瀏覽器會往上一頁
      onAction({ kind: 'backspace' });
      return;
    }

    // 只收單一英文字母
    if (e.key.length === 1) {
      const ch = e.key.toLowerCase();
      if (ch >= 'a' && ch <= 'z') {
        e.preventDefault();
        onAction({ kind: 'letter', ch });
      }
    }
  }

  function handleBlur() {
    onPause?.({ reason: 'blur' });
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('blur', handleBlur);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onPause?.({ reason: 'hidden' });
  });

  return {
    setEnabled(v) {
      enabled = v;
    },
    destroy() {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    }
  };
}
