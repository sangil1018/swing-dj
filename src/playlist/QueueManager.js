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
  }

  /* 특정 위치에 삽입 */
  insertAt(index, track) {
    this._queue.splice(index, 0, track);
    this._notify();
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
    }
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

  _notify() {
    if (this.onChange) this.onChange([...this._queue]);
  }
}
