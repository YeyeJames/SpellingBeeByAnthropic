const { getDB } = require('../db');

function collection() {
  return getDB().collection('shopItems');
}

async function listActiveItems() {
  return collection().find({ active: true }).sort({ type: 1, cost: 1 }).toArray();
}

async function getItemByKey(key) {
  return collection().findOne({ key });
}

async function upsertItem(item) {
  await collection().updateOne(
    { key: item.key },
    { $set: item },
    { upsert: true }
  );
  return getItemByKey(item.key);
}

module.exports = { listActiveItems, getItemByKey, upsertItem };
