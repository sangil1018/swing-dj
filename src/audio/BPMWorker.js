/**
 * BPMWorker.js — 온셋 플럭스 + 자기상관(Autocorrelation) 기반 스윙/재즈 BPM 분석 워커
 */
self.onmessage = async (e) => {
  const { buffer, sampleRate } = e.data;
  const bpm = detectBPM(buffer, sampleRate);
  self.postMessage({ bpm });
};

function detectBPM(data, sampleRate) {
  try {
    if (!data || data.length < sampleRate * 3) return null;

    // 1) 1차 저역 강조 필터 + 데시메이션
    const decimate = Math.max(1, Math.floor(sampleRate / 12000));
    const effRate = sampleRate / decimate;
    const rc = 1 / (2 * Math.PI * 350);
    const dt = 1 / sampleRate;
    const alpha = dt / (rc + dt);

    // 10ms 프레임 (~100 FPS)
    const hopSec = 0.01;
    const hopSamples = Math.max(1, Math.round(effRate * hopSec));
    const actualFps = effRate / hopSamples;

    const decimatedLen = Math.floor(data.length / decimate);
    const numFrames = Math.floor(decimatedLen / hopSamples);
    if (numFrames < 300) return null;

    const logEnergy = new Float32Array(numFrames);
    let lp = 0;
    let maxFrameE = 0;

    let sampleIdx = 0;
    for (let f = 0; f < numFrames; f++) {
      let sumLow = 0;
      let sumFull = 0;
      for (let j = 0; j < hopSamples; j++) {
        const end = Math.min(data.length, sampleIdx + decimate);
        let x = 0;
        for (let k = sampleIdx; k < end; k++) {
          const s = data[k];
          lp += alpha * (s - lp);
          x = s;
        }
        sampleIdx = end;
        sumLow += lp * lp;
        sumFull += x * x;
      }
      const e = (sumLow * 0.7 + sumFull * 0.3) / hopSamples;
      if (e > maxFrameE) maxFrameE = e;
      logEnergy[f] = Math.log1p(e * 10000);
    }

    if (maxFrameE < 1e-9) return null;

    // 2) 양의 에너지 변화량(Onset Strength Envelope) 계산
    const onset = new Float32Array(numFrames);
    for (let i = 1; i < numFrames; i++) {
      const diff = logEnergy[i] - logEnergy[i - 1];
      onset[i] = diff > 0 ? diff : 0;
    }

    // 3) 로컬 이동평균 차감(적응형 정규화)
    const winRadius = Math.round(actualFps * 0.25);
    const normOnset = new Float32Array(numFrames);
    let runningSum = 0;
    let count = 0;

    for (let i = 0; i <= Math.min(numFrames - 1, winRadius); i++) {
      runningSum += onset[i];
      count++;
    }
    for (let i = 0; i < numFrames; i++) {
      const addIdx = i + winRadius;
      const subIdx = i - winRadius - 1;
      if (i > 0 && addIdx < numFrames) {
        runningSum += onset[addIdx];
        count++;
      }
      if (subIdx >= 0) {
        runningSum -= onset[subIdx];
        count--;
      }
      const localMean = count > 0 ? runningSum / count : 0;
      const v = onset[i] - localMean;
      normOnset[i] = v > 0 ? v : 0;
    }

    // 4) BPM 후보군(68 ~ 220 BPM, 0.5 BPM 간격) 자기상관 + 마디 하모닉 평가
    const minBPM = 68;
    const maxBPM = 220;

    const minLag = Math.max(8, Math.floor((actualFps * 60) / maxBPM) - 2);
    const maxLag = Math.min(
      Math.floor(numFrames / 2),
      Math.ceil((actualFps * 60) / minBPM) * 4 + 4
    );
    const acf = new Float32Array(maxLag + 1);

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      const limit = numFrames - lag;
      for (let i = 0; i < limit; i++) {
        sum += normOnset[i] * normOnset[i + lag];
      }
      acf[lag] = sum / limit;
    }

    const sampleAcf = (lagFloat) => {
      const idx = Math.floor(lagFloat);
      const frac = lagFloat - idx;
      if (idx < minLag || idx + 1 > maxLag) return 0;
      return acf[idx] * (1 - frac) + acf[idx + 1] * frac;
    };

    const rawCombo = (bpm) => {
      const lag = (actualFps * 60) / bpm;
      let s = sampleAcf(lag);
      if (lag * 2 <= maxLag) s += 0.45 * sampleAcf(lag * 2);
      if (lag * 4 <= maxLag) s += 0.25 * sampleAcf(lag * 4);
      return s;
    };

    let bestBPM = null;
    let bestScore = -1;

    for (let bpm = minBPM; bpm <= maxBPM; bpm += 0.5) {
      let score = rawCombo(bpm);
      // 스윙/블루스 자연 템포 분포 완만한 가중치
      const center = 145;
      const sigma = 65;
      const prior = 1 + 0.16 * Math.exp(-0.5 * ((bpm - center) / sigma) ** 2);
      score *= prior;

      if (score > bestScore) {
        bestScore = score;
        bestBPM = bpm;
      }
    }

    if (bestScore <= 0 || bestBPM === null) return null;

    // 5) 반템포(2&4 백비트 락온) / 배템포(셔플 8분음표) 보정
    if (bestBPM < 106 && bestBPM * 2 <= maxBPM) {
      const lagSingle = (actualFps * 60) / (bestBPM * 2);
      const lagHalf   = (actualFps * 60) / bestBPM;
      // 매 정박(2배 템포 위치)에도 뚜렷한 펄스가 존재하면 정박 템포로 복원
      if (sampleAcf(lagSingle) >= 0.55 * sampleAcf(lagHalf)) {
        bestBPM *= 2;
      }
    }

    return Math.round(bestBPM);
  } catch (_) {
    return null;
  }
}
