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
    const { itemKey } = req.body || {};
    const item = await ShopItem.getItemByKey(itemKey);
    if (!item || !item.active) return res.status(404).json({ error: '找不到這個商品' });

    if ((req.user.ownedItemKeys || []).includes(itemKey)) {
      return res.status(400).json({ error: '你已經擁有這個商品了' });
    }
    if (req.user.coins < item.cost) {
      return res.status(400).json({ error: '金幣不夠喔，再多練習賺一點吧！' });
    }

    const updatedUser = await User.addOwnedItem(req.user._id, itemKey, item.cost);
    await getDB().collection('purchases').insertOne({
      userId: req.user._id,
      itemKey,
      cost: item.cost,
      purchasedAt: new Date()
    });

    res.json({ user: User.sanitizeUser(updatedUser) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
