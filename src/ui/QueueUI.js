/**
 * QueueUI.js — 큐 패널 UI (드래그앤드롭 순서 변경 + 큐 미리듣기)
 */
import { formatDuration, formatTime } from '../utils/TimeFormatter.js';

export class QueueUI {
  constructor(container, queueManager, cuePlayer, onCueLoad) {
    this.container  = container;
    this.qm         = queueManager;
    this.cuePlayer  = cuePlayer;
    this.onCueLoad  = onCueLoad;   // (track) — 큐 플레이어에 로드 요청

    this._listEl     = null;
    this._dragSrcIdx = null;

    this.qm.onChange = () => this._renderList();

    // 큐 플레이어 시간 표시 갱신용
    this._rafId = null;
    this._playingTrackId = null; // 현재 재생 중인 트랙 ID
    this._missingTrackIds = new Set(); // 유실/에러 트랙 ID 저장용
    this._playedTrackIds = new Set(); // 이미 재생 완료된 트랙 ID
  }

  updatePlayedState(playedIds) {
    this._playedTrackIds = playedIds;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.q-item').forEach((el) => {
      const idx = parseInt(el.dataset.idx);
      const t = this.qm.queue[idx];
      if (t && playedIds.has(t.id)) el.classList.add('played');
      else el.classList.remove('played');
    });
  }

  markAsMissing(trackId) {
    this._missingTrackIds.add(trackId);
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.q-item').forEach((el) => {
      const idx = parseInt(el.dataset.idx);
      const t = this.qm.queue[idx];
      if (t && t.id === trackId) {
        el.classList.add('missing');
      }
    });
  }

  updatePlayingState(trackId) {
    this._playingTrackId = trackId;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.q-item').forEach((el) => {
      const idx = parseInt(el.dataset.idx);
      const t = this.qm.queue[idx];
      if (t && t.id === trackId) {
        el.classList.add('playing');
      } else {
        el.classList.remove('playing');
      }
    });
  }

  mount() {
    this.container.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">📋 큐</span>
        <button class="btn-text" id="q-clear-btn">전체 삭제</button>
      </div>

      <!-- 큐 드롭 영역 + 리스트 -->
      <ul class="queue-list" id="q-list"></ul>

      <!-- 큐 미리듣기 (CUE OUT) -->
      <div class="cue-preview" id="cue-preview">
        <div class="cue-preview-header">
          <span class="cue-label">🎧 CUE OUT</span>
          <div class="cue-vol-wrap">
            <svg class="icon-sm" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
            <input type="range" id="cue-vol" class="mini-slider" min="0" max="1" step="0.01" value="0.85" title="CUE 볼륨" />
          </div>
        </div>
        <div class="cue-now" id="cue-now">—</div>
        <div class="cue-controls">
          <button class="cue-btn" id="cue-play-btn" disabled>▶ 미리듣기</button>
          <button class="cue-btn cue-stop" id="cue-stop-btn" disabled>■ 정지</button>
        </div>
        <div class="cue-progress-wrap">
          <span id="cue-time">0:00</span>
          <div class="cue-progress-bar">
            <div class="cue-progress-fill" id="cue-fill" style="width:0%"></div>
          </div>
          <span id="cue-dur">0:00</span>
        </div>
      </div>
    `;

    this._listEl     = this.container.querySelector('#q-list');
    this._cueNowEl   = this.container.querySelector('#cue-now');
    this._cuePlayBtn = this.container.querySelector('#cue-play-btn');
    this._cueStopBtn = this.container.querySelector('#cue-stop-btn');
    this._cueTimeEl  = this.container.querySelector('#cue-time');
    this._cueDurEl   = this.container.querySelector('#cue-dur');
    this._cueFillEl  = this.container.querySelector('#cue-fill');

    // 전체 삭제
    this.container.querySelector('#q-clear-btn').addEventListener('click', () => {
      this.qm.clear();
    });

    // CUE 볼륨
    this.container.querySelector('#cue-vol').addEventListener('input', (e) => {
      this.cuePlayer.engine.setCueVolume(parseFloat(e.target.value));
    });

    // CUE 재생/정지
    this._cuePlayBtn.addEventListener('click', () => this._cueToggle());
    this._cueStopBtn.addEventListener('click', () => this._cueStop());

    // 큐 리스트에 외부 드롭(플레이리스트에서)
    this._listEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    this._listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = parseInt(e.dataTransfer.getData('text/plain'));
      if (!isNaN(id) && this.onTrackDropFromPlaylist) {
        this.onTrackDropFromPlaylist(id);
      }
    });

    this._renderList();
    this._startCueTick();
  }

  /* ── 큐 리스트 렌더링 ───────────────────────────────── */
  _renderList() {
    const queue = this.qm.queue;
    if (queue.length === 0) {
      this._listEl.innerHTML = '<li class="q-empty">큐가 비어있습니다<br/><small>플레이리스트에서 +Q 버튼을 누르거나 드래그하세요</small></li>';
      return;
    }

    this._listEl.innerHTML = queue.map((t, i) => {
      const isPlaying = t.id === this._playingTrackId ? 'playing' : '';
      const isMissing = this._missingTrackIds.has(t.id) ? 'missing' : '';
      const isPlayed  = this._playedTrackIds.has(t.id) ? 'played' : '';
      
      return `
      <li class="q-item ${isPlaying} ${isMissing} ${isPlayed}" data-idx="${i}" draggable="true" tabindex="0">
        <span class="q-num">${i + 1}</span>
        <div class="q-info">
          <span class="q-name">${escHtml(t.name)}</span>
          <span class="q-artist">${escHtml(t.artist)}</span>
        </div>
        <div class="q-meta">
          ${t.bpm ? `<span class="bpm-badge">${t.bpm}</span>` : ''}
          <span class="q-dur">${t.durationLabel}</span>
        </div>
        <div class="q-actions">
          <button class="q-up-btn" data-idx="${i}" title="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="q-dn-btn" data-idx="${i}" title="아래로" ${i === queue.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="q-del-btn" data-idx="${i}" title="삭제">✕</button>
        </div>
      </li>
    `}).join('');

    // 드래그앤드롭 순서 변경
    this._listEl.querySelectorAll('.q-item').forEach((el) => {
      // 클릭 시 포커스 강제 이동 (단축키 작동 위함)
      el.addEventListener('mousedown', () => { el.focus(); });
      
      el.addEventListener('dblclick', () => {
         const idx = parseInt(el.dataset.idx);
         const track = this.qm.queue[idx];
         if (track && this.onTrackDoubleClick) {
             this.onTrackDoubleClick(track.id);
         }
      });
      
      // 우클릭 → CUE 미리듣기
      el.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const idx = parseInt(el.dataset.idx);
        const track = this.qm.queue[idx];
        if (track) {
          const status = await this.loadCue(track);
          if (status === 'started') this._toast(`미리듣기 시작: ${track.name}`);
          else if (status === 'stopped') this._toast(`미리듣기 정지: ${track.name}`);
        }
      });

      // 단축키 지원 (P, Q, Delete)
      el.addEventListener('keydown', async (e) => {
        const idx = parseInt(el.dataset.idx);
        const track = this.qm.queue[idx];
        if (!track) return;

        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          if (this.onTrackDoubleClick) this.onTrackDoubleClick(track.id);
        } else if (e.key === 'q' || e.key === 'Q') {
          e.preventDefault();
          const status = await this.loadCue(track);
          if (status === 'started') this._toast(`미리듣기 시작: ${track.name}`);
          else if (status === 'stopped') this._toast(`미리듣기 정지: ${track.name}`);
        } else if (e.code === 'Delete' || e.code === 'Backspace') {
          e.preventDefault();
          this.qm.removeById(track.id);
        }
      });

      el.addEventListener('dragstart', (e) => {
        this._dragSrcIdx = parseInt(el.dataset.idx);
        const track = this.qm.queue[this._dragSrcIdx];
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('q-internal', this._dragSrcIdx); // 큐 내부 정렬용
        if (track) e.dataTransfer.setData('q-to-pl', track.id); // 플레이리스트로 드래그용
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('q-internal')) {
          e.dataTransfer.dropEffect = 'move';
          el.classList.add('drag-target');
        }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-target');
        const toIdx = parseInt(el.dataset.idx);
        if (!isNaN(this._dragSrcIdx) && this._dragSrcIdx !== toIdx && e.dataTransfer.types.includes('q-internal')) {
          this.qm.reorder(this._dragSrcIdx, toIdx);
        }
        this._dragSrcIdx = null;
      });
    });

    // 버튼 이벤트
    this._listEl.querySelectorAll('.q-up-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.qm.moveUp(parseInt(btn.dataset.idx)));
    });
    this._listEl.querySelectorAll('.q-dn-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.qm.moveDown(parseInt(btn.dataset.idx)));
    });
    this._listEl.querySelectorAll('.q-del-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const track = this.qm.queue[idx];
        if (track) this.qm.removeById(track.id);
      });
    });
  }

  /* ── CUE 미리듣기 ───────────────────────────────────── */
  async loadCue(track) {
    this.cuePlayer.engine.resume();
    if (!track || !track.file) {
      this._cueNowEl.textContent = `파일을 찾을 수 없습니다: ${track?.name}`;
      return 'error';
    }

    // 이미 같은 곡이 CUE에 로드되어 있는 경우 토글(정지/재생) 기능 수행
    if (this.cuePlayer.currentTrack && this.cuePlayer.currentTrack.id === track.id) {
      if (this.cuePlayer.isPlaying) {
        this._cueStop();
        return 'stopped';
      } else {
        this.cuePlayer.play();
        this._updateCueBtn();
        return 'started';
      }
    }

    this._cueNowEl.textContent = `로딩 중… ${track.name}`;
    this._cuePlayBtn.disabled = true;
    const success = await this.cuePlayer.load(track);
    if (!success) {
      this._cueNowEl.textContent = `재생 불가 (에러): ${track.name}`;
      return 'error'; 
    }
    this._cueNowEl.textContent = `${track.name} — ${track.artist}`;
    this._cueDurEl.textContent = formatTime(this.cuePlayer.duration);
    this._cuePlayBtn.disabled = false;
    this._cueStopBtn.disabled = false;
    this.cuePlayer.play();
    this._updateCueBtn();
    return 'started';
  }

  _cueToggle() {
    this.cuePlayer.toggle();
    this._updateCueBtn();
  }

  _cueStop() {
    this.cuePlayer.stop();
    this._cueFillEl.style.width = '0%';
    this._cueTimeEl.textContent = '0:00';
    this._updateCueBtn();
  }

  _updateCueBtn() {
    this._cuePlayBtn.textContent = this.cuePlayer.isPlaying ? '⏸ 일시정지' : '▶ 미리듣기';
  }

  /* ── CUE 진행 바 업데이트 (rAF) ─────────────────────── */
  _startCueTick() {
    const tick = () => {
      if (this.cuePlayer.isPlaying) {
        const pct = this.cuePlayer.progress * 100;
        this._cueFillEl.style.width = `${pct.toFixed(1)}%`;
        this._cueTimeEl.textContent = formatTime(this.cuePlayer.currentTime);
        this._cueDurEl.textContent  = formatTime(this.cuePlayer.duration);
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  _toast(msg) {
    const toast = document.createElement('div');
    toast.className   = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2800);
  }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
