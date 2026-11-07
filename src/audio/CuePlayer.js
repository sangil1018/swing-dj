/**
 * CuePlayer.js — 큐 미리듣기 플레이어 (헤드폰 출력)
 * 별도 AudioContext(cueContext) 사용 → 완전 분리 출력 + 구간 탐색(Seek) 지원
 */
import { formatDuration } from '../utils/TimeFormatter.js';

export class CuePlayer {
  constructor(audioEngine) {
    this.engine = audioEngine;
    this.sourceNode = null;
    this.currentTrack = null;
    this._currentBuffer = null; // 메모리 누수 방지용
    this.isPlaying = false;
    this._startTime = 0;
    this._pauseAt = 0;
    this._loadId = 0; // Concurrency protection

    this.onTrackReady  = null;
    this.onEnded       = null;
    this.onStateChange = null;
  }

  async load(track) {
    this.stop();
    this._pauseAt = 0;

    const currentLoadId = ++this._loadId;

    if (!track || !track.file) {
      console.warn('CuePlayer.load: 파일이 존재하지 않습니다.', track?.name);
      return false;
    }

    try {
      const ab = await track.file.arrayBuffer();
      if (this._loadId !== currentLoadId) return false;

      const decodedBuffer = await this.engine.decodeForCue(ab);
      if (this._loadId !== currentLoadId) return false;

      this._currentBuffer = decodedBuffer;
      track.duration = decodedBuffer.duration;
      track.durationLabel = formatDuration(track.duration);
      if (this.onTrackReady) this.onTrackReady(track, decodedBuffer);
    } catch (e) {
      console.error('CuePlayer.load 디코딩 에러:', e);
      return false;
    }

    this.currentTrack = track;
    if (this.onStateChange) this.onStateChange();
    return true;
  }

  /* ── 재생 ───────────────────────────────────────────── */
  play() {
    if (!this._currentBuffer) return;
    if (this.isPlaying) return;

    if (this._pauseAt >= this.duration - 0.05) {
      this._pauseAt = 0;
    }

    this._createSource();
    this.sourceNode.start(0, this._pauseAt);
    this._startTime = this.engine.cueTime - this._pauseAt;
    this.isPlaying = true;
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 일시정지 ───────────────────────────────────────── */
  pause() {
    if (!this.isPlaying) return;
    this._pauseAt = this.currentTime;
    this._stopSource();
    this.isPlaying = false;
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 정지 ───────────────────────────────────────────── */
  stop() {
    this._stopSource();
    this.isPlaying = false;
    this._pauseAt = 0;
    this._startTime = 0;
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 완전 언로드 ────────────────────────────────────── */
  unload() {
    this._loadId++;
    this.stop();
    this.currentTrack = null;
    this._currentBuffer = null;
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 구간 탐색 (Seek) ───────────────────────────────── */
  seek(seconds) {
    if (!this._currentBuffer) return;
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this._stopSource();
      this.isPlaying = false;
    }
    this._pauseAt = Math.max(0, Math.min(seconds, this.duration));
    if (wasPlaying) {
      this._createSource();
      this.sourceNode.start(0, this._pauseAt);
      this._startTime = this.engine.cueTime - this._pauseAt;
      this.isPlaying = true;
    }
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 토글 ───────────────────────────────────────────── */
  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  /* ── Getters ────────────────────────────────────────── */
  get currentTime() {
    if (this.isPlaying) {
      return Math.min(
        this.engine.cueTime - this._startTime,
        this.duration
      );
    }
    return this._pauseAt;
  }

  get duration() {
    return this._currentBuffer?.duration ?? 0;
  }

  get progress() {
    return this.duration > 0 ? this.currentTime / this.duration : 0;
  }

  /* ── 내부 (안티클릭 마이크로 엔벨로프 포함) ───────────── */
  _createSource() {
    const ctx = this.engine.cueContext;
    const src = ctx.createBufferSource();
    const env = ctx.createGain();
    src.buffer = this._currentBuffer;

    const now = ctx.currentTime;
    if (this._pauseAt > 0.02) {
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(1.0, now + 0.007);
    } else {
      env.gain.setValueAtTime(1.0, now);
    }

    src.connect(env);
    env.connect(this.engine.getCueInputNode());

    this.sourceNode = src;
    this._envGain = env;

    src.onended = () => {
      if (this.sourceNode !== src) return;
      if (this.isPlaying) {
        this.isPlaying = false;
        this._pauseAt = 0;
        if (this.onStateChange) this.onStateChange();
        if (this.onEnded) this.onEnded();
      }
    };
  }

  _stopSource() {
    if (!this.sourceNode) return;
    const oldSrc = this.sourceNode;
    const oldEnv = this._envGain;
    this.sourceNode = null;
    this._envGain = null;
    oldSrc.onended = null;

    const ctx = this.engine.cueContext;
    if (ctx && ctx.state === 'running' && oldEnv) {
      try {
        const now = ctx.currentTime;
        oldEnv.gain.cancelScheduledValues(now);
        oldEnv.gain.setValueAtTime(Math.max(0.0001, oldEnv.gain.value), now);
        oldEnv.gain.linearRampToValueAtTime(0.0001, now + 0.008);
        oldSrc.stop(now + 0.009);
        setTimeout(() => {
          try { oldSrc.disconnect(); } catch (_) {}
          try { oldEnv.disconnect(); } catch (_) {}
        }, 24);
        return;
      } catch (_) {}
    }

    try { oldSrc.stop(); } catch (_) {}
    try { oldSrc.disconnect(); } catch (_) {}
    try { oldEnv?.disconnect(); } catch (_) {}
  }
}
