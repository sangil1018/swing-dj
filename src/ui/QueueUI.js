/**
 * QueueUI.js — 큐 패널 UI (드래그앤드롭 순서 변경 + 키보드 탐색 + CUE 구간 시크/점프)
 */
import { formatTime, formatSetDuration } from '../utils/TimeFormatter.js';
import { extractDroppedAudioSources } from '../utils/FileLoader.js';
import { getBPMTierClass, getBPMTier } from '../utils/BPMTier.js';
import { showToast } from '../utils/Toast.js';

export class QueueUI {
  constructor(container, queueManager, cuePlayer, onCueLoad) {
    this.container  = container;
    this.qm         = queueManager;
    this.cuePlayer  = cuePlayer;
    this.onCueLoad  = onCueLoad;

    // 콜백
    this.onCueStateChange       = null; // (cueingTrackId: number|null) => void
    this.onImportAllFromPlaylist = null; // () => void
    this.onExternalFilesDropped = null; // ({ handles, files }) => Promise<void>
    this.onBPMBadgeClick        = null; // (track, anchorEl) => void
    this.getSavedQueues         = null; // () => SavedQueue[]
    this.onSaveQueueToStorage   = null; // (name, tracks) => Promise<void>
    this.onLoadQueueFromStorage = null; // (queueId, { append }) => Promise<void>
    this.onDeleteSavedQueue     = null; // (queueId) => Promise<void>
    this.onExportQueue          = null; // (format: 'json'|'m3u8') => void
    this.onImportQueueFile      = null; // (file: File) => Promise<void>
    this.onCopyQueueToPlaylist  = null; // (tracks) => void
    this.onReconnectHandles     = null; // () => Promise<number>
    this.onReconnectFolder      = null; // () => Promise<void>

    this._listEl       = null;
    this._dragSrcIdx   = null;
    this._isCueSeeking = false;
    this._pendingFocusIdx = null;
    this._ioDrawerOpen = false;

    this.qm.onChange = () => {
      this._renderList();
      this.onQueueChanged?.(this.qm.queue);
    };

    this._rafId = null;
    this._playingTrackId = null;
    this._cueingTrackId  = null;
    this._missingTrackIds = new Set();
    this._playedTrackIds  = new Set();
  }

  updatePlayedState(playedIds) {
    this._playedTrackIds = playedIds;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.q-item').forEach((el) => {
      const id = parseInt(el.dataset.id, 10);
      el.classList.toggle('played', playedIds.has(id));
    });
    this._updateSummary();
  }

  markAsMissing(trackId) {
    this._missingTrackIds.add(trackId);
    if (!this._listEl) return;
    const el = this._listEl.querySelector(`.q-item[data-id="${trackId}"]`);
    if (el) el.classList.add('missing');
  }

  updatePlayingState(trackId) {
    this._playingTrackId = trackId;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.q-item').forEach((el) => {
      const id = parseInt(el.dataset.id, 10);
      el.classList.toggle('playing', id === trackId);
    });
    this._updateSummary();
  }

  updateCueingState(trackId) {
    this._cueingTrackId = trackId;
    if (!this._listEl) return;
    this._listEl.querySelectorAll('.q-item').forEach((el) => {
      const id = parseInt(el.dataset.id, 10);
      el.classList.toggle('cueing', id === trackId);
    });
  }

  updateTrackMeta(track) {
    if (!track) return;
    const el = this._listEl?.querySelector(`.q-item[data-id="${track.id}"]`);
    if (el) {
      const metaEl = el.querySelector('.q-meta');
      if (metaEl) {
        const tierCls = getBPMTierClass(track.bpm);
        const manualCls = track._bpmManual ? 'bpm-manual' : '';
        const tierObj = getBPMTier(track.bpm);
        const manualHint = track._bpmManual ? ' [수동 고정됨]' : '';
        const titleTxt = tierObj
          ? `${tierObj.desc}${manualHint} · 클릭하여 BPM 수정 (단축키 B)`
          : `클릭하여 BPM 수정${manualHint} (단축키 B)`;
        metaEl.innerHTML = `
          ${track.bpm ? `<span class="bpm-badge bpm-interactive ${tierCls} ${manualCls}" data-bpm-id="${track.id}" title="${titleTxt}">${track.bpm}</span>` : ''}
          <span class="q-dur">${track.durationLabel}</span>
        `;
        const badge = metaEl.querySelector('[data-bpm-id]');
        if (badge) {
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onBPMBadgeClick?.(track, badge);
          });
        }
      }
    }
    this._updateSummary();
  }

  refreshEmptyState() {
    if (this.qm.length === 0) this._renderList();
  }

  mount() {
    this.container.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-wrap">
          <span class="panel-title">📋 큐</span>
          <span class="track-count" id="q-summary">0곡</span>
          <span class="q-autosave-badge" id="q-autosave-badge" title="큐 대기열과 재생 완료 이력은 브라우저에 자동 저장되며, 앱을 다시 켜면 그대로 복원됩니다">✓ 자동저장</span>
        </div>
        <div class="panel-header-actions">
          <button class="btn-text btn-text-gold" id="q-io-btn" type="button" title="큐 보관함 저장/불러오기 및 JSON·M3U8 파일 내보내기/가져오기">💾 보관함</button>
          <button class="btn-text btn-text-gold" id="q-reset-history-btn" type="button" title="재생 완료 이력을 초기화하여 같은 곡을 다시 추가할 수 있게 합니다">이력 초기화</button>
          <button class="btn-text" id="q-clear-btn" type="button" title="큐 대기열 전체 비우기">전체 삭제</button>
        </div>
      </div>

      <!-- 큐 저장 / 불러오기 / 파일 입출력 서랍 -->
      <div class="q-io-drawer" id="q-io-drawer" style="display:none" aria-label="큐 저장 및 불러오기">
        <div class="q-io-row">
          <input type="text" id="q-save-name-input" class="q-save-name-input" placeholder="저장할 큐 세트 이름 (예: 1부 댄스 셋)" maxlength="32" />
          <button type="button" class="q-io-primary-btn" id="q-save-storage-btn" title="브라우저 보관함에 현재 큐 대기열 저장">💾 보관함 저장</button>
        </div>
        <div class="q-io-file-btns">
          <button type="button" class="q-io-chip-btn" id="q-export-json-btn" title="현재 큐를 JSON 파일(.swingdj.json)로 내보내기">📥 JSON 저장</button>
          <button type="button" class="q-io-chip-btn" id="q-export-m3u-btn" title="현재 큐를 M3U8 파일(.m3u8)로 내보내기">📥 M3U8 저장</button>
          <button type="button" class="q-io-chip-btn" id="q-import-file-btn" title="JSON 또는 M3U/M3U8 큐 파일 불러오기">📂 파일 불러오기</button>
          <button type="button" class="q-io-chip-btn" id="q-copy-to-tab-btn" title="현재 큐 목록 전체를 새 플레이리스트 탭으로 복사">🎵 탭으로 복사</button>
          <button type="button" class="q-io-chip-btn" id="q-drawer-folder-btn" title="다른 기기나 폴더 이동 시 음원 폴더를 지정하여 큐와 플레이리스트의 미연결 곡을 자동 매칭">📁 음원 폴더 찾기</button>
          <input type="file" id="q-import-input" accept=".json,.m3u,.m3u8,application/json,audio/x-mpegurl" style="display:none" />
        </div>
        <div class="q-saved-section">
          <div class="q-saved-title">보관함에 저장된 큐 세트</div>
          <ul class="q-saved-list" id="q-saved-list"></ul>
        </div>
      </div>

      <!-- 큐 이전 세션 복원 후 오디오 권한/폴더 원클릭 재연결 배너 -->
      <div class="q-reconnect-banner" id="q-reconnect-banner" style="display:none">
        <span class="q-reconnect-text" id="q-reconnect-text">🔗 이전 큐가 복원되었습니다</span>
        <div class="q-reconnect-actions">
          <button type="button" class="q-reconnect-btn primary" id="q-reconnect-handles-btn" title="클릭 한 번으로 저장된 오디오 파일 읽기 권한을 다시 활성화합니다">🔗 오디오 연결</button>
          <button type="button" class="q-reconnect-btn" id="q-reconnect-folder-btn" title="음악 폴더를 선택하면 곡 순서와 수정된 BPM은 그대로 유지한 채 오디오 파일을 자동 매칭합니다">📁 폴더 찾기</button>
        </div>
      </div>

      <!-- 큐 드롭 영역 + 리스트 -->
      <ul class="queue-list" id="q-list"></ul>

      <!-- 큐 미리듣기 (CUE OUT) -->
      <div class="cue-preview" id="cue-preview">
        <div class="cue-preview-header">
          <span class="cue-label">🎧 CUE OUT</span>
          <div class="cue-vol-wrap">
            <button type="button" class="btn-mute-icon cue-mute-btn" id="btn-cue-mute" title="CUE 음소거 토글">
              <svg id="icon-cue-vol-on" class="icon-sm" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
              <svg id="icon-cue-vol-off" class="icon-sm" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
            </button>
            <input type="range" id="cue-vol" class="mini-slider" min="0" max="1" step="0.01" value="0.85" title="CUE 볼륨" />
            <span class="cue-vol-pct" id="cue-vol-pct">85%</span>
          </div>
        </div>

        <div class="cue-now" id="cue-now">우클릭 또는 🎧 버튼으로 미리듣기</div>

        <div class="cue-controls">
          <button class="cue-btn" id="cue-play-btn" type="button" disabled>▶ 미리듣기</button>
          <button class="cue-btn cue-stop" id="cue-stop-btn" type="button" disabled>■ 정지</button>
          <div class="cue-jumps" title="구간 빠른 확인 (인트로 / 중반 / 엔딩 15초 전)">
            <button class="cue-jump-btn" data-jump="intro" type="button" disabled title="곡 처음(인트로) 확인">처음</button>
            <button class="cue-jump-btn" data-jump="mid" type="button" disabled title="곡 중반(50%) 분위기 확인">중반</button>
            <button class="cue-jump-btn" data-jump="outro" type="button" disabled title="곡 끝나기 15초 전(엔딩/페이드아웃) 확인">엔딩</button>
          </div>
        </div>

        <div class="cue-progress-wrap">
          <span id="cue-time">0:00</span>
          <div class="cue-progress-bar" id="cue-progress-bar" title="클릭 또는 드래그하여 미리듣기 구간 이동">
            <div class="cue-progress-fill" id="cue-fill" style="width:0%"></div>
            <div class="cue-progress-thumb" id="cue-thumb" style="left:0%"></div>
          </div>
          <span id="cue-dur">0:00</span>
        </div>
      </div>
    `;

    this._listEl        = this.container.querySelector('#q-list');
    this._summaryEl     = this.container.querySelector('#q-summary');
    this._ioDrawerEl    = this.container.querySelector('#q-io-drawer');
    this._ioBtnEl       = this.container.querySelector('#q-io-btn');
    this._saveNameInput = this.container.querySelector('#q-save-name-input');
    this._savedListEl   = this.container.querySelector('#q-saved-list');
    this._importInput   = this.container.querySelector('#q-import-input');
    this._reconnectBannerEl = this.container.querySelector('#q-reconnect-banner');
    this._reconnectTextEl   = this.container.querySelector('#q-reconnect-text');
    this._reconnectHandlesBtn = this.container.querySelector('#q-reconnect-handles-btn');
    this._reconnectFolderBtn  = this.container.querySelector('#q-reconnect-folder-btn');
    this._cueNowEl      = this.container.querySelector('#cue-now');
    this._cuePlayBtn    = this.container.querySelector('#cue-play-btn');
    this._cueStopBtn    = this.container.querySelector('#cue-stop-btn');
    this._cueJumpBtns   = Array.from(this.container.querySelectorAll('.cue-jump-btn'));
    this._cueTimeEl     = this.container.querySelector('#cue-time');
    this._cueDurEl      = this.container.querySelector('#cue-dur');
    this._cueBarEl      = this.container.querySelector('#cue-progress-bar');
    this._cueFillEl     = this.container.querySelector('#cue-fill');
    this._cueThumbEl    = this.container.querySelector('#cue-thumb');
    this._cueVolSlider  = this.container.querySelector('#cue-vol');
    this._cueVolPct     = this.container.querySelector('#cue-vol-pct');
    this._cueMuteBtn    = this.container.querySelector('#btn-cue-mute');

    // 큐 보관함 서랍 토글 및 세트 관리
    this._ioBtnEl?.addEventListener('click', () => this.toggleIODrawer());
    this.container.querySelector('#q-save-storage-btn')?.addEventListener('click', async () => {
      if (this.qm.length === 0) {
        showToast('큐에 저장할 곡이 없습니다');
        return;
      }
      const defaultName = `큐 세트 ${new Date().toLocaleDateString('ko-KR')}`;
      const name = (this._saveNameInput.value || '').trim() || defaultName;
      if (this.onSaveQueueToStorage) {
        await this.onSaveQueueToStorage(name, this.qm.queue);
        this.renderSavedQueues();
      }
    });

    // 큐 JSON / M3U8 파일 내보내기 및 불러오기
    this.container.querySelector('#q-export-json-btn')?.addEventListener('click', () => {
      this.onExportQueue?.('json');
    });
    this.container.querySelector('#q-export-m3u-btn')?.addEventListener('click', () => {
      this.onExportQueue?.('m3u8');
    });
    this.container.querySelector('#q-import-file-btn')?.addEventListener('click', () => {
      this._importInput.click();
    });
    this._importInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file && this.onImportQueueFile) {
        await this.onImportQueueFile(file);
      }
    });

    // 큐 목록을 새 플레이리스트 탭으로 복사
    this.container.querySelector('#q-copy-to-tab-btn')?.addEventListener('click', () => {
      if (this.qm.length === 0) {
        showToast('플레이리스트로 복사할 큐 곡이 없습니다');
        return;
      }
      this.onCopyQueueToPlaylist?.(this.qm.queue);
    });

    // 서랍 내 음원 폴더 찾기
    this.container.querySelector('#q-drawer-folder-btn')?.addEventListener('click', () => {
      this.onReconnectFolder?.();
    });

    // 재연결 배너 버튼
    this._reconnectHandlesBtn?.addEventListener('click', async () => {
      if (this.onReconnectHandles) {
        await this.onReconnectHandles();
      }
    });
    this._reconnectFolderBtn?.addEventListener('click', () => {
      this.onReconnectFolder?.();
    });

    this.renderSavedQueues();

    // 이력 초기화 및 안전한 전체 삭제
    this.container.querySelector('#q-reset-history-btn')?.addEventListener('click', () => {
      this.onResetHistory?.();
    });
    this.container.querySelector('#q-clear-btn').addEventListener('click', () => {
      if (this.qm.length === 0) return;
      if (confirm(`큐의 대기 목록(${this.qm.length}곡)을 모두 비울까요?`)) {
        this.qm.clear();
        showToast('큐 목록을 모두 비웠습니다');
      }
    });

    // CUE 볼륨 & 음소거
    this._cueVolSlider.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      this.cuePlayer.engine.setCueVolume(v);
      this._syncCueVolumeUI();
    });
    this._cueMuteBtn.addEventListener('click', () => {
      this.cuePlayer.engine.toggleCueMute();
      this._syncCueVolumeUI();
    });

    // CUE 재생/정지 및 구간 점프
    this._cuePlayBtn.addEventListener('click', () => this._cueToggle());
    this._cueStopBtn.addEventListener('click', () => this.stopCue());

    this._cueJumpBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.cuePlayer.currentTrack) return;
        const dur = this.cuePlayer.duration;
        if (dur <= 0) return;
        const mode = btn.dataset.jump;
        let targetSec = 0;
        if (mode === 'intro') targetSec = 0;
        else if (mode === 'mid') targetSec = dur * 0.5;
        else if (mode === 'outro') targetSec = Math.max(0, dur - 15);

        this.cuePlayer.engine.resume();
        this.cuePlayer.seek(targetSec);
        if (!this.cuePlayer.isPlaying) {
          this.cuePlayer.play();
        }
        this._updateCueProgressUI();
        this._updateCueBtn();
      });
    });

    // CUE 진행 바 시크 (클릭 & 드래그)
    this._setupCueSeek();

    this.cuePlayer.onEnded = () => {
      this._cueFillEl.style.width = '0%';
      this._cueThumbEl.style.left = '0%';
      this._cueTimeEl.textContent = '0:00';
      this._updateCueBtn();
    };

    // 큐 패널/리스트 드롭 처리 (플레이리스트 트랙 드롭 / 내부 하단 이동 / 외부 파일·폴더 드롭)
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
    this.container.addEventListener('drop', async (e) => {
      this.container.classList.remove('panel-drag-over');
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        const sources = await extractDroppedAudioSources(e.dataTransfer);
        if ((sources.handles.length || sources.files.length) && this.onExternalFilesDropped) {
          await this.onExternalFilesDropped(sources);
        }
      }
    });

    this._listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('q-internal')) {
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this._listEl.addEventListener('drop', (e) => {
      if (e.dataTransfer.types.includes('Files')) return; // container 핸들러가 처리
      e.preventDefault();
      if (e.dataTransfer.types.includes('q-internal')) {
        const fromIdx = parseInt(e.dataTransfer.getData('q-internal'), 10);
        if (!isNaN(fromIdx) && this.qm.length > 0) {
          this.qm.reorder(fromIdx, this.qm.length - 1);
        }
        this._dragSrcIdx = null;
        return;
      }
      const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (!isNaN(id) && this.onTrackDropFromPlaylist) {
        this.onTrackDropFromPlaylist(id);
      }
    });

    this._renderList();
  }

  _syncCueVolumeUI() {
    if (!this._cueMuteBtn) return;
    const isMuted = this.cuePlayer.engine.isCueMuted;
    const v = this.cuePlayer.engine.getCueVolume();
    this.container.querySelector('#icon-cue-vol-on').style.display  = isMuted ? 'none' : 'block';
    this.container.querySelector('#icon-cue-vol-off').style.display = isMuted ? 'block' : 'none';
    this._cueMuteBtn.classList.toggle('muted', isMuted);
    if (this._cueVolPct) {
      this._cueVolPct.textContent = isMuted ? '음소거' : `${Math.round(v * 100)}%`;
    }
  }

  syncVolumeFromSettings(v) {
    if (this._cueVolSlider) this._cueVolSlider.value = v;
    this._syncCueVolumeUI();
  }

  _setupCueSeek() {
    const seekTo = (clientX) => {
      if (!this.cuePlayer.currentTrack || this.cuePlayer.duration <= 0) return;
      const rect = this._cueBarEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      this.cuePlayer.seek(ratio * this.cuePlayer.duration);
      this._updateCueProgressUI();
    };

    this._cueBarEl.style.touchAction = 'none';
    this._cueBarEl.addEventListener('pointerdown', (e) => {
      if (!this.cuePlayer.currentTrack) return;
      this._isCueSeeking = true;
      this._cueBarEl.setPointerCapture?.(e.pointerId);
      seekTo(e.clientX);
    });
    this._cueBarEl.addEventListener('pointermove', (e) => {
      if (this._isCueSeeking) seekTo(e.clientX);
    });
    const endCueSeek = (e) => {
      if (this._isCueSeeking) {
        this._isCueSeeking = false;
        this._cueBarEl.releasePointerCapture?.(e.pointerId);
      }
    };
    this._cueBarEl.addEventListener('pointerup', endCueSeek);
    this._cueBarEl.addEventListener('pointercancel', endCueSeek);
  }

  toggleIODrawer(force) {
    const open = force !== undefined ? force : !this._ioDrawerOpen;
    this._ioDrawerOpen = open;
    if (this._ioDrawerEl) {
      this._ioDrawerEl.style.display = open ? 'flex' : 'none';
    }
    if (this._ioBtnEl) {
      this._ioBtnEl.classList.toggle('active', open);
      this._ioBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (open) {
      this.renderSavedQueues();
      if (this._saveNameInput && !this._saveNameInput.value) {
        this._saveNameInput.value = `큐 세트 ${new Date().toLocaleDateString('ko-KR')}`;
      }
    }
  }

  renderSavedQueues() {
    if (!this._savedListEl) return;
    const list = (this.getSavedQueues ? this.getSavedQueues() : []) || [];
    if (list.length === 0) {
      this._savedListEl.innerHTML = `<li class="q-saved-empty">저장된 큐 세트가 없습니다. 위 입력창에서 저장해보세요.</li>`;
      return;
    }

    this._savedListEl.innerHTML = list.map((item) => {
      const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('ko-KR') : '';
      const durStr = item.totalDuration ? ` · ${formatSetDuration(item.totalDuration)}` : '';
      return `
        <li class="q-saved-item" data-id="${item.id}">
          <div class="q-saved-info" title="${escAttr(item.name)} (${item.trackCount || 0}곡)">
            <span class="q-saved-name">${escHtml(item.name)}</span>
            <span class="q-saved-meta">${item.trackCount || 0}곡${durStr} · ${dateStr}</span>
          </div>
          <div class="q-saved-actions">
            <button type="button" class="q-saved-btn q-saved-load" data-id="${item.id}" title="현재 큐를 이 세트로 교체하여 불러오기">불러오기</button>
            <button type="button" class="q-saved-btn q-saved-append" data-id="${item.id}" title="현재 큐 목록 뒤에 추가">+추가</button>
            <button type="button" class="q-saved-btn q-saved-del" data-id="${item.id}" title="보관함에서 삭제">✕</button>
          </div>
        </li>
      `;
    }).join('');

    this._savedListEl.querySelectorAll('.q-saved-load').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        this.onLoadQueueFromStorage?.(id, { append: false });
      });
    });

    this._savedListEl.querySelectorAll('.q-saved-append').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        this.onLoadQueueFromStorage?.(id, { append: true });
      });
    });

    this._savedListEl.querySelectorAll('.q-saved-del').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const item = list.find((q) => q.id === id);
        if (confirm(`큐 보관함에서 "${item?.name || '큐 세트'}"를 삭제할까요?`)) {
          await this.onDeleteSavedQueue?.(id);
          this.renderSavedQueues();
        }
      });
    });
  }

  _updateSummary() {
    if (!this._summaryEl) return;
    const queue = this.qm.queue;

    // 미연결 트랙 통계 및 재연결 배너 업데이트
    if (this._reconnectBannerEl) {
      const stats = this.qm.getMissingFileStats();
      if (stats.missing > 0) {
        this._reconnectBannerEl.style.display = 'flex';
        if (stats.withHandles > 0) {
          this._reconnectTextEl.textContent = `🔗 큐 ${stats.missing}곡 오디오 대기 중`;
          this._reconnectHandlesBtn.style.display = 'inline-flex';
        } else {
          this._reconnectTextEl.textContent = `📁 큐 ${stats.missing}곡 파일 연결 대기 중`;
          this._reconnectHandlesBtn.style.display = 'none';
        }
      } else {
        this._reconnectBannerEl.style.display = 'none';
      }
    }

    if (queue.length === 0) {
      this._summaryEl.textContent = '0곡';
      this._summaryEl.title = '대기 중인 곡 없음';
      return;
    }

    let totalSec = 0;
    let remainingSec = 0;
    const playingIdx = this._playingTrackId != null
      ? queue.findIndex((t) => t.id === this._playingTrackId)
      : -1;

    queue.forEach((t, idx) => {
      const d = isFinite(t.duration) && t.duration > 0 ? t.duration : 0;
      totalSec += d;
      if (playingIdx !== -1) {
        if (idx > playingIdx) remainingSec += d;
      } else if (!this._playedTrackIds.has(t.id)) {
        remainingSec += d;
      }
    });

    if (totalSec > 0) {
      const displaySec = playingIdx !== -1 ? remainingSec : totalSec;
      const prefix = playingIdx !== -1 ? `다음 ${Math.max(0, queue.length - playingIdx - 1)}곡` : `${queue.length}곡`;
      this._summaryEl.textContent = displaySec > 0
        ? `${prefix} · ${formatSetDuration(displaySec)}`
        : `${queue.length}곡`;
      this._summaryEl.title = `전체 큐 ${queue.length}곡 (${formatSetDuration(totalSec)}) / 남은 대기곡 예정 시간: ${formatSetDuration(remainingSec)}`;
    } else {
      this._summaryEl.textContent = `${queue.length}곡`;
      this._summaryEl.title = `큐 총 ${queue.length}곡`;
    }
  }

  /* ── 큐 리스트 렌더링 ───────────────────────────────── */
  _renderList() {
    const queue = this.qm.queue;
    this._updateSummary();

    if (queue.length === 0) {
      const hasPlaylistTracks = Boolean(this.getPlaylistCount?.() > 0);
      this._listEl.innerHTML = `
        <li class="q-empty">
          <div>큐가 비어있습니다</div>
          <small>플레이리스트에서 <b>더블클릭</b> · <b>+Q</b> · <b>드래그</b>하여 추가하세요</small>
          ${hasPlaylistTracks ? `<button type="button" class="q-import-all-btn" id="q-import-all-btn">+ 플레이리스트 전체 가져오기</button>` : ''}
        </li>
      `;
      this._listEl.querySelector('#q-import-all-btn')?.addEventListener('click', () => {
        this.onImportAllFromPlaylist?.();
      });
      return;
    }

    this._listEl.innerHTML = queue.map((t, i) => {
      const isPlaying = t.id === this._playingTrackId ? 'playing' : '';
      const isCueing  = t.id === this._cueingTrackId ? 'cueing' : '';
      if (t.file && this._missingTrackIds.has(t.id)) {
        this._missingTrackIds.delete(t.id);
      }
      const isMissing = (!t.file || this._missingTrackIds.has(t.id)) ? 'missing' : '';
      const isPlayed  = this._playedTrackIds.has(t.id) ? 'played' : '';
      const tierCls   = getBPMTierClass(t.bpm);
      const manualCls = t._bpmManual ? 'bpm-manual' : '';
      const tierObj   = getBPMTier(t.bpm);
      const manualHint = t._bpmManual ? ' [수동 고정됨]' : '';
      const bpmTitle  = tierObj
        ? `${tierObj.desc}${manualHint} · 클릭하여 BPM 수정 (단축키 B)`
        : `클릭하여 BPM 수정${manualHint} (단축키 B)`;

      return `
      <li class="q-item ${isPlaying} ${isCueing} ${isMissing} ${isPlayed}" data-id="${t.id}" data-idx="${i}" draggable="true" tabindex="0">
        <span class="q-num">${i + 1}</span>
        <div class="q-info" title="${escAttr(t.name)} — ${escAttr(t.artist)}">
          <span class="q-name">${escHtml(t.name)}</span>
          <span class="q-artist">${escHtml(t.artist)}</span>
        </div>
        <div class="q-meta">
          ${t.bpm ? `<span class="bpm-badge bpm-interactive ${tierCls} ${manualCls}" data-bpm-id="${t.id}" title="${bpmTitle}">${t.bpm}</span>` : ''}
          <span class="q-dur">${t.durationLabel}</span>
        </div>
        <div class="q-actions">
          <button type="button" class="q-cue-btn" data-idx="${i}" title="헤드폰 미리듣기 (우클릭 / Q)">🎧</button>
          <button type="button" class="q-up-btn" data-idx="${i}" title="위로 이동 (Alt+↑)" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="q-dn-btn" data-idx="${i}" title="아래로 이동 (Alt+↓)" ${i === queue.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="q-del-btn" data-idx="${i}" title="큐에서 제거 (Delete)">✕</button>
        </div>
      </li>
    `}).join('');

    const items = Array.from(this._listEl.querySelectorAll('.q-item'));

    items.forEach((el, i) => {
      el.addEventListener('mousedown', (e) => {
        if (!e.target.closest('button')) el.focus();
      });

      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('button') || e.target.closest('.bpm-badge')) return;
        const track = this.qm.queue[i];
        if (track && this.onTrackDoubleClick) {
          this.onTrackDoubleClick(track.id);
        }
      });

      // 우클릭 → CUE 미리듣기
      el.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const track = this.qm.queue[i];
        if (track) await this._triggerCue(track);
      });

      // 키보드 탐색 및 단축키 (↑/↓, Alt+↑/↓, Home/End, P/Enter, Q, Delete)
      el.addEventListener('keydown', async (e) => {
        const track = this.qm.queue[i];
        if (!track) return;

        if (e.altKey && e.key === 'ArrowUp') {
          e.preventDefault();
          if (i > 0) {
            this._pendingFocusIdx = i - 1;
            this.qm.moveUp(i);
          }
        } else if (e.altKey && e.key === 'ArrowDown') {
          e.preventDefault();
          if (i < items.length - 1) {
            this._pendingFocusIdx = i + 1;
            this.qm.moveDown(i);
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextEl = items[i + 1];
          if (nextEl) {
            nextEl.focus();
            nextEl.scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevEl = items[i - 1];
          if (prevEl) {
            prevEl.focus();
            prevEl.scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          items[0]?.focus();
          items[0]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'End') {
          e.preventDefault();
          items[items.length - 1]?.focus();
          items[items.length - 1]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'p' || e.key === 'P' || e.code === 'Enter') {
          e.preventDefault();
          if (this.onTrackDoubleClick) this.onTrackDoubleClick(track.id);
        } else if (e.key === 'b' || e.key === 'B') {
          e.preventDefault();
          const badgeEl = el.querySelector('[data-bpm-id]') || el.querySelector('.q-meta');
          if (badgeEl && this.onBPMBadgeClick) {
            this.onBPMBadgeClick(track, badgeEl);
          }
        } else if (e.key === 'q' || e.key === 'Q') {
          e.preventDefault();
          await this._triggerCue(track);
        } else if (e.code === 'Delete' || e.code === 'Backspace') {
          e.preventDefault();
          this._pendingFocusIdx = i;
          this.qm.removeById(track.id);
        }
      });

      el.addEventListener('dragstart', (e) => {
        this._dragSrcIdx = i;
        const track = this.qm.queue[i];
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('q-internal', String(i));
        if (track) e.dataTransfer.setData('q-to-pl', String(track.id));
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('q-internal')) {
          e.dataTransfer.dropEffect = 'move';
          el.classList.add('drag-target');
        } else if (e.dataTransfer.types.includes('text/plain')) {
          e.dataTransfer.dropEffect = 'copy';
          el.classList.add('drag-target');
        }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-target'));
      el.addEventListener('drop', (e) => {
        if (e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        el.classList.remove('drag-target');
        const toIdx = i;
        if (e.dataTransfer.types.includes('q-internal')) {
          e.stopPropagation();
          if (this._dragSrcIdx != null && !isNaN(this._dragSrcIdx) && this._dragSrcIdx !== toIdx) {
            this.qm.reorder(this._dragSrcIdx, toIdx);
          }
          this._dragSrcIdx = null;
        } else {
          const trackId = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(trackId) && this.onTrackDropFromPlaylist) {
            e.stopPropagation();
            this.onTrackDropFromPlaylist(trackId, toIdx);
          }
        }
      });
    });

    // BPM 뱃지 클릭
    this._listEl.querySelectorAll('[data-bpm-id]').forEach((badgeEl) => {
      badgeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(badgeEl.dataset.bpmId, 10);
        const track = this.qm.queue.find((t) => t.id === id);
        if (track && this.onBPMBadgeClick) {
          this.onBPMBadgeClick(track, badgeEl);
        }
      });
    });

    // 버튼 이벤트
    this._listEl.querySelectorAll('.q-cue-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const track = this.qm.queue[parseInt(btn.dataset.idx, 10)];
        if (track) await this._triggerCue(track);
      });
    });
    this._listEl.querySelectorAll('.q-up-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        if (idx > 0) {
          this._pendingFocusIdx = idx - 1;
          this.qm.moveUp(idx);
        }
      });
    });
    this._listEl.querySelectorAll('.q-dn-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        if (idx < this.qm.length - 1) {
          this._pendingFocusIdx = idx + 1;
          this.qm.moveDown(idx);
        }
      });
    });
    this._listEl.querySelectorAll('.q-del-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const track = this.qm.queue[idx];
        if (track) {
          this._pendingFocusIdx = idx;
          this.qm.removeById(track.id);
        }
      });
    });

    // 포커스 복원 (삭제·이동 후 연속 키보드 조작 보장)
    if (this._pendingFocusIdx !== null) {
      const newItems = this._listEl.querySelectorAll('.q-item');
      if (newItems.length > 0) {
        const target = newItems[Math.min(this._pendingFocusIdx, newItems.length - 1)];
        target?.focus();
        target?.scrollIntoView({ block: 'nearest' });
      }
      this._pendingFocusIdx = null;
    }
  }

  async _triggerCue(track) {
    const status = await this.loadCue(track);
    if (status === 'started') showToast(`미리듣기 시작: ${track.name}`);
    else if (status === 'stopped') showToast(`미리듣기 정지: ${track.name}`);
  }

  /* ── CUE 미리듣기 ───────────────────────────────────── */
  async loadCue(track) {
    this.cuePlayer.engine.resume();
    if (!track || !track.file) {
      this._cueNowEl.textContent = `파일을 찾을 수 없습니다: ${track?.name}`;
      showToast(`파일 유실: ${track?.name ?? ''}`);
      return 'error';
    }

    // 이미 같은 곡이 CUE에 로드되어 있는 경우 토글(정지/재생)
    if (this.cuePlayer.currentTrack && this.cuePlayer.currentTrack.id === track.id) {
      if (this.cuePlayer.isPlaying) {
        this.stopCue();
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
    this._cueNowEl.title       = `${track.name} — ${track.artist}`;
    this._cueDurEl.textContent = formatTime(this.cuePlayer.duration);
    this._cuePlayBtn.disabled  = false;
    this._cueStopBtn.disabled  = false;
    this._cueJumpBtns.forEach((b) => { b.disabled = false; });

    this.cuePlayer.play();
    this._updateCueBtn();
    return 'started';
  }

  _cueToggle() {
    this.cuePlayer.engine.resume();
    this.cuePlayer.toggle();
    this._updateCueBtn();
  }

  stopCue() {
    this.cuePlayer.stop();
    this._cueFillEl.style.width = '0%';
    this._cueThumbEl.style.left = '0%';
    this._cueTimeEl.textContent = '0:00';
    this._updateCueBtn();
  }

  resetCue() {
    this.cuePlayer.unload();
    this._cueNowEl.textContent  = '우클릭 또는 🎧 버튼으로 미리듣기';
    this._cueFillEl.style.width = '0%';
    this._cueThumbEl.style.left = '0%';
    this._cueTimeEl.textContent = '0:00';
    this._cueDurEl.textContent  = '0:00';
    this._cuePlayBtn.disabled   = true;
    this._cueStopBtn.disabled   = true;
    this._cueJumpBtns.forEach((b) => { b.disabled = true; });
    this._updateCueBtn();
  }

  _updateCueBtn() {
    this._cuePlayBtn.textContent = this.cuePlayer.isPlaying ? '⏸ 일시정지' : '▶ 미리듣기';
    const activeCueId = this.cuePlayer.isPlaying && this.cuePlayer.currentTrack
      ? this.cuePlayer.currentTrack.id
      : null;
    this.updateCueingState(activeCueId);
    this.onCueStateChange?.(activeCueId);

    if (this.cuePlayer.isPlaying) {
      this._startCueTick();
    } else if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _updateCueProgressUI() {
    const pct = (this.cuePlayer.progress * 100).toFixed(2);
    this._cueFillEl.style.width = `${pct}%`;
    this._cueThumbEl.style.left = `${pct}%`;
    this._cueTimeEl.textContent = formatTime(this.cuePlayer.currentTime);
    this._cueDurEl.textContent  = formatTime(this.cuePlayer.duration);
  }

  /* ── CUE 진행 바 업데이트 (rAF) ─────────────────────── */
  _startCueTick() {
    if (this._rafId) return;
    const tick = () => {
      if (!this.cuePlayer.isPlaying) {
        this._rafId = null;
        return;
      }
      this._updateCueProgressUI();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
