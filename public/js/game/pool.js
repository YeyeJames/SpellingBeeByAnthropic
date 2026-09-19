/**
 * 顯示物件池。
 *
 * 紀律是「戰鬥中不新建任何物件」：所有粒子、蜂針、碎片都在開場時配好，
 * 之後只是被反覆借用。持續配置會讓 GC 在隨機的時間點介入，造成偶發掉格——
 * 那種 bug 玩的人只會說「有時候怪怪的」，最難查，所以從一開始就不要讓它發生。
 *
 * 借用的策略是環狀的：池子借光時直接回收最舊的那一個。
 * 對特效來說這完全可以接受——最舊的那個本來就快演完了，
 * 而且寧可讓一個粒子早點消失，也不要為了它配置記憶體。
 */

export function createPool(size, factory) {
  const items = new Array(size);
  for (let i = 0; i < size; i += 1) {
    const it = factory(i);
    it.active = false;
    items[i] = it;
  }
  return { items, size, cursor: 0, peakActive: 0, recycled: 0, spawned: 0 };
}

/** 借一個出來用。回傳的物件一定已經被標成 active。 */
export function obtain(pool) {
  const it = pool.items[pool.cursor];
  pool.spawned += 1;
  if (it.active) pool.recycled += 1; // 統計：佔比偏高代表池子開太小
  pool.cursor = (pool.cursor + 1) % pool.size;
  it.active = true;
  return it;
}

/** 目前有幾個在用，F3 疊加層會顯示。 */
export function activeCount(pool) {
  let n = 0;
  for (let i = 0; i < pool.size; i += 1) if (pool.items[i].active) n += 1;
  if (n > pool.peakActive) pool.peakActive = n;
  return n;
}

export function releaseAll(pool) {
  for (let i = 0; i < pool.size; i += 1) {
    const it = pool.items[i];
    it.active = false;
    it.node.setVisible(false);
  }
  pool.cursor = 0;
}
