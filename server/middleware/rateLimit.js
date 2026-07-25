const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '嘗試登入次數過多，請稍後再試' }
});

const wordCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '新增單字太頻繁了，請稍等一下' }
});

module.exports = { loginLimiter, wordCreateLimiter };
