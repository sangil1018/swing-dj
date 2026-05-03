/**
 * BPMDetector.js — 오프라인 분석 기반 BPM 자동 감지
 * 분석 방법: 저역 필터 → 에너지 피크 감지 → 인터벌 클러스터링
 */

/**
 * BPMDetector.js — 웹 워커를 이용한 비동기 BPM 감지
 */

export async function detectBPM(audioBuffer) {
  return new Promise((resolve) => {
    try {
      const sampleRate = audioBuffer.sampleRate;
      // 최대 60초만 분석 (성능)
      const analyzeSamples = Math.min(audioBuffer.length, sampleRate * 60);
      const data = audioBuffer.getChannelData(0).slice(0, analyzeSamples);

      // 워커 생성 (Blob 이용)
      const worker = new Worker(new URL('./BPMWorker.js', import.meta.url));
      
      worker.onmessage = (e) => {
        resolve(e.data.bpm);
        worker.terminate();
      };

      worker.onerror = () => {
        resolve(null);
        worker.terminate();
      };

      // 구조화된 복제(Structured Clone) 대신 Transferable objects 사용 검토 가능하나
      // 여기서는 slice된 Float32Array 전달
      worker.postMessage({ buffer: data, sampleRate }, [data.buffer]);
    } catch (e) {
      console.warn('BPM worker failed:', e);
      resolve(null);
    }
  });
}
