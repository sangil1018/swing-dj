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
};
