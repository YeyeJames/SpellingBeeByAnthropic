require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const { connectDB, getDB, getClient } = require('./db');
const { LazyMongoStore } = require('./sessionStore');
const authRoutes = require('./routes/auth');
const wordsRoutes = require('./routes/words');
const practiceRoutes = require('./routes/practice');
const gameRoutes = require('./routes/game');
const campaignRoutes = require('./routes/campaign');
const shopRoutes = require('./routes/shop');
const usersRoutes = require('./routes/users');
const telemetryRoutes = require('./routes/telemetry');
const wordBank = require('./data/word-bank');

const PORT = process.env.PORT || 3000;

// 版本標記：Render 部署時會帶入 commit SHA，本機開發則退回啟動時間。
// 用來判斷「手機上看到的是不是最新版」，這種問題光看畫面猜不出來。
const BUILD_ID =
  process.env.RENDER_GIT_COMMIT || process.env.BUILD_ID || `dev-${Date.now().toString(36)}`;
const STARTED_AT = new Date().toISOString();

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

  const sessionMiddleware = session({
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
  });

  // 健康檢查：直接用瀏覽器開 /api/health 就能看出伺服器與資料庫狀態
  app.get('/api/health', async (req, res) => {
    const info = {
      server: 'ok',
      database: dbState.ready ? 'connected' : 'disconnected',
      databaseError: dbState.error,
      lastConnectionAttempt: dbState.lastAttemptAt,
      hasMongoUri: !!process.env.MONGODB_URI,
      hasSessionSecret: !!process.env.SESSION_SECRET,
      sessionStorage: sessionStore.isPersistent() ? 'mongodb' : 'memory(重啟後會被登出)',
      // 版本標記：用來確認手機拿到的是不是最新部署的版本
      buildId: BUILD_ID,
      startedAt: STARTED_AT,
      nodeEnv: process.env.NODE_ENV || null,
      time: new Date().toISOString()
    };

    if (dbState.ready) {
      try {
        const db = getDB();
        info.databaseName = db.databaseName;
        info.userCount = await db.collection('users').countDocuments();
        info.recordedAudioCount = await db.collection('wordAudio').countDocuments();
        info.shopItemCount = await db.collection('shopItems').countDocuments();
      } catch (err) {
        info.database = 'error';
        info.databaseError = err.message;
      }
    }

    res.status(dbState.ready ? 200 : 503).json(info);
  });

  /*
   * 單字庫的唯讀端點，刻意擋在資料庫關卡「之前」。
   *
   * 單字庫是寫死在 server/data/word-bank.js 的靜態資料，不碰資料庫也不需要登入
   * （那是公開的競賽單字表，沒有任何個人資料）。放在關卡前面有兩個好處：
   *   - 資料庫掛掉時遊戲頁仍然打得開
   *   - 自動化測試不必先登入就能跑，測試環境因此不需要 MongoDB
   */
  /*
   * 只要組別目錄，不要四百多個字。
   * 練習頁的「選一組」只需要這個，沒必要為了畫幾顆按鈕就載入整個單字庫。
   */
  /*
   * ?bank= 指定是哪一本課本（兩個孩子各一本）。
   *
   * 這一支不需要登入，所以看不到 req.user，課本只能由呼叫端帶進來。
   * 不帶就給預設那一本——舊的連結與測試因此照樣能用。
   */
  app.get('/api/wordbank/groups', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ groups: wordBank.listGroups(req.query.bank), banks: wordBank.listBanks() });
  });

  app.get('/api/wordbank', (req, res) => {
    const { part, group } = req.query;
    // group 是現在的單位（Part 1、Week 1 都是一組）；part 是競賽單字留下來的舊參數
    let words;
    const bank = req.query.bank;
    if (group) words = wordBank.wordsByGroup(group);
    /*
     * part=all 是「整本都給我」，不是某一個 part。
     *
     * 沒有這一行的話會走到 wordsByPart('all')，而那裡是 w.part === Number('all')
     * ——Number('all') 是 NaN，跟任何東西比都是 false，所以**回傳空陣列**。
     * 戰役就是這樣壞掉的：地圖上寫著「Week 1・40 字」，按下去卻說
     * 「這一關沒有可以打的字」。沒有任何錯誤、沒有 500，只是安靜地回 0 筆。
     *
     * 遊戲頁有兩個地方會問「整本」，而它們本來用不一樣的寫法（一個送
     * part=all、一個乾脆不送 part），所以只有其中一個是通的。
     * 現在兩種寫法都對。
     */
    else if (part === 'all') words = wordBank.getBank(bank).words;
    else if (part) {
      // 不是數字就明講。放行的話會走進 wordsByPart 的 NaN 陷阱，變成安靜的 0 筆
      if (!Number.isFinite(Number(part))) {
        return res.status(400).json({ error: `part 要是數字或 all，收到「${part}」` });
      }
      words = wordBank.wordsByPart(part, bank);
    }
    /*
     * 不指定就給**那一本**的全部，而不是所有課本的全部。
     * 給全部的話，Allen 的遊戲頁會把 Pierce 的字也載進來——
     * 雖然靠 id 濾得掉，但那等於把另一個孩子的整份題庫送到他的瀏覽器裡。
     */
    else words = wordBank.getBank(bank).words;
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      words,
      parts: wordBank.getBank(bank).parts,
      groups: wordBank.listGroups(bank),
      bank: wordBank.resolveBankId(bank)
    });
  });

  // 這道關卡必須擋在 session 中介層「之前」。
  // 否則資料庫還在連線時，session 會先從空的暫用 store 讀取（讀不到登入紀錄），
  // 而等它讀完時資料庫剛好連上了，關卡就會放行，最後變成 401
  //  → 使用者明明登入著卻被踢回登入頁，過幾秒又自己登入回來。
  app.use('/api', (req, res, next) => {
    if (!dbState.ready) {
      return res.status(503).json({
        error: `資料庫尚未連線：${dbState.error || '連線中，請稍候再試'}`
      });
    }
    next();
  });

  // session 只掛在 /api 底下：靜態檔案（CSS/JS/圖片）不需要 session，
  // 每個檔案都去查一次 session store 只是白白增加延遲
  app.use('/api', sessionMiddleware);

  app.use('/api/auth', authRoutes);
  app.use('/api/words', wordsRoutes);
  app.use('/api/practice', practiceRoutes);
  app.use('/api/game', gameRoutes);
  app.use('/api/campaign', campaignRoutes);
  app.use('/api/shop', shopRoutes);
  app.use('/api/user', usersRoutes);
  app.use('/api/telemetry', telemetryRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: 'API 端點不存在' }));

  // 乾淨網址：/game 直接給遊戲頁。遊戲刻意與現有練習頁分開，
  // 做到一半也不會影響小孩每天在用的東西。
  app.get('/game', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '..', 'public', 'game.html'));
  });

  // 聲音自我檢查頁。開發環境聽不到聲音，這一頁是借家長的耳朵驗證。
  app.get('/selftest', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '..', 'public', 'selftest.html'));
  });

  /*
   * 靜態檔案一律要求重新驗證。
   *
   * 這個專案刻意沒有建置步驟，檔名不含內容雜湊（style.css 而不是 style.abc123.css），
   * 所以只要瀏覽器把 CSS/JS 快取起來，部署新版之後手機仍會拿舊檔案，
   * 畫面看起來就像根本沒更新——這種問題非常難查。
   *
   * no-cache 的意思是「可以存，但每次都要跟伺服器確認」，
   * 檔案沒變時回 304，幾乎不耗流量，卻能保證永遠拿到最新版本。
   */
  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        // HTML 與導覽列樣板每次都要向伺服器確認，這樣部署後才會立刻帶到新的資源參照
        if (/\.html$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
          return;
        }
        // CSS/JS/圖片給一分鐘的新鮮期：切換分頁時可直接用快取，不必每個檔案都往返一次。
        // 一分鐘後自動重新驗證，所以部署新版最多一分鐘就會生效。
        res.setHeader('Cache-Control', 'public, max-age=60');
      }
    })
  );

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
