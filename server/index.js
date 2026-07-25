require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const { connectDB } = require('./db');
const authRoutes = require('./routes/auth');
const wordsRoutes = require('./routes/words');
const practiceRoutes = require('./routes/practice');

const PORT = process.env.PORT || 3000;

async function main() {
  await connectDB();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  app.use(
    session({
      name: 'connect.sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        client: require('./db').client,
        collectionName: 'sessions'
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000
      }
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/words', wordsRoutes);
  app.use('/api/practice', practiceRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '伺服器發生錯誤' });
  });

  app.listen(PORT, () => {
    console.log(`拼字蜂伺服器啟動於 http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('伺服器啟動失敗:', err);
  process.exit(1);
});
