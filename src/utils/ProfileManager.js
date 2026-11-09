/**
 * ProfileManager.js — 앱 전체 프로파일 저장/불러오기
 *
 * 프로파일에 포함되는 정보:
 *  - EQ 밴드 설정 (5밴드)
 *  - 메인/CUE 볼륨
 *  - 출력 장치 ID
 *  - 플레이리스트 (파일 메타데이터 + FileSystemFileHandle → IndexedDB)
 *
 * 저장 위치:
 *  - localStorage : 프로파일 메타데이터 목록 (swingdj_profiles)
 *  - IndexedDB    : 파일 핸들 (FileSystemFileHandle) — 브라우저 재시작 후에도 유지
 */

const DB_NAME    = 'swingdj_db';
const DB_VERSION = 1;
const STORE      = 'file_handles';
const LS_KEY     = 'swingdj_profiles';
const PL_LS_KEY  = 'swingdj_saved_playlists';
const QUEUE_LS_KEY = 'swingdj_saved_queues';
const WS_LS_KEY  = 'swingdj_workspace_session_v1';

export class ProfileManager {
  constructor() {
    this._db = null;
  }

  /** IndexedDB 초기화 — 앱 시작 시 한 번 호출 */
  async init() {
    this._db = await this._openDB();
  }

  // ── IndexedDB 초기화 ──────────────────────────────────
  _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  // ── 프로파일 목록 (localStorage) ──────────────────────
  getProfiles() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch { return []; }
  }

  _setProfiles(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  }

  // ── 저장 ──────────────────────────────────────────────
  /**
   * @param {string} name 프로파일 이름
   * @param {object} appState
   *   { eqBands, mainVolume, cueVolume, mainDeviceId, cueDeviceId, tracks }
   *   tracks 각 항목에 track.fileHandle (FileSystemFileHandle | null) 있어야 함
   */
  async saveProfile(name, appState) {
    const { eqBands, mainVolume, cueVolume, mainDeviceId, cueDeviceId, tracks, queue } = appState;
    const id = `p_${Date.now()}`;

    // 플레이리스트 메타데이터 추출 + 핸들 저장
    const playlist = [];
    const trackIdToIdx = new Map();
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      trackIdToIdx.set(t.id, i);
      const hasHandle = !!(t.fileHandle);

      if (hasHandle) {
        await this._dbPut(`${id}_${i}`, t.fileHandle);
      }

      playlist.push({
        idx:           i,
        name:          t.name,
        artist:        t.artist || '',
        album:         t.album  || '',
        bpm:           t.bpm    || null,
        duration:      t.duration      || 0,
        durationLabel: t.durationLabel || '0:00',
        size:          t.size   || 0,
        type:          t.type   || 'audio/*',
        hasHandle,
      });
    }

    // 큐 목록을 플레이리스트 인덱스 배열로 저장
    const queueIndices = Array.isArray(queue)
      ? queue.map(qt => trackIdToIdx.get(qt.id)).filter(idx => idx !== undefined)
      : playlist.map(p => p.idx);

    const profile = {
      id,
      name,
      createdAt: new Date().toISOString(),
      eqBands:      [...eqBands],
      mainVolume,
      cueVolume,
      mainDeviceId,
      cueDeviceId,
      trackCount: playlist.length,
      playlist,
      queueIndices,
    };

    const list = this.getProfiles();
    // 이름 중복 시 덮어쓰기
    const existing = list.findIndex(p => p.name === name);
    if (existing >= 0) {
      // 기존 핸들 삭제
      await this._cleanHandles(list[existing]);
      list[existing] = profile;
    } else {
      list.push(profile);
    }
    this._setProfiles(list);
    return profile;
  }

  // ── 불러오기 ──────────────────────────────────────────
  /**
   * 프로파일 ID로 전체 데이터 + 파일 핸들 복원
   * 반환: { ...profile, tracks: [{ ...meta, fileHandle, file }] }
   */
  async loadProfile(profileId) {
    const list = this.getProfiles();
    const profile = list.find(p => p.id === profileId);
    if (!profile) throw new Error('Profile not found');

    const tracks = [];
    for (const meta of profile.playlist) {
      let fileHandle = null;
      let file = null;

      if (meta.hasHandle) {
        fileHandle = await this._dbGet(`${profileId}_${meta.idx}`);
        if (fileHandle) {
          // 권한 요청
          const perm = await fileHandle.requestPermission({ mode: 'read' }).catch(() => 'denied');
          if (perm === 'granted') {
            file = await fileHandle.getFile().catch(() => null);
          }
        }
      }

      tracks.push({ ...meta, fileHandle, file });
    }

    return { ...profile, tracks };
  }

  // ── 삭제 ──────────────────────────────────────────────
  async deleteProfile(profileId) {
    let list = this.getProfiles();
    const profile = list.find(p => p.id === profileId);
    if (profile) {
      await this._cleanHandles(profile);
    }
    list = list.filter(p => p.id !== profileId);
    this._setProfiles(list);
  }

  async _cleanHandles(profile) {
    const n = profile.trackCount || (profile.playlist?.length ?? 0);
    for (let i = 0; i < n; i++) {
      await this._dbDelete(`${profile.id}_${i}`);
    }
  }

  // ── 개별 플레이리스트 보관함 (저장 / 불러오기 / 삭제) ──────────
  getSavedPlaylists() {
    try {
      return JSON.parse(localStorage.getItem(PL_LS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  _setSavedPlaylists(list) {
    localStorage.setItem(PL_LS_KEY, JSON.stringify(list));
  }

  async savePlaylist(name, tracks = []) {
    const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const items = [];

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const handle = t.fileHandle || t.file?._handle || null;
      const hasHandle = Boolean(handle);
      if (hasHandle) {
        await this._dbPut(`${id}_${i}`, handle);
      }
      items.push({
        idx:           i,
        name:          t.name,
        artist:        t.artist || '',
        album:         t.album  || '',
        bpm:           t.bpm    || null,
        bpmManual:     Boolean(t._bpmManual),
        duration:      t.duration || 0,
        durationLabel: t.durationLabel || '0:00',
        format:        t.format || '',
        fileName:      t.file?.name || t.fileName || '',
        size:          t.file?.size || t.size || 0,
        loudness:      t.loudness || null,
        hasHandle,
      });
    }

    const record = {
      id,
      name: String(name || '새 플레이리스트').trim(),
      createdAt: new Date().toISOString(),
      trackCount: items.length,
      tracks: items,
    };

    const list = this.getSavedPlaylists();
    const existingIdx = list.findIndex((p) => p.name === record.name);
    if (existingIdx >= 0) {
      await this._cleanHandles(list[existingIdx]);
      list[existingIdx] = record;
    } else {
      list.push(record);
    }
    this._setSavedPlaylists(list);
    return record;
  }

  async loadPlaylist(playlistId) {
    const list = this.getSavedPlaylists();
    const record = list.find((p) => p.id === playlistId);
    if (!record) throw new Error('저장된 플레이리스트를 찾을 수 없습니다');

    const restored = [];
    for (const meta of record.tracks || []) {
      let fileHandle = null;
      let file = null;

      if (meta.hasHandle) {
        fileHandle = await this._dbGet(`${playlistId}_${meta.idx}`);
        if (fileHandle) {
          const perm = await fileHandle.requestPermission?.({ mode: 'read' }).catch(() => 'denied');
          if (perm === 'granted' || !fileHandle.requestPermission) {
            file = await fileHandle.getFile().catch(() => null);
            if (file) file._handle = fileHandle;
          }
        }
      }

      restored.push({ ...meta, fileHandle, file });
    }

    return { ...record, tracks: restored };
  }

  async deletePlaylist(playlistId) {
    let list = this.getSavedPlaylists();
    const record = list.find((p) => p.id === playlistId);
    if (record) {
      const n = record.trackCount || (record.tracks?.length ?? 0);
      for (let i = 0; i < n; i++) {
        await this._dbDelete(`${record.id}_${i}`);
      }
    }
    list = list.filter((p) => p.id !== playlistId);
    this._setSavedPlaylists(list);
  }

  // ── 큐 세트 목록 (localStorage + IndexedDB) ─────────────
  getSavedQueues() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_LS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  _setSavedQueues(list) {
    localStorage.setItem(QUEUE_LS_KEY, JSON.stringify(list));
  }

  async saveQueue(name, tracks = []) {
    const id = `queue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const items = [];

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const handle = t.fileHandle || t.file?._handle || null;
      const hasHandle = Boolean(handle);
      if (hasHandle) {
        await this._dbPut(`${id}_${i}`, handle);
      }
      items.push({
        idx:           i,
        name:          t.name,
        artist:        t.artist || '',
        album:         t.album  || '',
        bpm:           t.bpm    || null,
        bpmManual:     Boolean(t._bpmManual),
        duration:      t.duration || 0,
        durationLabel: t.durationLabel || '0:00',
        format:        t.format || '',
        fileName:      t.file?.name || t.fileName || '',
        size:          t.file?.size || t.size || 0,
        loudness:      t.loudness || null,
        hasHandle,
      });
    }

    const totalSeconds = items.reduce((sum, item) => sum + (item.duration || 0), 0);
    const record = {
      id,
      name: String(name || '새 큐 세트').trim(),
      createdAt: new Date().toISOString(),
      trackCount: items.length,
      totalDuration: totalSeconds,
      tracks: items,
    };

    const list = this.getSavedQueues();
    const existingIdx = list.findIndex((p) => p.name === record.name);
    if (existingIdx >= 0) {
      const old = list[existingIdx];
      const n = old.trackCount || (old.tracks?.length ?? 0);
      for (let i = 0; i < n; i++) {
        await this._dbDelete(`${old.id}_${i}`);
      }
      list[existingIdx] = record;
    } else {
      list.push(record);
    }
    this._setSavedQueues(list);
    return record;
  }

  async loadQueue(queueId) {
    const list = this.getSavedQueues();
    const record = list.find((p) => p.id === queueId);
    if (!record) throw new Error('저장된 큐 세트를 찾을 수 없습니다');

    const restored = [];
    for (const meta of record.tracks || []) {
      let fileHandle = null;
      let file = null;

      if (meta.hasHandle) {
        fileHandle = await this._dbGet(`${queueId}_${meta.idx}`);
        if (fileHandle) {
          const perm = await fileHandle.requestPermission?.({ mode: 'read' }).catch(() => 'denied');
          if (perm === 'granted' || !fileHandle.requestPermission) {
            file = await fileHandle.getFile().catch(() => null);
            if (file) file._handle = fileHandle;
          }
        }
      }

      restored.push({ ...meta, fileHandle, file });
    }

    return { ...record, tracks: restored };
  }

  async deleteQueue(queueId) {
    let list = this.getSavedQueues();
    const record = list.find((p) => p.id === queueId);
    if (record) {
      const n = record.trackCount || (record.tracks?.length ?? 0);
      for (let i = 0; i < n; i++) {
        await this._dbDelete(`${record.id}_${i}`);
      }
    }
    list = list.filter((p) => p.id !== queueId);
    this._setSavedQueues(list);
  }

  /** 수동 수정된 BPM을 저장된 플레이리스트 보관함 및 프로파일에도 일괄 반영 */
  updateTrackBPMInStorage(track) {
    if (!track || !track.bpm) return;
    const targetFile = (track.file?.name || track.fileName || '').toLowerCase();
    const targetName = (track.name || '').toLowerCase();
    const targetArtist = (track.artist || '').toLowerCase();

    const matchesMeta = (m) => {
      const mFile = (m.fileName || '').toLowerCase();
      if (targetFile && mFile && targetFile === mFile) return true;
      if (
        targetName &&
        (m.name || '').toLowerCase() === targetName &&
        (!targetArtist || !(m.artist || '') || (m.artist || '').toLowerCase() === targetArtist)
      ) {
        return true;
      }
      return false;
    };

    try {
      const savedPlaylists = this.getSavedPlaylists();
      let plChanged = false;
      for (const pl of savedPlaylists) {
        for (const m of pl.tracks || []) {
          if (matchesMeta(m)) {
            m.bpm = track.bpm;
            m.bpmManual = Boolean(track._bpmManual);
            plChanged = true;
          }
        }
      }
      if (plChanged) this._setSavedPlaylists(savedPlaylists);

      const savedQueues = this.getSavedQueues();
      let qChanged = false;
      for (const q of savedQueues) {
        for (const m of q.tracks || []) {
          if (matchesMeta(m)) {
            m.bpm = track.bpm;
            m.bpmManual = Boolean(track._bpmManual);
            qChanged = true;
          }
        }
      }
      if (qChanged) this._setSavedQueues(savedQueues);

      const profiles = this.getProfiles();
      let profChanged = false;
      for (const p of profiles) {
        for (const m of p.playlist || []) {
          if (matchesMeta(m)) {
            m.bpm = track.bpm;
            m.bpmManual = Boolean(track._bpmManual);
            profChanged = true;
          }
        }
      }
      if (profChanged) this._setProfiles(profiles);
    } catch (_) {}
  }

  // ── 워크스페이스(멀티 탭 플레이리스트 + 큐) 실시간 자동 저장 & 복원 ──
  async saveWorkspaceSession(tabs = [], activeTabId = null, queueTracks = [], playedTrackIds = []) {
    try {
      const serializedTabs = [];
      const handleTasks = [];

      for (let tIdx = 0; tIdx < tabs.length; tIdx++) {
        const tab = tabs[tIdx];
        const items = [];
        for (let i = 0; i < (tab.tracks || []).length; i++) {
          const t = tab.tracks[i];
          const handle = t.fileHandle || t.file?._handle || null;
          const hasHandle = Boolean(handle);
          if (hasHandle) {
            handleTasks.push({ key: `ws_${tIdx}_${i}`, handle });
          }
          items.push({
            idx:           i,
            name:          t.name,
            artist:        t.artist || '',
            album:         t.album  || '',
            bpm:           t.bpm    || null,
            bpmManual:     Boolean(t._bpmManual),
            duration:      t.duration || 0,
            durationLabel: t.durationLabel || '0:00',
            format:        t.format || '',
            fileName:      t.file?.name || t.fileName || '',
            size:          t.file?.size || t.size || 0,
            loudness:      t.loudness || null,
            hasHandle,
          });
        }
        serializedTabs.push({
          id:     tab.id,
          name:   tab.name,
          tracks: items,
        });
      }

      // 큐 대기열 직렬화 및 파일 핸들 보존
      const serializedQueue = [];
      for (let i = 0; i < (queueTracks || []).length; i++) {
        const t = queueTracks[i];
        const handle = t.fileHandle || t.file?._handle || null;
        const hasHandle = Boolean(handle);
        if (hasHandle) {
          handleTasks.push({ key: `ws_q_${i}`, handle });
        }
        serializedQueue.push({
          idx:           i,
          name:          t.name,
          artist:        t.artist || '',
          album:         t.album  || '',
          bpm:           t.bpm    || null,
          bpmManual:     Boolean(t._bpmManual),
          duration:      t.duration || 0,
          durationLabel: t.durationLabel || '0:00',
          format:        t.format || '',
          fileName:      t.file?.name || t.fileName || '',
          size:          t.file?.size || t.size || 0,
          loudness:      t.loudness || null,
          hasHandle,
        });
      }

      const payload = {
        version:        2,
        updatedAt:      new Date().toISOString(),
        activeTabId:    activeTabId || serializedTabs[0]?.id || null,
        tabs:           serializedTabs,
        queue:          serializedQueue,
        playedTrackIds: Array.from(playedTrackIds || []),
      };
      // 1) localStorage에 메타데이터 즉시(동기) 기록 → 탭 닫기/새로고침 시에도 100% 보장
      localStorage.setItem(WS_LS_KEY, JSON.stringify(payload));

      // 2) IndexedDB에 FileSystemFileHandle 비동기 저장
      for (const task of handleTasks) {
        await this._dbPut(task.key, task.handle).catch(() => {});
      }
    } catch (e) {
      console.warn('saveWorkspaceSession failed:', e);
    }
  }

  async loadWorkspaceSession() {
    try {
      const raw = localStorage.getItem(WS_LS_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) return null;

      // 모든 탭과 큐가 비어있는 세션이면 복원 불필요
      const totalTracks = session.tabs.reduce((sum, tab) => sum + (tab.tracks?.length || 0), 0);
      const queueCount = session.queue?.length || 0;
      if (totalTracks === 0 && queueCount === 0 && session.tabs.length <= 1) return null;

      const restoredTabs = [];
      for (let tIdx = 0; tIdx < session.tabs.length; tIdx++) {
        const tab = session.tabs[tIdx];
        const tracks = [];
        for (const meta of tab.tracks || []) {
          let fileHandle = null;
          let file = null;
          if (meta.hasHandle) {
            fileHandle = await this._dbGet(`ws_${tIdx}_${meta.idx}`);
            if (fileHandle) {
              // queryPermission은 사용자 클릭 없이도 현재 권한 상태 확인 가능
              const perm = typeof fileHandle.queryPermission === 'function'
                ? await fileHandle.queryPermission({ mode: 'read' }).catch(() => 'prompt')
                : 'granted';
              if (perm === 'granted') {
                file = await fileHandle.getFile().catch(() => null);
                if (file) file._handle = fileHandle;
              }
            }
          }
          tracks.push({ ...meta, fileHandle, file });
        }
        restoredTabs.push({
          id:     tab.id,
          name:   tab.name,
          tracks,
        });
      }

      // 큐 대기열 복원
      const restoredQueue = [];
      for (const meta of session.queue || []) {
        let fileHandle = null;
        let file = null;
        if (meta.hasHandle) {
          fileHandle = await this._dbGet(`ws_q_${meta.idx}`);
          if (fileHandle) {
            const perm = typeof fileHandle.queryPermission === 'function'
              ? await fileHandle.queryPermission({ mode: 'read' }).catch(() => 'prompt')
              : 'granted';
            if (perm === 'granted') {
              file = await fileHandle.getFile().catch(() => null);
              if (file) file._handle = fileHandle;
            }
          }
        }
        restoredQueue.push({ ...meta, fileHandle, file });
      }

      return {
        activeTabId:    session.activeTabId,
        tabs:           restoredTabs,
        queue:          restoredQueue,
        playedTrackIds: session.playedTrackIds || [],
      };
    } catch (e) {
      console.warn('loadWorkspaceSession failed:', e);
      return null;
    }
  }

  /** 사용자 클릭 시 파일 핸들 읽기 권한을 요청하여 미연결 트랙들을 일괄 활성화 */
  async reconnectTracksWithHandles(tracks = []) {
    let connected = 0;
    for (const t of tracks) {
      if (t.file || !t.fileHandle) continue;
      try {
        const perm = typeof t.fileHandle.requestPermission === 'function'
          ? await t.fileHandle.requestPermission({ mode: 'read' })
          : 'granted';
        if (perm === 'granted') {
          const file = await t.fileHandle.getFile();
          if (file) {
            file._handle = t.fileHandle;
            t.file = file;
            t.fileName = file.name;
            t.size = file.size;
            t.type = file.type || t.type || 'audio/mpeg';
            t._unavailable = false;
            t._needsPermission = false;
            connected++;
          }
        }
      } catch (_) {}
    }
    return connected;
  }

  // ── IndexedDB CRUD ────────────────────────────────────
  _dbPut(key, value) {
    return new Promise((resolve, reject) => {
      if (!this._db) return resolve();
      const tx  = this._db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  _dbGet(key) {
    return new Promise((resolve) => {
      if (!this._db) return resolve(null);
      const tx  = this._db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = (e) => resolve(e.target.result ?? null);
      req.onerror   = () => resolve(null);
    });
  }

  _dbDelete(key) {
    return new Promise((resolve) => {
      if (!this._db) return resolve();
      const tx = this._db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    });
  }
}
