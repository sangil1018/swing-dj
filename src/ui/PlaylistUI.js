/**
 * PlaylistUI.js — 플레이리스트 패널 UI
 */
import { formatDuration } from '../utils/TimeFormatter.js';

export class PlaylistUI {
  constructor(container, playlistManager, onAddToQueue, onPlay) {
    this.container    = container;
    this.pm           = playlistManager;
    this.onAddToQueue = onAddToQueue;  // (track) => void
    this.onPlay       = onPlay;        // (track) => void (더블클릭 즉시 재생)
    this._sortField   = 'name';
    this._filter      = '';
    this._playingTrackId = null;
    this._playedTrackIds = new Set();

    this.pm.onChange = (tracks) => this._render(tracks);
  }

  updatePlayedState(playedIds) {
    this._playedTrackIds = playedIds;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.track-item').forEach(el => {
      const id = parseInt(el.dataset.id);
      if (playedIds.has(id)) el.classList.add('played');
      else el.classList.remove('played');
    });
  }

  mount() {
    this.container.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">🎵 플레이리스트</span>
        <span class="track-count" id="pl-count">0곡</span>
      </div>
      <div class="playlist-toolbar">
        <button class="btn-icon" id="pl-add-btn" title="파일 추가">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <input type="text" id="pl-search" class="pl-search" placeholder="검색…" />
        <select id="pl-sort" class="pl-sort">
          <option value="name">이름순</option>
          <option value="artist">아티스트</option>
          <option value="bpm">BPM</option>
          <option value="duration">길이</option>
        </select>
      </div>
      <div class="pl-drop-zone" id="pl-drop-zone">
        <div class="drop-icon">🎵</div>
        <div class="pl-drop-hint">파일을 여기에 드래그하거나</div>
        <button class="pl-drop-add-btn" id="pl-drop-add-btn">+ 파일 추가</button>
      </div>
      <ul class="track-list" id="pl-list"></ul>
      <input type="file" id="pl-file-input" multiple accept="audio/*,.mp3,.flac,.wav,.ogg,.aac,.m4a" style="display:none" />
    `;

    this._listEl   = this.container.querySelector('#pl-list');
    this._dropZone = this.container.querySelector('#pl-drop-zone');
    this._fileInput = this.container.querySelector('#pl-file-input');
    this._countEl  = this.container.querySelector('#pl-count');

    // 파일 추가 버튼 (툴바) — File System Access API 우선
    const openFilePicker = async () => {
      if (window.showOpenFilePicker) {
        try {
          const handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{ description: '오디오 파일',
              accept: { 'audio/*': ['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.opus'] }
            }]
          });
          if (this.onFilesWithHandles) this.onFilesWithHandles(handles);
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;  // 사용자 취소
        }
      }
      // 폴백: 일반 input
      this._fileInput.click();
    };

    this.container.querySelector('#pl-add-btn').addEventListener('click', openFilePicker);
    const dropAddBtn = this.container.querySelector('#pl-drop-add-btn');
    if (dropAddBtn) dropAddBtn.addEventListener('click', openFilePicker);
    this._fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) this._emitFiles(e.target.files);
      e.target.value = '';
    });

    // 드래그앤드롭 — getAsFileSystemHandle 우선 시도
    this._dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this._dropZone.classList.add('drag-over');
    });
    this._dropZone.addEventListener('dragleave', () => {
      this._dropZone.classList.remove('drag-over');
    });
    this._dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      this._dropZone.classList.remove('drag-over');
      if (e.dataTransfer.items?.length) {
        const handles = [], files = [];
        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind !== 'file') continue;
          try {
            const h = await item.getAsFileSystemHandle();
            if (h?.kind === 'file') { handles.push(h); continue; }
          } catch (_) {}
          const f = item.getAsFile();
          if (f) files.push(f);
        }
        if (handles.length && this.onFilesWithHandles) this.onFilesWithHandles(handles);
        if (files.length)   this._emitFiles(files);
      } else if (e.dataTransfer.files.length) {
        this._emitFiles(e.dataTransfer.files);
      }
    });

    // 정렬
    this.container.querySelector('#pl-sort').addEventListener('change', (e) => {
      this._sortField = e.target.value;
      this.pm.sortBy(this._sortField);
    });

    // 검색
    this.container.querySelector('#pl-search').addEventListener('input', (e) => {
      this._filter = e.target.value.toLowerCase();
      this._render(this.pm.tracks);
    });

    // 파일 드롭을 전체 패널에서도 받기
    this.container.addEventListener('dragover', (e) => e.preventDefault());
    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) this._emitFiles(e.dataTransfer.files);
    });
  }

  _emitFiles(files) {
    // main.js의 파일 처리 함수 호출
    if (this.onFilesDropped) this.onFilesDropped(files);
  }

  _render(tracks) {
    const filtered = this._filter
      ? tracks.filter((t) =>
          t.name.toLowerCase().includes(this._filter) ||
          t.artist.toLowerCase().includes(this._filter)
        )
      : tracks;

    this._countEl.textContent = `${tracks.length}곡`;

    if (tracks.length === 0) {
      this._dropZone.style.display = 'flex';
      this._listEl.innerHTML = '';
      return;
    }
    this._dropZone.style.display = 'none';

    this._listEl.innerHTML = filtered.map((t, idx) => {
      const isPlayed  = this._playedTrackIds.has(t.id) ? 'played' : '';
      
      return `
      <li class="track-item ${isPlayed}" data-id="${t.id}" data-idx="${idx}" draggable="true" tabindex="0">
        <div class="track-thumb">
          ${t.albumArt
            ? `<img src="${t.albumArt}" alt="cover" class="track-art" />`
            : `<div class="track-art-placeholder">♪</div>`
          }
        </div>
        <div class="track-info">
          <span class="track-name">${escHtml(t.name)}</span>
          <span class="track-artist">${escHtml(t.artist)}</span>
        </div>
        <div class="track-meta">
          ${t.bpm ? `<span class="bpm-badge">${t.bpm} BPM</span>` : '<span class="bpm-badge bpm-loading">…</span>'}
          <span class="track-duration">${t.durationLabel}</span>
        </div>
        <div class="track-actions">
          <button class="btn-cue" data-id="${t.id}" title="헤드폰으로 미리듣기">🎧</button>
          <button class="btn-queue" data-id="${t.id}" title="큐에 추가">+Q</button>
        </div>
      </li>
    `}).join('');

    // 이벤트 위임
    this._listEl.querySelectorAll('.track-item').forEach((el) => {
      const id = parseInt(el.dataset.id);
      const track = this.pm.getTrackById(id);

      // 클릭 시 포커스 강제 이동 (단축키 작동 위함)
      el.addEventListener('mousedown', () => { el.focus(); });

      // 더블클릭 → 큐 맨 아래에 추가
      el.addEventListener('dblclick', () => { if (track) this.onAddToQueue?.(track); });
      
      // 우클릭 → CUE 미리듣기
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (track) this.onCue?.(track);
      });

      // 단축키 지원 (Q, >, Enter)
      el.addEventListener('keydown', (e) => {
        if (!track) return;
        if (e.key === 'q' || e.key === 'Q') {
          e.preventDefault();
          this.onCue?.(track);
        } else if (e.key === '>' || e.key === '.' || e.code === 'Enter') {
          e.preventDefault();
          this.onAddToQueue?.(track);
        }
      });

      // 드래그 → 큐에 드롭 & 내부 순서 변경
      el.addEventListener('dragstart', (e) => {
        this._dragSrcIdx = parseInt(el.dataset.idx);
        e.dataTransfer.setData('text/plain', id); // 큐로 보낼 때
        e.dataTransfer.setData('pl-internal', this._dragSrcIdx); // 내부 순서 변경용
        e.dataTransfer.effectAllowed = 'copyMove';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('pl-internal') || e.dataTransfer.types.includes('q-to-pl')) {
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes('pl-internal') ? 'move' : 'copy';
          el.classList.add('drag-target');
        }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-target');
        
        // 내부 순서 변경
        if (e.dataTransfer.types.includes('pl-internal')) {
          const toIdx = parseInt(el.dataset.idx);
          if (!isNaN(this._dragSrcIdx) && this._dragSrcIdx !== toIdx) {
            this.pm.reorder(this._dragSrcIdx, toIdx);
          }
          this._dragSrcIdx = null;
        } 
        // 큐에서 가져오기
        else if (e.dataTransfer.types.includes('q-to-pl')) {
           const trackId = parseInt(e.dataTransfer.getData('q-to-pl'));
           if (this.onTrackDropFromQueue) {
               this.onTrackDropFromQueue(trackId, parseInt(el.dataset.idx));
           }
        }
      });
    });

    this._listEl.querySelectorAll('.btn-cue').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const track = this.pm.getTrackById(id);
        if (track) this.onCue?.(track);
      });
    });

    this._listEl.querySelectorAll('.btn-queue').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const track = this.pm.getTrackById(id);
        if (track) this.onAddToQueue?.(track);
      });
    });
  }

  /* BPM/duration 업데이트 후 특정 트랙 리스트 항목만 갱신 */
  updateTrackMeta(track) {
    const el = this._listEl?.querySelector(`[data-id="${track.id}"]`);
    if (!el) return;
    const bpmEl = el.querySelector('.bpm-badge');
    const durEl = el.querySelector('.track-duration');
    if (bpmEl) {
      bpmEl.textContent = track.bpm ? `${track.bpm} BPM` : '';
      bpmEl.classList.remove('bpm-loading');
    }
    if (durEl) durEl.textContent = track.durationLabel;
  }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
