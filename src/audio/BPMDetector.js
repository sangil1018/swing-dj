/**
 * BPMDetector.js — 오프라인 분석 기반 BPM 자동 감지
 * 분석 방법: 저역 필터 → 에너지 피크 감지 → 인터벌 클러스터링
 */

/**
 * BPMDetector.js — 웹 워커를 이용한 비동기 BPM 감지 (싱글톤 워커 + 작업 큐)
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
      // 최대 60초만 분석 (성능)
      const analyzeSamples = Math.min(audioBuffer.length, sampleRate * 60);
      const data = audioBuffer.getChannelData(0).slice(0, analyzeSamples);

      _queue.push({ data, sampleRate, resolve });
      processNext();
    } catch (e) {
      console.warn('BPM detect preparation failed:', e);
      resolve(null);
    }
  });
}
