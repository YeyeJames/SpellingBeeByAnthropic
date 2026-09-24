/*
 * 帳號 = 選一個名字。沒有密碼、沒有 PIN。
 *
 * 這台機器只有我跟孩子在用，家裡沒有外人。PIN 擋不到任何人，
 * 只會讓孩子每次玩之前多按四下，還常常忘記。
 *
 * 各帳號之間仍然是分開的：分數、金幣、練過哪幾組、哪幾組解鎖了，
 * 都跟著帳號走。唯一共用的是單字錄音（見 models/User.js 的說明）。
 */
const express = require('express');
const {
  createUser,
  findByNickname,
  findById,
  listProfiles,
  deleteUser,
  touchLastLogin,
  updateAudioPrefs,
  sanitizeUser
} = require('../models/User');
const { isValidNickname } = require('../utils/nickname');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const wordBank = require('../data/word-bank');

const router = express.Router();

router.get('/profiles', async (req, res, next) => {
  try {
    const profiles = await listProfiles();
    res.json({ profiles, banks: wordBank.listBanks() });
  } catch (err) {
    next(err);
  }
});

router.post('/register', loginLimiter, async (req, res, next) => {
  try {
    const { nickname, wordBankId } = req.body || {};
    if (!isValidNickname(nickname)) {
      return res.status(400).json({ error: '暱稱格式不正確（1-20字，可用中英數字）' });
    }
    const existing = await findByNickname(nickname);
    if (existing) {
      return res.status(409).json({ error: '這個暱稱已經有人用了，換一個試試' });
    }
    /*
     * 建帳號時就選好用哪一本課本。
     *
     * 兩個孩子各有各的單字庫，選錯的話他會一路練到別人的單字——
     * 而那件事從畫面上看不出來（單字都是英文，他不會知道那不是自己的功課）。
     * 認不得的 id 會退回預設那一本，不會建出一個指著不存在課本的帳號。
     */
    const user = await createUser(nickname, wordBank.resolveBankId(wordBankId));
    req.session.userId = user._id.toString();
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    // 登入不碰課本——課本是帳號的屬性，選帳號的時候就決定了
    const { nickname } = req.body || {};
    if (!isValidNickname(nickname)) {
      return res.status(400).json({ error: '暱稱格式不正確' });
    }
    const user = await findByNickname(nickname);
    if (!user) {
      return res.status(404).json({ error: '找不到這個帳號' });
    }
    req.session.userId = user._id.toString();
    await touchLastLogin(user._id);
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

/*
 * 刪帳號。
 *
 * 刪掉的是這個帳號自己的東西：分數、金幣、練習紀錄、解鎖進度。
 * **單字錄音不會跟著消失**——那是孩子錄的，跨帳號共用，刪掉一個帳號
 * 不該讓他錄過的聲音不見。
 *
 * 要求把暱稱原字打一次才刪：誤按一下就清掉一個孩子的所有進度太容易了。
 */
router.delete('/profiles/:id', async (req, res, next) => {
  try {
    const { confirmNickname } = req.body || {};
    const target = await findById(req.params.id).catch(() => null);
    if (!target) return res.status(404).json({ error: '找不到這個帳號' });

    if (String(confirmNickname || '').trim() !== target.nickname) {
      return res.status(400).json({ error: '請把要刪除的帳號名稱完整打一次' });
    }

    await deleteUser(req.params.id);

    // 刪掉的如果就是自己，順手登出，不要留下一個指向空帳號的 session
    if (req.session && req.session.userId === String(req.params.id)) {
      req.session.userId = null;
    }
    res.json({ ok: true, nickname: target.nickname });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.userSafe });
});

router.put('/audio-prefs', requireAuth, async (req, res, next) => {
  try {
    const { bgmVolume, sfxVolume, muted } = req.body || {};
    const prefs = {
      bgmVolume: clampVolume(bgmVolume, req.user.audioPrefs.bgmVolume),
      sfxVolume: clampVolume(sfxVolume, req.user.audioPrefs.sfxVolume),
      muted: typeof muted === 'boolean' ? muted : req.user.audioPrefs.muted
    };
    await updateAudioPrefs(req.user._id, prefs);
    res.json({ audioPrefs: prefs });
  } catch (err) {
    next(err);
  }
});

function clampVolume(value, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

module.exports = router;
