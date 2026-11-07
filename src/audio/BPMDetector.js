/**
 * BPMDetector.js — 웹 워커를 이용한 비동기 BPM 감지 (싱글톤 워커 + 순차 작업 큐)
 */

let _worker = null;
const _queue = [];
let _processing = false;

function getWorker() {
  if (!_worker) {
    _worker = new Worker(new URL('./BPMWorker.js', import.meta.url));
  }
  return _worker;
}

function processNext() {
  if (_processing || _queue.length === 0) return;
  _processing = true;
  const { data, sampleRate, resolve } = _queue.shift();

  try {
    const worker = getWorker();
    worker.onmessage = (e) => {
      _processing = false;
      resolve(e.data.bpm);
      processNext();
    };
    worker.onerror = () => {
      _processing = false;
      if (_worker) {
        _worker.terminate();
        _worker = null;
      }
      resolve(null);
      processNext();
    };
    worker.postMessage({ buffer: data, sampleRate }, [data.buffer]);
  } catch (e) {
    console.warn('BPM worker failed:', e);
    _processing = false;
    resolve(null);
    processNext();
  }
}

export async function detectBPM(audioBuffer) {
  return new Promise((resolve) => {
    try {
      const sampleRate = audioBuffer.sampleRate;
      const totalDuration = audioBuffer.length / sampleRate;
      // 스윙 재즈 인트로(루바토/무반주) 영향을 줄이기 위해 25초 이상 곡은 앞부분 일부 건너뜀
      const offsetSec = totalDuration > 25 ? Math.min(12, totalDuration * 0.12) : 0;
      const startSample = Math.floor(offsetSec * sampleRate);
      // 최대 60초 구간 분석
      const analyzeSamples = Math.min(audioBuffer.length - startSample, sampleRate * 60);
      if (analyzeSamples < sampleRate * 3) {
        resolve(null);
        return;
      }
      const data = audioBuffer.getChannelData(0).slice(startSample, startSample + analyzeSamples);

      _queue.push({ data, sampleRate, resolve });
      processNext();
    } catch (e) {
      console.warn('BPM detect preparation failed:', e);
      resolve(null);
    }
  });
}
