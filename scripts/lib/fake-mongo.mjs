/**
 * 記憶體版的假 MongoDB。
 *
 * 為什麼需要它：這台開發機沒有 MongoDB，也裝不了（下載站被擋）。
 * 但「選一組開始練習」「練完兩次解鎖遊戲」「刪帳號」這幾條路徑全都要碰
 * 資料庫，只靠讀程式碼交差等於沒測。做法是把 server/db.js 換掉，
 * 路由、模型、單字庫都用真的，只有儲存層是假的。
 *
 * 刻意只實作真的會被用到的操作。多寫的部分不會被測到，
 * 反而會變成「看起來有測」的假象。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');

function matchValue(actual, expected) {
  if (expected instanceof ObjectId) {
    return actual != null && actual.toString() === expected.toString();
  }
  if (expected && typeof expected === 'object' && '$type' in expected) {
    return expected.$type === 'string' ? typeof actual === 'string' : actual != null;
  }
  /*
   * 比較運算子。
   *
   * 買裝備是把條件寫進 query 的（honey: {$gte: cost}、ownedGear: {$ne: key}），
   * 這樣扣款與記帳才是同一個原子操作——先讀出來判斷再寫回去的話，
   * 連按兩下就會扣兩次錢。這個假的原本只認嚴格相等，於是那個查詢永遠
   * 配不到任何一筆，測出來是「蜂蜜不夠」。
   * 那不是程式錯，是這個測試替身不完整。
   */
  if (expected && typeof expected === 'object') {
    if ('$gte' in expected) return Number(actual) >= Number(expected.$gte);
    if ('$lte' in expected) return Number(actual) <= Number(expected.$lte);
    if ('$gt' in expected) return Number(actual) > Number(expected.$gt);
    if ('$lt' in expected) return Number(actual) < Number(expected.$lt);
    if ('$ne' in expected) {
      // 陣列欄位的 $ne 是「陣列裡沒有這個元素」
      if (Array.isArray(actual)) return !actual.some((v) => String(v) === String(expected.$ne));
      return actual !== expected.$ne;
    }
    if ('$in' in expected) {
      const list = expected.$in.map(String);
      if (Array.isArray(actual)) return actual.some((v) => list.includes(String(v)));
      return list.includes(String(actual));
    }
  }
  return actual === expected;
}

function matches(doc, query) {
  return Object.entries(query).every(([k, v]) => matchValue(doc[k], v));
}

/** 'stats.coins' 這種帶點的路徑要寫得進去，計分用的更新全是這種形狀。 */
function setPath(doc, path, value) {
  const parts = path.split('.');
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

function getPath(doc, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), doc);
}

function applyUpdate(doc, update) {
  for (const [path, value] of Object.entries(update.$set || {})) setPath(doc, path, value);
  for (const [path, delta] of Object.entries(update.$inc || {})) {
    setPath(doc, path, (Number(getPath(doc, path)) || 0) + delta);
  }
  for (const [path, value] of Object.entries(update.$addToSet || {})) {
    const arr = getPath(doc, path) || [];
    if (!arr.includes(value)) arr.push(value);
    setPath(doc, path, arr);
  }
  for (const [path, value] of Object.entries(update.$pull || {})) {
    setPath(doc, path, (getPath(doc, path) || []).filter((v) => v !== value));
  }
  return doc;
}

/**
 * 建一個假的 db 物件。
 * @param {object} store 以 collection 名稱為鍵的陣列容器，測試可以直接檢查
 * @param {object} opts.uniqueIndexes 例：{ attempts: ['userId','opId'] }
 *   真資料庫靠唯一索引擋下重複計分，假資料庫不模擬的話「重試會不會重複計分」
 *   這件事就測不到——而那正是最該測的。
 */
export function createFakeDb(store, { uniqueIndexes = {} } = {}) {
  function collection(name) {
    const rows = store[name] || (store[name] = []);
    const unique = uniqueIndexes[name];

    function violatesUnique(doc) {
      if (!unique) return false;
      // 索引欄位有一個是 null/undefined 就不算在索引範圍內（對應 partial index）
      if (unique.some((k) => doc[k] == null)) return false;
      return rows.some((r) => unique.every((k) => String(r[k]) === String(doc[k])));
    }

    return {
      find: (query = {}) => ({
        sort: () => ({ toArray: async () => rows.filter((d) => matches(d, query)) }),
        toArray: async () => rows.filter((d) => matches(d, query))
      }),
      findOne: async (query = {}) => rows.find((d) => matches(d, query)) || null,
      countDocuments: async (query = {}) => rows.filter((d) => matches(d, query)).length,
      insertOne: async (doc) => {
        if (violatesUnique(doc)) {
          const err = new Error('duplicate key');
          err.code = 11000;
          throw err;
        }
        const _id = doc._id || new ObjectId();
        rows.push({ ...doc, _id });
        return { insertedId: _id };
      },
      updateOne: async (query = {}, update = {}, opts = {}) => {
        const hit = rows.find((d) => matches(d, query));
        if (hit) {
          applyUpdate(hit, update);
          return { matchedCount: 1, modifiedCount: 1 };
        }
        if (opts.upsert) {
          rows.push(applyUpdate({ ...query, _id: new ObjectId() }, update));
          return { matchedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0 };
      },
      /*
       * 遊戲模式加經驗用的是 findOneAndUpdate。
       *
       * 用它而不是 updateOne 是因為 $inc 要原子：兩場同時回報（重送、
       * 多分頁）時，讀-改-寫會讓其中一場的經驗憑空消失。
       * 這個假的一開始沒有這個方法，整支測試就以
       * 500「findOneAndUpdate is not a function」失敗——那不是程式錯，
       * 是這個測試替身不完整。
       *
       * driver 6 回傳的是文件本身（不是 { value }），這裡照它的形狀回。
       */
      findOneAndUpdate: async (query = {}, update = {}, opts = {}) => {
        const hit = rows.find((d) => matches(d, query));
        if (!hit) {
          if (!opts.upsert) return null;
          const created = applyUpdate({ ...query, _id: new ObjectId() }, update);
          rows.push(created);
          return created;
        }
        const before = { ...hit };
        applyUpdate(hit, update);
        return opts.returnDocument === 'before' ? before : hit;
      },
      deleteOne: async (query = {}) => {
        const i = rows.findIndex((d) => matches(d, query));
        if (i < 0) return { deletedCount: 0 };
        rows.splice(i, 1);
        return { deletedCount: 1 };
      },
      deleteMany: async (query = {}) => {
        const keep = rows.filter((d) => !matches(d, query));
        const removed = rows.length - keep.length;
        rows.length = 0;
        rows.push(...keep);
        return { deletedCount: removed };
      },
      createIndex: async () => 'ok'
    };
  }

  return { collection };
}

/**
 * 把 server/db.js 從 require 快取換成假的。
 *
 * 必須在載入任何模型「之前」做：模型是在載入時就把 getDB 解構走的。
 */
export function installFakeDb(fakeDb) {
  // 從這個檔案自己的位置解析 server/db.js。require 快取是全域的，
  // 所以在這裡換掉，呼叫端之後載入的模型就會拿到假的
  const dbPath = require.resolve('../../server/db.js');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      connectDB: async () => fakeDb,
      getDB: () => fakeDb,
      getAudioBucket: () => {
        throw new Error('這支測試不碰錄音檔');
      },
      getClient: () => null
    }
  };
}

export { ObjectId };
