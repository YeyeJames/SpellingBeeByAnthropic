const { MongoClient, GridFSBucket } = require('mongodb');

let client;
let db;
let audioBucket;

/**
 * 注意：這裡刻意「不」在模組載入時就建立連線或拋錯。
 * 缺少 MONGODB_URI 或連線失敗時，伺服器仍要能啟動並透過 /api/health
 * 說明原因，否則 Render 只會顯示一個沒有任何線索的通用錯誤頁。
 */
async function connectDB() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('環境變數 MONGODB_URI 未設定');
  }

  if (!client) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  }

  await client.connect();
  db = client.db();
  audioBucket = new GridFSBucket(db, { bucketName: 'audio' });
  await ensureIndexes(db);
  return db;
}

async function ensureIndexes(database) {
  await database.collection('users').createIndex({ nicknameLower: 1 }, { unique: true });
  await database.collection('wordProgress').createIndex({ userId: 1, wordId: 1 }, { unique: true });
  await database.collection('wordProgress').createIndex({ userId: 1, nextReviewAt: 1 });
  await database.collection('attempts').createIndex({ userId: 1, attemptedAt: 1 });
  await database.collection('shopItems').createIndex({ key: 1 }, { unique: true });
  // 單字內容寫死在程式碼裡，資料庫只存每個單字的真人錄音
  await database.collection('wordAudio').createIndex({ wordId: 1 }, { unique: true });

  // 去重用的索引。背景同步一定會重試，沒有這些索引的話
  // 同一筆作答會被重複計分、同一筆購買會被重複扣款。
  await database.collection('attempts').createIndex(
    { userId: 1, opId: 1 },
    { unique: true, partialFilterExpression: { opId: { $type: 'string' } } }
  );
  await database.collection('purchases').createIndex(
    { userId: 1, opId: 1 },
    { unique: true, partialFilterExpression: { opId: { $type: 'string' } } }
  );
}

function getDB() {
  if (!db) {
    throw new Error('資料庫尚未連線');
  }
  return db;
}

function getAudioBucket() {
  if (!audioBucket) {
    throw new Error('資料庫尚未連線');
  }
  return audioBucket;
}

function getClient() {
  return client;
}

module.exports = { connectDB, getDB, getAudioBucket, getClient };
