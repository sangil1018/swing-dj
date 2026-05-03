/**
 * Player.js — 메인 플레이어 (스피커 출력)
 */
import { formatDuration } from '../utils/TimeFormatter.js';

export class Player {
  constructor(audioEngine) {
    this.engine = audioEngine;
    this.sourceNode = null;
    this.currentTrack = null;
    this._currentBuffer = null; // 메모리 누수 방지용 (Player 내부에만 유지)
    this.isPlaying = false;
    this._startTime = 0;
    this._pauseAt  = 0;
    this._loadId   = 0; // Concurrency protection

    // 콜백
    this.onEnded      = null;
    this.onTrackReady = null;
    this.onPlay       = null; // 재생 시작 시 호출
  }

  /* ── 트랙 로드 (디코딩) ────────────────────────────── */
  async load(track) {
    this.stop();
    this._pauseAt = 0;
    
    const currentLoadId = ++this._loadId;

    if (!track || !track.file) {
      console.warn("Player.load: 파일이 존재하지 않습니다.", track?.name);
      return false; // 파일 유실로 인한 크래시 방어
    }

    try {
      // 매번 디코딩하여 메모리 누수를 방지
      const ab = await track.file.arrayBuffer();
      if (this._loadId !== currentLoadId) return false; // 다른 로드 요청으로 취소됨
      
      const decodedBuffer = await this.engine.decodeForMain(ab);
      if (this._loadId !== currentLoadId) return false; // 다른 로드 요청으로 취소됨
      
      this._currentBuffer = decodedBuffer;
      track.duration = decodedBuffer.duration;
      track.durationLabel = formatDuration(track.duration);
      if (this.onTrackReady) this.onTrackReady(track, decodedBuffer);
    } catch (e) {
      console.error("Player.load 디코딩 에러:", e);
      return false; // 브라우저 크래시 방어
    }

    this.currentTrack = track;
    return true; // 로드 성공
  }

  /* ── 재생 ───────────────────────────────────────────── */
  play() {
    if (!this._currentBuffer) return;
    if (this.isPlaying) return;

    this._createSource();
    this.sourceNode.start(0, this._pauseAt);
    this._startTime = this.engine.mainTime - this._pauseAt;
    this.isPlaying = true;
    
    if (this.onPlay) this.onPlay(this.currentTrack);
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
    this._startTime = 0;
  }

  /* ── 시크 ───────────────────────────────────────────── */
  seek(seconds) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this._stopSource();
      this.isPlaying = false;
    }
    this._pauseAt = Math.max(0, Math.min(seconds, this.duration));
    if (wasPlaying) this.play();
  }

  /* ── 토글 ───────────────────────────────────────────── */
  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  /* ── 상태 Getters ───────────────────────────────────── */
  get currentTime() {
    if (this.isPlaying) {
      return Math.min(
        this.engine.mainTime - this._startTime,
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

  /* ── 내부 헬퍼 ──────────────────────────────────────── */
  _createSource() {
    const ctx = this.engine.mainContext;
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this._currentBuffer;
    this.sourceNode.connect(this.engine.getMainInputNode());
    this.sourceNode.onended = () => {
      // 자연 종료 (seek나 stop에 의한 종료 제외)
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
