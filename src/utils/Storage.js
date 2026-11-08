/**
 * Storage.js — localStorage 설정 저장/불러오기
 */
const PREFIX = 'swingdj_';

const DEFAULT_SETTINGS = {
  mainVolume: 0.85,
  cueVolume: 0.85,
  mainDeviceId: 'default',
  cueDeviceId: 'default',
  eqBands: [0, 0, 0, 0, 0],
  showAlbumArt: true,
  showEQ: true,
  showVisualizer: true,
  showRemainingTime: true,
  autoStopAfterCurrent: false,
  theme: 'gold',
  compMode: false,
  compDurationSec: 100,
  compFadeSec: 5,
  metronomeBpm: 140,
  metronomeMode: 'straight',
  metronomeOutput: 'cue',
  autoGain: false,
  monoOutput: false,
};

export const Storage = {
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage.set failed:', e);
    }
  },

  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(PREFIX + key);
      return item !== null ? JSON.parse(item) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },

  // EQ 프리셋 저장/삭제
  saveEQPreset(name, bands) {
    const presets = this.get('eq_presets', {});
    presets[name] = [...bands];
    this.set('eq_presets', presets);
  },

  deleteEQPreset(name) {
    const presets = this.get('eq_presets', {});
    delete presets[name];
    this.set('eq_presets', presets);
  },

  getEQPresets() {
    return this.get('eq_presets', {});
  },

  // 앱 설정
  saveSettings(settings) {
    this.set('settings', { ...DEFAULT_SETTINGS, ...settings });
  },

  getSettings() {
    const saved = this.get('settings', null);
    return saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS };
  },

  /* ── 트랙별 영구 메타데이터 캐시 (수동 수정 BPM · 길이 · 라우드니스 보존) ── */
  _buildTrackKeys(trackOrInfo) {
    if (!trackOrInfo) return [];
    const keys = [];
    const fileName = String(
      trackOrInfo.file?.name || trackOrInfo.fileName || ''
    ).trim().toLowerCase();
    const size = Number(trackOrInfo.file?.size || trackOrInfo.size || 0);
    const name = String(trackOrInfo.name || '').trim().toLowerCase();
    const artist = String(trackOrInfo.artist || '').trim().toLowerCase();

    if (fileName && size > 0) {
      keys.push(`file:${fileName}:${size}`);
    }
    if (fileName) {
      keys.push(`name:${fileName}`);
    }
    if (name) {
      keys.push(`title:${artist}::${name}`);
    }
    return keys;
  },

  getTrackMeta(trackOrInfo) {
    const keys = this._buildTrackKeys(trackOrInfo);
    if (keys.length === 0) return null;
    const db = this.get('track_meta_v1', {});
    for (const k of keys) {
      if (db[k]) return db[k];
    }
    return null;
  },

  saveTrackMeta(track, { bpmManual = undefined } = {}) {
    if (!track) return;
    const keys = this._buildTrackKeys(track);
    if (keys.length === 0) return;

    const db = this.get('track_meta_v1', {});
    const existing = keys.map((k) => db[k]).find(Boolean) || {};

    const isManual = bpmManual !== undefined
      ? Boolean(bpmManual)
      : Boolean(track._bpmManual || existing.bpmManual);

    // 기존에 사용자가 수동 고정한 BPM이 있는데 자동 분석(bpmManual === false)이 덮어쓰려 하면 기존 수동 BPM 유지
    let finalBpm = track.bpm || existing.bpm || null;
    let finalManual = isManual;
    if (existing.bpmManual && existing.bpm && bpmManual === false) {
      finalBpm = existing.bpm;
      finalManual = true;
    }

    const record = {
      bpm:           finalBpm,
      bpmManual:     finalManual,
      duration:      track.duration || existing.duration || 0,
      durationLabel: (track.durationLabel && track.durationLabel !== '0:00' && track.durationLabel !== '--:--')
        ? track.durationLabel
        : (existing.durationLabel || ''),
      loudness:      track.loudness || existing.loudness || null,
      updatedAt:     Date.now(),
    };

    for (const k of keys) {
      db[k] = record;
    }
    this.set('track_meta_v1', db);
  },

  clearManualBPM(track) {
    if (!track) return;
    const keys = this._buildTrackKeys(track);
    if (keys.length === 0) return;
    const db = this.get('track_meta_v1', {});
    for (const k of keys) {
      if (db[k]) {
        db[k].bpmManual = false;
        db[k].bpm = null;
      }
    }
    this.set('track_meta_v1', db);
  },

  applyCachedMetaToTrack(track) {
    if (!track) return track;
    const cached = this.getTrackMeta(track);
    if (!cached) return track;

    if (cached.bpmManual && cached.bpm) {
      track.bpm = cached.bpm;
      track._bpmChecked = true;
      track._bpmManual = true;
    } else if (!track.bpm && cached.bpm) {
      track.bpm = cached.bpm;
      track._bpmChecked = true;
      track._bpmManual = Boolean(cached.bpmManual);
    }

    if ((!track.duration || track.duration <= 0) && cached.duration > 0) {
      track.duration = cached.duration;
      track.durationLabel = cached.durationLabel || track.durationLabel;
    }
    if (!track.loudness && cached.loudness) {
      track.loudness = cached.loudness;
    }
    return track;
  },
};
