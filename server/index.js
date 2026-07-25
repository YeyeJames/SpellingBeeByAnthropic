require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const { connectDB, getDB, getClient } = require('./db');
const { LazyMongoStore } = require('./sessionStore');
const authRoutes = require('./routes/auth');
const wordsRoutes = require('./routes/words');
const practiceRoutes = require('./routes/practice');
const shopRoutes = require('./routes/shop');
const usersRoutes = require('./routes/users');

const PORT = process.env.PORT || 3000;

// 資料庫連線狀態。伺服器不會因為連不上資料庫就直接結束——
// 而是照常啟動並在 /api/health 與 API 回應中明確說明原因，
// 否則 Render 只會顯示一個沒有任何線索的通用錯誤頁。
const dbState = { ready: false, error: null, lastAttemptAt: null };
const sessionStore = new LazyMongoStore();

async function tryConnectDB() {
  dbState.lastAttemptAt = new Date();
  try {
    await connectDB();
    dbState.ready = true;
    dbState.error = null;
    sessionStore.attachMongo(getClient());
    console.log('✅ MongoDB 連線成功');
  } catch (err) {
    dbState.ready = false;
    dbState.error = err.message;
    console.error('❌ MongoDB 連線失敗:', err.message);
  }
}

// 安全網：資料庫相關的非同步錯誤如果沒被接住，預設會直接殺掉整個 process，
// 導致「首頁送得出去但 CSS/JS 全部失敗」這種很難查的空白畫面。
// 對這個家用小工具來說，記錄下來並繼續提供服務，遠比整個掛掉好。
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ 未處理的 Promise 錯誤（伺服器繼續運作）:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ 未捕捉的例外（伺服器繼續運作）:', err);
});

function main() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  app.use(
    session({
      name: 'connect.sid',
      secret: process.env.SESSION_SECRET || 'insecure-fallback-secret',
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000
      }
    })
  );

  // 健康檢查：直接用瀏覽器開 /api/health 就能看出伺服器與資料庫狀態
  app.get('/api/health', async (req, res) => {
    const info = {
      server: 'ok',
      database: dbState.ready ? 'connected' : 'disconnected',
      databaseError: dbState.error,
      lastConnectionAttempt: dbState.lastAttemptAt,
      hasMongoUri: !!process.env.MONGODB_URI,
      hasSessionSecret: !!process.env.SESSION_SECRET,
      nodeEnv: process.env.NODE_ENV || null,
      time: new Date().toISOString()
    };

    if (dbState.ready) {
      try {
        const db = getDB();
        info.databaseName = db.databaseName;
        info.userCount = await db.collection('users').countDocuments();
        info.wordCount = await db.collection('words').countDocuments();
        info.shopItemCount = await db.collection('shopItems').countDocuments();
      } catch (err) {
        info.database = 'error';
        info.databaseError = err.message;
      }
    }

    res.status(dbState.ready ? 200 : 503).json(info);
  });

  // 資料庫還沒連上時，API 要回一個看得懂的錯誤，而不是各種奇怪的 500
  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
    if (!dbState.ready) {
      return res.status(503).json({
        error: `資料庫尚未連線：${dbState.error || '連線中，請稍候再試'}`
      });
    }
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/words', wordsRoutes);
  app.use('/api/practice', practiceRoutes);
  app.use('/api/shop', shopRoutes);
  app.use('/api/user', usersRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: 'API 端點不存在' }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((req, res) => {
    res.status(404).send('找不到這個頁面');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: `伺服器發生錯誤：${err.message}` });
  });

  app.listen(PORT, () => {
    console.log(`拼字蜂伺服器啟動於 port ${PORT}`);
  });
}

main();
tryConnectDB();
// 首次連線失敗時持續在背景重試，避免要手動重新部署才能恢復
setInterval(() => {
  if (!dbState.ready) tryConnectDB();
}, 15000);
