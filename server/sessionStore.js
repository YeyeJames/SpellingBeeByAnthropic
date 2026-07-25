const session = require('express-session');
const MongoStore = require('connect-mongo');

/**
 * 延遲掛載的 session store。
 *
 * 為什麼需要這個：如果直接把 mongoUrl 交給 connect-mongo，它會自己去連資料庫，
 * 而連線失敗時丟出的錯誤沒有任何地方可以攔截，會直接讓整個 Node process 崩潰。
 * 那會造成一個很難查的症狀——首頁 HTML 送得出去，但緊接著 process 就死了，
 * 後續的 CSS/JS 全部拿不到，畫面變成沒有樣式的空白頁。
 *
 * 所以這裡改成：一開始先用記憶體 store 讓伺服器正常運作，
 * 等我們自己的資料庫連線確定成功後，再把真正的 MongoDB store 掛上去。
 */
class LazyMongoStore extends session.Store {
  constructor() {
    super();
    this.realStore = null;
    this.fallbackStore = new session.MemoryStore();
  }

  attachMongo(client) {
    try {
      this.realStore = MongoStore.create({ client, collectionName: 'sessions' });
      console.log('✅ Session 已切換為 MongoDB 儲存');
    } catch (err) {
      console.error('⚠️ Session store 掛載失敗，繼續使用記憶體儲存:', err.message);
    }
  }

  active() {
    return this.realStore || this.fallbackStore;
  }

  get(sid, cb) {
    this.active().get(sid, cb);
  }

  set(sid, sess, cb) {
    this.active().set(sid, sess, cb);
  }

  destroy(sid, cb) {
    this.active().destroy(sid, cb);
  }

  touch(sid, sess, cb) {
    const store = this.active();
    if (typeof store.touch === 'function') return store.touch(sid, sess, cb);
    if (cb) cb();
  }
}

module.exports = { LazyMongoStore };
