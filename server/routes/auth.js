const express = require('express');
const {
  createUser,
  findByNickname,
  listProfiles,
  touchLastLogin,
  updateAudioPrefs,
  sanitizeUser
} = require('../models/User');
const { isValidNickname, isValidPin, verifyPin } = require('../utils/pin');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/profiles', async (req, res, next) => {
  try {
    const profiles = await listProfiles();
    res.json({ profiles });
  } catch (err) {
    next(err);
  }
});

router.post('/register', loginLimiter, async (req, res, next) => {
  try {
    const { nickname, pin } = req.body || {};
    if (!isValidNickname(nickname)) {
      return res.status(400).json({ error: '暱稱格式不正確（1-20字，可用中英數字）' });
    }
    if (!isValidPin(pin)) {
      return res.status(400).json({ error: 'PIN 碼必須是 4 位數字' });
    }
    const existing = await findByNickname(nickname);
    if (existing) {
      return res.status(409).json({ error: '這個暱稱已經有人用了，換一個試試' });
    }
    const user = await createUser(nickname, pin);
    req.session.userId = user._id.toString();
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { nickname, pin } = req.body || {};
    if (!isValidNickname(nickname) || !isValidPin(pin)) {
      return res.status(400).json({ error: '暱稱或 PIN 碼格式不正確' });
    }
    const user = await findByNickname(nickname);
    if (!user) {
      return res.status(401).json({ error: '找不到這個暱稱' });
    }
    const ok = await verifyPin(pin, user.pinHash);
    if (!ok) {
      return res.status(401).json({ error: 'PIN 碼不正確' });
    }
    req.session.userId = user._id.toString();
    await touchLastLogin(user._id);
    res.json({ user: sanitizeUser(user) });
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
