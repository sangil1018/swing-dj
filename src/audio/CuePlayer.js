/**
 * CuePlayer.js — 큐 미리듣기 플레이어 (헤드폰 출력)
 * 별도 AudioContext(cueContext) 사용 → 완전 분리 출력
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
    
    this.onTrackReady = null;
  }

  async load(track) {
    this.stop();
    this._pauseAt = 0;
    
    const currentLoadId = ++this._loadId;

    if (!track || !track.file) {
      console.warn("CuePlayer.load: 파일이 존재하지 않습니다.", track?.name);
      return false; // 파일 유실로 인한 크래시 방어
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
    } catch(e) {
      console.error("CuePlayer.load 디코딩 에러:", e);
      return false; // 브라우저 크래시 방어
    }

    this.currentTrack = track;
    return true;
  }

  /* ── 재생 ───────────────────────────────────────────── */
  play() {
    if (!this._currentBuffer) return;
    if (this.isPlaying) return;

    this._createSource();
    this.sourceNode.start(0, this._pauseAt);
    this._startTime = this.engine.cueTime - this._pauseAt;
    this.isPlaying = true;
  }

  /* ── 일시정지 ───────────────────────────────────────── */
  pause() {
    if (!this.isPlaying) return;
    this._pauseAt = this.currentTime;
    this._stopSource();
    this.isPlaying = false;
  }

  /* ── 정지 ───────────────────────────────────────────── */
  stop() {
    this._stopSource();
    this.isPlaying = false;
    this._pauseAt = 0;
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

  /* ── 내부 ───────────────────────────────────────────── */
  _createSource() {
    const ctx = this.engine.cueContext;
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this._currentBuffer;
    this.sourceNode.connect(this.engine.getCueInputNode());
    this.sourceNode.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this._pauseAt = 0;
        if (this.onEnded) this.onEnded();
      }
    };
  }

  _stopSource() {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch (_) {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }
}
