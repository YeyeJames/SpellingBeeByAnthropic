const express = require('express');
const { getDB } = require('../db');
const ShopItem = require('../models/ShopItem');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/*
 * 裝備與等級的規則跟前端用同一份檔案（見 levels.js / equipment.js 的說明）。
 * ES module 在 CommonJS 只能動態 import，載入結果快取起來。
 */
let rulesPromise = null;
function rules() {
  if (!rulesPromise) {
    rulesPromise = Promise.all([
      import('../../public/js/shared/equipment.js'),
      import('../../public/js/shared/levels.js')
    ]).then(([equipment, levels]) => ({ ...equipment, ...levels }));
  }
  return rulesPromise;
}

/** 裝備清單：擁有哪些、裝了哪些、還差幾級才解得開。 */
router.get('/gear', async (req, res, next) => {
  try {
    const { GEAR, SLOTS, SLOT_LABELS, DEFAULT_EQUIPPED, gearAvailability, levelFromXp } = await rules();
    const level = levelFromXp(req.user.xp || 0).level;
    const honey = req.user.honey || 0;
    const owned = new Set(req.user.ownedGear || []);
    const equipped = { ...DEFAULT_EQUIPPED, ...(req.user.equipped || {}) };

    res.json({
      honey,
      level,
      // 商店要能講「大約再打幾場」，那要原始經驗值，不只是等級
      xp: req.user.xp || 0,
      slots: SLOTS,
      slotLabels: SLOT_LABELS,
      equipped,
      items: GEAR.map((g) => ({
        key: g.key,
        slot: g.slot,
        tier: g.tier,
        name: g.name,
        description: g.description,
        cost: g.cost,
        minLevel: g.minLevel,
        equipped: equipped[g.slot] === g.key,
        ...gearAvailability(g, { level, honey, owned })
      }))
    });
  } catch (err) {
    next(err);
  }
});

/** 買一件裝備。跟造型的購買一樣用 opId 去重。 */
router.post('/gear/buy', async (req, res, next) => {
  try {
    const { gearKey, opId } = req.body || {};
    const { gearByKey, gearAvailability, levelFromXp } = await rules();

    const gear = gearByKey(gearKey);
    if (!gear) return res.status(404).json({ error: '找不到這件裝備' });
    if (gear.tier === 1) return res.status(400).json({ error: '這件是初始裝備，本來就有了' });

    if (opId) {
      const existing = await getDB().collection('purchases').findOne({ userId: req.user._id, opId });
      if (existing) return res.json({ duplicate: true, user: User.sanitizeUser(req.user) });
    }

    const level = levelFromXp(req.user.xp || 0).level;
    const avail = gearAvailability(gear, {
      level,
      honey: req.user.honey || 0,
      owned: req.user.ownedGear || []
    });
    if (avail.owned) return res.status(400).json({ error: '你已經有這件裝備了' });
    if (!avail.unlocked) {
      return res.status(400).json({ error: `要 ${gear.minLevel} 級才解得開，現在是 ${level} 級` });
    }
    if (!avail.affordable) {
      return res.status(400).json({ error: '蜂蜜不夠，再去遊戲模式打幾場吧！' });
    }

    /*
     * 先寫購買紀錄：唯一索引會擋下重試造成的重複扣款。
     * 跟造型的購買完全一樣的做法，同一張 purchases 表。
     */
    try {
      await getDB().collection('purchases').insertOne({
        userId: req.user._id,
        itemKey: gearKey,
        kind: 'gear',
        opId: opId || null,
        cost: gear.cost,
        purchasedAt: new Date()
      });
    } catch (err) {
      if (err.code === 11000) return res.json({ duplicate: true, user: User.sanitizeUser(req.user) });
      throw err;
    }

    /*
     * 扣款與記帳在同一個原子操作裡（條件寫在 query）。
     * 回 null 代表條件在這中間變了——例如同時買了另一件把蜂蜜花掉。
     */
    const updated = await User.buyGear(req.user._id, gearKey, gear.cost);
    if (!updated) {
      await getDB().collection('purchases').deleteOne({ userId: req.user._id, opId: opId || null, itemKey: gearKey });
      return res.status(400).json({ error: '蜂蜜不夠，再去遊戲模式打幾場吧！' });
    }
    res.json({ user: User.sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});

/** 換裝。gearKey 傳 null 代表把那個欄位空出來（只有飾品可以空著）。 */
router.post('/gear/equip', async (req, res, next) => {
  try {
    const { slot, gearKey } = req.body || {};
    const { SLOTS, gearByKey, DEFAULT_EQUIPPED } = await rules();
    if (!SLOTS.includes(slot)) return res.status(400).json({ error: '沒有這個欄位' });

    if (gearKey == null) {
      /*
       * 武器與護甲不能空著——空著等於沒有初始裝備，戰鬥那邊會拿不到倍率。
       * 要「脫掉」就是換回 tier 1，飾品才是真的可以不戴。
       */
      if (slot !== 'trinket') {
        const fallback = DEFAULT_EQUIPPED[slot];
        const user = await User.setEquipped(req.user._id, slot, fallback);
        return res.json({ user: User.sanitizeUser(user) });
      }
      const user = await User.setEquipped(req.user._id, slot, null);
      return res.json({ user: User.sanitizeUser(user) });
    }

    const gear = gearByKey(gearKey);
    if (!gear) return res.status(404).json({ error: '找不到這件裝備' });
    if (gear.slot !== slot) return res.status(400).json({ error: '這件裝備不是裝在這個欄位的' });

    const owned = new Set(req.user.ownedGear || []);
    if (gear.tier !== 1 && !owned.has(gearKey)) {
      return res.status(400).json({ error: '你還沒有這件裝備' });
    }

    const user = await User.setEquipped(req.user._id, slot, gearKey);
    res.json({ user: User.sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/items', async (req, res, next) => {
  try {
    const items = await ShopItem.listActiveItems();
    const owned = new Set(req.user.ownedItemKeys || []);
    res.json({
      items: items.map((item) => ({ ...item, owned: owned.has(item.key) }))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/purchase', async (req, res, next) => {
  try {
    const { itemKey, opId } = req.body || {};

    // 背景同步會重試，先確認這筆購買是不是已經處理過了，避免重複扣款
    if (opId) {
      const existing = await getDB().collection('purchases').findOne({ userId: req.user._id, opId });
      if (existing) {
        return res.json({ duplicate: true, user: User.sanitizeUser(req.user) });
      }
    }

    const item = await ShopItem.getItemByKey(itemKey);
    if (!item || !item.active) return res.status(404).json({ error: '找不到這個商品' });

    if ((req.user.ownedItemKeys || []).includes(itemKey)) {
      return res.status(400).json({ error: '你已經擁有這個商品了' });
    }
    if (req.user.coins < item.cost) {
      return res.status(400).json({ error: '金幣不夠喔，再多練習賺一點吧！' });
    }

    // 先寫購買紀錄：唯一索引會擋下並行或重試造成的重複扣款
    try {
      await getDB().collection('purchases').insertOne({
        userId: req.user._id,
        itemKey,
        opId: opId || null,
        cost: item.cost,
        purchasedAt: new Date()
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.json({ duplicate: true, user: User.sanitizeUser(req.user) });
      }
      throw err;
    }

    const updatedUser = await User.addOwnedItem(req.user._id, itemKey, item.cost);
    res.json({ user: User.sanitizeUser(updatedUser) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
