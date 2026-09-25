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
    if (this.realStore) return true;
    try {
      /*
       * touchAfter：資料庫裡的 session 期限最多一天更新一次。
       * 登入改成「有在用就延長」之後（index.js 的 rolling），不設這個的話
       * 每一個請求都會寫一次資料庫，只為了把期限往後推幾秒。
       */
      this.realStore = MongoStore.create({ client, collectionName: 'sessions', touchAfter: 24 * 3600 });
      console.log('✅ Session 已切換為 MongoDB 儲存');
      return true;
    } catch (err) {
      console.error('⚠️ Session store 掛載失敗，繼續使用記憶體儲存:', err.message);
      return false;
    }
  }

  /** 是否已使用 MongoDB 儲存。若為 false，伺服器一重啟所有人就會被登出 */
  isPersistent() {
    return !!this.realStore;
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
