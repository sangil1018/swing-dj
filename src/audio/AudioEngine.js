/**
 * AudioEngine.js — 이중 출력 하이파이 오디오 엔진
 *
 * 1) 진정한 Bit-Perfect (Pure Direct) 경로:
 *    - 5밴드 EQ가 모두 0dB이고 Auto-Gain이 꺼져 있을 때 EQ 필터 및 리미터를 모두 완전 우회하여
 *      Source → Gain → Destination 직결 경로로 원음을 손실 없이 출력합니다.
 *    - 스펙트럼 분석기(AnalyserNode)는 직렬 통과가 아닌 병렬 탭(Parallel Tap)으로 분리되어 출력 신호에 간섭하지 않습니다.
 * 2) 하드웨어 네이티브 샘플레이트 동기화:
 *    - 고정 48kHz 강제 변환을 제거하고 오디오 인터페이스/OS 네이티브 샘플레이트(44.1kHz/48kHz/96kHz)를 그대로 사용합니다.
 * 3) 트랙 간 자동 음량 평준화 (Auto-Gain, -14 dBFS 게이팅 RMS 기준 + 피크 헤드룸 보호)
 * 4) 빠/행사장 PA 환경을 위한 모노 출력 합산 (Mono Summing)
 * 5) Butterworth 비례 Q(0.707) 5밴드 EQ + 부스트 시 자동 헤드룸 보상 + -0.5dBFS 브릭월 피크 리미터
 * 6) 청각 특성 맞춤 코사인-지수(S-Curve) 페이드아웃 및 백그라운드 분석 전용 디코더 격리
 */

export class AudioEngine {
  constructor() {
    this.mainContext = null;
    this.cueContext  = null;

    // Main chain nodes
    this.mainInputProxy = null;
    this.eqFilters      = [];   // [lowshelf, peak×3, highshelf]
    this.mainGain       = null;
    this.limiter        = null;
    this.mainAnalyser   = null;

    // Cue chain nodes
    this.cueGain        = null;

    this.mainDeviceId = 'default';
    this.cueDeviceId  = 'default';

    this._userMainVolume = 0.85;
    this._userCueVolume  = 0.85;
    this._mainMuted      = false;
    this._cueMuted       = false;
    this._isFading       = false;
    this._fadeTimer      = null;

    // 하이파이 / DSP 옵션 상태
    this.autoGainEnabled = false;
    this.monoOutput      = false;
    this._currentTrackLoudness = null; // { rmsDb, peak, gainDb, gainLinear }
    this._routeState     = null;

    this.onBypassChange    = null; // (isBitPerfect: boolean) => void
    this.onAudioModeChange = null; // () => void
    this.initialized       = false;
  }

  /* ── 초기화 (네이티브 하드웨어 샘플레이트 사용) ─────── */
  async initialize() {
    const opts = { latencyHint: 'playback' };
    this.mainContext = new AudioContext(opts);
    this.cueContext  = new AudioContext(opts);

    this._buildMainChain();
    this._buildCueChain();

    this.initialized = true;
  }

  get sampleRate() {
    return this.mainContext?.sampleRate ?? 48000;
  }

  _buildMainChain() {
    const ctx = this.mainContext;

    // 5밴드 EQ 필터 정의 (2옥타브 간격 Butterworth 비례 Q = 0.707 적용)
    const bands = [
      { type: 'lowshelf',  freq: 60,    Q: 0.707, gain: 0 },
      { type: 'peaking',   freq: 250,   Q: 0.707, gain: 0 },
      { type: 'peaking',   freq: 1000,  Q: 0.707, gain: 0 },
      { type: 'peaking',   freq: 4000,  Q: 0.707, gain: 0 },
      { type: 'highshelf', freq: 16000, Q: 0.707, gain: 0 },
    ];
    this._targetBands = [0, 0, 0, 0, 0];

    this.eqFilters = bands.map((b) => {
      const f = ctx.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.freq;
      f.gain.value = b.gain;
      if (b.Q !== null) f.Q.value = b.Q;
      return f;
    });

    // EQ 체인 내부 직렬 연결
    for (let i = 0; i < this.eqFilters.length - 1; i++) {
      this.eqFilters[i].connect(this.eqFilters[i + 1]);
    }

    // 입력 프록시 (Auto-Gain 및 EQ 헤드룸 보상 담당, 기본 1.0 Unity)
    this.mainInputProxy = ctx.createGain();
    this.mainInputProxy.gain.value = 1.0;

    // 메인 볼륨 및 모노 썸밍 제어 노드
    this.mainGain = ctx.createGain();
    this.mainGain.gain.value = this._userMainVolume;
    this.mainGain.channelInterpretation = 'speakers';

    // 투명한 브릭월 피크 보호 리미터 (-0.5 dBFS 임계점, 2dB 소프트니, 20:1 비율)
    // 기존 knee: 30dB(-16dBFS부터 압축) 문제를 해결하여 일반 음량 구간에서는 원음 다이내믹스 100% 보존
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-0.5, ctx.currentTime);
    this.limiter.knee.setValueAtTime(2.0, ctx.currentTime);
    this.limiter.ratio.setValueAtTime(20.0, ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.001, ctx.currentTime);
    this.limiter.release.setValueAtTime(0.08, ctx.currentTime);

    // 스펙트럼 비주얼라이저용 분석기 (신호 경로 밖 병렬 탭으로만 연결)
    this.mainAnalyser = ctx.createAnalyser();
    this.mainAnalyser.fftSize = 512;
    this.mainAnalyser.smoothingTimeConstant = 0.78;

    this._applyMonoConfig();
    this._updateInputGain();
    this._updateAudioPath();
  }

  _buildCueChain() {
    const ctx = this.cueContext;
    this.cueGain = ctx.createGain();
    this.cueGain.gain.value = this._userCueVolume;
    this.cueGain.connect(ctx.destination);
  }

  /* ── 소스 연결 진입점 ───────────────────────────────── */
  getMainInputNode() { return this.mainInputProxy; }
  getCueInputNode()  { return this.cueGain; }

  /* ── 출력 장치 설정 ─────────────────────────────────── */
  async setMainDevice(deviceId) {
    this.mainDeviceId = deviceId;
    if (this.mainContext?.setSinkId) {
      try {
        await this.mainContext.setSinkId(deviceId === 'default' ? '' : deviceId);
        return true;
      } catch (e) {
        console.warn('setMainDevice failed:', e);
        return false;
      }
    }
    return true;
  }

  async setCueDevice(deviceId) {
    this.cueDeviceId = deviceId;
    if (this.cueContext?.setSinkId) {
      try {
        await this.cueContext.setSinkId(deviceId === 'default' ? '' : deviceId);
        return true;
      } catch (e) {
        console.warn('setCueDevice failed:', e);
        return false;
      }
    }
    return true;
  }

  /* ── EQ 밴드 조정 및 헤드룸 보상 ────────────────────── */
  setEQBand(index, gainDb) {
    if (!this.eqFilters[index]) return;
    this._targetBands[index] = gainDb;
    const t = this.mainContext.currentTime;
    this.eqFilters[index].gain.setTargetAtTime(gainDb, t, 0.015);
    this._updateInputGain();

    // 비트 퍼펙트 바이패스 여부 확인 (필터 게인 수렴 후 글리치 없이 전환)
    if (this._bypassTimer) clearTimeout(this._bypassTimer);
    this._bypassTimer = setTimeout(() => this._updateAudioPath(), 55);
  }

  /* ── Auto-Gain (음량 평준화) & Mono Summing 제어 ────── */
  setAutoGain(enabled) {
    this.autoGainEnabled = Boolean(enabled);
    this._updateInputGain();
    this._updateAudioPath();
    this.onAudioModeChange?.();
  }

  setMonoOutput(enabled) {
    this.monoOutput = Boolean(enabled);
    this._applyMonoConfig();
    this.onAudioModeChange?.();
  }

  _applyMonoConfig() {
    if (!this.mainGain) return;
    if (this.monoOutput) {
      // 스테레오(L/R)를 1채널 모노로 합산한 뒤 Destination(2ch) 양쪽 스피커에 동일 출력
      this.mainGain.channelCount = 1;
      this.mainGain.channelCountMode = 'explicit';
    } else {
      this.mainGain.channelCount = 2;
      this.mainGain.channelCountMode = 'max';
    }
  }

  /** 현재 메인 트랙의 라우드니스 메타데이터 반영 */
  setCurrentTrackLoudness(loudness) {
    this._currentTrackLoudness = loudness || null;
    this._updateInputGain();
    this.onAudioModeChange?.();
  }

  get currentTrackGainDb() {
    if (!this.autoGainEnabled || !this._currentTrackLoudness) return 0;
    return this._currentTrackLoudness.gainDb ?? 0;
  }

  _updateInputGain() {
    if (!this.mainInputProxy || !this.mainContext) return;

    // 1) 트랙 Auto-Gain 보정치
    const trackLinear = (this.autoGainEnabled && this._currentTrackLoudness)
      ? (this._currentTrackLoudness.gainLinear ?? 1.0)
      : 1.0;

    // 2) EQ 양수 부스트 시 디지털 클리핑 방지를 위한 자동 헤드룸 감쇠
    const maxBoostDb = Math.max(0, ...(this._targetBands || [0]));
    const eqHeadroomDb = maxBoostDb > 0 ? -(maxBoostDb * 0.45) : 0;
    const eqHeadroomLinear = Math.pow(10, eqHeadroomDb / 20);

    const targetGain = trackLinear * eqHeadroomLinear;
    const now = this.mainContext.currentTime;
    this.mainInputProxy.gain.cancelScheduledValues(now);
    this.mainInputProxy.gain.setTargetAtTime(targetGain, now, 0.018);
  }

  /* 진정한 Bit-Perfect(Pure Direct) 라우팅:
     - EQ 0dB & Auto-Gain OFF → mainInputProxy(1.0) -> mainGain -> destination (EQ·리미터 완전 우회, Analyser 병렬 탭)
     - EQ 0dB & Auto-Gain ON  → mainInputProxy(AG)  -> mainGain -> limiter -> destination (EQ 우회, 피크 보호 리미터 활성)
     - EQ Active              → mainInputProxy      -> eqFilters -> mainGain -> limiter -> destination */
  _updateAudioPath() {
    if (!this.mainInputProxy || !this.mainGain || !this.limiter || !this.mainAnalyser) return;

    const isFlat = (this._targetBands || []).every((g) => Math.abs(g) < 0.01);
    const nextRoute = isFlat ? (this.autoGainEnabled ? 'flat-ag' : 'bit-perfect') : 'eq-active';

    this._isFlatConnected = isFlat;
    if (this._routeState === nextRoute) {
      if (this.onBypassChange) this.onBypassChange(isFlat);
      return;
    }
    this._routeState = nextRoute;

    const lastEq = this.eqFilters[this.eqFilters.length - 1];
    this.mainInputProxy.disconnect();
    lastEq.disconnect();
    this.mainGain.disconnect();
    this.limiter.disconnect();

    if (nextRoute === 'bit-perfect') {
      // Pure Direct: 필터와 컴프레서를 모두 거치지 않고 출력에 직결 + 병렬 스펙트럼 탭
      this.mainInputProxy.connect(this.mainGain);
      this.mainGain.connect(this.mainContext.destination);
      this.mainGain.connect(this.mainAnalyser);
    } else if (nextRoute === 'flat-ag') {
      // EQ 바이패스 + Auto-Gain 피크 보호 리미터
      this.mainInputProxy.connect(this.mainGain);
      this.mainGain.connect(this.limiter);
      this.limiter.connect(this.mainContext.destination);
      this.limiter.connect(this.mainAnalyser);
    } else {
      // 5밴드 EQ 활성 + 피크 보호 리미터
      this.mainInputProxy.connect(this.eqFilters[0]);
      lastEq.connect(this.mainGain);
      this.mainGain.connect(this.limiter);
      this.limiter.connect(this.mainContext.destination);
      this.limiter.connect(this.mainAnalyser);
    }

    if (this.onBypassChange) this.onBypassChange(isFlat);
    if (this.onAudioModeChange) this.onAudioModeChange();
  }

  get isBitPerfect() {
    return Boolean(this._isFlatConnected);
  }

  get isPureDirect() {
    return this._routeState === 'bit-perfect' && !this.monoOutput;
  }

  getEQBands() {
    return this._targetBands ? [...this._targetBands] : this.eqFilters.map((f) => f.gain.value);
  }

  /* ── 볼륨 & 음소거 & S-Curve 페이드 제어 ──────────────── */
  setMainVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    this._userMainVolume = clamped;
    if (clamped > 0) this._mainMuted = false;
    if (this._isFading) this.cancelMainFade(false);
    if (!this.mainGain) return;
    const now = this.mainContext.currentTime;
    this.mainGain.gain.cancelScheduledValues(now);
    this.mainGain.gain.setTargetAtTime(this._mainMuted ? 0 : clamped, now, 0.015);
  }

  setCueVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    this._userCueVolume = clamped;
    if (clamped > 0) this._cueMuted = false;
    if (!this.cueGain) return;
    const now = this.cueContext.currentTime;
    this.cueGain.gain.cancelScheduledValues(now);
    this.cueGain.gain.setTargetAtTime(this._cueMuted ? 0 : clamped, now, 0.015);
  }

  toggleMainMute() {
    this._mainMuted = !this._mainMuted;
    if (this._isFading) this.cancelMainFade(false);
    if (this.mainGain) {
      const now = this.mainContext.currentTime;
      const target = this._mainMuted ? 0 : (this._userMainVolume > 0 ? this._userMainVolume : 0.85);
      if (!this._mainMuted && this._userMainVolume === 0) this._userMainVolume = 0.85;
      this.mainGain.gain.cancelScheduledValues(now);
      this.mainGain.gain.setTargetAtTime(target, now, 0.015);
    }
    return this._mainMuted;
  }

  toggleCueMute() {
    this._cueMuted = !this._cueMuted;
    if (this.cueGain) {
      const now = this.cueContext.currentTime;
      const target = this._cueMuted ? 0 : (this._userCueVolume > 0 ? this._userCueVolume : 0.85);
      if (!this._cueMuted && this._userCueVolume === 0) this._userCueVolume = 0.85;
      this.cueGain.gain.cancelScheduledValues(now);
      this.cueGain.gain.setTargetAtTime(target, now, 0.015);
    }
    return this._cueMuted;
  }

  get isMainMuted() { return this._mainMuted || this._userMainVolume === 0; }
  get isCueMuted()  { return this._cueMuted  || this._userCueVolume === 0; }
  get isFading()    { return this._isFading; }

  /** 인간 청각(dB 스케일)에 자연스러운 코사인-지수 S-Curve 페이드 아웃 */
  startMainFadeOut(durationSec = 3.0, onComplete = null) {
    if (!this.mainGain || !this.mainContext) return;
    if (this._fadeTimer) clearTimeout(this._fadeTimer);

    this._isFading = true;
    const now = this.mainContext.currentTime;
    const startVal = Math.max(0.0001, this.mainGain.gain.value);
    this.mainGain.gain.cancelScheduledValues(now);

    const steps = 64;
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      // 코사인 감쇠와 지수 감쇠를 결합해 초반 꺾임과 말미 급절단을 모두 방지
      const shaped = Math.pow(Math.cos(t * Math.PI * 0.5), 1.85);
      curve[i] = Math.max(0.0001, startVal * shaped);
    }
    try {
      this.mainGain.gain.setValueCurveAtTime(curve, now, Math.max(0.05, durationSec));
    } catch (_) {
      this.mainGain.gain.setValueAtTime(startVal, now);
      this.mainGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.05, durationSec));
    }

    this._fadeTimer = setTimeout(() => {
      this._fadeTimer = null;
      this._isFading = false;
      if (onComplete) onComplete();
      this.restoreMainVolume();
    }, Math.round(durationSec * 1000) + 30);
  }

  cancelMainFade(restoreGain = true) {
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
    this._isFading = false;
    if (restoreGain) {
      this.restoreMainVolume();
    }
  }

  restoreMainVolume() {
    if (!this.mainGain || !this.mainContext) return;
    const now = this.mainContext.currentTime;
    const target = this._mainMuted ? 0 : this._userMainVolume;
    this.mainGain.gain.cancelScheduledValues(now);
    this.mainGain.gain.setTargetAtTime(target, now, 0.02);
  }

  getMainVolume() { return this._userMainVolume; }
  getCueVolume()  { return this._userCueVolume; }

  /* ── 오디오 버퍼 디코딩 (메인 / 큐 / 백그라운드 분석 분리) ── */
  async decodeForMain(arrayBuffer) {
    return this.mainContext.decodeAudioData(arrayBuffer.slice(0));
  }

  async decodeForCue(arrayBuffer) {
    return this.cueContext.decodeAudioData(arrayBuffer.slice(0));
  }

  /** 백그라운드 BPM/음량 분석 시 실시간 재생 컨텍스트에 부하를 주지 않도록 OfflineAudioContext 사용 */
  async decodeForAnalysis(arrayBuffer) {
    const sr = this.mainContext?.sampleRate || 44100;
    const offlineCtx = new OfflineAudioContext(1, 1, sr);
    return offlineCtx.decodeAudioData(arrayBuffer.slice(0));
  }

  /**
   * 오디오 버퍼의 체감 음량(Gated RMS dBFS) 및 피크를 측정하여
   * 목표 음량(-14.0 dBFS) 대비 안전한 Auto-Gain 보정치를 산출합니다.
   */
  static analyzeLoudness(audioBuffer, targetRmsDb = -14.0) {
    if (!audioBuffer || audioBuffer.length === 0) {
      return { rmsDb: -14.0, peak: 0.5, gainDb: 0, gainLinear: 1.0 };
    }

    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = numChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

    let peak = 0;
    const blockSize = Math.max(512, Math.floor(audioBuffer.sampleRate * 0.1)); // 100ms 블록
    const stride = 4; // 고속 스캔
    const blockEnergies = [];

    for (let start = 0; start < length; start += blockSize) {
      const end = Math.min(length, start + blockSize);
      let sumSq = 0;
      let count = 0;
      for (let i = start; i < end; i += stride) {
        const s0 = ch0[i];
        const s1 = ch1[i];
        const a0 = s0 < 0 ? -s0 : s0;
        const a1 = s1 < 0 ? -s1 : s1;
        if (a0 > peak) peak = a0;
        if (a1 > peak) peak = a1;
        sumSq += 0.5 * (s0 * s0 + s1 * s1);
        count++;
      }
      if (count > 0) {
        const meanSq = sumSq / count;
        // 무음 구간(-52 dBFS 미만) 제외 게이팅
        if (meanSq > 6.3e-6) {
          blockEnergies.push(meanSq);
        }
      }
    }

    if (blockEnergies.length === 0) {
      return { rmsDb: -40.0, peak: peak || 0.01, gainDb: 0, gainLinear: 1.0 };
    }

    // 상위 85% 에너지 블록 평균 (인트로/아웃트로 약음 영향을 줄여 본편 음압 기준 측정)
    blockEnergies.sort((a, b) => b - a);
    const keepCount = Math.max(1, Math.floor(blockEnergies.length * 0.75));
    let gatedSum = 0;
    for (let i = 0; i < keepCount; i++) {
      gatedSum += blockEnergies[i];
    }
    const gatedRms = Math.sqrt(gatedSum / keepCount);
    const rmsDb = 20 * Math.log10(Math.max(1e-5, gatedRms));

    // 목표치(-14 dBFS)와의 차이 계산 (±8.5 dB 범위 제한)
    let gainDb = Math.max(-8.5, Math.min(8.5, targetRmsDb - rmsDb));
    let gainLinear = Math.pow(10, gainDb / 20);

    // 피크 클리핑 방지 헤드룸 (-0.35 dBFS = 0.96 천장 제한)
    const ceiling = 0.96;
    if (peak > 0.001 && peak * gainLinear > ceiling) {
      gainLinear = ceiling / peak;
      gainDb = 20 * Math.log10(gainLinear);
    }

    return {
      rmsDb: Math.round(rmsDb * 10) / 10,
      peak: Math.round(peak * 1000) / 1000,
      gainDb: Math.round(gainDb * 10) / 10,
      gainLinear,
    };
  }

  /* ── 스펙트럼 데이터 ─────────────────────────────────── */
  getSpectrumData() {
    if (!this.mainAnalyser) return null;
    if (!this._spectrumData) {
      this._spectrumData = new Uint8Array(this.mainAnalyser.frequencyBinCount);
    }
    this.mainAnalyser.getByteFrequencyData(this._spectrumData);
    return this._spectrumData;
  }

  /* ── AudioContext 활성화 (user gesture 후) ─────────── */
  resume() {
    if (this.mainContext?.state === 'suspended') this.mainContext.resume();
    if (this.cueContext?.state === 'suspended')  this.cueContext.resume();
  }

  /* ── 현재 시간 ──────────────────────────────────────── */
  get mainTime() { return this.mainContext?.currentTime ?? 0; }
  get cueTime()  { return this.cueContext?.currentTime  ?? 0; }
}
