/**
 * PlaylistManager.js — 다중 탭 플레이리스트 및 트랙 목록 관리
 *
 * - 멀티 탭(기본 '플레이리스트 1', 탭 추가/전환/이름변경/복제/닫기/탭 간 곡 복사)
 * - 플레이리스트 JSON / M3U8 내보내기 및 가져오기
 * - 미연결(오프라인 메타데이터) 트랙에 실제 오디오 파일 추가 시 자동 매칭 복구
 */

import { getNextTrackId, extractFormatLabel, parseFilename } from '../utils/FileLoader.js';
import { formatDuration } from '../utils/TimeFormatter.js';

let _tabSeq = 1;

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
  addTracks(newTracks) {
    const curTracks = this.activeTab.tracks;

    // 1) 기존에 파일 없이 불러온 플레이스홀더(_unavailable) 트랙이 있으면 자동 매칭 연결
    const existingKeys = new Set(
      curTracks.filter((t) => t.file).map((t) => `${t.file.name}:${t.file.size}`)
    );

    const added = [];
    for (const t of newTracks) {
      if (t.file) {
        const placeholder = curTracks.find(
          (p) => !p.file && (
            (p.fileName && p.fileName.toLowerCase() === t.file.name.toLowerCase()) ||
            (p.name.toLowerCase() === t.name.toLowerCase() &&
             (!p.artist || !t.artist || p.artist.toLowerCase() === t.artist.toLowerCase()))
          )
        );
        if (placeholder) {
          placeholder.file       = t.file;
          placeholder.fileHandle = t.fileHandle || t.file._handle || null;
          placeholder.size       = t.file.size;
          placeholder.type       = t.file.type || placeholder.type;
          placeholder.format     = t.format || placeholder.format;
          if (t.albumArt) placeholder.albumArt = t.albumArt;
          if (!placeholder.bpm && t.bpm) {
            placeholder.bpm = t.bpm;
            placeholder._bpmChecked = true;
          }
          if ((!placeholder.duration || placeholder.duration <= 0) && t.duration > 0) {
            placeholder.duration = t.duration;
            placeholder.durationLabel = t.durationLabel;
          }
          placeholder._unavailable = false;
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
    for (const tab of this._tabs) {
      for (const t of tab.tracks) {
        if (!t.file) continue;
        if (meta.fileName && t.file.name.toLowerCase() === meta.fileName.toLowerCase()) {
          return t;
        }
        if (
          meta.name &&
          t.name.toLowerCase() === meta.name.toLowerCase() &&
          (!meta.artist || !t.artist || t.artist.toLowerCase() === meta.artist.toLowerCase())
        ) {
          return t;
        }
      }
    }
    return null;
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
        duration:      t.duration || 0,
        durationLabel: t.durationLabel || '0:00',
        format:        t.format || extractFormatLabel(t.file?.name || t.name),
        fileName:      t.file?.name || t.fileName || '',
        size:          t.file?.size || t.size || 0,
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
    return {
      id:            getNextTrackId(),
      file:          matched?.file || meta.file || null,
      fileHandle:    matched?.fileHandle || meta.fileHandle || null,
      fileName:      meta.fileName || matched?.file?.name || '',
      name:          meta.name || '알 수 없는 트랙',
      artist:        meta.artist || '알 수 없는 아티스트',
      album:         meta.album || matched?.album || '',
      bpm,
      _bpmChecked:   Boolean(bpm || (!matched?.file && !meta.file)),
      format:        meta.format || extractFormatLabel(meta.fileName || meta.name),
      duration:      dur,
      durationLabel: meta.durationLabel && meta.durationLabel !== '0:00'
        ? meta.durationLabel
        : formatDuration(dur),
      albumArt:      matched?.albumArt || null,
      _unavailable:  !(matched?.file || meta.file),
    };
  }

  _notify() {
    if (this.onChange) {
      this.onChange(this.activeTab.tracks, this._tabs, this.activeTab);
    }
  }
}
