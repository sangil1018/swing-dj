/**
 * PlaylistManager.js — 다중 탭 플레이리스트 및 트랙 목록 관리
 *
 * - 멀티 탭(기본 '플레이리스트 1', 탭 추가/전환/이름변경/복제/닫기/탭 간 곡 복사)
 * - 플레이리스트 JSON / M3U8 내보내기 및 가져오기
 * - 미연결(오프라인 메타데이터) 트랙에 실제 오디오 파일 추가 시 자동 매칭 복구
 */

import { getNextTrackId, extractFormatLabel, parseFilename } from '../utils/FileLoader.js';
import { formatDuration } from '../utils/TimeFormatter.js';
import { Storage } from '../utils/Storage.js';

let _tabSeq = 1;

function extractBaseName(pathOrName) {
  if (!pathOrName) return '';
  return String(pathOrName).split(/[\\/]/).pop() || '';
}

function stripExt(name) {
  return String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
}

function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[\s\-_()[\]{}.,'"+!@#$%^&*~`]/g, '');
}

export class PlaylistManager {
  constructor() {
    const firstTab = {
      id: `tab_${_tabSeq++}`,
      name: '플레이리스트 1',
      tracks: [],
    };
    this._tabs       = [firstTab];
    this._activeId   = firstTab.id;
    this.onChange    = null; // (tracks, tabs, activeTab) => void
  }

  /* ── 현재 활성 탭 및 트랙 접근자 (하위 호환 유지) ───── */
  get tabs() {
    return this._tabs;
  }

  get activeTabId() {
    return this._activeId;
  }

  get activeTab() {
    return this._tabs.find((t) => t.id === this._activeId) || this._tabs[0];
  }

  get tracks() {
    return this.activeTab.tracks;
  }

  /* ── 멀티 탭 관리 ───────────────────────────────────── */
  createTab(name = null, initialTracks = [], switchTo = true) {
    const idx = this._tabs.length + 1;
    const tabName = (name && String(name).trim()) || `플레이리스트 ${idx}`;
    const newTab = {
      id: `tab_${++_tabSeq}_${Date.now().toString(36)}`,
      name: tabName,
      tracks: Array.isArray(initialTracks) ? [...initialTracks] : [],
    };
    this._tabs.push(newTab);
    if (switchTo) {
      this._activeId = newTab.id;
    }
    this._notify();
    return newTab;
  }

  switchTab(tabId) {
    const target = this._tabs.find((t) => t.id === tabId);
    if (!target || target.id === this._activeId) return false;
    this._activeId = target.id;
    this._notify();
    return true;
  }

  renameTab(tabId, newName) {
    const target = this._tabs.find((t) => t.id === tabId);
    const trimmed = String(newName ?? '').trim();
    if (!target || !trimmed) return false;
    target.name = trimmed.slice(0, 32);
    this._notify();
    return true;
  }

  duplicateTab(tabId = this._activeId) {
    const src = this._tabs.find((t) => t.id === tabId);
    if (!src) return null;
    const clonedTracks = src.tracks.map((t) => ({ ...t }));
    return this.createTab(`${src.name} (복사본)`, clonedTracks, true);
  }

  closeTab(tabId) {
    const idx = this._tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return false;

    // 탭이 1개뿐이면 내용만 비우고 이름을 초기화
    if (this._tabs.length === 1) {
      this.clear();
      this._tabs[0].name = '플레이리스트 1';
      this._notify();
      return true;
    }

    const [removedTab] = this._tabs.splice(idx, 1);
    // 다른 탭에서 참조하지 않는 ObjectURL 정리
    const stillUsedUrls = new Set();
    for (const tab of this._tabs) {
      for (const tr of tab.tracks) {
        if (tr.albumArt) stillUsedUrls.add(tr.albumArt);
      }
    }
    for (const tr of removedTab.tracks) {
      if (tr.albumArt && !stillUsedUrls.has(tr.albumArt)) {
        URL.revokeObjectURL(tr.albumArt);
      }
    }

    if (this._activeId === tabId) {
      const nextTab = this._tabs[Math.min(idx, this._tabs.length - 1)];
      this._activeId = nextTab.id;
    }
    this._notify();
    return true;
  }

  copyTrackToTab(trackId, targetTabId) {
    const targetTab = this._tabs.find((t) => t.id === targetTabId);
    const track = this.getTrackById(trackId);
    if (!targetTab || !track) return false;

    const exists = targetTab.tracks.some((t) =>
      t.id === track.id ||
      (t.file && track.file && t.file.name === track.file.name && t.file.size === track.file.size)
    );
    if (exists) return false;

    targetTab.tracks.push(track);
    this._notify();
    return true;
  }

  /* ── 트랙 추가 / 삭제 / 정렬 ────────────────────────── */
  _matchesPlaceholder(p, t) {
    if (!p || p.file || !t?.file) return false;
    const pBase = extractBaseName(p.fileName || p.name).toLowerCase();
    const tBase = extractBaseName(t.file.name).toLowerCase();

    // 1) 파일명(확장자 포함) 일치
    if (pBase && tBase && pBase === tBase) return true;

    // 2) 확장자 제외 파일명 일치 (.mp3 vs .wav vs .flac 등 포맷 변경 호환)
    const pNoExt = stripExt(pBase);
    const tNoExt = stripExt(tBase);
    if (pNoExt && tNoExt && pNoExt === tNoExt) return true;

    // 3) 아티스트 + 곡명 정규화 일치
    const pNorm = normalizeKey((p.artist ? p.artist + ' ' : '') + (p.name || ''));
    const tNorm = normalizeKey(tNoExt);
    if (pNorm && tNorm && (pNorm === tNorm || normalizeKey((p.name || '') + ' ' + (p.artist || '')) === tNorm)) {
      return true;
    }

    // 4) 곡명 + 아티스트 동시 일치
    if (
      p.name &&
      t.name &&
      p.name.toLowerCase() === t.name.toLowerCase() &&
      (!p.artist || !t.artist || p.artist.toLowerCase() === t.artist.toLowerCase())
    ) {
      return true;
    }

    // 5) 파일명에 곡명과 아티스트가 포함된 경우
    const pTitleNorm = normalizeKey(p.name);
    const pArtistNorm = normalizeKey(p.artist);
    if (pTitleNorm && pTitleNorm.length >= 3 && tNorm.includes(pTitleNorm)) {
      if (!pArtistNorm || pArtistNorm === 'unknownartist' || tNorm.includes(pArtistNorm)) {
        return true;
      }
    }

    return false;
  }

  _hydratePlaceholder(placeholder, t) {
    placeholder.file       = t.file;
    placeholder.fileHandle = t.fileHandle || t.file._handle || placeholder.fileHandle || null;
    placeholder.fileName   = t.file.name;
    placeholder.size       = t.file.size;
    placeholder.type       = t.file.type || placeholder.type;
    placeholder.format     = t.format || placeholder.format;
    if (t.albumArt) placeholder.albumArt = t.albumArt;
    if (t._bpmManual && t.bpm) {
      placeholder.bpm = t.bpm;
      placeholder._bpmChecked = true;
      placeholder._bpmManual = true;
    } else if (!placeholder.bpm && t.bpm) {
      placeholder.bpm = t.bpm;
      placeholder._bpmChecked = true;
      placeholder._bpmManual = Boolean(t._bpmManual);
    }
    if ((!placeholder.duration || placeholder.duration <= 0) && t.duration > 0) {
      placeholder.duration = t.duration;
      placeholder.durationLabel = t.durationLabel;
    }
    placeholder._unavailable = false;
    placeholder._needsPermission = false;
    Storage.applyCachedMetaToTrack(placeholder);
  }

  addTracks(newTracks) {
    const curTracks = this.activeTab.tracks;

    // 1) 기존에 파일 없이 불러온 플레이스홀더(_unavailable) 트랙이 있으면 자동 매칭 연결 (모든 탭 동시 복구)
    const existingKeys = new Set(
      curTracks.filter((t) => t.file).map((t) => `${t.file.name}:${t.file.size}`)
    );

    const added = [];
    for (const t of newTracks) {
      Storage.applyCachedMetaToTrack(t);

      if (t.file) {
        // 다른 비활성 탭에 있는 동일 미연결 트랙도 함께 파일 연결
        for (const tab of this._tabs) {
          if (tab.id === this.activeTab.id) continue;
          for (const p of tab.tracks) {
            if (this._matchesPlaceholder(p, t)) {
              this._hydratePlaceholder(p, t);
            }
          }
        }

        const placeholder = curTracks.find((p) => this._matchesPlaceholder(p, t));
        if (placeholder) {
          this._hydratePlaceholder(placeholder, t);
          existingKeys.add(`${t.file.name}:${t.file.size}`);
          added.push(placeholder);
          continue;
        }
      }

      const key = t.file ? `${t.file.name}:${t.file.size}` : null;
      if (!key || !existingKeys.has(key)) {
        if (key) existingKeys.add(key);
        if (t.file && !t.fileName) t.fileName = t.file.name;
        curTracks.push(t);
        added.push(t);
      } else if (t.albumArt) {
        URL.revokeObjectURL(t.albumArt);
      }
    }

    this._notify();
    return added;
  }

  /** 동일 곡이 여러 탭에 있을 때 수동 수정된 BPM을 모든 탭에 동기화 */
  syncTrackBPM(updatedTrack) {
    if (!updatedTrack) return [];
    const synced = [];
    const targetFile = (updatedTrack.file?.name || updatedTrack.fileName || '').toLowerCase();
    const targetName = (updatedTrack.name || '').toLowerCase();
    const targetArtist = (updatedTrack.artist || '').toLowerCase();

    for (const tab of this._tabs) {
      for (const t of tab.tracks) {
        const sameId = t.id === updatedTrack.id;
        const tFile = (t.file?.name || t.fileName || '').toLowerCase();
        const sameFile = Boolean(targetFile && tFile && targetFile === tFile);
        const sameTitle = Boolean(
          targetName &&
          (t.name || '').toLowerCase() === targetName &&
          (!targetArtist || !(t.artist || '') || (t.artist || '').toLowerCase() === targetArtist)
        );
        if (sameId || sameFile || sameTitle) {
          t.bpm = updatedTrack.bpm;
          t._bpmChecked = Boolean(updatedTrack.bpm);
          t._bpmManual = Boolean(updatedTrack._bpmManual);
          synced.push(t);
        }
      }
    }
    return synced;
  }

  /** 현재 탭 및 전체 탭의 오디오 미연결 트랙 통계 반환 */
  getMissingFileStats() {
    let activeMissing = 0;
    let activeWithHandles = 0;
    let totalMissing = 0;
    let totalWithHandles = 0;

    for (const tab of this._tabs) {
      for (const t of tab.tracks) {
        if (!t.file) {
          totalMissing++;
          if (t.fileHandle) totalWithHandles++;
          if (tab.id === this.activeTab.id) {
            activeMissing++;
            if (t.fileHandle) activeWithHandles++;
          }
        }
      }
    }
    return { activeMissing, activeWithHandles, totalMissing, totalWithHandles };
  }

  /** 저장된 워크스페이스 세션으로부터 멀티 탭 전체 복원 */
  restoreTabsFromSession(sessionTabs, activeTabId) {
    if (!Array.isArray(sessionTabs) || sessionTabs.length === 0) return [];
    const builtTabs = [];
    const toAnalyze = [];

    for (const st of sessionTabs) {
      const tabTracks = [];
      for (const meta of st.tracks || []) {
        const tr = this._buildTrackFromMeta(meta);
        if (meta.file) {
          tr.file = meta.file;
          tr.size = meta.file.size || meta.size || 0;
          tr.type = meta.file.type || meta.type || 'audio/mpeg';
          tr._unavailable = false;
          tr._needsPermission = false;
        } else if (meta.fileHandle) {
          tr.fileHandle = meta.fileHandle;
          tr._needsPermission = true;
          tr._unavailable = true;
        }
        Storage.applyCachedMetaToTrack(tr);
        if (tr.file && !tr._bpmChecked) {
          toAnalyze.push(tr);
        }
        tabTracks.push(tr);
      }
      builtTabs.push({
        id: st.id || `tab_${++_tabSeq}_${Date.now().toString(36)}`,
        name: String(st.name || '플레이리스트').slice(0, 32),
        tracks: tabTracks,
      });
    }

    this._tabs = builtTabs;
    const foundActive = builtTabs.find((t) => t.id === activeTabId);
    this._activeId = foundActive ? foundActive.id : builtTabs[0].id;
    this._notify();
    return toAnalyze;
  }

  /** 프로파일/보관함 복원 전용 — 중복 체크 없이 직접 추가 */
  _addDirect(track) {
    this.activeTab.tracks.push(track);
    this._notify();
  }

  removeTrack(id) {
    const curTracks = this.activeTab.tracks;
    const idx = curTracks.findIndex((t) => String(t.id) === String(id));
    if (idx !== -1) {
      const [removed] = curTracks.splice(idx, 1);
      this._notify();
      return removed;
    }
    return null;
  }

  getTrackById(id) {
    const inActive = this.activeTab.tracks.find((t) => String(t.id) === String(id));
    if (inActive) return inActive;
    for (const tab of this._tabs) {
      const found = tab.tracks.find((t) => String(t.id) === String(id));
      if (found) return found;
    }
    return null;
  }

  /** 다른 탭에 이미 로드된 동일 파일이 있는지 검색 (보관함/JSON 불러오기 시 파일 자동 연결용) */
  findLoadedFileMatch(meta) {
    if (!meta) return null;
    const metaBase = extractBaseName(meta.fileName || meta.name).toLowerCase();
    const metaNoExt = stripExt(metaBase);
    for (const tab of this._tabs) {
      for (const t of tab.tracks) {
        if (!t.file) continue;
        const tBase = extractBaseName(t.file.name).toLowerCase();
        const tNoExt = stripExt(tBase);
        if (metaBase && tBase && (metaBase === tBase || metaNoExt === tNoExt)) {
          return t;
        }
        if (
          meta.name &&
          t.name &&
          t.name.toLowerCase() === meta.name.toLowerCase() &&
          (!meta.artist || !t.artist || t.artist.toLowerCase() === meta.artist.toLowerCase())
        ) {
          return t;
        }
      }
    }
    return null;
  }

  /**
   * 폴더 찾기로 수집한 파일/핸들 목록을 미연결 트랙에만 매칭하여 복원.
   * 새 파일 추가 없이 기존 플레이스홀더만 연결하므로 플레이리스트 곡 수가 불필요하게 늘어나지 않습니다.
   */
  matchFolderFiles(fileListOrHandles = []) {
    let hydratedCount = 0;
    const hydratedTracks = [];

    // 가상 track 형태의 후보 목록 생성
    const candidates = fileListOrHandles.map((item) => {
      const file = item.file || (item instanceof File ? item : null);
      const fileHandle = item.fileHandle || (item.kind === 'file' ? item : (file?._handle || null));
      return {
        file,
        fileHandle,
        name: file ? file.name : (item.name || ''),
        size: file ? file.size : 0,
        type: file ? file.type : '',
      };
    });

    // 모든 탭의 미연결 트랙 검색 및 매칭
    for (const tab of this._tabs) {
      for (const p of tab.tracks) {
        if (p.file) continue;
        for (const cand of candidates) {
          if (!cand.file) continue;
          if (this._matchesPlaceholder(p, cand)) {
            this._hydratePlaceholder(p, cand);
            hydratedTracks.push(p);
            hydratedCount++;
            break;
          }
        }
      }
    }

    if (hydratedCount > 0) {
      this._notify();
    }

    return { hydratedCount, hydratedTracks };
  }

  reorder(fromIdx, toIdx) {
    const curTracks = this.activeTab.tracks;
    if (fromIdx < 0 || fromIdx >= curTracks.length) return;
    if (toIdx < 0 || toIdx >= curTracks.length) return;
    if (fromIdx === toIdx) return;
    const [moved] = curTracks.splice(fromIdx, 1);
    curTracks.splice(toIdx, 0, moved);
    this._notify();
  }

  sortBy(field, direction = 'asc') {
    const curTracks = this.activeTab.tracks;
    const sign = direction === 'desc' ? -1 : 1;
    const collatorOpts = { numeric: true, sensitivity: 'base' };

    const comparators = {
      added:  (a, b) => ((a.id ?? 0) - (b.id ?? 0)) * sign,
      name:   (a, b) => (a.name || '').localeCompare(b.name || '', undefined, collatorOpts) * sign,
      artist: (a, b) => {
        const cmp = (a.artist || '').localeCompare(b.artist || '', undefined, collatorOpts) * sign;
        return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '', undefined, collatorOpts);
      },
      bpm: (a, b) => {
        const aHas = Boolean(a.bpm && a.bpm > 0);
        const bHas = Boolean(b.bpm && b.bpm > 0);
        if (!aHas && !bHas) return 0;
        if (!aHas) return 1;
        if (!bHas) return -1;
        return (a.bpm - b.bpm) * sign;
      },
      duration: (a, b) => {
        const aHas = Boolean(a.duration && a.duration > 0);
        const bHas = Boolean(b.duration && b.duration > 0);
        if (!aHas && !bHas) return 0;
        if (!aHas) return 1;
        if (!bHas) return -1;
        return (a.duration - b.duration) * sign;
      },
    };

    const fn = comparators[field];
    if (fn) {
      curTracks.sort(fn);
      this._notify();
    }
  }

  clear() {
    this.activeTab.tracks = [];
    this._notify();
  }

  /* ── JSON / M3U8 내보내기 & 가져오기 ────────────────── */
  exportActiveTabToJSON() {
    const tab = this.activeTab;
    return {
      format: 'swingdj-playlist-v1',
      name: tab.name,
      exportedAt: new Date().toISOString(),
      tracks: tab.tracks.map((t, idx) => ({
        idx,
        name:          t.name,
        artist:        t.artist || '',
        album:         t.album  || '',
        bpm:           t.bpm    || null,
        bpmManual:     Boolean(t._bpmManual),
        duration:      t.duration || 0,
        durationLabel: t.durationLabel || '0:00',
        format:        t.format || extractFormatLabel(t.file?.name || t.name),
        fileName:      t.file?.name || t.fileName || '',
        size:          t.file?.size || t.size || 0,
        loudness:      t.loudness || null,
      })),
    };
  }

  exportActiveTabToM3U8() {
    const tab = this.activeTab;
    const lines = ['#EXTM3U', `#PLAYLIST:${tab.name}`];
    for (const t of tab.tracks) {
      const dur = Math.round(t.duration || 0);
      const display = t.artist && t.artist !== '알 수 없는 아티스트'
        ? `${t.artist} - ${t.name}`
        : t.name;
      if (t.bpm) {
        lines.push(`#EXTBPM:${t.bpm}`);
      }
      lines.push(`#EXTINF:${dur},${display}`);
      lines.push(t.file?.name || t.fileName || `${display}.mp3`);
    }
    return lines.join('\r\n') + '\r\n';
  }

  importFromJSONObject(data, { asNewTab = false } = {}) {
    if (!data || !Array.isArray(data.tracks)) {
      throw new Error('유효한 플레이리스트 JSON 형식이 아닙니다');
    }
    const playlistName = data.name || '가져온 플레이리스트';
    if (asNewTab) {
      this.createTab(playlistName, [], true);
    } else if (data.name) {
      this.activeTab.name = String(data.name).slice(0, 32);
    }

    const built = data.tracks.map((meta) => this._buildTrackFromMeta(meta));
    const curTracks = this.activeTab.tracks;
    curTracks.push(...built);
    this._notify();
    return built;
  }

  importFromM3U8Text(text, fallbackName = 'M3U 플레이리스트', { asNewTab = false } = {}) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let playlistName = fallbackName.replace(/\.(m3u8?|txt)$/i, '');
    const entries = [];
    let pendingInfo = null;
    let pendingBpm = null;

    for (const line of lines) {
      if (line.startsWith('#PLAYLIST:')) {
        playlistName = line.slice(10).trim() || playlistName;
      } else if (line.startsWith('#EXTBPM:')) {
        const b = parseInt(line.slice(8).trim(), 10);
        if (isFinite(b) && b >= 40 && b <= 400) pendingBpm = b;
      } else if (line.startsWith('#EXTINF:')) {
        const m = line.match(/^#EXTINF:(-?\d+),(.*)$/);
        if (m) {
          const dur = Math.max(0, parseInt(m[1], 10) || 0);
          const [artist, title] = parseFilename(m[2].trim() || 'Track');
          pendingInfo = { duration: dur, name: title, artist: artist || 'Unknown Artist' };
        }
      } else if (!line.startsWith('#')) {
        const fileName = line.split(/[\\/]/).pop();
        const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
        const [artist, title] = parseFilename(nameWithoutExt);
        entries.push({
          name:     pendingInfo?.name   || title || nameWithoutExt,
          artist:   pendingInfo?.artist || artist || 'Unknown Artist',
          duration: pendingInfo?.duration || 0,
          durationLabel: pendingInfo?.duration ? formatDuration(pendingInfo.duration) : '0:00',
          bpm:      pendingBpm,
          fileName,
          format:   extractFormatLabel(fileName),
        });
        pendingInfo = null;
        pendingBpm = null;
      }
    }

    if (asNewTab) {
      this.createTab(playlistName, [], true);
    }
    const built = entries.map((meta) => this._buildTrackFromMeta(meta));
    this.activeTab.tracks.push(...built);
    this._notify();
    return built;
  }

  _buildTrackFromMeta(meta) {
    const matched = this.findLoadedFileMatch(meta);
    const dur = meta.duration || matched?.duration || 0;
    const bpm = meta.bpm || matched?.bpm || null;
    const track = {
      id:            getNextTrackId(),
      file:          matched?.file || meta.file || null,
      fileHandle:    matched?.fileHandle || meta.fileHandle || null,
      fileName:      meta.fileName || matched?.file?.name || '',
      size:          meta.size || matched?.file?.size || 0,
      name:          meta.name || '알 수 없는 트랙',
      artist:        meta.artist || '알 수 없는 아티스트',
      album:         meta.album || matched?.album || '',
      bpm,
      _bpmChecked:   Boolean(bpm || (!matched?.file && !meta.file)),
      _bpmManual:    Boolean(meta.bpmManual || matched?._bpmManual),
      format:        meta.format || extractFormatLabel(meta.fileName || meta.name),
      duration:      dur,
      durationLabel: meta.durationLabel && meta.durationLabel !== '0:00'
        ? meta.durationLabel
        : formatDuration(dur),
      loudness:      meta.loudness || matched?.loudness || null,
      albumArt:      matched?.albumArt || null,
      _unavailable:  !(matched?.file || meta.file),
    };
    Storage.applyCachedMetaToTrack(track);
    if (track.bpm && track._bpmManual) {
      Storage.saveTrackMeta(track, { bpmManual: true });
    }
    return track;
  }

  _notify() {
    if (this.onChange) {
      this.onChange(this.activeTab.tracks, this._tabs, this.activeTab);
    }
  }
}
