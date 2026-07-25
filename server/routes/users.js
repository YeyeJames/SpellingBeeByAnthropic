const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = ['theme', 'avatarAccessory'];

router.post('/equip', async (req, res, next) => {
  try {
    const { type, itemKey } = req.body || {};
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: '不合法的造型類型' });

    const isDefaultTheme = type === 'theme' && itemKey === 'sports';
    if (!isDefaultTheme && !(req.user.ownedItemKeys || []).includes(itemKey)) {
      return res.status(400).json({ error: '你還沒有解鎖這個造型' });
    }

    const updatedUser = await User.equipItem(req.user._id, type, itemKey);
    res.json({ user: User.sanitizeUser(updatedUser) });
  } catch (err) {
    next(err);
  }
});

router.post('/unequip', async (req, res, next) => {
  try {
    const { itemKey } = req.body || {};
    const updatedUser = await User.unequipAccessory(req.user._id, itemKey);
    res.json({ user: User.sanitizeUser(updatedUser) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
