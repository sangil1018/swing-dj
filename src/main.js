/**
 * main.js — SwingDJ 앱 초기화 및 모듈 조율
 */

import { AudioEngine }      from './audio/AudioEngine.js';
import { Player }           from './audio/Player.js';
import { CuePlayer }        from './audio/CuePlayer.js';
import { Metronome }        from './audio/Metronome.js';
import { detectBPM }        from './audio/BPMDetector.js';
import { PlaylistManager }  from './playlist/PlaylistManager.js';
import { QueueManager }     from './playlist/QueueManager.js';
import {
  loadFiles,
  getNextTrackId,
  extractFormatLabel,
  extractDroppedAudioSources,
} from './utils/FileLoader.js';
import { formatDuration }   from './utils/TimeFormatter.js';
import { Storage }          from './utils/Storage.js';
import { ProfileManager }   from './utils/ProfileManager.js';
import { ThemeManager }     from './utils/ThemeManager.js';
import { showToast }        from './utils/Toast.js';
import { DeviceSelector }   from './ui/DeviceSelector.js';
import { EQPanel }          from './ui/EQPanel.js';
import { PlayerUI }         from './ui/PlayerUI.js';
import { DJToolsUI }        from './ui/DJToolsUI.js';
import { PlaylistUI }       from './ui/PlaylistUI.js';
import { QueueUI }          from './ui/QueueUI.js';
import { ProfileUI }        from './ui/ProfileUI.js';
import { BPMPopover }       from './ui/BPMPopover.js';
import { HelpModal }        from './ui/HelpModal.js';

/* ── 모듈 인스턴스 ───────────────────────────────────── */
const engine     = new AudioEngine();
const player     = new Player(engine);
const cue        = new CuePlayer(engine);
const metronome  = new Metronome(engine);
const pm         = new PlaylistManager();
const qm         = new QueueManager();
const profileMgr = new ProfileManager();
const themeMgr   = new ThemeManager();

/* ── UI 인스턴스 ─────────────────────────────────────── */
const playerUI = new PlayerUI(
  document.querySelector('#player-inner'),
  player, engine,
  () => playNext(),
  () => playPrev()
);

const djToolsUI = new DJToolsUI(
  document.querySelector('#dj-tools-container'),
  player, engine, metronome
);

const playlistUI = new PlaylistUI(
  document.querySelector('#playlist-panel'),
  pm,
  (track) => addToQueue(track)
);

const queueUI = new QueueUI(
  document.querySelector('#queue-panel'),
  qm, cue,
  null
);

const eqPanel = new EQPanel(
  document.querySelector('#eq-container'),
  engine, Storage
);

const deviceSelector = new DeviceSelector(engine);

const bpmPopover = new BPMPopover((track, newBpm) => {
  track.bpm = newBpm;
  track._bpmChecked = true;
  playlistUI.updateTrackMeta(track);
  queueUI.updateTrackMeta(track);
  if (player.currentTrack?.id === track.id) {
    playerUI.updateBPM(track);
  }
  showToast(`${track.name}: ${newBpm} BPM 설정됨`);
});

const helpModal = new HelpModal();

/* ── 프로파일 시스템 ─────────────────────────────────── */
const profileUI = new ProfileUI(
  profileMgr,
  () => ({
    eqBands:      eqPanel.getBands(),
    mainVolume:   engine.getMainVolume(),
    cueVolume:    engine.getCueVolume(),
    mainDeviceId: document.querySelector('#sel-main-device')?.value ?? 'default',
    cueDeviceId:  document.querySelector('#sel-cue-device')?.value  ?? 'default',
    tracks:       pm.tracks,
    queue:        qm.queue,
  }),
  applyProfile
);

// 재생 완료(히스토리) 곡 ID 저장소
const playedTrackIds = new Set();
let _history = [];

// 백그라운드 BPM/길이 분석 대기열
const _bgAnalysisQueue = [];
let _bgAnalyzing = false;

function syncPlayingUI() {
  const activeId = player.isPlaying && player.currentTrack ? player.currentTrack.id : null;
  playerUI._syncState();
  queueUI.updatePlayingState(activeId);
  playlistUI.updatePlayingState(activeId);
}

function setPlayingState(track) {
  if (!track) return;
  playedTrackIds.add(track.id);

  // 같은 곡이 헤드폰(CUE)에서 미리듣기 중이면 자동 정지 (이중 재생 혼선 방지)
  if (cue.isPlaying && cue.currentTrack?.id === track.id) {
    queueUI.stopCue();
  }

  syncPlayingUI();
  queueUI.updatePlayedState(playedTrackIds);
  playlistUI.updatePlayedState(playedTrackIds);
}

function resetPlayedHistory() {
  playedTrackIds.clear();
  if (player.currentTrack && player.isPlaying) {
    playedTrackIds.add(player.currentTrack.id);
  }
  queueUI.updatePlayedState(playedTrackIds);
  playlistUI.updatePlayedState(playedTrackIds);
  showToast('재생 이력이 초기화되었습니다');
}

/* ── 초기화 ──────────────────────────────────────────── */
async function init() {
  await profileMgr.init().catch(console.warn);
  await engine.initialize();

  // 큐 비어있을 때 플레이리스트 보유 곡 수 참조 연결
  queueUI.getPlaylistCount = () => pm.tracks.length;

  // 저장된 설정 복원
  const settings = Storage.getSettings();

  // UI 마운트
  playerUI.getSpectrumColors = () => themeMgr.getSpectrumColors();
  playerUI.mount();
  djToolsUI.mount();
  playlistUI.mount();
  queueUI.mount();
  eqPanel.render();
  bpmPopover.mount();

  await deviceSelector.mount(
    document.querySelector('#sel-main-device'),
    document.querySelector('#sel-cue-device')
  );

  const headerEl = document.querySelector('#app-header');
  themeMgr.mount(headerEl, settings.theme || 'gold');
  profileUI.mount(headerEl);
  helpModal.mount(headerEl);

  themeMgr.onThemeChange = (themeId, themeObj) => {
    const s = Storage.getSettings();
    s.theme = themeId;
    Storage.saveSettings(s);
    playerUI._drawSpectrum();
    showToast(`🎨 테마 변경: ${themeObj.name}`);
  };

  // DJ 도구 설정 복원 및 콜백 연결
  djToolsUI.restoreSettings(settings);
  djToolsUI.getReferenceBPM = () => player.currentTrack?.bpm || cue.currentTrack?.bpm || null;
  djToolsUI.onStatusChange  = (msg) => updateStatus(msg);
  djToolsUI.onSettingsChange = (partial) => {
    const s = Storage.getSettings();
    Object.assign(s, partial);
    Storage.saveSettings(s);
  };
  djToolsUI.onCompEnded = async () => {
    await preloadNextFromQueueAfter(player.currentTrack);
    syncPlayingUI();
  };

  const mainVol = document.querySelector('#main-vol');
  if (mainVol) {
    mainVol.value = settings.mainVolume;
  }
  engine.setMainVolume(settings.mainVolume);
  engine.setCueVolume(settings.cueVolume);
  queueUI.syncVolumeFromSettings(settings.cueVolume);
  playerUI._syncState();
  await deviceSelector.restoreDevices(settings.mainDeviceId, settings.cueDeviceId);

  // 오디오 엔진 모드 변경 시 EQ 헤더 및 트랙 라우드니스 배지 동기화
  engine.onAudioModeChange = () => {
    eqPanel.syncAudioModeUI();
    playerUI.updateLoudness(player.currentTrack);
  };
  // 플레이어 옵션 복원
  playerUI.setOptions({
    showAlbumArt:         settings.showAlbumArt,
    showEQ:               settings.showEQ ?? true,
    showVisualizer:       settings.showVisualizer,
    showRemainingTime:    settings.showRemainingTime ?? true,
    autoStopAfterCurrent: settings.autoStopAfterCurrent ?? false,
  });
  eqPanel.setBodyVisible(settings.showEQ ?? true);

  playerUI.onOptionChange = (key, value) => {
    const s = Storage.getSettings();
    if (key === 'albumArt') s.showAlbumArt = value;
    if (key === 'eq') {
      s.showEQ = value;
      eqPanel.setBodyVisible(value);
    }
    if (key === 'visualizer') s.showVisualizer = value;
    if (key === 'remainingTime') s.showRemainingTime = value;
    if (key === 'autoStop') {
      s.autoStopAfterCurrent = value;
      showToast(value ? '현재 곡 종료 후 자동 정지 켜짐' : '자동 연속 재생 켜짐');
    }
    Storage.saveSettings(s);
  };

  // 페이드 아웃 제어
  playerUI.onFadeToggle = () => {
    if (!player.isPlaying) return;
    const started = player.fadeOutAndPause(3.0);
    if (started) {
      showToast('3초 페이드 아웃 중… (다시 누르면 취소)');
      updateStatus(`페이드 아웃 중: ${player.currentTrack?.name ?? ''}`);
    } else {
      showToast('페이드 아웃 취소됨');
      updateStatus(`재생 중: ${player.currentTrack?.name ?? ''}`);
    }
  };

  // 트랙 미로드 상태에서 재생 버튼 클릭 시 스마트 시작
  playerUI.onPlayEmpty = async () => {
    if (qm.length > 0) {
      await playNext();
      return;
    }
    const candidate = playlistUI.getSelectedOrFirstTrack();
    if (candidate) {
      if (!candidate.file) {
        showToast(`파일 유실: ${candidate.name}`);
        return;
      }
      qm.enqueue(candidate);
      const ok = await player.load(candidate);
      if (ok) {
        playerUI.showTrack(candidate);
        player.play();
        updateStatus(`재생 중: ${candidate.name}`);
      }
    } else {
      showToast('먼저 오디오 파일이나 폴더를 추가해주세요');
    }
  };

  // BPM 수동 보정 팝오버 연결
  const openBpmEditor = (track, anchorEl) => bpmPopover.open(track, anchorEl);
  playerUI.onBPMBadgeClick   = openBpmEditor;
  playlistUI.onBPMBadgeClick = openBpmEditor;
  queueUI.onBPMBadgeClick    = openBpmEditor;

  // 플레이리스트 ↔ 큐 상태 동기화
  playlistUI.onPlaylistChanged = () => {
    queueUI.refreshEmptyState();
    updateMobileTabCounts();
    // 모든 탭이 비워졌고 큐도 비어있고 재생 중이 아니면 플레이어 초기화
    const totalTracks = pm.tabs.reduce((sum, tab) => sum + tab.tracks.length, 0);
    if (totalTracks === 0 && qm.length === 0 && !player.isPlaying) {
      player.unload();
      playerUI.reset();
    }
  };

  // 플레이리스트 보관함 저장 / 불러오기 / 파일 내보내기·가져오기 연결
  playlistUI.getSavedPlaylists = () => profileMgr.getSavedPlaylists();

  playlistUI.onSavePlaylistToStorage = async (name, tracks) => {
    await profileMgr.savePlaylist(name, tracks);
    showToast(`💾 플레이리스트 보관함 저장: "${name}" (${tracks.length}곡)`);
    updateStatus(`플레이리스트 저장됨: ${name} (${tracks.length}곡)`);
  };

  playlistUI.onLoadPlaylistFromStorage = async (playlistId, { asNewTab = false } = {}) => {
    try {
      const data = await profileMgr.loadPlaylist(playlistId);
      if (asNewTab) {
        pm.createTab(data.name, [], true);
      } else {
        pm.clear();
        pm.renameTab(pm.activeTabId, data.name);
      }

      const toAnalyze = [];
      let readyCount = 0;
      let missingCount = 0;

      for (const meta of data.tracks || []) {
        if (meta.file) {
          const loaded = await loadFiles([meta.file]);
          if (loaded.length) {
            const t = loaded[0];
            if (meta.bpm) {
              t.bpm = meta.bpm;
              t._bpmChecked = true;
            }
            if (meta.duration) t.duration = meta.duration;
            if (meta.durationLabel && meta.durationLabel !== '0:00') {
              t.durationLabel = meta.durationLabel;
            }
            pm._addDirect(t);
            if (!t._bpmChecked) toAnalyze.push(t);
            readyCount++;
          }
        } else {
          const built = pm._buildTrackFromMeta(meta);
          pm._addDirect(built);
          if (built.file) readyCount++;
          else missingCount++;
        }
      }

      if (toAnalyze.length > 0) enqueueBackgroundAnalysis(toAnalyze);
      const msg = missingCount > 0
        ? `플레이리스트 "${data.name}" 불러옴 (${readyCount}곡 연결됨, ${missingCount}곡 파일 드롭 시 자동 매칭)`
        : `플레이리스트 "${data.name}" 불러옴 (${readyCount}곡)`;
      showToast(msg);
      updateStatus(msg);
    } catch (err) {
      console.error('loadPlaylist failed:', err);
      showToast(`플레이리스트 불러오기 실패: ${err.message}`);
    }
  };

  playlistUI.onDeleteSavedPlaylist = async (playlistId) => {
    await profileMgr.deletePlaylist(playlistId);
    showToast('보관함에서 플레이리스트를 삭제했습니다');
  };

  playlistUI.onExportPlaylist = (format) => {
    if (pm.tracks.length === 0) {
      showToast('내보낼 곡이 없습니다');
      return;
    }
    const safeName = (pm.activeTab.name || 'playlist').replace(/[\\/:*?"<>|]/g, '_');
    if (format === 'm3u8') {
      const m3u = pm.exportActiveTabToM3U8();
      downloadTextFile(`${safeName}.m3u8`, m3u, 'audio/x-mpegurl;charset=utf-8');
      showToast(`📥 M3U8 파일 내보내기 완료: ${safeName}.m3u8`);
    } else {
      const jsonObj = pm.exportActiveTabToJSON();
      downloadTextFile(`${safeName}.swingdj.json`, JSON.stringify(jsonObj, null, 2), 'application/json;charset=utf-8');
      showToast(`📥 JSON 파일 내보내기 완료: ${safeName}.swingdj.json`);
    }
  };

  playlistUI.onImportPlaylistFile = async (file) => {
    try {
      const text = await file.text();
      const asNewTab = pm.tracks.length > 0;
      let imported = [];
      if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) {
        const data = JSON.parse(text);
        imported = pm.importFromJSONObject(data, { asNewTab });
      } else {
        imported = pm.importFromM3U8Text(text, file.name, { asNewTab });
      }
      showToast(`📂 "${pm.activeTab.name}" 불러오기 완료 (${imported.length}곡)`);
      updateStatus(`플레이리스트 파일 불러옴: ${pm.activeTab.name} (${imported.length}곡)`);
    } catch (err) {
      console.error('importPlaylistFile failed:', err);
      showToast(`플레이리스트 파일 읽기 실패: ${err.message}`);
    }
  };

  playlistUI.onTabCopiedTrack = (track, targetTab) => {
    showToast(`"${targetTab.name}" 탭에 곡 복사됨: ${track.name}`);
  };

  queueUI.onQueueChanged = (queue) => {
    const queuedIds = new Set(queue.map((t) => t.id));
    playlistUI.updateQueuedState(queuedIds);
    updateMobileTabCounts();
  };
  playlistUI.onRemoveTrack = (removed) => {
    // 플레이리스트에서 삭제 시 CUE에만 걸려있다면 정리 (큐에 이미 올라간 항목은 유지)
    if (cue.currentTrack?.id === removed.id && !qm.queue.some((t) => t.id === removed.id)) {
      queueUI.resetCue();
    }
    updateMobileTabCounts();
  };

  // 파일/폴더 입력 연결
  playlistUI.onFilesDropped     = (files)   => handleFilesFromInput(files, false);
  playlistUI.onFilesWithHandles = (handles) => handleFilesWithHandles(handles, false);
  playlistUI.onEmptyFolder      = ()        => showToast('선택한 폴더에 지원되는 오디오 파일이 없습니다');

  // 바로 다음 곡 예약 / 전체 큐 담기
  playlistUI.onAddNextToQueue = (track) => addNextToQueue(track);
  playlistUI.onQueueAll       = (tracks) => addManyToQueue(tracks);
  queueUI.onImportAllFromPlaylist = () => addManyToQueue(playlistUI.getFilteredTracks());

  // 큐 패널에 직접 외부 파일/폴더를 드롭한 경우 → 플레이리스트 등록 + 즉시 큐에 추가
  queueUI.onExternalFilesDropped = async ({ handles, files }) => {
    if (handles.length) await handleFilesWithHandles(handles, true);
    if (files.length)   await handleFilesFromInput(files, true);
  };

  queueUI.onTrackDropFromPlaylist = (trackId, insertIdx) => {
    const t = pm.getTrackById(trackId);
    if (t) addToQueue(t, insertIdx);
  };

  queueUI.onResetHistory = () => resetPlayedHistory();

  // CUE 상태 변경 시 플레이리스트에도 하이라이트 반영
  queueUI.onCueStateChange = (cueingId) => {
    playlistUI.updateCueingState(cueingId);
  };

  // 플레이리스트에서 CUE(미리듣기) 클릭 시
  playlistUI.onCue = async (track) => {
    engine.resume();
    const status = await queueUI.loadCue(track);
    if (status === 'started') {
      showToast(`미리듣기 시작: ${track.name}`);
    } else if (status === 'stopped') {
      showToast(`미리듣기 정지: ${track.name}`);
    }
  };

  // 큐에서 플레이리스트로 드래그
  playlistUI.onTrackDropFromQueue = (trackId, toIdx) => {
    const trackInQueue = qm.queue.find((t) => t.id === trackId);
    if (!trackInQueue) return;

    let existingTrack = pm.getTrackById(trackId);
    if (!existingTrack) {
      pm._addDirect(trackInQueue);
      existingTrack = trackInQueue;
    }

    const fromIdx = pm.tracks.findIndex((t) => t.id === existingTrack.id);
    if (fromIdx !== -1 && !isNaN(toIdx)) {
      pm.reorder(fromIdx, toIdx);
    }
  };

  // 큐에서 더블클릭 / P / Enter 시 해당 곡 메인 재생
  queueUI.onTrackDoubleClick = async (trackId) => {
    engine.resume();
    const track = qm.queue.find((t) => t.id === trackId);
    if (!track) return;

    if (!track.file) {
      showToast(`파일 유실 (재생 불가): ${track.name}`);
      queueUI.markAsMissing(track.id);
      return;
    }

    const prevTrack = player.currentTrack;
    const success = await player.load(track);
    if (!success) {
      showToast(`재생 실패: ${track.name}`);
      queueUI.markAsMissing(track.id);
      return;
    }

    if (prevTrack && prevTrack.id !== track.id) {
      _history.push(prevTrack);
    }

    playerUI.showTrack(track);
    player.play();
    updateStatus(`재생 중: ${track.name}`);
  };

  // 모바일 장치 설정 토글
  const toggleBtn = document.querySelector('#btn-toggle-devices');
  const devicesArea = document.querySelector('#header-devices');
  if (toggleBtn && devicesArea) {
    toggleBtn.addEventListener('click', () => {
      devicesArea.classList.toggle('show-mobile');
      toggleBtn.textContent = devicesArea.classList.contains('show-mobile') ? '설정 닫기' : '장치 설정';
      toggleBtn.classList.toggle('active', devicesArea.classList.contains('show-mobile'));
    });
  }

  // 모바일 탭 제어
  const tabBtns = document.querySelectorAll('.m-tab-btn');
  const appEl = document.querySelector('#app');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.target;
      if (target === 'playlist-panel') {
        appEl.classList.add('show-playlist');
        appEl.classList.remove('show-queue');
      } else {
        appEl.classList.remove('show-playlist');
        appEl.classList.add('show-queue');
      }
    });
  });

  // Player 상태 및 종료 이벤트 연결
  player.onStateChange = () => {
    syncPlayingUI();
    djToolsUI.notifyPlayerStateChange();
    if (!player.isPlaying && player.currentTrack && !player.isFading) {
      updateStatus(`일시정지 / 대기: ${player.currentTrack.name}`);
    }
  };

  player.onEnded = async () => {
    if (playerUI.autoStopAfterCurrent || djToolsUI.compMode) {
      // 다음 대기 곡이 있으면 일시정지 상태로 미리 준비만 해둠 (멘트/컴핏 라운드 종료 후 즉시 ▶ 재생 가능)
      await preloadNextFromQueueAfter(player.currentTrack);
      syncPlayingUI();
      const msg = djToolsUI.compMode
        ? '컴핏모드: 현재 곡 종료 후 자동 정지됨 (다음 라운드 대기 중)'
        : '현재 곡 종료 후 자동 정지됨 (다음 곡 대기 중)';
      updateStatus(msg);
      showToast(djToolsUI.compMode ? '🏆 컴핏모드: 자동 정지되었습니다' : '1곡 후 정지: 자동 정지되었습니다');
      return;
    }
    await playNext();
  };

  player.onPlay = (track) => {
    setPlayingState(track);
  };

  // 트랙 디코딩 시 메타데이터 갱신 및 BPM 감지
  player.onTrackReady = (track, buffer) => {
    playlistUI.updateTrackMeta(track);
    queueUI.updateTrackMeta(track);
    playerUI.updateBPM(track);
    djToolsUI.notifyTrackLoaded();
    bgDetectBPM(track, buffer);
  };
  cue.onTrackReady = (track, buffer) => {
    playlistUI.updateTrackMeta(track);
    queueUI.updateTrackMeta(track);
    bgDetectBPM(track, buffer);
  };

  // 장치 변경 → 설정 저장
  document.querySelector('#sel-main-device')?.addEventListener('change', saveDeviceSettings);
  document.querySelector('#sel-cue-device')?.addEventListener('change', saveDeviceSettings);

  // 전체 페이지 드롭 (패널 바깥 영역 드롭 지원 — 파일 및 폴더 모두 처리)
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (
      e.dataTransfer.types.includes('pl-internal') ||
      e.dataTransfer.types.includes('q-internal') ||
      e.dataTransfer.types.includes('q-to-pl')
    ) {
      return;
    }
    const { handles, files } = await extractDroppedAudioSources(e.dataTransfer);
    if (handles.length) await handleFilesWithHandles(handles, false);
    if (files.length)   await handleFilesFromInput(files, false);
  });

  // 라이브 재생 중 실수로 탭 닫기 / 새로고침 방지
  window.addEventListener('beforeunload', (e) => {
    if (player.isPlaying) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  updateMobileTabCounts();
  updateStatus('준비 완료 — 오디오 파일이나 폴더를 드래그하세요 (? 키: 단축키 안내)');
}

function updateMobileTabCounts() {
  const plTab = document.querySelector('.m-tab-btn[data-target="playlist-panel"]');
  const qTab  = document.querySelector('.m-tab-btn[data-target="queue-panel"]');
  if (plTab) plTab.textContent = pm.tracks.length > 0 ? `플레이리스트 (${pm.tracks.length})` : '플레이리스트';
  if (qTab)  qTab.textContent  = qm.length > 0 ? `큐 (${qm.length})` : '큐';
}

/* ── 파일 및 폴더 처리 ───────────────────────────────── */

async function handleFilesFromInput(fileList, autoEnqueue = false) {
  updateStatus('파일 로딩 중…');
  const tracks = await loadFiles(fileList);
  const added  = pm.addTracks(tracks);
  await _afterAdd(added, autoEnqueue);
}

async function handleFilesWithHandles(handles, autoEnqueue = false) {
  updateStatus(`파일 로딩 중… (${handles.length}개)`);
  const fileObjs = [];
  for (const h of handles) {
    const f = await h.getFile().catch(() => null);
    if (f) {
      f._handle = h;
      fileObjs.push(f);
    }
  }
  const tracks = await loadFiles(fileObjs);
  const added  = pm.addTracks(tracks);
  await _afterAdd(added, autoEnqueue);
}

async function _afterAdd(added, autoEnqueue = false) {
  updateMobileTabCounts();
  if (added.length === 0) {
    const msg = '추가할 새 오디오 파일이 없습니다 (중복 또는 미지원 형식)';
    updateStatus(msg);
    showToast(msg);
    return;
  }

  if (autoEnqueue) {
    qm.enqueueMany(added);
    if (!player.isPlaying && !player.currentTrack && qm.length > 0) {
      await loadCurrentFromQueue();
    }
    showToast(`${added.length}곡을 플레이리스트 및 큐에 추가했습니다`);
  } else {
    showToast(`${added.length}곡 추가됨 (더블클릭 또는 +Q로 큐에 예약)`);
  }

  if (!player.isPlaying) {
    updateStatus(`${added.length}곡 추가됨 (총 ${pm.tracks.length}곡)`);
  }

  enqueueBackgroundAnalysis(added);
}

/* ── 프로파일 적용 ───────────────────────────────────── */
async function applyProfile(data) {
  if (player.isPlaying) {
    const ok = confirm('현재 음악이 재생 중입니다. 프로파일을 불러오면 재생이 중단됩니다. 계속할까요?');
    if (!ok) return;
  }

  updateStatus('프로파일 불러오는 중…');

  // 1. EQ 적용
  if (data.eqBands?.length === 5) {
    eqPanel.applyBands(data.eqBands);
  }

  // 2. 볼륨 적용
  const mainVol = document.querySelector('#main-vol');
  if (mainVol && data.mainVolume != null) {
    mainVol.value = data.mainVolume;
    engine.setMainVolume(data.mainVolume);
    playerUI._syncState();
  }
  if (data.cueVolume != null) {
    engine.setCueVolume(data.cueVolume);
    queueUI.syncVolumeFromSettings(data.cueVolume);
  }

  // 3. 출력 장치 적용
  if (data.mainDeviceId || data.cueDeviceId) {
    await deviceSelector.restoreDevices(data.mainDeviceId, data.cueDeviceId);
  }

  // 4. 설정 저장
  const s = Storage.getSettings();
  if (data.eqBands)            s.eqBands      = [...data.eqBands];
  if (data.mainVolume != null) s.mainVolume   = data.mainVolume;
  if (data.cueVolume  != null) s.cueVolume    = data.cueVolume;
  if (data.mainDeviceId)       s.mainDeviceId = data.mainDeviceId;
  if (data.cueDeviceId)        s.cueDeviceId  = data.cueDeviceId;
  Storage.saveSettings(s);

  // 5. 플레이리스트 및 큐 복원
  if (Array.isArray(data.tracks)) {
    _bgAnalysisQueue.length = 0;
    player.unload();
    playerUI.reset();
    queueUI.resetCue();
    pm.clear();
    qm.clear();
    playedTrackIds.clear();
    syncPlayingUI();
    queueUI.updatePlayedState(playedTrackIds);
    playlistUI.updatePlayedState(playedTrackIds);

    let loadedCount  = 0;
    let missingCount = 0;
    const restoredByIdx = new Map();
    const toAnalyze = [];

    for (const meta of data.tracks) {
      if (meta.file) {
        meta.file._handle = meta.fileHandle;
        const tracks = await loadFiles([meta.file]);
        if (tracks.length) {
          const t = tracks[0];
          if (meta.bpm) {
            t.bpm = meta.bpm;
            t._bpmChecked = true;
          }
          if (meta.duration) t.duration = meta.duration;
          if (meta.durationLabel && meta.durationLabel !== '0:00' && meta.durationLabel !== '--:--') {
            t.durationLabel = meta.durationLabel;
          }
          pm._addDirect(t);
          restoredByIdx.set(meta.idx, t);
          if (!t._bpmChecked) toAnalyze.push(t);
          loadedCount++;
        }
      } else {
        const placeholder = {
          id:            getNextTrackId(),
          file:          null,
          fileHandle:    meta.fileHandle || null,
          name:          meta.name,
          artist:        meta.artist || '',
          album:         meta.album  || '',
          bpm:           meta.bpm    || null,
          _bpmChecked:   true,
          format:        extractFormatLabel(meta.name),
          duration:      meta.duration || 0,
          durationLabel: meta.durationLabel || '0:00',
          albumArt:      null,
          _unavailable:  true,
        };
        pm._addDirect(placeholder);
        restoredByIdx.set(meta.idx, placeholder);
        missingCount++;
      }
    }

    if (Array.isArray(data.queueIndices)) {
      const queuedTracks = data.queueIndices
        .map((idx) => restoredByIdx.get(idx))
        .filter(Boolean);
      qm.enqueueMany(queuedTracks);
    } else {
      qm.enqueueMany(pm.tracks.filter((t) => t.file));
    }

    if (!player.isPlaying && qm.length > 0) {
      await loadCurrentFromQueue();
    }

    updateMobileTabCounts();
    if (toAnalyze.length > 0) enqueueBackgroundAnalysis(toAnalyze);

    const msg = missingCount > 0
      ? `프로파일 적용 — ${loadedCount}곡 복원, ${missingCount}곡 권한필요/파일없음`
      : `프로파일 적용 — ${loadedCount}곡 복원`;
    updateStatus(msg);
    showToast(msg);
  } else {
    updateStatus('프로파일 적용 완료');
    showToast('프로파일 적용 완료');
  }
}

/* ── 큐 관리 ─────────────────────────────────────────── */
async function addToQueue(track, insertIdx = null) {
  if (!track.file) {
    showToast(`파일 유실로 추가할 수 없습니다: ${track.name}`);
    return;
  }
  if (playedTrackIds.has(track.id)) {
    showToast(`이미 재생된 곡입니다 ('이력 초기화' 후 추가 가능): ${track.name}`);
    return;
  }
  if (qm.queue.some((t) => t.id === track.id)) {
    showToast(`이미 큐에 대기 중인 곡입니다: ${track.name}`);
    return;
  }
  if (typeof insertIdx === 'number' && !isNaN(insertIdx)) {
    qm.insertAt(insertIdx, track);
  } else {
    qm.enqueue(track);
  }
  showToast(`큐에 추가: ${track.name}`);

  if (!player.isPlaying && !player.currentTrack) {
    await loadCurrentFromQueue();
  }
}

async function addNextToQueue(track) {
  if (!track.file) {
    showToast(`파일 유실로 추가할 수 없습니다: ${track.name}`);
    return;
  }
  if (player.currentTrack?.id === track.id && player.isPlaying) {
    showToast(`현재 재생 중인 곡입니다: ${track.name}`);
    return;
  }
  if (playedTrackIds.has(track.id)) {
    showToast(`이미 재생된 곡입니다 ('이력 초기화' 후 추가 가능): ${track.name}`);
    return;
  }

  const alreadyQueued = qm.queue.some((t) => t.id === track.id);
  if (alreadyQueued) {
    qm.removeById(track.id);
  }
  qm.insertNext(track, player.currentTrack?.id ?? null);
  showToast(alreadyQueued ? `바로 다음 순서로 이동: ${track.name}` : `다음 곡으로 예약: ${track.name}`);

  if (!player.isPlaying && !player.currentTrack) {
    await loadCurrentFromQueue();
  }
}

async function addManyToQueue(tracks) {
  if (!tracks?.length) return;
  const queuedIds = new Set(qm.queue.map((t) => t.id));
  const candidates = tracks.filter(
    (t) => t.file && !playedTrackIds.has(t.id) && !queuedIds.has(t.id)
  );
  if (candidates.length === 0) {
    showToast('추가할 수 있는 새 곡이 없습니다 (이미 큐에 있거나 재생 완료됨)');
    return;
  }
  qm.enqueueMany(candidates);
  showToast(`${candidates.length}곡을 큐에 추가했습니다`);

  if (!player.isPlaying && !player.currentTrack) {
    await loadCurrentFromQueue();
  }
}

/* ── 재생 제어 ───────────────────────────────────────── */
async function playNext() {
  const current = player.currentTrack;
  let startIdx = 0;
  if (current) {
    const idx = qm.queue.findIndex((t) => t.id === current.id);
    if (idx !== -1) {
      startIdx = idx + 1;
    }
  }

  for (let i = startIdx; i < qm.queue.length; i++) {
    const next = qm.queue[i];

    if (!next.file) {
      showToast(`파일 유실 (건너뜀): ${next.name}`);
      updateStatus(`파일 유실 오류: ${next.name}`);
      queueUI.markAsMissing(next.id);
      continue;
    }

    const success = await player.load(next);
    if (!success) {
      showToast(`재생 실패 (건너뜀): ${next.name}`);
      queueUI.markAsMissing(next.id);
      continue;
    }

    playerUI.showTrack(next);
    player.play();
    updateStatus(`재생 중: ${next.name}`);

    if (current) _history.push(current);
    return;
  }

  syncPlayingUI();
  updateStatus('더 이상 재생할 곡이 없습니다 (큐 끝 도달)');
}

async function preloadNextFromQueueAfter(current) {
  let startIdx = 0;
  if (current) {
    const idx = qm.queue.findIndex((t) => t.id === current.id);
    if (idx !== -1) startIdx = idx + 1;
    else return;
  }
  for (let i = startIdx; i < qm.queue.length; i++) {
    const next = qm.queue[i];
    if (!next.file) {
      queueUI.markAsMissing(next.id);
      continue;
    }
    const ok = await player.load(next);
    if (!ok) {
      queueUI.markAsMissing(next.id);
      continue;
    }
    playerUI.showTrack(next);
    return;
  }
}

async function playPrev() {
  const current = player.currentTrack;
  // 현재 곡이 4초 이상 재생 중이면 곡의 처음으로 되감기 (일반적인 DJ/플레이어 UX)
  if (current && player.currentTime > 4) {
    player.seek(0);
    showToast('곡 처음으로 이동');
    return;
  }

  let startIdx = qm.queue.length - 1;
  if (current) {
    const idx = qm.queue.findIndex((t) => t.id === current.id);
    if (idx > 0) {
      startIdx = idx - 1;
    } else {
      player.seek(0);
      return;
    }
  }

  for (let i = startIdx; i >= 0; i--) {
    const prev = qm.queue[i];

    if (!prev.file) {
      showToast(`파일 유실 (건너뜀): ${prev.name}`);
      queueUI.markAsMissing(prev.id);
      continue;
    }

    const success = await player.load(prev);
    if (!success) {
      showToast(`재생 실패 (건너뜀): ${prev.name}`);
      queueUI.markAsMissing(prev.id);
      continue;
    }

    playerUI.showTrack(prev);
    player.play();
    updateStatus(`재생 중: ${prev.name}`);
    return;
  }
}

// 큐 첫 곡을 플레이어에 대기 로드 (자동재생은 안 함)
async function loadCurrentFromQueue() {
  for (let i = 0; i < qm.queue.length; i++) {
    const track = qm.queue[i];
    if (!track.file) {
      queueUI.markAsMissing(track.id);
      continue;
    }
    const success = await player.load(track);
    if (!success) {
      queueUI.markAsMissing(track.id);
      continue;
    }
    playerUI.showTrack(track);
    return;
  }
}

/* ── BPM 백그라운드 자동 분석 (순차 큐 · 메모리 즉시 해제) ── */
async function bgDetectBPM(track, buffer) {
  if (!track || track._bpmChecked || track.bpm) {
    if (track && track.bpm) track._bpmChecked = true;
    return;
  }
  try {
    if (!buffer) return;
    const bpm = await detectBPM(buffer);
    track._bpmChecked = true;
    if (bpm) {
      track.bpm = bpm;
    }
    playlistUI.updateTrackMeta(track);
    queueUI.updateTrackMeta(track);
    if (player.currentTrack?.id === track.id) playerUI.updateBPM(track);
  } catch (_) {
    track._bpmChecked = true;
    playlistUI.updateTrackMeta(track);
  }
}

function enqueueBackgroundAnalysis(tracks) {
  for (const t of tracks) {
    if (t && t.file && !t._bpmChecked && !_bgAnalysisQueue.includes(t)) {
      _bgAnalysisQueue.push(t);
    }
  }
  _runBackgroundAnalysis();
}

async function _runBackgroundAnalysis() {
  if (_bgAnalyzing) return;
  _bgAnalyzing = true;

  try {
    while (_bgAnalysisQueue.length > 0) {
      const track = _bgAnalysisQueue.shift();
      if (!track || !track.file || track._bpmChecked) continue;
      // 이미 플레이리스트와 큐 모두에서 삭제된 트랙이면 건너뜀
      const stillExists = pm.getTrackById(track.id) || qm.queue.some((q) => q.id === track.id);
      if (!stillExists) continue;

      if (!player.isPlaying) {
        updateStatus(`백그라운드 BPM 분석 중… (남은 ${ _bgAnalysisQueue.length + 1 }곡)`);
      }

      try {
        const ab = await track.file.arrayBuffer();
        const decoded = await engine.decodeForAnalysis(ab);
        if (!track.duration && decoded.duration) {
          track.duration = decoded.duration;
          track.durationLabel = formatDuration(decoded.duration);
        }
        track.sampleRate = decoded.sampleRate;
        if (!track.loudness) {
          track.loudness = AudioEngine.analyzeLoudness(decoded);
        }
        const bpm = await detectBPM(decoded);
        track._bpmChecked = true;
        if (bpm && !track.bpm) {
          track.bpm = bpm;
        }
      } catch (_) {
        track._bpmChecked = true;
      }

      playlistUI.updateTrackMeta(track);
      queueUI.updateTrackMeta(track);
      if (player.currentTrack?.id === track.id) {
        playerUI.updateBPM(track);
        playerUI.updateLoudness(track);
      }

      // 메인 UI 이벤트 루프 양보
      await new Promise((r) => setTimeout(r, 35));
    }

    if (!player.isPlaying) {
      updateStatus(`준비 완료 — 총 ${pm.tracks.length}곡 (BPM 분석 완료)`);
    }
  } finally {
    _bgAnalyzing = false;
  }
}

/* ── 유틸 ────────────────────────────────────────────── */
function updateStatus(msg) {
  const el = document.querySelector('#status-bar');
  if (el) el.textContent = msg;
}

function downloadTextFile(filename, textContent, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([textContent], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function saveDeviceSettings() {
  const s = Storage.getSettings();
  s.mainDeviceId = document.querySelector('#sel-main-device')?.value ?? 'default';
  s.cueDeviceId  = document.querySelector('#sel-cue-device')?.value  ?? 'default';
  Storage.saveSettings(s);
}

/* ── 볼륨 자동 저장 ──────────────────────────────────── */
document.addEventListener('change', (e) => {
  if (e.target.id === 'main-vol') {
    const s = Storage.getSettings();
    s.mainVolume = parseFloat(e.target.value);
    Storage.saveSettings(s);
  }
  if (e.target.id === 'cue-vol') {
    const s = Storage.getSettings();
    s.cueVolume = parseFloat(e.target.value);
    Storage.saveSettings(s);
  }
});

document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
