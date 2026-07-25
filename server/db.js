const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error('MONGODB_URI is not set');
}

const client = new MongoClient(uri);
let db;

async function connectDB() {
  if (db) return db;
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  return db;
}

async function ensureIndexes(database) {
  await database.collection('users').createIndex(
    { nicknameLower: 1 },
    { unique: true }
  );
  await database.collection('words').createIndex({ tags: 1 });
  await database.collection('wordProgress').createIndex(
    { userId: 1, wordId: 1 },
    { unique: true }
  );
  await database.collection('wordProgress').createIndex({ userId: 1, nextReviewAt: 1 });
  await database.collection('attempts').createIndex({ userId: 1, attemptedAt: 1 });
  await database.collection('shopItems').createIndex({ key: 1 }, { unique: true });
}

function getDB() {
  if (!db) {
    throw new Error('Database not connected yet. Call connectDB() first.');
  }
  return db;
}

module.exports = { connectDB, getDB, client };
