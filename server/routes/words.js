const express = require('express');
const multer = require('multer');
const { ObjectId } = require('mongodb');
const Word = require('../models/Word');
const { getAudioBucket } = require('../db');
const { requireAuth } = require('../middleware/auth');

/**
 * 單字庫是唯讀的：內容寫死在 server/data/word-bank.js，
 * 沒有新增/編輯/刪除的 API。唯一可以變動的是每個單字的真人錄音。
 */
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('不支援的音檔格式'));
  }
});

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { part } = req.query;
    const words = part ? await Word.listWordsByPart(part) : await Word.listWords();
    res.json({ words, parts: Word.PARTS });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const word = await Word.getWordById(req.params.id);
    if (!word) return res.status(404).json({ error: '找不到這個單字' });
    res.json({ word });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/audio', upload.single('audio'), async (req, res, next) => {
  try {
    const word = await Word.getWordById(req.params.id);
    if (!word) return res.status(404).json({ error: '找不到這個單字' });
    if (!req.file) return res.status(400).json({ error: '沒有收到音檔' });

    const durationSec = Number(req.body.durationSec) || null;

    const existing = await Word.getAudio(req.params.id);
    if (existing && existing.gridfsFileId) {
      await safeDeleteFromBucket(existing.gridfsFileId);
    }

    const fileId = await uploadBufferToBucket(
      req.file.buffer,
      `word-${req.params.id}-${Date.now()}`,
      { mimeType: req.file.mimetype, wordId: req.params.id }
    );

    const updated = await Word.setAudio(req.params.id, {
      gridfsFileId: fileId,
      mimeType: req.file.mimetype,
      durationSec
    });
    res.json({ word: updated });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/audio', async (req, res, next) => {
  try {
    const audio = await Word.getAudio(req.params.id);
    if (!audio || !audio.gridfsFileId) {
      return res.status(404).json({ error: '這個單字沒有錄音' });
    }
    res.set('Content-Type', audio.mimeType || 'audio/webm');
    const stream = getAudioBucket().openDownloadStream(new ObjectId(audio.gridfsFileId));
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/audio', async (req, res, next) => {
  try {
    const existing = await Word.getAudio(req.params.id);
    if (existing && existing.gridfsFileId) {
      await safeDeleteFromBucket(existing.gridfsFileId);
    }
    const updated = await Word.clearAudio(req.params.id);
    res.json({ word: updated });
  } catch (err) {
    next(err);
  }
});

function uploadBufferToBucket(buffer, filename, metadata) {
  return new Promise((resolve, reject) => {
    const stream = getAudioBucket().openUploadStream(filename, { metadata });
    stream.on('finish', () => resolve(stream.id));
    stream.on('error', reject);
    stream.end(buffer);
  });
}

async function safeDeleteFromBucket(fileId) {
  try {
    await getAudioBucket().delete(new ObjectId(fileId));
  } catch (err) {
    // 檔案可能已不存在，忽略即可
  }
}

module.exports = router;
