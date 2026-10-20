/**
 * PlayerUI.js — 메인 플레이어 UI (앨범아트, 파형, 컨트롤, 볼륨)
 */
import { formatTime } from '../utils/TimeFormatter.js';

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
    
    // 표시 옵션 상태
    this.showAlbumArt   = true;
    this.showVisualizer = true;
  }

  mount() {
    this.container.innerHTML = `
      <div class="player-main">

        <!-- 앨범 아트 -->
        <div class="album-art-wrap" id="album-art-wrap">
          <div class="album-art" id="album-art">
            <div class="album-art-default">🎷</div>
          </div>
          <div class="vinyl-ring"></div>
        </div>

        <!-- 트랙 정보 -->
        <div class="track-display">
          <div class="now-title" id="now-title">트랙을 불러오세요</div>
          <div class="now-artist" id="now-artist">—</div>
          <div class="now-badges">
            <span class="bpm-badge" id="now-bpm" style="display:none"></span>
            <span class="now-format" id="now-format"></span>
          </div>
        </div>

        <!-- 스펙트럼 비주얼라이저 -->
        <canvas id="spectrum-canvas" class="spectrum-canvas" width="400" height="60"></canvas>

        <!-- 진행 바 -->
        <div class="progress-section">
          <span class="time-label" id="time-cur">0:00</span>
          <div class="progress-bar" id="progress-bar">
            <div class="progress-fill" id="progress-fill" style="width:0%"></div>
            <div class="progress-thumb" id="progress-thumb" style="left:0%"></div>
          </div>
          <span class="time-label" id="time-dur">0:00</span>
        </div>

        <!-- 컨트롤 버튼 -->
        <div class="player-controls">
          <button class="ctrl-btn" id="btn-prev" title="이전 곡">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button class="ctrl-btn ctrl-play" id="btn-play" title="재생/일시정지">
            <svg id="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <svg id="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>
          <button class="ctrl-btn" id="btn-next" title="다음 곡">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2.5-6 5.7 4V8l-5.7 4zM16 6h2v12h-2z"/></svg>
          </button>
        </div>

        <!-- 볼륨 & 옵션 -->
        <div class="player-bottom-row">
          <div class="volume-section">
            <svg class="icon-sm" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            <input type="range" id="main-vol" class="vol-slider" min="0" max="1" step="0.01" value="0.85" title="메인 볼륨" />
            <span id="vol-label">85%</span>
          </div>
          
          <div class="player-options">
            <label class="opt-label" title="앨범 아트 표시">
              <input type="checkbox" id="opt-album-art" checked> 💿 아트
            </label>
            <label class="opt-label" title="이퀄라이저 밴드 표시">
              <input type="checkbox" id="opt-eq" checked> 🎚️ EQ
            </label>
            <label class="opt-label" title="스펙트럼 비주얼라이저 표시">
              <input type="checkbox" id="opt-visualizer" checked> 📊 파형
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
    this._canvas        = this.container.querySelector('#spectrum-canvas');
    this._ctx2d         = this._canvas.getContext('2d');
    this._playerMain    = this.container.querySelector('.player-main');

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

    // 컨트롤 버튼
    this.container.querySelector('#btn-play').addEventListener('click', () => {
      this.engine.resume();
      this.player.toggle();
      this._syncState();
    });
    this.container.querySelector('#btn-prev').addEventListener('click', () => this.onPrev?.());
    this.container.querySelector('#btn-next').addEventListener('click', () => this.onNext?.());

    // 볼륨
    const volSlider = this.container.querySelector('#main-vol');
    const volLabel  = this.container.querySelector('#vol-label');
    volSlider.addEventListener('input', () => {
      const v = parseFloat(volSlider.value);
      this.engine.setMainVolume(v);
      volLabel.textContent = `${Math.round(v * 100)}%`;
    });

    // 진행 바 클릭/드래그/터치로 시크
    this._setupSeek();

    // 키보드 'p' → 재생/정지 (리스트 아이템 포커스 제외)
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'p' || e.key === 'P') && e.target.tagName !== 'INPUT') {
        // 리스트 항목(플레이리스트/큐)에서 p를 누른 경우, 전역 재생/정지 방지 (해당 항목 재생이 우선)
        if (e.target.closest('.track-item') || e.target.closest('.q-item')) {
          return;
        }
        e.preventDefault();
        this.engine.resume();
        this.player.toggle();
        this._syncState();
      }
    });

    // 정지 파형 1회 초기 렌더
    this._drawSpectrum();
  }

  /* ── 트랙 표시 업데이트 ─────────────────────────────── */
  showTrack(track) {
    this._titleEl.textContent  = track.name;
    this._artistEl.textContent = track.artist;

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

    if (track.bpm) {
      this._bpmEl.textContent = `${track.bpm} BPM`;
      this._bpmEl.style.display = 'inline-block';
    } else {
      this._bpmEl.style.display = 'none';
    }

    this._updateProgress();
    this._syncState();
  }

  updateBPM(track) {
    if (track.bpm) {
      this._bpmEl.textContent = `${track.bpm} BPM`;
      this._bpmEl.style.display = 'inline-block';
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
  }

  _updatePlayIcon() {
    this.container.querySelector('#icon-play').style.display  = this.player.isPlaying ? 'none' : 'block';
    this.container.querySelector('#icon-pause').style.display = this.player.isPlaying ? 'block' : 'none';
  }

  _syncState() {
    this._updatePlayIcon();
    if (this._playerMain) {
      this._playerMain.classList.toggle('player-playing', this.player.isPlaying);
    }
    if (this.player.isPlaying) {
      this._startRenderLoop();
    } else {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      if (this.showVisualizer) this._drawSpectrum();
    }
  }

  /* ── 시크 조작 (마우스 + 터치 통합 PointerEvent) ───── */
  _setupSeek() {
    const seek = (clientX) => {
      const rect = this._progressBar.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      this.player.seek(ratio * this.player.duration);
      this._updateProgress();
    };

    this._progressBar.style.touchAction = 'none';
    this._progressBar.addEventListener('pointerdown', (e) => {
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
    const pct = (this.player.progress * 100).toFixed(2);
    this._progressFill.style.width  = `${pct}%`;
    this._progressThumb.style.left  = `${pct}%`;
    this._timeCur.textContent = formatTime(this.player.currentTime);
    this._timeDur.textContent = formatTime(this.player.duration);
  }

  /* ── 스펙트럼 비주얼라이저 ──────────────────────────── */
  _drawSpectrum() {
    if (!this.showVisualizer) return;

    const W = this._canvas.width;
    const H = this._canvas.height;
    const ctx = this._ctx2d;

    if (!this.player.isPlaying) {
      ctx.clearRect(0, 0, W, H);
      // 정지 상태 — 미세한 수평 파형 표시
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

    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0,   '#f0c060');
    grad.addColorStop(0.5, '#ff8040');
    grad.addColorStop(1,   '#ff4060');
    ctx.fillStyle = grad;

    for (let i = 0; i < count; i++) {
      const srcIdx = Math.floor((i / count) * data.length);
      const v = data[srcIdx] / 255;
      const h = v * H;
      const x = i * (barW + gap);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, H - h, barW, h);
      // 피크 빛
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x, H - h - 2, barW, 2);
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }
}
