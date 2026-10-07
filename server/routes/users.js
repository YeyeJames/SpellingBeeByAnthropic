const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const { SHOP_ITEMS } = require('../data/shop-items');

const VALID_TYPES = ['theme', 'avatarAccessory', 'cosmetic'];

/* 外觀放在哪一格，以程式碼裡的清單為準——不信前端送來的 slot */
function cosmeticSlot(itemKey) {
  const item = SHOP_ITEMS.find((i) => i.key === itemKey && i.type === 'cosmetic');
  return item ? item.slot : null;
}

router.post('/equip', async (req, res, next) => {
  try {
    const { type, itemKey } = req.body || {};
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: '不合法的造型類型' });

    /*
     * 主題的兩種寫法：商品 key 是 theme_space，套用時存的（也是前端送來的）是 space。
     *
     * 本來擁有清單是拿 space 去找——而清單裡存的是 theme_space，永遠找不到，
     * 所以買來的主題**一次都套用不了**：商店頁看起來換了，其實伺服器回 400，
     * 換一頁就變回預設（docs/audit/step6 的 R3）。兩種寫法都認。
     */
    const isDefaultTheme = type === 'theme' && itemKey === 'sports';
    const owned = req.user.ownedItemKeys || [];
    const ownsIt = type === 'theme'
      ? owned.includes(`theme_${itemKey}`) || owned.includes(itemKey)
      : owned.includes(itemKey);
    if (!isDefaultTheme && !ownsIt) {
      return res.status(400).json({ error: '你還沒有解鎖這個造型' });
    }

    if (type === 'cosmetic') {
      const slot = cosmeticSlot(itemKey);
      if (!slot) return res.status(400).json({ error: '找不到這個造型' });
      const updated = await User.equipCosmetic(req.user._id, slot, itemKey);
      return res.json({ user: User.sanitizeUser(updated) });
    }

    const updatedUser = await User.equipItem(req.user._id, type, itemKey);
    res.json({ user: User.sanitizeUser(updatedUser) });
  } catch (err) {
    next(err);
  }
});

router.post('/unequip', async (req, res, next) => {
  try {
    const { itemKey, type } = req.body || {};
    if (type === 'cosmetic') {
      const slot = cosmeticSlot(itemKey);
      if (!slot) return res.status(400).json({ error: '找不到這個造型' });
      const updated = await User.unequipCosmetic(req.user._id, slot, itemKey);
      return res.json({ user: User.sanitizeUser(updated) });
    }
    const updatedUser = await User.unequipAccessory(req.user._id, itemKey);
    res.json({ user: User.sanitizeUser(updatedUser) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
