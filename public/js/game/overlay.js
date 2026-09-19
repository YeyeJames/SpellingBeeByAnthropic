/**
 * F3 除錯疊加層。
 *
 * 跟 Minecraft 的 F3 一樣：我拿來除錯，小孩拿來當彩蛋。
 * 用 DOM 而不是畫在 Phaser 裡，這樣它的成本不會算進遊戲的影格預算，
 * 量效能時才不會「因為開著除錯面板所以變慢」。
 */

import { perfReport } from './perf.js';

export function createOverlay(ctx) {
  const el = document.createElement('div');
  el.className = 'debug-overlay';
  el.hidden = true;
  document.body.appendChild(el);

  let visible = false;
  let timer = null;

  function refresh() {
    const s = ctx.debug.state();
    const p = perfReport(ctx.perf);
    const l = ctx.debug.latency();
    const q = ctx.debug.queue();
    const fx = ctx.getEffectStats();
    if (!s) {
      el.textContent = '（尚未開始）';
      return;
    }
    el.textContent = [
      `tick ${s.tick}  ${(s.timeMs / 1000).toFixed(1)}s  ${s.status}`,
      `seed ${ctx.getSeed()}  指紋 ${s.fingerprint}`,
      `影格 p50 ${p.p50}ms  p95 ${p.p95}ms  最差 ${p.worst}ms  掉格 ${p.dropped}`,
      `heap ${p.heapMB ?? '—'}MB  成長 ${p.heapGrowthMB ?? '—'}MB`,
      `本影格邏輯步 ${ctx.getClockSteps()}  丟棄 ${Math.round(ctx.getClockDropped())}ms`,
      `延遲 p50 ${l.p50}ms  p95 ${l.p95}ms  最差 ${l.worst}ms（${l.samples} 筆）`,
      `物件池 針 ${fx.stingers} 碎 ${fx.fragments} 濺 ${fx.splashes}  回收 ${fx.recycled}`,
      `輸入佇列 ${q.size}  丟棄 ${q.dropped}`,
      '',
      `單字 ${s.wordIndex} "${s.target}"  已打 ${s.typed}/${s.target.length}`,
      `敵人 ${(s.progress * 100).toFixed(1)}%  橫越 ${s.crossMs}ms`,
      `血 ${s.hp}  連擊 ${s.combo}  蜂蜜 ${s.honey}  剩 ${s.remaining} 字`,
      '',
      `對 ${s.stats.correctLetters}  錯 ${s.stats.wrongLetters}  退格 ${s.stats.backspaces}`,
      `殺 ${s.stats.wordsKilled}  漏 ${s.stats.wordsMissed}  重聽 ${s.stats.listens}`,
      '',
      `錄影 ${ctx.getLog()?.entries.length ?? 0} 個動作`
    ].join('\n');
  }

  return {
    toggle() {
      visible = !visible;
      el.hidden = !visible;
      if (visible) {
        refresh();
        timer = setInterval(refresh, 250);
      } else {
        clearInterval(timer);
        timer = null;
      }
    },
    isVisible() {
      return visible;
    }
  };
}
