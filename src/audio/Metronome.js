/**
 * Metronome.js — Web Audio API 정밀 스케줄러 기반 스윙 재즈 메트로놈
 *
 * - 출력 채널 선택: 'cue' (헤드폰 모니터, 기본) | 'main' (메인 스피커)
 * - 리듬 모드: 'straight' (정박 1-2-3-4) | 'swing' (스윙 셔플) | 'backbeat' (2&4 백비트 강조)
 * - BPM 범위: 40 ~ 360 BPM
 */

export class Metronome {
  constructor(audioEngine) {
    this.engine       = audioEngine;
    this.bpm          = 140;
    this.beatsPerBar  = 4;
    this.mode         = 'straight'; // 'straight' | 'swing' | 'backbeat'
    this.output       = 'cue';      // 'cue' | 'main'
    this.volume       = 0.75;
    this.isPlaying    = false;

    this._currentBeat = 0;
    this._nextNoteTime = 0;
    this._timerId     = null;
    this._visualTimers = new Set();

    // 콜백
    this.onBeat        = null; // (beatIndex: 0..3, bpm: number) => void
    this.onStateChange = null; // (isPlaying: boolean) => void
  }

  _getContext() {
    return this.output === 'main' ? this.engine.mainContext : this.engine.cueContext;
  }

  _getDestination() {
    return this.output === 'main'
      ? this.engine.getMainInputNode()
      : this.engine.getCueInputNode();
  }

  setBPM(bpm) {
    const n = Math.round(Number(bpm));
    if (!isFinite(n)) return this.bpm;
    this.bpm = Math.max(40, Math.min(360, n));
    return this.bpm;
  }

  setMode(mode) {
    if (['straight', 'swing', 'backbeat'].includes(mode)) {
      this.mode = mode;
    }
  }

  setOutput(output) {
    const next = output === 'main' ? 'main' : 'cue';
    if (this.output === next) return;
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.stop();
    this.output = next;
    if (wasPlaying) this.start();
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) || 0));
  }

  start() {
    if (this.isPlaying) return;
    this.engine.resume();
    const ctx = this._getContext();
    if (!ctx) return;

    this.isPlaying = true;
    this._currentBeat = 0;
    this._nextNoteTime = ctx.currentTime + 0.04;

    const lookaheadMs = 25;
    const scheduleAheadSec = 0.1;

    this._scheduler = () => {
      if (!this.isPlaying) return;
      const activeCtx = this._getContext();
      if (!activeCtx) return;

      while (this._nextNoteTime < activeCtx.currentTime + scheduleAheadSec) {
        this._scheduleBeat(this._currentBeat, this._nextNoteTime);
        const secondsPerBeat = 60.0 / this.bpm;
        this._nextNoteTime += secondsPerBeat;
        this._currentBeat = (this._currentBeat + 1) % this.beatsPerBar;
      }
    };

    this._scheduler();
    this._timerId = setInterval(this._scheduler, lookaheadMs);
    if (this.onStateChange) this.onStateChange(true);
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    for (const id of this._visualTimers) {
      clearTimeout(id);
    }
    this._visualTimers.clear();
    if (this.onStateChange) this.onStateChange(false);
  }

  toggle() {
    if (this.isPlaying) this.stop();
    else this.start();
    return this.isPlaying;
  }

  _scheduleBeat(beatIdx, time) {
    const ctx = this._getContext();
    const dest = this._getDestination();
    if (!ctx || !dest) return;

    // 정박 클릭 사운드 합성
    if (this.mode === 'backbeat') {
      // 스윙 2 & 4 백비트 강조 (1,3박은 부드러운 로우 우드블록, 2,4박은 선명한 하이 클릭)
      const isBackbeat = beatIdx === 1 || beatIdx === 3;
      this._triggerClick(
        ctx,
        dest,
        time,
        isBackbeat ? 1280 : 480,
        isBackbeat ? 520 : 220,
        isBackbeat ? 0.95 : 0.55,
        0.042
      );
    } else {
      // 기본 정박 / 스윙 모드: 1박 강세
      const isAccent = beatIdx === 0;
      this._triggerClick(
        ctx,
        dest,
        time,
        isAccent ? 1200 : 800,
        isAccent ? 560 : 390,
        isAccent ? 0.95 : 0.65,
        0.038
      );
    }

    // 스윙 셔플 모드일 때 2/3 지점(스윙 8분음표 바운스) 서브 클릭 추가
    if (this.mode === 'swing') {
      const secPerBeat = 60.0 / this.bpm;
      const swingRatio = this.bpm >= 220 ? 0.62 : 0.667;
      const subTime = time + secPerBeat * swingRatio;
      this._triggerClick(ctx, dest, subTime, 980, 480, 0.32, 0.025);
    }

    // 시각적 비트 인디케이터 동기화
    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
    const tid = setTimeout(() => {
      this._visualTimers.delete(tid);
      if (this.isPlaying && this.onBeat) {
        this.onBeat(beatIdx, this.bpm);
      }
    }, delayMs);
    this._visualTimers.add(tid);
  }

  _triggerClick(ctx, dest, time, startFreq, endFreq, relGain, durationSec) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const peak = Math.max(0.0001, this.volume * relGain);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(startFreq, time);
      osc.frequency.exponentialRampToValueAtTime(endFreq, time + durationSec);

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(peak, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + durationSec);

      osc.connect(gain);
      gain.connect(dest);

      osc.start(time);
      osc.stop(time + durationSec + 0.005);
    } catch (_) {}
  }
}
