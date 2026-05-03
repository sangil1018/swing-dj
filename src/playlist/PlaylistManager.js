/**
 * PlaylistManager.js — 전체 트랙 목록 관리
 */

export class PlaylistManager {
  constructor() {
    this._tracks   = [];
    this.onChange  = null;
    this._idCounter = 0;   // 프로파일 복원 시 외부에서 사용
  }

  get tracks() { return this._tracks; }

  addTracks(newTracks) {
    // 중복 파일명+크기 제거 (파일 없는 플레이스홀더는 항상 추가)
    const existing = new Set(
      this._tracks.filter(t => t.file).map(t => t.file.name + t.file.size)
    );
    const added = newTracks.filter(
      t => !t.file || !existing.has(t.file.name + t.file.size)
    );
    this._tracks.push(...added);
    this._notify();
    return added;
  }

  /** 프로파일 복원 전용 — 중복 체크 없이 직접 추가 */
  _addDirect(track) {
    this._tracks.push(track);
    this._notify();
  }

  removeTrack(id) {
    const idx = this._tracks.findIndex((t) => t.id === id);
    if (idx !== -1) {
      const [removed] = this._tracks.splice(idx, 1);
      // ObjectURL 해제
      if (removed.albumArt) URL.revokeObjectURL(removed.albumArt);
      this._notify();
    }
  }

  getTrackById(id) {
    return this._tracks.find((t) => t.id === id) || null;
  }

  reorder(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this._tracks.length) return;
    if (toIdx < 0 || toIdx >= this._tracks.length) return;
    const [moved] = this._tracks.splice(fromIdx, 1);
    this._tracks.splice(toIdx, 0, moved);
    this._notify();
  }

  sortBy(field) {
    const fn = {
      name:     (a, b) => a.name.localeCompare(b.name),
      artist:   (a, b) => a.artist.localeCompare(b.artist),
      bpm:      (a, b) => (a.bpm ?? 0) - (b.bpm ?? 0),
      duration: (a, b) => (a.duration ?? 0) - (b.duration ?? 0),
    }[field];
    if (fn) { this._tracks.sort(fn); this._notify(); }
  }

  clear() {
    this._tracks.forEach((t) => { if (t.albumArt) URL.revokeObjectURL(t.albumArt); });
    this._tracks = [];
    this._notify();
  }

  _notify() {
    if (this.onChange) this.onChange(this._tracks);
  }
}
