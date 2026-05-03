/**
 * AudioEngine.js — 이중 출력 오디오 엔진
 *
 * mainContext  : 메인 PA (스피커) 출력 — 5밴드 EQ + Gain
 * cueContext   : 헤드폰/모니터 출력 — Gain 전용
 *
 * Chrome 110+ AudioContext.setSinkId() 지원
 */

export class AudioEngine {
  constructor() {
    this.mainContext = null;
    this.cueContext  = null;

    // Main chain nodes
    this.eqFilters  = [];   // [lowshelf, peak×3, highshelf]
    this.mainGain   = null;
    this.mainAnalyser = null;

    // Cue chain nodes
    this.cueGain    = null;

    this.mainDeviceId = 'default';
    this.cueDeviceId  = 'default';

    this.initialized = false;
  }

  /* ── 초기화 ─────────────────────────────────────────── */
  async initialize() {
    const opts = { latencyHint: 'playback', sampleRate: 48000 };
    this.mainContext = new AudioContext(opts);
    this.cueContext  = new AudioContext(opts);

    this._buildMainChain();
    this._buildCueChain();

    this.initialized = true;
  }

  _buildMainChain() {
    const ctx = this.mainContext;

    // 5밴드 EQ 필터 정의
    const bands = [
      { type: 'lowshelf',  freq: 60,    Q: null, gain: 0 },
      { type: 'peaking',   freq: 250,   Q: 1.0,  gain: 0 },
      { type: 'peaking',   freq: 1000,  Q: 1.0,  gain: 0 },
      { type: 'peaking',   freq: 4000,  Q: 1.0,  gain: 0 },
      { type: 'highshelf', freq: 16000, Q: null, gain: 0 },
    ];

    this.eqFilters = bands.map((b) => {
      const f = ctx.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.freq;
      f.gain.value = b.gain;
      if (b.Q !== null) f.Q.value = b.Q;
      return f;
    });

    // EQ 체인 내부 연결
    for (let i = 0; i < this.eqFilters.length - 1; i++) {
      this.eqFilters[i].connect(this.eqFilters[i + 1]);
    }

    this.mainGain = ctx.createGain();
    this.mainGain.gain.value = 0.85;

    // 비트 퍼펙트 재생을 위한 프록시 입력 노드
    this.mainInputProxy = ctx.createGain();
    this._updateAudioPath();

    // 리미터 (DynamicsCompressorNode) 추가 — 클리핑 방지 및 음질 보호
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-1.0, ctx.currentTime);
    this.limiter.knee.setValueAtTime(30, ctx.currentTime);
    this.limiter.ratio.setValueAtTime(12, ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.003, ctx.currentTime);
    this.limiter.release.setValueAtTime(0.25, ctx.currentTime);

    this.mainAnalyser = ctx.createAnalyser();
    this.mainAnalyser.fftSize = 512;
    
    // 체인 연결: Gain -> Limiter -> Analyser -> Destination
    this.mainGain.connect(this.limiter);
    this.limiter.connect(this.mainAnalyser);
    this.mainAnalyser.connect(ctx.destination);
  }

  _buildCueChain() {
    const ctx = this.cueContext;
    this.cueGain = ctx.createGain();
    this.cueGain.gain.value = 0.85;
    this.cueGain.connect(ctx.destination);
  }

  /* ── 소스 연결 진입점 ───────────────────────────────── */
  getMainInputNode() { return this.mainInputProxy; }
  getCueInputNode()  { return this.cueGain; }

  /* ── 출력 장치 설정 ─────────────────────────────────── */
  async setMainDevice(deviceId) {
    this.mainDeviceId = deviceId;
    if (this.mainContext?.setSinkId) {
      await this.mainContext.setSinkId(deviceId).catch(console.warn);
    }
  }

  async setCueDevice(deviceId) {
    this.cueDeviceId = deviceId;
    if (this.cueContext?.setSinkId) {
      await this.cueContext.setSinkId(deviceId).catch(console.warn);
    }
  }

  /* ── EQ 밴드 조정 ───────────────────────────────────── */
  setEQBand(index, gainDb) {
    if (!this.eqFilters[index]) return;
    const t = this.mainContext.currentTime;
    this.eqFilters[index].gain.setTargetAtTime(gainDb, t, 0.015);
    
    // 비트 퍼펙트 바이패스 여부 확인
    setTimeout(() => this._updateAudioPath(), 30);
  }

  /* 비트 퍼펙트(Hard Bypass) 로직: 0dB 시 필터 체인을 완전히 거치지 않음 */
  _updateAudioPath() {
    if (!this.mainInputProxy || !this.mainGain) return;

    // 모든 필터의 gain이 0인지 확인
    const isFlat = this.eqFilters.every(f => Math.abs(f.gain.value) < 0.01);
    
    this.mainInputProxy.disconnect();
    
    if (isFlat) {
      // 0dB (Flat) 상태: 필터 건너뛰고 게인 노드로 직접 연결 (Bit-Perfect)
      this.mainInputProxy.connect(this.mainGain);
    } else {
      // EQ 사용 중: 필터 체인 활성화
      this.mainInputProxy.connect(this.eqFilters[0]);
      // 필터 체인의 끝을 메인 게인에 연결 (disconnect 후 재연결로 중복 방지)
      this.eqFilters[this.eqFilters.length - 1].disconnect();
      this.eqFilters[this.eqFilters.length - 1].connect(this.mainGain);
    }
  }

  getEQBands() {
    return this.eqFilters.map((f) => f.gain.value);
  }

  /* ── 볼륨 제어 ──────────────────────────────────────── */
  setMainVolume(v) {
    if (!this.mainGain) return;
    this.mainGain.gain.setTargetAtTime(v, this.mainContext.currentTime, 0.015);
  }

  setCueVolume(v) {
    if (!this.cueGain) return;
    this.cueGain.gain.setTargetAtTime(v, this.cueContext.currentTime, 0.015);
  }

  getMainVolume() { return this.mainGain?.gain.value ?? 0.85; }
  getCueVolume()  { return this.cueGain?.gain.value  ?? 0.85; }

  /* ── 오디오 버퍼 디코딩 ─────────────────────────────── */
  async decodeForMain(arrayBuffer) {
    return this.mainContext.decodeAudioData(arrayBuffer.slice(0));
  }

  async decodeForCue(arrayBuffer) {
    return this.cueContext.decodeAudioData(arrayBuffer.slice(0));
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
