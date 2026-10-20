/**
 * main.js — SwingDJ 앱 초기화 및 모듈 조율
 */

import { AudioEngine }      from './audio/AudioEngine.js';
import { Player }           from './audio/Player.js';
import { CuePlayer }        from './audio/CuePlayer.js';
import { detectBPM }        from './audio/BPMDetector.js';
import { PlaylistManager }  from './playlist/PlaylistManager.js';
import { QueueManager }     from './playlist/QueueManager.js';
import { loadFiles, getNextTrackId } from './utils/FileLoader.js';
import { Storage }          from './utils/Storage.js';
import { ProfileManager }   from './utils/ProfileManager.js';
import { DeviceSelector }   from './ui/DeviceSelector.js';
import { EQPanel }          from './ui/EQPanel.js';
import { PlayerUI }         from './ui/PlayerUI.js';
import { PlaylistUI }       from './ui/PlaylistUI.js';
import { QueueUI }          from './ui/QueueUI.js';
import { ProfileUI }        from './ui/ProfileUI.js';

/* ── 모듈 인스턴스 ───────────────────────────────────── */
const engine  = new AudioEngine();
const player  = new Player(engine);
const cue     = new CuePlayer(engine);
const pm      = new PlaylistManager();
const qm      = new QueueManager();
const profileMgr = new ProfileManager();

/* ── UI 인스턴스 ─────────────────────────────────────── */
const playerUI   = new PlayerUI(
  document.querySelector('#player-inner'),
  player, engine,
  () => playNext(),
  () => playPrev()
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

/* ── 프로파일 시스템 ─────────────────────────────────── */
const profileUI = new ProfileUI(
  profileMgr,
  // getAppState: 현재 앱 전체 상태 반환
  () => ({
    eqBands:      eqPanel.getBands(),
    mainVolume:   parseFloat(document.querySelector('#main-vol')?.value ?? 0.85),
    cueVolume:    parseFloat(document.querySelector('#cue-vol')?.value  ?? 0.85),
    mainDeviceId: document.querySelector('#sel-main-device')?.value ?? 'default',
    cueDeviceId:  document.querySelector('#sel-cue-device')?.value  ?? 'default',
    tracks:       pm.tracks,   // fileHandle 포함
    queue:        qm.queue,    // 큐 목록 포함
  }),
  // applyProfile: 프로파일 적용
  applyProfile
);

// 재생 완료(히스토리) 곡 ID 저장소
const playedTrackIds = new Set();

function setPlayingState(track) {
  if (!track) return;
  playedTrackIds.add(track.id);
  
  // UI 업데이트
  playerUI._syncState();
  queueUI.updatePlayingState(track.id);
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
  // IndexedDB 초기화
  await profileMgr.init().catch(console.warn);

  // AudioEngine 초기화
  await engine.initialize();

  // UI 마운트
  playerUI.mount();
  playlistUI.mount();
  queueUI.mount();
  eqPanel.render();

  // 출력 장치 선택 UI
  await deviceSelector.mount(
    document.querySelector('#sel-main-device'),
    document.querySelector('#sel-cue-device')
  );

  // 프로파일 버튼을 헤더에 마운트
  profileUI.mount(document.querySelector('#app-header'));

  // 저장된 설정 복원
  const settings = Storage.getSettings();
  const mainVol = document.querySelector('#main-vol');
  const cueVol  = document.querySelector('#cue-vol');
  if (mainVol) { mainVol.value = settings.mainVolume; mainVol.dispatchEvent(new Event('input')); }
  if (cueVol)  { cueVol.value  = settings.cueVolume; }
  engine.setMainVolume(settings.mainVolume);
  engine.setCueVolume(settings.cueVolume);
  await deviceSelector.restoreDevices(settings.mainDeviceId, settings.cueDeviceId);
  
  // 플레이어 옵션 설정 복원
  playerUI.setOptions({
    showAlbumArt: settings.showAlbumArt,
    showEQ: settings.showEQ ?? true,
    showVisualizer: settings.showVisualizer
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
    Storage.saveSettings(s);
  };

  // 파일 드롭 핸들러 연결
  playlistUI.onFilesDropped = handleFilesFromInput;
  playlistUI.onFilesWithHandles = handleFilesWithHandles;

  queueUI.onTrackDropFromPlaylist = (trackId, insertIdx) => {
    const t = pm.getTrackById(trackId);
    if (t) addToQueue(t, insertIdx);
  };

  queueUI.onResetHistory = () => resetPlayedHistory();

  // 플레이리스트에서 CUE(미리듣기) 버튼 클릭 시
  playlistUI.onCue = async (track) => {
    engine.resume();
    const status = await queueUI.loadCue(track);
    if (status === 'started') {
      showToast(`미리듣기 시작: ${track.name}`);
    } else if (status === 'stopped') {
      showToast(`미리듣기 정지: ${track.name}`);
    }
  };

  // 큐에서 플레이리스트로 드래그 (특정 위치에 추가)
  playlistUI.onTrackDropFromQueue = (trackId, toIdx) => {
    const trackInQueue = qm.queue.find(t => t.id === trackId);
    if (!trackInQueue) return;
    
    // 이미 플레이리스트에 있는지 확인
    let existingTrack = pm.getTrackById(trackId);
    if (!existingTrack) {
        pm._addDirect(trackInQueue);
        existingTrack = trackInQueue;
    }
    
    // 위치 이동 (새로 추가되었으면 맨 마지막에 있으므로 해당 위치에서 이동)
    const fromIdx = pm.tracks.findIndex(t => t.id === existingTrack.id);
    if (fromIdx !== -1 && !isNaN(toIdx)) {
        pm.reorder(fromIdx, toIdx);
    }
  };

  // 큐에서 더블클릭 시 (해당 곡 메인 재생)
  queueUI.onTrackDoubleClick = async (trackId) => {
    engine.resume();
    const track = qm.queue.find(t => t.id === trackId);
    if (!track) return;
    
    if (!track.file) {
        showToast(`파일 유실 (재생 불가): ${track.name}`);
        queueUI.markAsMissing(track.id);
        return;
    }

    const success = await player.load(track);
    if (!success) {
        showToast(`재생 실패: ${track.name}`);
        queueUI.markAsMissing(track.id);
        return;
    }
    
    playerUI.showTrack(track);
    player.play();
    updateStatus(`재생 중: ${track.name}`);
    
    const current = player.currentTrack;
    if (current && current.id !== track.id) {
        _history.push(current);
    }
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
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
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

  // Player 자동 다음 곡
  player.onEnded = () => playNext();
  
  // 플레이어 재생 시작 시 (UI 재생 버튼 클릭, 단축키 등)
  player.onPlay = (track) => {
    setPlayingState(track);
  };

  // 트랙 준비 후 BPM/duration 업데이트 (메모리 누수 방지로 buffer 직접 전달)
  player.onTrackReady = (track, buffer) => {
    playlistUI.updateTrackMeta(track);
    playerUI.updateBPM(track);
    bgDetectBPM(track, buffer);
  };
  cue.onTrackReady = (track, buffer) => {
    playlistUI.updateTrackMeta(track);
    bgDetectBPM(track, buffer);
  };

  // 장치 변경 → 설정 저장
  document.querySelector('#sel-main-device')?.addEventListener('change', saveDeviceSettings);
  document.querySelector('#sel-cue-device')?.addEventListener('change', saveDeviceSettings);

  // 전체 페이지 드롭 (드래그앤드롭 — 내부 트랙 이동 무시)
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('pl-internal') || e.dataTransfer.types.includes('q-internal') || e.dataTransfer.types.includes('q-to-pl')) {
      return;
    }
    // File System Access API: 핸들 추출 시도
    if (e.dataTransfer.items?.length) {
      const handles = [];
      const files   = [];
      for (const item of Array.from(e.dataTransfer.items)) {
        if (item.kind !== 'file') continue;
        try {
          const h = await item.getAsFileSystemHandle?.();
          if (h?.kind === 'file') {
            handles.push(h);
            continue;
          }
        } catch (_) {}
        const f = item.getAsFile();
        if (f) files.push(f);
      }
      if (handles.length) await handleFilesWithHandles(handles);
      if (files.length)   await handleFilesFromInput(files);
    } else if (e.dataTransfer.files?.length) {
      await handleFilesFromInput(e.dataTransfer.files);
    }
  });

  updateStatus('준비 완료 — 파일을 추가하거나 드래그하세요');
}

/* ── 파일 처리 ───────────────────────────────────────── */

/** 일반 File 객체 (핸들 없음) */
async function handleFilesFromInput(fileList) {
  updateStatus('파일 로딩 중…');
  const tracks = await loadFiles(fileList);
  const added  = pm.addTracks(tracks);
  _afterAdd(added);
}

/** FileSystemFileHandle 배열 (핸들 있음 → 프로파일 저장 가능) */
async function handleFilesWithHandles(handles) {
  updateStatus('파일 로딩 중…');
  const fileObjs = [];
  for (const h of handles) {
    const f = await h.getFile().catch(() => null);
    if (f) {
      f._handle = h;   // 핸들을 파일 객체에 첨부
      fileObjs.push(f);
    }
  }
  const tracks = await loadFiles(fileObjs);
  const added  = pm.addTracks(tracks);
  _afterAdd(added);
}

function _afterAdd(added) {
  updateStatus(`${added.length}곡 추가됨 (총 ${pm.tracks.length}곡)`);
  if (qm.length === 0 && added.length > 0) {
    added.forEach((t) => qm.enqueue(t));
  }
  if (!player.isPlaying && !player.currentTrack && qm.length > 0) {
    loadCurrentFromQueue();
  }
}

/* ── 프로파일 적용 ───────────────────────────────────── */
async function applyProfile(data) {
  updateStatus('프로파일 불러오는 중…');

  // 1. EQ 적용
  if (data.eqBands?.length === 5) {
    eqPanel.applyBands(data.eqBands);
  }

  // 2. 볼륨 적용
  const mainVol = document.querySelector('#main-vol');
  const cueVol  = document.querySelector('#cue-vol');
  if (mainVol && data.mainVolume != null) {
    mainVol.value = data.mainVolume;
    mainVol.dispatchEvent(new Event('input'));
    engine.setMainVolume(data.mainVolume);
  }
  if (cueVol && data.cueVolume != null) {
    cueVol.value = data.cueVolume;
    engine.setCueVolume(data.cueVolume);
  }

  // 3. 출력 장치 적용
  if (data.mainDeviceId) {
    await deviceSelector.restoreDevices(data.mainDeviceId, data.cueDeviceId);
  }

  // 4. 설정 저장
  const s = Storage.getSettings();
  if (data.eqBands)           s.eqBands      = [...data.eqBands];
  if (data.mainVolume != null) s.mainVolume   = data.mainVolume;
  if (data.cueVolume  != null) s.cueVolume    = data.cueVolume;
  if (data.mainDeviceId)       s.mainDeviceId = data.mainDeviceId;
  if (data.cueDeviceId)        s.cueDeviceId  = data.cueDeviceId;
  Storage.saveSettings(s);

  // 5. 플레이리스트 및 큐 복원
  if (data.tracks?.length > 0) {
    player.stop();
    cue.stop();
    pm.clear();
    qm.clear();
    playedTrackIds.clear();
    queueUI.updatePlayingState(null);
    queueUI.updatePlayedState(playedTrackIds);
    playlistUI.updatePlayedState(playedTrackIds);

    let loadedCount  = 0;
    let missingCount = 0;
    const restoredByIdx = new Map();

    for (const meta of data.tracks) {
      if (meta.file) {
        // 파일 핸들로 복원 성공
        meta.file._handle = meta.fileHandle;
        const tracks = await loadFiles([meta.file]);
        if (tracks.length) {
          const t = tracks[0];
          // 프로파일에 저장되어 있던 BPM 및 재생시간 메타데이터 보존
          if (meta.bpm)           t.bpm           = meta.bpm;
          if (meta.duration)      t.duration      = meta.duration;
          if (meta.durationLabel && meta.durationLabel !== '0:00' && meta.durationLabel !== '--:--') {
            t.durationLabel = meta.durationLabel;
          }
          pm._addDirect(t);
          restoredByIdx.set(meta.idx, t);
          loadedCount++;
        }
      } else {
        // 핸들 없거나 권한 거부 → 메타데이터만 표시
        const placeholder = {
          id:            getNextTrackId(),
          file:          null, // <--- 파일 없음 표시
          fileHandle:    meta.fileHandle || null,
          name:          meta.name,
          artist:        meta.artist || '',
          album:         meta.album  || '',
          bpm:           meta.bpm    || null,
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

    // 저장된 큐 순서 복원 (하위 호환: queueIndices가 없으면 전체 트랙 추가)
    if (Array.isArray(data.queueIndices)) {
      for (const idx of data.queueIndices) {
        const t = restoredByIdx.get(idx);
        if (t) qm.enqueue(t);
      }
    } else {
      for (const t of pm.tracks) {
        if (t.file) qm.enqueue(t);
      }
    }

    // 첫 트랙 로드
    if (!player.isPlaying && qm.length > 0) {
      await loadCurrentFromQueue();
    }

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
function addToQueue(track, insertIdx = null) {
  if (playedTrackIds.has(track.id)) {
    showToast(`이미 재생된 곡입니다 ('이력 초기화' 후 추가 가능): ${track.name}`);
    return;
  }
  if (qm.queue.some(t => t.id === track.id)) {
    showToast(`이미 큐에 대기 중인 곡입니다: ${track.name}`);
    return;
  }
  if (typeof insertIdx === 'number' && !isNaN(insertIdx)) {
    qm.insertAt(insertIdx, track);
  } else {
    qm.enqueue(track);
  }
  showToast(`큐에 추가: ${track.name}`);
}

/* ── 재생 제어 ───────────────────────────────────────── */
let _history = [];

async function playNext() {
  const current = player.currentTrack;
  let startIdx = 0;
  if (current) {
    const idx = qm.queue.findIndex(t => t.id === current.id);
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
      continue; // 다음 곡으로 넘어감
    }

    const success = await player.load(next);
    if (!success) {
      showToast(`재생 실패 (건너뜀): ${next.name}`);
      queueUI.markAsMissing(next.id);
      continue; // 재생 실패 시에도 건너뜀
    }
    
    playerUI.showTrack(next);
    player.play();
    updateStatus(`재생 중: ${next.name}`);
    
    if (current) _history.push(current);
    return; // 성공적으로 재생했으므로 루프 종료
  }

  updateStatus('더 이상 재생할 곡이 없습니다 (큐 끝 도달)');
}

async function playPrev() {
  const current = player.currentTrack;
  let startIdx = qm.queue.length - 1;
  if (current) {
    const idx = qm.queue.findIndex(t => t.id === current.id);
    if (idx > 0) {
      startIdx = idx - 1;
    } else {
      return; // 맨 처음 곡이면 무시
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

// 최초 플레이리스트 추가 시 첫 곡 로드 (자동재생은 안 함)
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
    // 재생 시작 전이므로 큐 리스트에서 🎶 마크(playing)를 표시하지 않음
    return;
  }
}

/* ── BPM 백그라운드 감지 ─────────────────────────────── */
async function bgDetectBPM(track, buffer) {
  if (track.bpm) return;
  try {
    if (!buffer) return;
    const bpm = await detectBPM(buffer);
    if (bpm) {
      track.bpm = bpm;
      playlistUI.updateTrackMeta(track);
      if (player.currentTrack?.id === track.id) playerUI.updateBPM(track);
    }
  } catch (_) {}
}

/* ── 유틸 ────────────────────────────────────────────── */
function updateStatus(msg) {
  const el = document.querySelector('#status-bar');
  if (el) el.textContent = msg;
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className   = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2800);
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
