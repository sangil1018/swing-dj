/**
 * Storage.js — localStorage 설정 저장/불러오기
 */
const PREFIX = 'swingdj_';

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

  // EQ 프리셋 저장
  saveEQPreset(name, bands) {
    const presets = this.get('eq_presets', {});
    presets[name] = bands;
    this.set('eq_presets', presets);
  },

  getEQPresets() {
    return this.get('eq_presets', {});
  },

  // 앱 설정
  saveSettings(settings) {
    this.set('settings', settings);
  },

  getSettings() {
    return this.get('settings', {
      mainVolume: 0.85,
      cueVolume: 0.85,
      mainDeviceId: 'default',
      cueDeviceId: 'default',
      eqBands: [0, 0, 0, 0, 0],
      showAlbumArt: true,
      showVisualizer: true,
    });
  },
};
