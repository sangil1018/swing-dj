/**
 * QueueManager.js — 큐(재생 순서) 관리
 */

export class QueueManager {
  constructor() {
    this._queue = [];
    this.onChange = null;
  }

  get queue() { return this._queue; }
  get length() { return this._queue.length; }

  /* 큐 끝에 추가 */
  enqueue(track) {
    this._queue.push(track);
    this._notify();
    return this._queue.length - 1;
  }

  /* 다중 트랙 일괄 추가 (리렌더 1회로 최적화) */
  enqueueMany(tracks) {
    if (!tracks?.length) return 0;
    this._queue.push(...tracks);
    this._notify();
    return tracks.length;
  }

  /* 특정 위치에 삽입 */
  insertAt(index, track) {
    const safeIdx = Math.max(0, Math.min(index, this._queue.length));
    this._queue.splice(safeIdx, 0, track);
    this._notify();
    return safeIdx;
  }

  /* 현재 재생 중인 곡 바로 다음 순서에 삽입 */
  insertNext(track, currentPlayingId = null) {
    if (currentPlayingId != null) {
      const curIdx = this._queue.findIndex((t) => t.id === currentPlayingId);
      if (curIdx !== -1) {
        return this.insertAt(curIdx + 1, track);
      }
    }
    return this.insertAt(0, track);
  }

  /* 선두(다음 재생) 트랙 꺼내기 */
  dequeue() {
    if (this._queue.length === 0) return null;
    const track = this._queue.shift();
    this._notify();
    return track;
  }

  /* 다음 트랙 미리 보기 (제거 X) */
  peek() {
    return this._queue[0] || null;
  }

  /* ID로 제거 */
  removeById(trackId) {
    const idx = this._queue.findIndex((t) => t.id === trackId);
    if (idx !== -1) {
      this._queue.splice(idx, 1);
      this._notify();
      return idx;
    }
    return -1;
  }

  /* 드래그앤드롭 순서 변경 */
  reorder(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this._queue.length) return;
    if (toIndex < 0 || toIndex >= this._queue.length) return;
    if (fromIndex === toIndex) return;
    const [item] = this._queue.splice(fromIndex, 1);
    this._queue.splice(toIndex, 0, item);
    this._notify();
  }

  /* 큐 위로/아래로 이동 */
  moveUp(index) {
    if (index > 0) this.reorder(index, index - 1);
  }

  moveDown(index) {
    if (index < this._queue.length - 1) this.reorder(index, index + 1);
  }

  clear() {
    this._queue = [];
    this._notify();
  }

  /* 큐 전체 교체 (보관함/세션 복원용) */
  restoreQueue(tracks = []) {
    this._queue = Array.isArray(tracks) ? [...tracks] : [];
    this._notify();
    return this._queue.length;
  }

  /* 미연결(파일 핸들 권한 필요 또는 파일 유실) 트랙 통계 */
  getMissingFileStats() {
    let missing = 0;
    let withHandles = 0;
    for (const t of this._queue) {
      if (!t.file) {
        missing++;
        if (t.fileHandle) withHandles++;
      }
    }
    return { missing, withHandles, total: this._queue.length };
  }

  /* ── JSON / M3U8 내보내기 ────────────────────────────── */
  exportToJSON(name = '큐 세트') {
    return {
      format: 'swingdj-queue-v1',
      name: String(name || '큐 세트').slice(0, 32),
      exportedAt: new Date().toISOString(),
      tracks: this._queue.map((t, idx) => ({
        idx,
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
      })),
    };
  }

  exportToM3U8(name = '큐 세트') {
    const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
    for (const t of this._queue) {
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

  _notify() {
    if (this.onChange) this.onChange([...this._queue]);
  }
}
