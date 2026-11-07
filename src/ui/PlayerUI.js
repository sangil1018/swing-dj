/**
 * PlayerUI.js — 메인 플레이어 UI (앨범아트, 파형, 컨트롤, 페이드아웃, 1곡 후 정지, 볼륨)
 */
import { formatTime, formatRemainingTime } from '../utils/TimeFormatter.js';
import { applyBPMTierClass, getBPMTier } from '../utils/BPMTier.js';

export class PlayerUI {
  constructor(container, player, audioEngine, onNext, onPrev) {
    this.container   = container;
    this.player      = player;
    this.engine      = audioEngine;
    this.onNext      = onNext;
    this.onPrev      = onPrev;
    this._rafId      = null;
    this._isSeeking  = false;
    this._canvas     = null;
    this._ctx2d      = null;

    // 콜백
    this.onPlayEmpty       = null; // 트랙 미로드 상태에서 재생 클릭 시
    this.onOptionChange    = null; // 표시/동작 옵션 변경 시
    this.onBPMBadgeClick   = null; // (track, anchorEl) => void
    this.onFadeToggle      = null; // () => void
    this.getSpectrumColors = null; // () => [c1, c2, c3]

    // 표시 및 동작 옵션 상태
    this.showAlbumArt         = true;
    this.showVisualizer       = true;
    this.showRemainingTime    = true;
    this.autoStopAfterCurrent = false;
  }

  mount() {
    this.container.innerHTML = `
      <div class="player-main">

        <!-- 상단 히어로 데크 (앨범 아트 + 트랙 메타데이터) -->
        <div class="player-hero" id="player-hero">
          <div class="album-art-wrap" id="album-art-wrap">
            <div class="album-art" id="album-art">
              <div class="album-art-default">🎷</div>
            </div>
            <div class="vinyl-ring"></div>
          </div>

          <div class="track-display">
            <div class="now-title" id="now-title">트랙을 불러오세요</div>
            <div class="now-artist" id="now-artist">파일이나 폴더를 드래그하여 추가하세요</div>
            <div class="now-badges">
              <button type="button" class="bpm-badge bpm-interactive" id="now-bpm" style="display:none" title="클릭하여 BPM 보정 (×2 / ÷2 / TAP / 직접 입력)"></button>
              <span class="format-badge" id="now-format" style="display:none"></span>
              <span class="format-badge loudness-badge" id="now-loudness" style="display:none" title="트랙 음량(Gated RMS) 및 Auto-Gain 보정 정보"></span>
            </div>
          </div>
        </div>

        <!-- 스펙트럼 비주얼라이저 -->
        <canvas id="spectrum-canvas" class="spectrum-canvas" width="560" height="52"></canvas>

        <!-- 진행 바 -->
        <div class="progress-section">
          <span class="time-label" id="time-cur">0:00</span>
          <div class="progress-bar" id="progress-bar" title="클릭 또는 드래그하여 구간 이동">
            <div class="progress-fill" id="progress-fill" style="width:0%"></div>
            <div class="progress-thumb" id="progress-thumb" style="left:0%"></div>
          </div>
          <button type="button" class="time-label time-label-btn" id="time-dur" title="클릭하여 남은 시간 표시 전환">0:00</button>
        </div>

        <!-- 컨트롤 버튼 (대칭형 DJ 트랜스포트) -->
        <div class="player-controls">
          <button class="ctrl-pill" id="btn-autostop" type="button" title="현재 곡이 끝난 뒤 다음 곡으로 자동 넘어가지 않고 대기합니다">
            <span class="pill-dot"></span>1곡 후 정지
          </button>

          <button class="ctrl-btn" id="btn-prev" type="button" title="이전 곡">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button class="ctrl-btn ctrl-play" id="btn-play" type="button" title="재생 / 일시정지 (단축키: P)">
            <svg id="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <svg id="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>
          <button class="ctrl-btn" id="btn-next" type="button" title="다음 곡">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2.5-6 5.7 4V8l-5.7 4zM16 6h2v12h-2z"/></svg>
          </button>

          <button class="ctrl-pill" id="btn-fade" type="button" disabled title="3초 동안 볼륨을 부드럽게 줄인 뒤 일시정지합니다 (단축키: F)">
            🔉 페이드
          </button>
        </div>

        <!-- 볼륨 & 옵션 -->
        <div class="player-bottom-row">
          <div class="volume-section">
            <button type="button" class="btn-mute-icon" id="btn-main-mute" title="메인 볼륨 음소거 토글">
              <svg id="icon-vol-on" class="icon-sm" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
              <svg id="icon-vol-off" class="icon-sm" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
            </button>
            <input type="range" id="main-vol" class="vol-slider" min="0" max="1" step="0.01" value="0.85" title="메인 볼륨" />
            <span id="vol-label">85%</span>
          </div>

          <div class="player-options">
            <label class="opt-label" title="앨범 아트 표시">
              <input type="checkbox" id="opt-album-art" checked> <span class="opt-emoji">💿 </span>아트
            </label>
            <label class="opt-label" title="이퀄라이저 밴드 표시">
              <input type="checkbox" id="opt-eq" checked> <span class="opt-emoji">🎚️ </span>EQ
            </label>
            <label class="opt-label" title="스펙트럼 비주얼라이저 표시 (해제 시 배터리 절약)">
              <input type="checkbox" id="opt-visualizer" checked> <span class="opt-emoji">📊 </span>파형
            </label>
          </div>
        </div>

      </div>
    `;

    // 참조
    this._progressBar   = this.container.querySelector('#progress-bar');
    this._progressFill  = this.container.querySelector('#progress-fill');
    this._progressThumb = this.container.querySelector('#progress-thumb');
    this._timeCur       = this.container.querySelector('#time-cur');
    this._timeDur       = this.container.querySelector('#time-dur');
    this._albumArtWrap  = this.container.querySelector('#album-art-wrap');
    this._albumArt      = this.container.querySelector('#album-art');
    this._titleEl       = this.container.querySelector('#now-title');
    this._artistEl      = this.container.querySelector('#now-artist');
    this._bpmEl         = this.container.querySelector('#now-bpm');
    this._formatEl      = this.container.querySelector('#now-format');
    this._loudnessEl    = this.container.querySelector('#now-loudness');
    this._canvas        = this.container.querySelector('#spectrum-canvas');
    this._ctx2d         = this._canvas.getContext('2d');
    this._playerMain    = this.container.querySelector('.player-main');

    this._btnAutoStop   = this.container.querySelector('#btn-autostop');
    this._btnFade       = this.container.querySelector('#btn-fade');
    this._btnMute       = this.container.querySelector('#btn-main-mute');
    this._volSlider     = this.container.querySelector('#main-vol');
    this._volLabel      = this.container.querySelector('#vol-label');

    this._optAlbumArt   = this.container.querySelector('#opt-album-art');
    this._optEQ         = this.container.querySelector('#opt-eq');
    this._optVisualizer = this.container.querySelector('#opt-visualizer');

    // 표시 옵션 이벤트
    this._optAlbumArt.addEventListener('change', (e) => {
      this.showAlbumArt = e.target.checked;
      this._albumArtWrap.style.display = this.showAlbumArt ? '' : 'none';
      if (this.onOptionChange) this.onOptionChange('albumArt', this.showAlbumArt);
    });

    this._optEQ.addEventListener('change', (e) => {
      const show = e.target.checked;
      if (this.onOptionChange) this.onOptionChange('eq', show);
    });

    this._optVisualizer.addEventListener('change', (e) => {
      this.showVisualizer = e.target.checked;
      this._canvas.style.display = this.showVisualizer ? 'block' : 'none';
      if (this.showVisualizer && !this.player.isPlaying) {
        this._drawSpectrum();
      }
      if (this.onOptionChange) this.onOptionChange('visualizer', this.showVisualizer);
    });

    // 남은 시간 표시 토글
    this._timeDur.addEventListener('click', () => {
      this.showRemainingTime = !this.showRemainingTime;
      this._updateProgress();
      if (this.onOptionChange) this.onOptionChange('remainingTime', this.showRemainingTime);
    });

    // BPM 뱃지 클릭 (수동 보정 / TAP)
    this._bpmEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.player.currentTrack && this.onBPMBadgeClick) {
        this.onBPMBadgeClick(this.player.currentTrack, this._bpmEl);
      }
    });

    // 컨트롤 버튼
    this.container.querySelector('#btn-play').addEventListener('click', () => {
      this.engine.resume();
      if (!this.player.currentTrack) {
        this.onPlayEmpty?.();
        return;
      }
      this.player.toggle();
      this._syncState();
    });
    this.container.querySelector('#btn-prev').addEventListener('click', () => this.onPrev?.());
    this.container.querySelector('#btn-next').addEventListener('click', () => this.onNext?.());

    // 1곡 후 정지 토글
    this._btnAutoStop.addEventListener('click', () => {
      this.setAutoStop(!this.autoStopAfterCurrent);
      if (this.onOptionChange) this.onOptionChange('autoStop', this.autoStopAfterCurrent);
    });

    // 페이드 아웃 버튼
    this._btnFade.addEventListener('click', () => {
      this.onFadeToggle?.();
    });

    // 볼륨 및 음소거
    this._volSlider.addEventListener('input', () => {
      const v = parseFloat(this._volSlider.value);
      this.engine.setMainVolume(v);
      this._syncVolumeUI();
    });

    this._btnMute.addEventListener('click', () => {
      this.engine.toggleMainMute();
      this._syncVolumeUI();
    });

    // 진행 바 클릭/드래그/터치로 시크
    this._setupSeek();

    // 전역 단축키 ('P': 재생/정지, 'F': 페이드 아웃)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

      if (e.key === 'p' || e.key === 'P') {
        if (e.target.closest('.track-item') || e.target.closest('.q-item')) return;
        e.preventDefault();
        this.engine.resume();
        if (!this.player.currentTrack) {
          this.onPlayEmpty?.();
          return;
        }
        this.player.toggle();
        this._syncState();
      } else if (e.key === 'f' || e.key === 'F') {
        if (this.player.isPlaying) {
          e.preventDefault();
          this.onFadeToggle?.();
        }
      }
    });

    // 정지 파형 1회 초기 렌더
    this._drawSpectrum();
  }

  /* ── 트랙 표시 업데이트 ─────────────────────────────── */
  showTrack(track) {
    if (!track) {
      this.reset();
      return;
    }
    this._titleEl.textContent  = track.name;
    this._titleEl.title        = track.name;
    this._artistEl.textContent = track.album ? `${track.artist} · ${track.album}` : track.artist;

    this._albumArt.innerHTML = '';
    if (track.albumArt) {
      const img = document.createElement('img');
      img.src = track.albumArt;
      img.alt = 'album art';
      img.className = 'album-art-img';
      this._albumArt.appendChild(img);
    } else {
      const def = document.createElement('div');
      def.className = 'album-art-default';
      def.textContent = '🎷';
      this._albumArt.appendChild(def);
    }

    this.updateBPM(track);

    if (track.format) {
      this._formatEl.textContent = track.format;
      this._formatEl.style.display = 'inline-flex';
    } else {
      this._formatEl.style.display = 'none';
    }

    this.updateLoudness(track);

    this._updateProgress();
    this._syncState();
  }

  reset() {
    this._titleEl.textContent  = '트랙을 불러오세요';
    this._artistEl.textContent = '파일이나 폴더를 드래그하여 추가하세요';
    this._albumArt.innerHTML   = '<div class="album-art-default">🎷</div>';
    this._bpmEl.style.display  = 'none';
    this._formatEl.style.display = 'none';
    if (this._loudnessEl) this._loudnessEl.style.display = 'none';
    this._progressFill.style.width = '0%';
    this._progressThumb.style.left = '0%';
    this._timeCur.textContent = '0:00';
    this._timeDur.textContent = '0:00';
    this._timeDur.classList.remove('ending-soon');
    this._syncState();
  }

  updateLoudness(track) {
    if (!this._loudnessEl) return;
    if (!track || !track.loudness) {
      this._loudnessEl.style.display = 'none';
      return;
    }
    const { rmsDb, peak, gainDb } = track.loudness;
    const agOn = Boolean(this.engine?.autoGainEnabled);
    const sign = gainDb > 0 ? '+' : '';
    if (agOn) {
      this._loudnessEl.textContent = `AG ${sign}${gainDb.toFixed(1)}dB`;
      this._loudnessEl.classList.add('ag-active');
    } else {
      this._loudnessEl.textContent = `${rmsDb.toFixed(1)} dBFS`;
      this._loudnessEl.classList.remove('ag-active');
    }
    this._loudnessEl.title = `체감 음량: ${rmsDb.toFixed(1)} dBFS · 피크: ${(peak * 100).toFixed(0)}% · Auto-Gain 보정치: ${sign}${gainDb.toFixed(1)} dB`;
    this._loudnessEl.style.display = 'inline-flex';
  }

  updateBPM(track) {
    if (!track) return;
    if (track.bpm) {
      const tier = getBPMTier(track.bpm);
      this._bpmEl.textContent = `${track.bpm} BPM`;
      this._bpmEl.classList.remove('bpm-unset');
      applyBPMTierClass(this._bpmEl, track.bpm);
      this._bpmEl.title = tier
        ? `${tier.desc} — 클릭하여 BPM 보정 (×2 / ÷2 / TAP / 직접 입력)`
        : '클릭하여 BPM 보정';
      this._bpmEl.style.display = 'inline-flex';
    } else {
      this._bpmEl.textContent = 'BPM 설정';
      this._bpmEl.classList.add('bpm-unset');
      applyBPMTierClass(this._bpmEl, null);
      this._bpmEl.style.display = 'inline-flex';
    }
  }

  setAutoStop(enabled) {
    this.autoStopAfterCurrent = Boolean(enabled);
    if (this._btnAutoStop) {
      this._btnAutoStop.classList.toggle('active', this.autoStopAfterCurrent);
    }
  }

  setOptions(options) {
    if (options.showAlbumArt !== undefined) {
      this.showAlbumArt = options.showAlbumArt;
      if (this._optAlbumArt) this._optAlbumArt.checked = this.showAlbumArt;
      if (this._albumArtWrap) this._albumArtWrap.style.display = this.showAlbumArt ? '' : 'none';
    }
    if (options.showEQ !== undefined) {
      if (this._optEQ) this._optEQ.checked = options.showEQ;
    }
    if (options.showVisualizer !== undefined) {
      this.showVisualizer = options.showVisualizer;
      if (this._optVisualizer) this._optVisualizer.checked = this.showVisualizer;
      if (this._canvas) this._canvas.style.display = this.showVisualizer ? 'block' : 'none';
    }
    if (options.showRemainingTime !== undefined) {
      this.showRemainingTime = options.showRemainingTime;
      this._updateProgress();
    }
    if (options.autoStopAfterCurrent !== undefined) {
      this.setAutoStop(options.autoStopAfterCurrent);
    }
  }

  _syncVolumeUI() {
    const isMuted = this.engine.isMainMuted;
    const v = this.engine.getMainVolume();
    this.container.querySelector('#icon-vol-on').style.display  = isMuted ? 'none' : 'block';
    this.container.querySelector('#icon-vol-off').style.display = isMuted ? 'block' : 'none';
    this._btnMute.classList.toggle('muted', isMuted);
    this._volLabel.textContent = isMuted ? '음소거' : `${Math.round(v * 100)}%`;
  }

  _updatePlayIcon() {
    this.container.querySelector('#icon-play').style.display  = this.player.isPlaying ? 'none' : 'block';
    this.container.querySelector('#icon-pause').style.display = this.player.isPlaying ? 'block' : 'none';
  }

  _syncState() {
    this._updatePlayIcon();
    this._syncVolumeUI();

    if (this._playerMain) {
      this._playerMain.classList.toggle('player-playing', this.player.isPlaying);
    }

    if (this._btnFade) {
      this._btnFade.disabled = !this.player.isPlaying;
      this._btnFade.classList.toggle('fading', this.player.isFading);
      this._btnFade.textContent = this.player.isFading ? '🔉 페이드 취소' : '🔉 페이드';
    }

    if (this.player.isPlaying) {
      this._startRenderLoop();
    } else {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._updateProgress();
      if (this.showVisualizer) this._drawSpectrum();
    }
  }

  /* ── 시크 조작 (마우스 + 터치 통합 PointerEvent) ───── */
  _setupSeek() {
    const seek = (clientX) => {
      if (!this.player.currentTrack) return;
      const rect = this._progressBar.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      this.player.seek(ratio * this.player.duration);
      this._updateProgress();
    };

    this._progressBar.style.touchAction = 'none';
    this._progressBar.addEventListener('pointerdown', (e) => {
      if (!this.player.currentTrack) return;
      this._isSeeking = true;
      this._progressBar.setPointerCapture?.(e.pointerId);
      seek(e.clientX);
    });
    this._progressBar.addEventListener('pointermove', (e) => {
      if (this._isSeeking) seek(e.clientX);
    });
    const endSeek = (e) => {
      if (this._isSeeking) {
        this._isSeeking = false;
        this._progressBar.releasePointerCapture?.(e.pointerId);
      }
    };
    this._progressBar.addEventListener('pointerup', endSeek);
    this._progressBar.addEventListener('pointercancel', endSeek);
  }

  /* ── rAF 렌더 루프 (재생 중일 때만 실행) ────────────── */
  _startRenderLoop() {
    if (this._rafId) return;
    const tick = () => {
      this._updateProgress();
      if (this.showVisualizer) {
        this._drawSpectrum();
      }
      if (this.player.isPlaying) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = null;
        this._syncState();
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _updateProgress() {
    if (!this.player.currentTrack) return;
    const cur = this.player.currentTime;
    const dur = this.player.duration;
    const pct = (this.player.progress * 100).toFixed(2);
    this._progressFill.style.width = `${pct}%`;
    this._progressThumb.style.left = `${pct}%`;
    this._timeCur.textContent = formatTime(cur);

    const remaining = Math.max(0, dur - cur);
    if (this.showRemainingTime && dur > 0 && (cur > 0 || this.player.isPlaying)) {
      this._timeDur.textContent = `${formatRemainingTime(cur, dur)} / ${formatTime(dur)}`;
    } else {
      this._timeDur.textContent = formatTime(dur);
    }

    // 곡 종료 20초 전 시각 알림
    const endingSoon = this.player.isPlaying && dur > 25 && remaining <= 20;
    this._timeDur.classList.toggle('ending-soon', endingSoon);
  }

  /* ── 스펙트럼 비주얼라이저 ──────────────────────────── */
  _drawSpectrum() {
    if (!this.showVisualizer) return;

    const W = this._canvas.width;
    const H = this._canvas.height;
    const ctx = this._ctx2d;

    if (!this.player.isPlaying) {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(240,192,96,0.06)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 16) {
        const y = H / 2 + Math.sin(x * 0.08) * 4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y); ctx.stroke();
      }
      return;
    }

    const data = this.engine.getSpectrumData();
    if (!data) return;

    ctx.clearRect(0, 0, W, H);

    const barW  = W / data.length * 2;
    const gap   = 1;
    const count = Math.floor(W / (barW + gap));

    const [c1, c2, c3] = this.getSpectrumColors?.() || ['#f0c060', '#ff8040', '#ff4060'];
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0,   c1);
    grad.addColorStop(0.5, c2);
    grad.addColorStop(1,   c3);
    ctx.fillStyle = grad;

    for (let i = 0; i < count; i++) {
      const srcIdx = Math.floor((i / count) * data.length);
      const v = data[srcIdx] / 255;
      const h = v * H;
      const x = i * (barW + gap);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, H - h, barW, h);
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x, H - h - 2, barW, 2);
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }
}
