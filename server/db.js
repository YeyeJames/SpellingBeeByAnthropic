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
  await seedShopItems(db);
  return db;
}

/**
 * 把程式碼裡那份商店清單寫進資料庫。
 *
 * 商店品項本來要手動跑 `npm run seed` 才會進資料庫，而 Render 上從來沒有
 * 人跑過——兒子第一次玩就先跑去點商店想看有什麼，看到的是一片空白
 * （shopItemCount 是 0）。商店是賺金幣的唯一理由，第一次點進去空白，
 * 他學到的是「這裡沒東西」。
 *
 * 靜態資料不該需要額外的部署步驟：單字庫不用 seed 就能用，商店也一樣。
 * 跟建索引放在一起，理由相同——兩者都是「這個資料庫要能用，就必須有」。
 *
 * upsert 是冪等的，每次啟動跑一次沒有副作用；失敗也不讓伺服器起不來，
 * 商店空著比整個 app 打不開好得多。
 */
async function seedShopItems(database) {
  try {
    const { SHOP_ITEMS } = require('./data/shop-items');
    await Promise.all(
      SHOP_ITEMS.map((item) =>
        database.collection('shopItems').updateOne({ key: item.key }, { $set: item }, { upsert: true })
      )
    );
  } catch (err) {
    console.error('⚠️ 商店品項寫入失敗（商店會是空的，其他功能不受影響）:', err.message);
  }
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
  // 練完一組、打完一場也都走背景佇列，同樣會重試
  await database.collection('groupCompletions').createIndex(
    { userId: 1, opId: 1 },
    { unique: true, partialFilterExpression: { opId: { $type: 'string' } } }
  );
  await database.collection('gameResults').createIndex(
    { userId: 1, opId: 1 },
    { unique: true, partialFilterExpression: { opId: { $type: 'string' } } }
  );

  // 每個帳號在每一組上只有一列進度
  await database.collection('groupProgress').createIndex({ userId: 1, groupId: 1 }, { unique: true });
  // 戰役進度：一個帳號一列
  await database.collection('campaignProgress').createIndex({ userId: 1 }, { unique: true });
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

/*
 * seedShopItems 對外開放是為了讓測試呼叫「真的那一個」。
 * 測試自己抄一份 upsert 迴圈的話，程式壞了測試照樣會過。
 */
module.exports = { connectDB, getDB, getAudioBucket, getClient, seedShopItems };
