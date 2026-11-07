/**
 * Player.js — 메인 플레이어 (스피커 출력, 라우드니스 분석 및 안티클릭 마이크로 엔벨로프 포함)
 */
import { formatDuration } from '../utils/TimeFormatter.js';
import { AudioEngine } from './AudioEngine.js';

export class Player {
  constructor(audioEngine) {
    this.engine = audioEngine;
    this.sourceNode = null;
    this._envGain   = null;     // 일시정지/시크 시 팝 노이즈 방지용 마이크로 엔벨로프
    this.currentTrack = null;
    this._currentBuffer = null; // 메모리 누수 방지용 (Player 내부에만 유지)
    this.isPlaying = false;
    this._startTime = 0;
    this._pauseAt   = 0;
    this._loadId    = 0; // Concurrency protection

    // 콜백
    this.onEnded       = null;
    this.onTrackReady  = null;
    this.onPlay        = null; // 재생 시작 시 호출
    this.onStateChange = null; // 재생/일시정지/정지/페이드 상태 변경 시 호출
  }

  /* ── 트랙 로드 (디코딩 성공 후 기존 재생 전환) ──────── */
  async load(track) {
    const currentLoadId = ++this._loadId;

    if (!track || !track.file) {
      console.warn('Player.load: 파일이 존재하지 않습니다.', track?.name);
      return false;
    }

    let decodedBuffer;
    try {
      const ab = await track.file.arrayBuffer();
      if (this._loadId !== currentLoadId) return false;

      decodedBuffer = await this.engine.decodeForMain(ab);
      if (this._loadId !== currentLoadId) return false;
    } catch (e) {
      console.error('Player.load 디코딩 에러:', e);
      return false;
    }

    // 디코딩 성공 시에만 기존 재생을 안전하게 정지하고 새 버퍼로 교체
    this.stop();
    this._currentBuffer = decodedBuffer;
    this.currentTrack = track;

    track.duration = decodedBuffer.duration;
    track.durationLabel = formatDuration(track.duration);
    track.sampleRate = decodedBuffer.sampleRate;
    if (!track.loudness) {
      track.loudness = AudioEngine.analyzeLoudness(decodedBuffer);
    }
    this.engine.setCurrentTrackLoudness(track.loudness);

    if (this.onTrackReady) this.onTrackReady(track, decodedBuffer);
    if (this.onStateChange) this.onStateChange();

    return true;
  }

  /* ── 재생 ───────────────────────────────────────────── */
  play() {
    if (!this._currentBuffer) return;
    if (this.isPlaying) return;

    if (this.engine.isFading) {
      this.engine.cancelMainFade(true);
    }

    // 곡 끝에 도달해 있으면 처음부터 재생
    if (this._pauseAt >= this.duration - 0.05) {
      this._pauseAt = 0;
    }

    this._createSource();
    this.sourceNode.start(0, this._pauseAt);
    this._startTime = this.engine.mainTime - this._pauseAt;
    this.isPlaying = true;

    if (this.onPlay) this.onPlay(this.currentTrack);
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 일시정지 ───────────────────────────────────────── */
  pause() {
    if (!this.isPlaying) return;
    if (this.engine.isFading) {
      this.engine.cancelMainFade(true);
    }
    this._pauseAt = this.currentTime;
    this._stopSource();
    this.isPlaying = false;
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 부드러운 페이드 아웃 후 일시정지 ───────────────── */
  fadeOutAndPause(durationSec = 3.0) {
    if (!this.isPlaying) return false;
    if (this.engine.isFading) {
      // 이미 페이드 중이면 페이드 취소 후 볼륨 복구
      this.engine.cancelMainFade(true);
      if (this.onStateChange) this.onStateChange();
      return false;
    }
    this.engine.startMainFadeOut(durationSec, () => {
      if (this.isPlaying) {
        this._pauseAt = this.currentTime;
        this._stopSource();
        this.isPlaying = false;
      }
      if (this.onStateChange) this.onStateChange();
    });
    if (this.onStateChange) this.onStateChange();
    return true;
  }

  /* ── 정지 ───────────────────────────────────────────── */
  stop() {
    if (this.engine.isFading) {
      this.engine.cancelMainFade(true);
    }
    this._stopSource();
    this.isPlaying = false;
    this._pauseAt = 0;
    this._startTime = 0;
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 완전 언로드 (프로파일 교체/전체 초기화용) ──────── */
  unload() {
    this._loadId++;
    this.stop();
    this.currentTrack = null;
    this._currentBuffer = null;
    this.engine.setCurrentTrackLoudness(null);
    if (this.onStateChange) this.onStateChange();
  }

  /* ── 시크 ───────────────────────────────────────────── */
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
      this._startTime = this.engine.mainTime - this._pauseAt;
      this.isPlaying = true;
    }
    if (this.onStateChange) this.onStateChange();
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

  get isFading() {
    return Boolean(this.engine?.isFading);
  }

  /* ── 내부 헬퍼 (안티클릭 마이크로 엔벨로프 포함) ──────── */
  _createSource() {
    const ctx = this.engine.mainContext;
    const src = ctx.createBufferSource();
    const env = ctx.createGain();
    src.buffer = this._currentBuffer;

    // 곡 중간에서 재개/시크할 때는 7ms 마이크로 페이드인을 적용해 파형 불연속 클릭 방지
    // 처음(0초)부터 시작할 때는 첫 어택 트랜지언트를 100% 보존하기 위해 1.0 직결
    const now = ctx.currentTime;
    if (this._pauseAt > 0.02) {
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(1.0, now + 0.007);
    } else {
      env.gain.setValueAtTime(1.0, now);
    }

    src.connect(env);
    env.connect(this.engine.getMainInputNode());

    this.sourceNode = src;
    this._envGain = env;

    src.onended = () => {
      if (this.sourceNode !== src) return;
      // 자연 종료 (seek나 stop에 의한 종료 제외)
      if (this.isPlaying) {
        if (this.engine.isFading) {
          this.engine.cancelMainFade(true);
        }
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

    const ctx = this.engine.mainContext;
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
