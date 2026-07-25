const { findById, sanitizeUser } = require('../models/User');

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '尚未登入' });
  }
  try {
    const user = await findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: '找不到使用者，請重新登入' });
    }
    req.user = user;
    req.userSafe = sanitizeUser(user);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
