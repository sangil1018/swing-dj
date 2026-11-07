/**
 * BPMPopover.js — 트랙 BPM 수동 보정 (×2 / ÷2 / 직접 입력 / TAP 템포) 팝오버
 */

export class BPMPopover {
  constructor(onApplyBPM) {
    this.onApplyBPM = onApplyBPM; // (track, bpm: number|null) => void
    this._el        = null;
    this._track     = null;
    this._taps      = [];
  }

  mount() {
    this._el = document.createElement('div');
    this._el.className = 'bpm-popover';
    this._el.style.display = 'none';
    this._el.innerHTML = `
      <div class="bpm-pop-header">
        <span class="bpm-pop-title" id="bpm-pop-title">BPM 설정</span>
        <button type="button" class="bpm-pop-close" id="bpm-pop-close" title="닫기">✕</button>
      </div>
      <div class="bpm-pop-row">
        <button type="button" class="bpm-pop-btn" id="bpm-half-btn" title="반템포로 변경 (÷2)">÷2</button>
        <input type="number" class="bpm-pop-input" id="bpm-pop-input" min="40" max="400" step="1" placeholder="BPM" />
        <button type="button" class="bpm-pop-btn" id="bpm-dbl-btn" title="배템포로 변경 (×2)">×2</button>
      </div>
      <div class="bpm-pop-actions">
        <button type="button" class="bpm-tap-btn" id="bpm-tap-btn" title="박자에 맞춰 연속 클릭 (스페이스바 가능)">🥁 TAP</button>
        <button type="button" class="bpm-apply-btn" id="bpm-apply-btn">적용</button>
      </div>
    `;
    document.body.appendChild(this._el);

    this._titleEl = this._el.querySelector('#bpm-pop-title');
    this._inputEl = this._el.querySelector('#bpm-pop-input');
    this._tapBtn  = this._el.querySelector('#bpm-tap-btn');

    this._el.querySelector('#bpm-pop-close').addEventListener('click', () => this.close());

    this._el.querySelector('#bpm-half-btn').addEventListener('click', () => {
      const cur = parseFloat(this._inputEl.value) || this._track?.bpm;
      if (cur && cur >= 80) {
        const next = Math.round(cur / 2);
        this._inputEl.value = next;
        this._commit(next);
      }
    });

    this._el.querySelector('#bpm-dbl-btn').addEventListener('click', () => {
      const cur = parseFloat(this._inputEl.value) || this._track?.bpm;
      if (cur && cur <= 200) {
        const next = Math.round(cur * 2);
        this._inputEl.value = next;
        this._commit(next);
      }
    });

    this._tapBtn.addEventListener('click', () => this._recordTap());

    this._el.querySelector('#bpm-apply-btn').addEventListener('click', () => {
      const v = parseInt(this._inputEl.value, 10);
      if (isFinite(v) && v >= 40 && v <= 400) {
        this._commit(v);
        this.close();
      }
    });

    this._inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = parseInt(this._inputEl.value, 10);
        if (isFinite(v) && v >= 40 && v <= 400) {
          this._commit(v);
          this.close();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (this._el.style.display !== 'none' && !this._el.contains(e.target) && !e.target.closest('.bpm-interactive')) {
        this.close();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (this._el.style.display === 'none') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  open(track, anchorEl) {
    if (!track || !this._el) return;
    this._track = track;
    this._taps = [];
    this._tapBtn.textContent = '🥁 TAP';
    this._titleEl.textContent = track.name;
    this._inputEl.value = track.bpm ? String(track.bpm) : '';

    this._el.style.display = 'flex';

    // 위치 계산 (화면 밖 넘침 방어)
    const rect = anchorEl.getBoundingClientRect();
    const popW = 224;
    const popH = 128;
    let left = rect.left + rect.width / 2 - popW / 2;
    let top  = rect.bottom + 8;

    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (top + popH > window.innerHeight - 8) top = Math.max(8, rect.top - popH - 8);

    this._el.style.left = `${Math.round(left)}px`;
    this._el.style.top  = `${Math.round(top)}px`;

    this._inputEl.focus();
    this._inputEl.select();
  }

  close() {
    if (this._el) this._el.style.display = 'none';
    this._track = null;
    this._taps = [];
  }

  _recordTap() {
    const now = performance.now();
    // 2.2초 이상 간격이면 새 탭 시퀀스 시작
    if (this._taps.length > 0 && now - this._taps[this._taps.length - 1] > 2200) {
      this._taps = [];
    }
    this._taps.push(now);
    if (this._taps.length > 8) this._taps.shift();

    if (this._taps.length >= 2) {
      let totalInterval = 0;
      for (let i = 1; i < this._taps.length; i++) {
        totalInterval += this._taps[i] - this._taps[i - 1];
      }
      const avgMs = totalInterval / (this._taps.length - 1);
      const bpm = Math.max(40, Math.min(400, Math.round(60000 / avgMs)));
      this._inputEl.value = bpm;
      this._tapBtn.textContent = `🥁 ${bpm} BPM`;
      if (this._taps.length >= 3) {
        this._commit(bpm);
      }
    } else {
      this._tapBtn.textContent = '🥁 한 번 더…';
    }
  }

  _commit(bpm) {
    if (this._track && this.onApplyBPM) {
      this.onApplyBPM(this._track, bpm);
    }
  }
}
