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
    const { part, group } = req.query;
    let words;
    if (group) words = await Word.listWordsByGroup(group);
    else if (part) words = await Word.listWordsByPart(part);
    else words = await Word.listWords();
    res.json({ words, parts: Word.PARTS, groups: Word.listGroups() });
  } catch (err) {
    next(err);
  }
});

/*
 * 哪些單字有真人錄音。
 *
 * 遊戲頁的單字是從 /api/wordbank 拿的（不碰資料庫、不必登入，這樣
 * 資料庫掛掉時遊戲仍然打得開），那份資料裡沒有錄音資訊。少了這支，
 * 遊戲就只會用機器語音唸——孩子特地錄的那個字等於白錄。
 *
 * 只回 id 清單，不回音檔本身：遊戲只需要知道「這個字要不要去抓錄音」。
 *
 * 必須排在 /:id 前面，否則會被當成 id 是 "recorded" 的單字。
 */
router.get('/recorded', async (req, res, next) => {
  try {
    res.json({ wordIds: await Word.listRecordedWordIds() });
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
