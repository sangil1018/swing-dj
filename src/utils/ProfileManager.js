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
    const { eqBands, mainVolume, cueVolume, mainDeviceId, cueDeviceId, tracks } = appState;
    const id = `p_${Date.now()}`;

    // 플레이리스트 메타데이터 추출 + 핸들 저장
    const playlist = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
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
        albumArt:      t.albumArt || null,   // Data URL (작은 커버아트)
        hasHandle,
      });
    }

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
