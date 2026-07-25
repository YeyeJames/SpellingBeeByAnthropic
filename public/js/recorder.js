const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || null;
}

const MAX_DURATION_MS = 5000;

/**
 * 建立一個簡單的錄音器。回傳 { start, stop, cancel }。
 * onDone(blob, mimeType, durationSec) 錄音完成時呼叫。
 * onError(err) 取得麥克風權限失敗或錄音發生錯誤時呼叫。
 */
export function createRecorder({ onDone, onError }) {
  let mediaRecorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let autoStopTimer = null;

  async function start() {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      onError && onError(new Error('這個瀏覽器不支援錄音功能'));
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType();
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunks = [];
      startedAt = Date.now();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const durationSec = (Date.now() - startedAt) / 1000;
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stopStreamTracks();
        onDone && onDone(blob, mediaRecorder.mimeType || 'audio/webm', durationSec);
      };
      mediaRecorder.start();
      autoStopTimer = setTimeout(() => stop(), MAX_DURATION_MS);
    } catch (err) {
      onError && onError(err);
    }
  }

  function stop() {
    clearTimeout(autoStopTimer);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  function cancel() {
    clearTimeout(autoStopTimer);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.onstop = null;
      mediaRecorder.stop();
    }
    stopStreamTracks();
  }

  function stopStreamTracks() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  return { start, stop, cancel, maxDurationMs: MAX_DURATION_MS };
}
