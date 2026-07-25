const express = require('express');
const multer = require('multer');
const { ObjectId } = require('mongodb');
const Word = require('../models/Word');
const { getAudioBucket } = require('../db');
const { validateWordInput } = require('../utils/validation');
const { requireAuth } = require('../middleware/auth');
const { wordCreateLimiter } = require('../middleware/rateLimit');

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
    const { tag, search } = req.query;
    const words = await Word.listWords({ tag, search });
    res.json({ words });
  } catch (err) {
    next(err);
  }
});

router.get('/tags-list', async (req, res, next) => {
  try {
    const tags = await Word.listTags();
    res.json({ tags: tags.filter(Boolean).sort() });
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

router.post('/', wordCreateLimiter, async (req, res, next) => {
  try {
    const { valid, errors, cleaned } = validateWordInput(req.body || {});
    if (!valid) return res.status(400).json({ error: errors.join('; ') });

    // 背景同步重試時不能重複建立同一個單字
    const opId = req.body && req.body.opId;
    if (opId) {
      const existing = await Word.getWordByOpId(opId);
      if (existing) return res.status(200).json({ word: existing, duplicate: true });
    }

    const duplicate = await Word.findDuplicateEnglish(cleaned.english);
    const word = await Word.createWord(cleaned, req.user._id, opId);
    res.status(201).json({ word, duplicateWarning: !!duplicate });
  } catch (err) {
    if (err.code === 11000 && req.body && req.body.opId) {
      const existing = await Word.getWordByOpId(req.body.opId);
      if (existing) return res.status(200).json({ word: existing, duplicate: true });
    }
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const existing = await Word.getWordById(req.params.id);
    if (!existing) return res.status(404).json({ error: '找不到這個單字' });

    const { valid, errors, cleaned } = validateWordInput(req.body || {});
    if (!valid) return res.status(400).json({ error: errors.join('; ') });

    const duplicate = await Word.findDuplicateEnglish(cleaned.english, req.params.id);
    const word = await Word.updateWord(req.params.id, cleaned);
    res.json({ word, duplicateWarning: !!duplicate });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await Word.getWordById(req.params.id);
    if (!existing) return res.status(404).json({ error: '找不到這個單字' });
    if (existing.audio && existing.audio.gridfsFileId) {
      await safeDeleteFromBucket(existing.audio.gridfsFileId);
    }
    await Word.deleteWord(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/audio', upload.single('audio'), async (req, res, next) => {
  try {
    const existing = await Word.getWordById(req.params.id);
    if (!existing) return res.status(404).json({ error: '找不到這個單字' });
    if (!req.file) return res.status(400).json({ error: '沒有收到音檔' });

    const durationSec = Number(req.body.durationSec) || null;

    if (existing.audio && existing.audio.gridfsFileId) {
      await safeDeleteFromBucket(existing.audio.gridfsFileId);
    }

    const fileId = await uploadBufferToBucket(
      req.file.buffer,
      `word-${req.params.id}-${Date.now()}`,
      { mimeType: req.file.mimetype, wordId: req.params.id }
    );

    const word = await Word.setAudio(req.params.id, {
      gridfsFileId: fileId,
      mimeType: req.file.mimetype,
      durationSec
    });
    res.json({ word });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/audio', async (req, res, next) => {
  try {
    const word = await Word.getWordById(req.params.id);
    if (!word || !word.audio || !word.audio.gridfsFileId) {
      return res.status(404).json({ error: '這個單字沒有錄音' });
    }
    res.set('Content-Type', word.audio.mimeType || 'audio/webm');
    const stream = getAudioBucket().openDownloadStream(new ObjectId(word.audio.gridfsFileId));
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/audio', async (req, res, next) => {
  try {
    const existing = await Word.getWordById(req.params.id);
    if (!existing) return res.status(404).json({ error: '找不到這個單字' });
    if (existing.audio && existing.audio.gridfsFileId) {
      await safeDeleteFromBucket(existing.audio.gridfsFileId);
    }
    const word = await Word.clearAudio(req.params.id);
    res.json({ word });
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
