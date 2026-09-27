/**
 * 螢幕鍵盤蓋住多少，遊戲就縮多少。
 *
 * iPhone／iPad 叫出螢幕鍵盤時，「版面高度」不會變——鍵盤是直接蓋在網頁上面的，
 * 只有 visualViewport（真正看得到的那一塊）變矮。所以遊戲照整個螢幕排版，
 * 蜂巢和敵人剛好被鍵盤蓋住（手機直式最明顯：戰場在畫面下三成，鍵盤蓋掉下半）。
 *
 * 這裡量出看得到的那一塊，寫成 CSS 變數，並在 body 加上 kb-open；
 * 樣式表用它把畫布、工具列與各個面板收進看得到的範圍。
 *
 * 只有「被蓋住的高度夠大、而且沒有在放大」才算鍵盤開著：
 * - 筆電、桌機：看得到的永遠等於版面，什麼都不會變
 * - Android：鍵盤本來就會把版面變矮，差距是 0，也什麼都不會變
 * - 雙指放大時看得到的也會變小，但那不是鍵盤，不動
 */
const MIN_COVERED = 120; // 比 Safari 工具列高、比任何螢幕鍵盤矮

export function watchKeyboardViewport(onChange) {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return () => {};
  const root = document.documentElement;
  let open = false;
  let last = '';
  let raf = 0;

  function apply() {
    raf = 0;
    const layoutH = root.clientHeight || window.innerHeight;
    const top = Math.max(0, vv.offsetTop || 0);
    const visH = vv.height;
    const covered = layoutH - (top + visH);
    const next = Math.abs((vv.scale || 1) - 1) < 0.01 && covered >= MIN_COVERED;
    const sig = next ? `${Math.round(top)}/${Math.round(visH)}/${Math.round(covered)}` : 'closed';
    if (sig === last) return;
    last = sig;
    if (next) {
      root.style.setProperty('--vv-top', `${Math.round(top)}px`);
      root.style.setProperty('--vv-h', `${Math.round(visH)}px`);
      root.style.setProperty('--kb-bottom', `${Math.round(covered)}px`);
    } else {
      root.style.removeProperty('--vv-top');
      root.style.removeProperty('--vv-h');
      root.style.removeProperty('--kb-bottom');
    }
    document.body.classList.toggle('kb-open', next);
    open = next;
    onChange?.(open);
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  // 鍵盤收起來的動畫結束時，有些版本不會再送一次 resize，補量一次
  const late = () => setTimeout(schedule, 350);
  document.addEventListener('focusin', late);
  document.addEventListener('focusout', late);
  schedule();

  return () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('focusin', late);
    document.removeEventListener('focusout', late);
  };
}
