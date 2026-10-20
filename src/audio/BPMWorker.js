/**
 * BPMWorker.js — BPM 분석을 위한 웹 워커
 */
self.onmessage = async (e) => {
  const { buffer, sampleRate } = e.data;
  const bpm = await detectBPM(buffer, sampleRate);
  self.postMessage({ bpm });
};

async function detectBPM(data, sampleRate) {
  try {
    // 10ms 프레임별 에너지 계산
    const frameSize = Math.floor(sampleRate * 0.01);
    const numFrames = Math.floor(data.length / frameSize);
    const energies = new Float32Array(numFrames);

    let maxE = 0;
    for (let i = 0; i < numFrames; i++) {
      let e = 0;
      const start = i * frameSize;
      for (let j = 0; j < frameSize; j++) e += data[start + j] ** 2;
      const frameE = e / frameSize;
      energies[i] = frameE;
      if (frameE > maxE) maxE = frameE;
    }

    if (maxE < 1e-10) return null;

    const threshold = maxE * 0.25;
    const minGap = Math.floor(250 / 10);
    const peaks = [];

    for (let i = 1; i < numFrames - 1; i++) {
      if (
        energies[i] > threshold &&
        energies[i] >= energies[i - 1] &&
        energies[i] >= energies[i + 1]
      ) {
        if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minGap) {
          peaks.push(i);
        }
      }
    }

    if (peaks.length < 4) return null;

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push((peaks[i] - peaks[i - 1]) * 10);
    }

    const bpmList = intervals
      .map((ms) => {
        let bpm = Math.round(60000 / ms);
        while (bpm < 60) bpm *= 2;
        while (bpm > 220) bpm /= 2;
        return bpm;
      })
      .filter((b) => b >= 60 && b <= 220);

    if (bpmList.length === 0) return null;

    const counts = {};
    bpmList.forEach((b) => {
      const key = Math.round(b / 2) * 2;
      counts[key] = (counts[key] || 0) + 1;
    });

    let bestBPM = bpmList[0];
    let bestCount = 0;
    for (const [k, v] of Object.entries(counts)) {
      if (v > bestCount) {
        bestCount = v;
        bestBPM = parseInt(k);
      }
    }
    return bestBPM;
  } catch (_) {
    return null;
  }
}
