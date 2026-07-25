const express = require('express');
const { getDB } = require('../db');
const ShopItem = require('../models/ShopItem');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

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
