/**
 * PlaylistUI.js — 플레이리스트 패널 UI (폴더 추가, BPM 범위 검색, 키보드 방향키 탐색 지원)
 */
import { collectAudioHandlesFromDirectory, extractDroppedAudioSources } from '../utils/FileLoader.js';
import {
  BPM_TIERS,
  getBPMTier,
  getBPMTierClass,
  applyBPMTierClass,
  matchesBPMTier,
} from '../utils/BPMTier.js';

export class PlaylistUI {
  constructor(container, playlistManager, onAddToQueue, onPlay) {
    this.container    = container;
    this.pm           = playlistManager;
    this.onAddToQueue = onAddToQueue;       // (track) => void
    this.onAddNextToQueue = null;           // (track) => void (바로 다음 곡 예약)
    this.onQueueAll   = null;               // (tracks) => void
    this.onRemoveTrack = null;              // (track) => void
    this.onBPMBadgeClick = null;            // (track, anchorEl) => void
    this.onPlay       = onPlay;

    this._sortField   = 'added';
    this._sortDir     = 'asc';
    this._filter      = '';
    this._tierFilter  = '';                 // '' | 't1' .. 't7'
    this._renamingTabId = null;
    this._ioOpen      = false;

    // 플레이리스트 저장/불러오기 콜백 (main.js에서 ProfileManager 연동)
    this.onSavePlaylistToStorage   = null; // (name, tracks) => Promise<void>
    this.onLoadPlaylistFromStorage = null; // (playlistId, { asNewTab }) => Promise<void>
    this.onDeleteSavedPlaylist     = null; // (playlistId) => Promise<void>
    this.getSavedPlaylists         = null; // () => Array
    this.onExportPlaylist          = null; // (format: 'json' | 'm3u8') => void
    this.onImportPlaylistFile      = null; // (file: File) => Promise<void>
    this.onTabCopiedTrack          = null; // (track, targetTab) => void

    this._playingTrackId = null;
    this._cueingTrackId  = null;
    this._playedTrackIds = new Set();
    this._queuedTrackIds = new Set();
    this._pendingFocusIdx = null;

    this.pm.onChange = (tracks) => {
      this._renderTabs();
      this._render(tracks);
      this.onPlaylistChanged?.(tracks);
    };
  }

  updatePlayedState(playedIds) {
    this._playedTrackIds = playedIds;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.track-item').forEach((el) => {
      const id = parseInt(el.dataset.id, 10);
      el.classList.toggle('played', playedIds.has(id));
    });
  }

  updatePlayingState(trackId) {
    this._playingTrackId = trackId;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.track-item').forEach((el) => {
      const id = parseInt(el.dataset.id, 10);
      el.classList.toggle('playing', id === trackId);
    });
  }

  updateCueingState(trackId) {
    this._cueingTrackId = trackId;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.track-item').forEach((el) => {
      const id = parseInt(el.dataset.id, 10);
      el.classList.toggle('cueing', id === trackId);
    });
  }

  updateQueuedState(queuedIds) {
    this._queuedTrackIds = queuedIds;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.track-item').forEach((el) => {
      const id = parseInt(el.dataset.id, 10);
      el.classList.toggle('in-queue', queuedIds.has(id));
    });
  }

  /** 현재 검색/필터 조건에 맞는 트랙 배열 반환 */
  getFilteredTracks() {
    return this.pm.tracks.filter((t) => {
      if (this._tierFilter && !matchesBPMTier(t.bpm, this._tierFilter)) return false;
      if (this._filter && !this._matchesFilter(t, this._filter)) return false;
      return true;
    });
  }

  /** 포커스된 트랙 또는 첫 트랙 반환 */
  getSelectedOrFirstTrack() {
    const focused = document.activeElement?.closest?.('.track-item');
    if (focused) {
      const id = parseInt(focused.dataset.id, 10);
      const t = this.pm.getTrackById(id);
      if (t) return t;
    }
    const visible = this.getFilteredTracks();
    return visible[0] || this.pm.tracks[0] || null;
  }

  mount() {
    this.container.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-wrap">
          <span class="panel-title">🎵 플레이리스트</span>
          <span class="track-count" id="pl-count">0곡</span>
        </div>
        <div class="panel-header-actions">
          <button class="btn-text btn-text-gold" id="pl-io-btn" type="button" title="플레이리스트 보관함 저장/불러오기 및 JSON·M3U8 파일 내보내기">💾 보관함</button>
          <button class="btn-text btn-text-gold" id="pl-queue-all-btn" type="button" title="현재 목록의 곡들을 모두 큐에 추가">+전체 큐</button>
          <button class="btn-text" id="pl-clear-btn" type="button" title="현재 플레이리스트 탭 비우기">비우기</button>
        </div>
      </div>

      <!-- 멀티 플레이리스트 탭 바 -->
      <div class="pl-tabs-bar" id="pl-tabs-bar" aria-label="플레이리스트 탭">
        <div class="pl-tabs-list" id="pl-tabs-list" role="tablist"></div>
        <div class="pl-tabs-actions">
          <button type="button" class="pl-tab-ctrl-btn" id="pl-tab-add-btn" title="새 플레이리스트 탭 추가">+ 탭</button>
          <button type="button" class="pl-tab-ctrl-btn" id="pl-tab-rename-btn" title="현재 탭 이름 변경 (탭 더블클릭 가능)">✏️</button>
          <button type="button" class="pl-tab-ctrl-btn" id="pl-tab-dup-btn" title="현재 탭 복제">⧉</button>
        </div>
      </div>

      <!-- 플레이리스트 저장 / 불러오기 / 파일 입출력 서랍 -->
      <div class="pl-io-drawer" id="pl-io-drawer" style="display:none" aria-label="플레이리스트 저장 및 불러오기">
        <div class="pl-io-row">
          <input type="text" id="pl-save-name-input" class="pl-save-name-input" placeholder="저장할 플레이리스트 이름" maxlength="32" />
          <button type="button" class="pl-io-primary-btn" id="pl-save-storage-btn" title="브라우저 보관함에 현재 탭 저장">💾 보관함 저장</button>
        </div>
        <div class="pl-io-file-btns">
          <button type="button" class="pl-io-chip-btn" id="pl-export-json-btn" title="현재 탭을 JSON 파일(.swingdj.json)로 내보내기">📥 JSON 저장</button>
          <button type="button" class="pl-io-chip-btn" id="pl-export-m3u-btn" title="현재 탭을 M3U8 파일(.m3u8)로 내보내기">📥 M3U8 저장</button>
          <button type="button" class="pl-io-chip-btn" id="pl-import-file-btn" title="JSON 또는 M3U/M3U8 플레이리스트 파일 불러오기">📂 파일 불러오기</button>
          <input type="file" id="pl-import-input" accept=".json,.m3u,.m3u8,application/json,audio/x-mpegurl" style="display:none" />
        </div>
        <div class="pl-saved-section">
          <div class="pl-saved-title">보관함에 저장된 플레이리스트</div>
          <ul class="pl-saved-list" id="pl-saved-list"></ul>
        </div>
      </div>

      <div class="playlist-toolbar">
        <button class="btn-icon" id="pl-add-btn" type="button" title="오디오 파일 추가">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="btn-icon" id="pl-add-folder-btn" type="button" title="음악 폴더 통째로 추가">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
        </button>

        <div class="pl-search-wrap">
          <input type="text" id="pl-search" class="pl-search" placeholder="검색 · BPM(140, 160-180)" />
          <button type="button" class="pl-search-clear" id="pl-search-clear" title="검색어 지우기 (Esc)" style="display:none">✕</button>
        </div>

        <select id="pl-sort" class="pl-sort" title="정렬 기준">
          <option value="added">추가순</option>
          <option value="name">이름순</option>
          <option value="artist">아티스트</option>
          <option value="bpm">BPM</option>
          <option value="duration">길이</option>
        </select>
        <button type="button" class="btn-icon btn-sort-dir" id="pl-sort-dir" title="오름차순 정렬 (클릭하여 내림차순 전환)">↑</button>
      </div>

      <!-- BPM 7단계 속도별 색상 구분 & 원클릭 필터 바 -->
      <div class="bpm-tier-bar" id="bpm-tier-bar" aria-label="BPM 속도 구간 필터">
        ${BPM_TIERS.map((tier) => `
          <button type="button" class="bpm-tier-chip ${tier.className}" data-tier-id="${tier.id}" title="${tier.desc} 클릭하여 필터링">${tier.label}</button>
        `).join('')}
      </div>

      <div class="pl-drop-zone" id="pl-drop-zone">
        <div class="drop-icon">🎵</div>
        <div class="pl-drop-hint">오디오 파일이나 폴더를<br/>여기에 드래그하세요</div>
        <div class="pl-drop-btns">
          <button class="pl-drop-add-btn" id="pl-drop-add-btn" type="button">+ 파일 추가</button>
          <button class="pl-drop-add-btn" id="pl-drop-folder-btn" type="button">📁 폴더 추가</button>
        </div>
      </div>

      <ul class="track-list" id="pl-list"></ul>
      <input type="file" id="pl-file-input" multiple accept="audio/*,.mp3,.flac,.wav,.ogg,.aac,.m4a,.opus,.aiff,.wma" style="display:none" />
      <input type="file" id="pl-folder-input" webkitdirectory directory multiple style="display:none" />
    `;

    this._listEl      = this.container.querySelector('#pl-list');
    this._dropZone    = this.container.querySelector('#pl-drop-zone');
    this._fileInput   = this.container.querySelector('#pl-file-input');
    this._folderInput = this.container.querySelector('#pl-folder-input');
    this._countEl     = this.container.querySelector('#pl-count');
    this._searchInput = this.container.querySelector('#pl-search');
    this._searchClear = this.container.querySelector('#pl-search-clear');
    this._sortDirBtn  = this.container.querySelector('#pl-sort-dir');
    this._tierBarEl   = this.container.querySelector('#bpm-tier-bar');
    this._tabsListEl  = this.container.querySelector('#pl-tabs-list');
    this._ioDrawerEl  = this.container.querySelector('#pl-io-drawer');
    this._ioBtnEl     = this.container.querySelector('#pl-io-btn');
    this._saveNameInput = this.container.querySelector('#pl-save-name-input');
    this._savedListEl = this.container.querySelector('#pl-saved-list');
    this._importInput = this.container.querySelector('#pl-import-input');

    // 멀티 탭 컨트롤 이벤트
    this.container.querySelector('#pl-tab-add-btn').addEventListener('click', () => {
      this._renamingTabId = null;
      this.pm.createTab();
      if (this._saveNameInput) this._saveNameInput.value = this.pm.activeTab.name;
    });

    this.container.querySelector('#pl-tab-rename-btn').addEventListener('click', () => {
      this._startTabRename(this.pm.activeTabId);
    });

    this.container.querySelector('#pl-tab-dup-btn').addEventListener('click', () => {
      this._renamingTabId = null;
      this.pm.duplicateTab(this.pm.activeTabId);
      if (this._saveNameInput) this._saveNameInput.value = this.pm.activeTab.name;
    });

    // 저장/불러오기 서랍 토글 및 이벤트
    this._ioBtnEl.addEventListener('click', () => {
      this.toggleIODrawer();
    });

    this.container.querySelector('#pl-save-storage-btn').addEventListener('click', async () => {
      const name = (this._saveNameInput.value || this.pm.activeTab.name).trim();
      if (!name) {
        this._saveNameInput.focus();
        return;
      }
      this.pm.renameTab(this.pm.activeTabId, name);
      if (this.onSavePlaylistToStorage) {
        await this.onSavePlaylistToStorage(name, this.pm.tracks);
        this.renderSavedPlaylists();
      }
    });

    this._saveNameInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.container.querySelector('#pl-save-storage-btn').click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.toggleIODrawer(false);
      }
    });

    this.container.querySelector('#pl-export-json-btn').addEventListener('click', () => {
      this.onExportPlaylist?.('json');
    });
    this.container.querySelector('#pl-export-m3u-btn').addEventListener('click', () => {
      this.onExportPlaylist?.('m3u8');
    });
    this.container.querySelector('#pl-import-file-btn').addEventListener('click', () => {
      this._importInput.click();
    });
    this._importInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file && this.onImportPlaylistFile) {
        await this.onImportPlaylistFile(file);
        if (this._saveNameInput) this._saveNameInput.value = this.pm.activeTab.name;
      }
    });

    this._renderTabs();
    this.renderSavedPlaylists();

    // BPM 속도 구간 칩 클릭 필터
    this._tierBarEl?.querySelectorAll('.bpm-tier-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const tid = chip.dataset.tierId;
        this._tierFilter = this._tierFilter === tid ? '' : tid;
        this._tierBarEl.querySelectorAll('.bpm-tier-chip').forEach((c) => {
          c.classList.toggle('active', c.dataset.tierId === this._tierFilter);
        });
        this._render(this.pm.tracks);
      });
    });

    // 파일 추가 (File System Access API 우선)
    const openFilePicker = async () => {
      if (window.showOpenFilePicker) {
        try {
          const handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{
              description: '오디오 파일',
              accept: { 'audio/*': ['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.opus', '.aiff'] }
            }]
          });
          if (this.onFilesWithHandles) this.onFilesWithHandles(handles);
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }
      this._fileInput.click();
    };

    // 폴더 추가 (showDirectoryPicker 우선, 폴백 webkitdirectory)
    const openFolderPicker = async () => {
      if (window.showDirectoryPicker) {
        try {
          const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
          const handles = await collectAudioHandlesFromDirectory(dirHandle);
          if (handles.length && this.onFilesWithHandles) {
            this.onFilesWithHandles(handles);
          } else if (handles.length === 0) {
            this.onEmptyFolder?.();
          }
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }
      this._folderInput.click();
    };

    this.container.querySelector('#pl-add-btn').addEventListener('click', openFilePicker);
    this.container.querySelector('#pl-add-folder-btn').addEventListener('click', openFolderPicker);
    this.container.querySelector('#pl-drop-add-btn')?.addEventListener('click', openFilePicker);
    this.container.querySelector('#pl-drop-folder-btn')?.addEventListener('click', openFolderPicker);

    // 주의: input.value 초기화 시 FileList가 비워지므로 반드시 배열로 먼저 복사
    this._fileInput.addEventListener('change', (e) => {
      const picked = Array.from(e.target.files || []);
      e.target.value = '';
      if (picked.length) this._emitFiles(picked);
    });
    this._folderInput.addEventListener('change', (e) => {
      const picked = Array.from(e.target.files || []);
      e.target.value = '';
      if (picked.length) this._emitFiles(picked);
    });

    // +전체 큐 / 비우기
    this.container.querySelector('#pl-queue-all-btn').addEventListener('click', () => {
      const visible = this.getFilteredTracks();
      if (visible.length > 0) this.onQueueAll?.(visible);
    });
    this.container.querySelector('#pl-clear-btn').addEventListener('click', () => {
      if (this.pm.tracks.length === 0) return;
      if (confirm(`플레이리스트의 ${this.pm.tracks.length}곡을 모두 비울까요?`)) {
        this.pm.clear();
      }
    });

    // 드래그앤드롭 (파일 + 폴더 모두 지원)
    const handleFileDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._dropZone.classList.remove('drag-over');
      this.container.classList.remove('panel-drag-over');
      if (
        e.dataTransfer.types.includes('pl-internal') ||
        e.dataTransfer.types.includes('q-internal') ||
        e.dataTransfer.types.includes('q-to-pl')
      ) {
        return;
      }

      const { handles, files } = await extractDroppedAudioSources(e.dataTransfer);
      if (handles.length && this.onFilesWithHandles) await this.onFilesWithHandles(handles);
      if (files.length) this._emitFiles(files);
    };

    this._dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this._dropZone.classList.add('drag-over');
    });
    this._dropZone.addEventListener('dragleave', () => {
      this._dropZone.classList.remove('drag-over');
    });
    this._dropZone.addEventListener('drop', handleFileDrop);

    // 정렬 기준 & 정렬 방향
    this.container.querySelector('#pl-sort').addEventListener('change', (e) => {
      this._sortField = e.target.value;
      this.pm.sortBy(this._sortField, this._sortDir);
    });
    this._sortDirBtn.addEventListener('click', () => {
      this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
      this._sortDirBtn.textContent = this._sortDir === 'asc' ? '↑' : '↓';
      this._sortDirBtn.title = this._sortDir === 'asc'
        ? '오름차순 정렬 (클릭하여 내림차순 전환)'
        : '내림차순 정렬 (클릭하여 오름차순 전환)';
      this.pm.sortBy(this._sortField, this._sortDir);
    });

    // 검색 및 초기화
    const applySearch = () => {
      this._filter = this._searchInput.value;
      this._searchClear.style.display = this._filter ? 'flex' : 'none';
      this._render(this.pm.tracks);
    };
    this._searchInput.addEventListener('input', applySearch);
    this._searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this._searchInput.value || this._tierFilter) {
          e.preventDefault();
          e.stopPropagation();
          this._searchInput.value = '';
          this._tierFilter = '';
          this._tierBarEl?.querySelectorAll('.bpm-tier-chip').forEach((c) => c.classList.remove('active'));
          applySearch();
        } else {
          this._searchInput.blur();
        }
      } else if (e.key === 'ArrowDown') {
        const firstItem = this._listEl.querySelector('.track-item');
        if (firstItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    });
    this._searchClear.addEventListener('click', () => {
      this._searchInput.value = '';
      applySearch();
      this._searchInput.focus();
    });

    // 파일 드롭을 전체 패널에서도 받기
    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('Files')) {
        this.container.classList.add('panel-drag-over');
      }
    });
    this.container.addEventListener('dragleave', (e) => {
      if (!this.container.contains(e.relatedTarget)) {
        this.container.classList.remove('panel-drag-over');
      }
    });
    this.container.addEventListener('drop', handleFileDrop);
  }

  _matchesFilter(track, rawQuery) {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return true;

    // 상한 열린 BPM 검색 (예: "~160", "<160", "-160")
    const upperMatch = q.match(/^[~<-]\s*(\d{2,3})$/);
    if (upperMatch) {
      const hi = parseInt(upperMatch[1], 10);
      return track.bpm != null && track.bpm < hi;
    }

    // 하한 열린 BPM 검색 (예: "300~", "300+", ">300", "300-")
    const lowerMatch = q.match(/^(?:>\s*(\d{2,3})|(\d{2,3})\s*[~+-])$/);
    if (lowerMatch) {
      const lo = parseInt(lowerMatch[1] || lowerMatch[2], 10);
      return track.bpm != null && track.bpm >= lo;
    }

    // BPM 범위 검색 (예: "130-150" 또는 "160~180")
    const rangeMatch = q.match(/^(\d{2,3})\s*[-~]\s*(\d{2,3})$/);
    if (rangeMatch) {
      const lo = Math.min(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10));
      const hi = Math.max(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10));
      return track.bpm != null && track.bpm >= lo && track.bpm <= hi;
    }

    const textHit =
      (track.name || '').toLowerCase().includes(q) ||
      (track.artist || '').toLowerCase().includes(q) ||
      (track.album || '').toLowerCase().includes(q);

    // 단일 BPM 숫자 검색 (예: "140" → ±2 BPM 이내 곡도 매칭)
    if (/^\d{2,3}$/.test(q)) {
      const targetBpm = parseInt(q, 10);
      if (targetBpm >= 40 && targetBpm <= 400 && track.bpm != null && Math.abs(track.bpm - targetBpm) <= 2) {
        return true;
      }
    }

    return textHit;
  }

  _emitFiles(files) {
    if (this.onFilesDropped) this.onFilesDropped(files);
  }

  /* ── 멀티 플레이리스트 탭 렌더링 및 조작 ──────────────── */
  _startTabRename(tabId) {
    this._renamingTabId = tabId;
    this._renderTabs();
    const input = this._tabsListEl?.querySelector('.pl-tab-rename-input');
    if (input) {
      input.focus();
      input.select();
    }
  }

  _renderTabs() {
    if (!this._tabsListEl) return;
    const tabs = this.pm.tabs;
    const activeId = this.pm.activeTabId;

    this._tabsListEl.innerHTML = tabs.map((tab) => {
      const isActive = tab.id === activeId;
      const isRenaming = tab.id === this._renamingTabId;
      return `
        <div class="pl-tab-item ${isActive ? 'active' : ''}" data-tab-id="${tab.id}" role="tab" aria-selected="${isActive}" tabindex="0" title="${escAttr(tab.name)} (${tab.tracks.length}곡) — 더블클릭하여 이름 변경 · 곡 드래그하여 복사">
          ${isRenaming
            ? `<input type="text" class="pl-tab-rename-input" value="${escAttr(tab.name)}" maxlength="32" aria-label="탭 이름 입력" />`
            : `<span class="pl-tab-name">${escHtml(tab.name)}</span>
               <span class="pl-tab-count">${tab.tracks.length}</span>`
          }
          ${tabs.length > 1 && !isRenaming
            ? `<button type="button" class="pl-tab-close" data-close-tab="${tab.id}" title="탭 닫기">✕</button>`
            : ''
          }
        </div>
      `;
    }).join('');

    this._tabsListEl.querySelectorAll('.pl-tab-item').forEach((tabEl) => {
      const tabId = tabEl.dataset.tabId;

      tabEl.addEventListener('click', (e) => {
        if (e.target.closest('.pl-tab-close') || e.target.closest('.pl-tab-rename-input')) return;
        if (this.pm.activeTabId !== tabId) {
          this._renamingTabId = null;
          this.pm.switchTab(tabId);
          if (this._saveNameInput) this._saveNameInput.value = this.pm.activeTab.name;
        }
      });

      tabEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('.pl-tab-close')) return;
        e.stopPropagation();
        this._startTabRename(tabId);
      });

      // 다른 탭으로 트랙 드래그 앤 드롭하여 복사
      tabEl.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('q-to-pl')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          tabEl.classList.add('drag-over');
        }
      });
      tabEl.addEventListener('dragleave', () => tabEl.classList.remove('drag-over'));
      tabEl.addEventListener('drop', (e) => {
        tabEl.classList.remove('drag-over');
        const rawId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('q-to-pl');
        const trackId = parseInt(rawId, 10);
        if (!isNaN(trackId)) {
          e.preventDefault();
          e.stopPropagation();
          const track = this.pm.getTrackById(trackId);
          const ok = this.pm.copyTrackToTab(trackId, tabId);
          const targetTab = this.pm.tabs.find((t) => t.id === tabId);
          if (ok && track && targetTab) {
            this.onTabCopiedTrack?.(track, targetTab);
          }
        }
      });
    });

    const renameInput = this._tabsListEl.querySelector('.pl-tab-rename-input');
    if (renameInput) {
      const targetTabId = this._renamingTabId;
      const commitRename = () => {
        if (!this._renamingTabId) return;
        const val = renameInput.value.trim();
        this._renamingTabId = null;
        if (val) {
          this.pm.renameTab(targetTabId, val);
          if (this._saveNameInput && this.pm.activeTabId === targetTabId) {
            this._saveNameInput.value = this.pm.activeTab.name;
          }
        } else {
          this._renderTabs();
        }
      };
      renameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRename();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this._renamingTabId = null;
          this._renderTabs();
        }
      });
      renameInput.addEventListener('blur', commitRename);
    }

    this._tabsListEl.querySelectorAll('.pl-tab-close').forEach((closeBtn) => {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tid = closeBtn.dataset.closeTab;
        const target = this.pm.tabs.find((t) => t.id === tid);
        if (target && target.tracks.length > 0) {
          if (!confirm(`"${target.name}" 탭(${target.tracks.length}곡)을 닫을까요?`)) return;
        }
        this.pm.closeTab(tid);
        if (this._saveNameInput) this._saveNameInput.value = this.pm.activeTab.name;
      });
    });
  }

  /* ── 플레이리스트 저장/불러오기 서랍 제어 ─────────────── */
  toggleIODrawer(forceState = null) {
    this._ioOpen = forceState !== null ? Boolean(forceState) : !this._ioOpen;
    if (this._ioDrawerEl) {
      this._ioDrawerEl.style.display = this._ioOpen ? 'flex' : 'none';
    }
    this._ioBtnEl?.classList.toggle('active', this._ioOpen);
    if (this._ioOpen) {
      if (this._saveNameInput) {
        this._saveNameInput.value = this.pm.activeTab.name;
      }
      this.renderSavedPlaylists();
    }
  }

  renderSavedPlaylists() {
    if (!this._savedListEl) return;
    const list = this.getSavedPlaylists?.() || [];
    if (list.length === 0) {
      this._savedListEl.innerHTML = `<li class="pl-saved-empty">저장된 플레이리스트가 없습니다</li>`;
      return;
    }

    this._savedListEl.innerHTML = [...list].reverse().map((item) => `
      <li class="pl-saved-item" data-pl-id="${item.id}">
        <div class="pl-saved-info">
          <span class="pl-saved-name">${escHtml(item.name)}</span>
          <span class="pl-saved-meta">${item.trackCount ?? item.tracks?.length ?? 0}곡</span>
        </div>
        <div class="pl-saved-actions">
          <button type="button" class="pl-load-cur-btn" data-pl-id="${item.id}" title="현재 탭에 불러오기">불러오기</button>
          <button type="button" class="pl-load-new-btn" data-pl-id="${item.id}" title="새 탭으로 불러오기">+새 탭</button>
          <button type="button" class="pl-saved-del-btn" data-pl-id="${item.id}" title="보관함에서 삭제">✕</button>
        </div>
      </li>
    `).join('');

    this._savedListEl.querySelectorAll('.pl-load-cur-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this.onLoadPlaylistFromStorage?.(btn.dataset.plId, { asNewTab: false });
      });
    });

    this._savedListEl.querySelectorAll('.pl-load-new-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this.onLoadPlaylistFromStorage?.(btn.dataset.plId, { asNewTab: true });
      });
    });

    this._savedListEl.querySelectorAll('.pl-saved-del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this.onDeleteSavedPlaylist?.(btn.dataset.plId);
        this.renderSavedPlaylists();
      });
    });
  }

  _render(tracks) {
    const filtered = this.getFilteredTracks();

    if (this._filter.trim() || this._tierFilter) {
      this._countEl.textContent = `${filtered.length}/${tracks.length}곡`;
    } else {
      this._countEl.textContent = `${tracks.length}곡`;
    }

    if (tracks.length === 0) {
      this._dropZone.style.display = 'flex';
      this._listEl.innerHTML = '';
      return;
    }
    this._dropZone.style.display = 'none';

    if (filtered.length === 0) {
      this._listEl.innerHTML = `
        <li class="pl-empty-filter">
          검색 결과가 없습니다<br/>
          <small>곡 제목, 아티스트 또는 BPM 범위(예: 130-150)로 검색해보세요</small>
        </li>
      `;
      return;
    }

    this._listEl.innerHTML = filtered.map((t, viewIdx) => {
      const origIdx   = tracks.indexOf(t);
      const isPlayed  = this._playedTrackIds.has(t.id) ? 'played' : '';
      const isPlaying = t.id === this._playingTrackId ? 'playing' : '';
      const isCueing  = t.id === this._cueingTrackId ? 'cueing' : '';
      const inQueue   = this._queuedTrackIds.has(t.id) ? 'in-queue' : '';
      const isMissing = !t.file ? 'missing' : '';

      let bpmHtml;
      if (t.bpm) {
        const tierCls = getBPMTierClass(t.bpm);
        const tierObj = getBPMTier(t.bpm);
        const titleTxt = tierObj ? `${tierObj.desc} · 클릭하여 BPM 보정` : '클릭하여 BPM 보정';
        bpmHtml = `<span class="bpm-badge bpm-interactive ${tierCls}" data-bpm-id="${t.id}" title="${titleTxt}">${t.bpm} BPM</span>`;
      } else if (!t._bpmChecked && t.file) {
        bpmHtml = `<span class="bpm-badge bpm-loading bpm-interactive" data-bpm-id="${t.id}" title="BPM 자동 분석 대기 중 (클릭하여 직접 입력)">…</span>`;
      } else {
        bpmHtml = `<span class="bpm-badge bpm-unset bpm-interactive" data-bpm-id="${t.id}" title="클릭하여 BPM 입력">—</span>`;
      }

      return `
      <li class="track-item ${isPlayed} ${isPlaying} ${isCueing} ${inQueue} ${isMissing}" data-id="${t.id}" data-idx="${origIdx}" data-view-idx="${viewIdx}" draggable="true" tabindex="0">
        <div class="track-thumb">
          ${t.albumArt
            ? `<img src="${t.albumArt}" alt="cover" class="track-art" />`
            : `<div class="track-art-placeholder">♪</div>`
          }
        </div>
        <div class="track-info" title="${escAttr(t.name)} — ${escAttr(t.artist)}">
          <span class="track-name">${escHtml(t.name)}</span>
          <span class="track-artist">${escHtml(t.artist)}</span>
        </div>
        <div class="track-meta">
          ${bpmHtml}
          <span class="track-duration">${t.durationLabel}</span>
        </div>
        <div class="track-actions">
          <button type="button" class="btn-cue" data-id="${t.id}" title="헤드폰 미리듣기 (우클릭 / Q)">🎧</button>
          <button type="button" class="btn-queue-next" data-id="${t.id}" title="바로 다음 곡으로 예약 (N / Shift+더블클릭)">+다음</button>
          <button type="button" class="btn-queue" data-id="${t.id}" title="큐 맨 아래에 추가 (더블클릭 / Enter)">+Q</button>
          <button type="button" class="btn-pl-del" data-id="${t.id}" title="플레이리스트에서 제거 (Delete)">✕</button>
        </div>
      </li>
    `}).join('');

    const items = Array.from(this._listEl.querySelectorAll('.track-item'));

    items.forEach((el, viewIdx) => {
      const id = parseInt(el.dataset.id, 10);
      const track = this.pm.getTrackById(id);

      // 클릭 시 포커스 이동 (버튼/BPM 뱃지 클릭 제외)
      el.addEventListener('mousedown', (e) => {
        if (!e.target.closest('button')) el.focus();
      });

      // 더블클릭 → 큐에 추가 (Shift+더블클릭 → 바로 다음 곡으로 예약)
      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('button') || e.target.closest('.bpm-badge')) return;
        if (!track) return;
        if (e.shiftKey && this.onAddNextToQueue) {
          this.onAddNextToQueue(track);
        } else {
          this.onAddToQueue?.(track);
        }
      });

      // 우클릭 → CUE 미리듣기
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (track) this.onCue?.(track);
      });

      // 방향키 이동 + 단축키 지원 (↑/↓, Home/End, Q, Enter/>, N, Delete)
      el.addEventListener('keydown', (e) => {
        if (!track) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextEl = items[viewIdx + 1];
          if (nextEl) {
            nextEl.focus();
            nextEl.scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevEl = items[viewIdx - 1];
          if (prevEl) {
            prevEl.focus();
            prevEl.scrollIntoView({ block: 'nearest' });
          } else {
            this._searchInput?.focus();
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          items[0]?.focus();
          items[0]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'End') {
          e.preventDefault();
          items[items.length - 1]?.focus();
          items[items.length - 1]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'q' || e.key === 'Q') {
          e.preventDefault();
          this.onCue?.(track);
        } else if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          this.onAddNextToQueue?.(track);
        } else if (e.key === '>' || e.key === '.' || e.code === 'Enter') {
          e.preventDefault();
          if (e.shiftKey && this.onAddNextToQueue) {
            this.onAddNextToQueue(track);
          } else {
            this.onAddToQueue?.(track);
          }
        } else if (e.code === 'Delete') {
          e.preventDefault();
          this._removeWithFocusRestore(id, viewIdx);
        }
      });

      // 드래그 → 큐에 드롭 & 내부 순서 변경
      el.addEventListener('dragstart', (e) => {
        this._dragSrcIdx = parseInt(el.dataset.idx, 10);
        e.dataTransfer.setData('text/plain', String(id));
        e.dataTransfer.setData('pl-internal', String(this._dragSrcIdx));
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

        if (e.dataTransfer.types.includes('pl-internal')) {
          e.stopPropagation();
          const toIdx = parseInt(el.dataset.idx, 10);
          if (!isNaN(this._dragSrcIdx) && this._dragSrcIdx !== toIdx) {
            this.pm.reorder(this._dragSrcIdx, toIdx);
          }
          this._dragSrcIdx = null;
        } else if (e.dataTransfer.types.includes('q-to-pl')) {
          e.stopPropagation();
          const trackId = parseInt(e.dataTransfer.getData('q-to-pl'), 10);
          if (this.onTrackDropFromQueue) {
            this.onTrackDropFromQueue(trackId, parseInt(el.dataset.idx, 10));
          }
        }
      });
    });

    // BPM 뱃지 클릭 (수동 보정 팝오버)
    this._listEl.querySelectorAll('[data-bpm-id]').forEach((badgeEl) => {
      badgeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(badgeEl.dataset.bpmId, 10);
        const track = this.pm.getTrackById(id);
        if (track && this.onBPMBadgeClick) {
          this.onBPMBadgeClick(track, badgeEl);
        }
      });
    });

    // 액션 버튼 이벤트
    this._listEl.querySelectorAll('.btn-cue').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.pm.getTrackById(parseInt(btn.dataset.id, 10));
        if (track) this.onCue?.(track);
      });
    });

    this._listEl.querySelectorAll('.btn-queue-next').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.pm.getTrackById(parseInt(btn.dataset.id, 10));
        if (track) this.onAddNextToQueue?.(track);
      });
    });

    this._listEl.querySelectorAll('.btn-queue').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.pm.getTrackById(parseInt(btn.dataset.id, 10));
        if (track) this.onAddToQueue?.(track);
      });
    });

    this._listEl.querySelectorAll('.btn-pl-del').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const itemEl = btn.closest('.track-item');
        const viewIdx = itemEl ? parseInt(itemEl.dataset.viewIdx, 10) : 0;
        this._removeWithFocusRestore(id, viewIdx);
      });
    });

    // 삭제 후 포커스 복원
    if (this._pendingFocusIdx !== null) {
      const newItems = this._listEl.querySelectorAll('.track-item');
      if (newItems.length > 0) {
        const target = newItems[Math.min(this._pendingFocusIdx, newItems.length - 1)];
        target?.focus();
      }
      this._pendingFocusIdx = null;
    }
  }

  _removeWithFocusRestore(trackId, viewIdx) {
    this._pendingFocusIdx = viewIdx;
    const removed = this.pm.removeTrack(trackId);
    if (removed && this.onRemoveTrack) {
      this.onRemoveTrack(removed);
    }
  }

  /* BPM/duration 업데이트 후 특정 트랙 리스트 항목만 갱신 */
  updateTrackMeta(track) {
    const el = this._listEl?.querySelector(`.track-item[data-id="${track.id}"]`);
    if (!el) return;
    const bpmEl = el.querySelector('.bpm-badge');
    const durEl = el.querySelector('.track-duration');
    if (bpmEl) {
      bpmEl.classList.remove('bpm-loading', 'bpm-unset');
      applyBPMTierClass(bpmEl, track.bpm);
      if (track.bpm) {
        const tierObj = getBPMTier(track.bpm);
        bpmEl.textContent = `${track.bpm} BPM`;
        bpmEl.title = tierObj ? `${tierObj.desc} · 클릭하여 BPM 보정` : '클릭하여 BPM 보정';
      } else {
        bpmEl.textContent = '—';
        bpmEl.classList.add('bpm-unset');
        bpmEl.title = '클릭하여 BPM 입력';
      }
    }
    if (durEl) durEl.textContent = track.durationLabel;
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
