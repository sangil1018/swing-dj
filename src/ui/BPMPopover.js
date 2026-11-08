/**
 * BPMPopover.js — 트랙 BPM 수동 보정 (×2 / ÷2 / 직접 입력 / TAP 템포) 팝오버
 */

export class BPMPopover {
  constructor(onApplyBPM, onReanalyzeBPM = null) {
    this.onApplyBPM     = onApplyBPM;     // (track, bpm: number|null, isManual: boolean) => void
    this.onReanalyzeBPM = onReanalyzeBPM; // (track) => Promise<number|null>
    this._el            = null;
    this._track         = null;
    this._taps          = [];
  }

  mount() {
    this._el = document.createElement('div');
    this._el.className = 'bpm-popover';
    this._el.style.display = 'none';
    this._el.innerHTML = `
      <div class="bpm-pop-header">
        <span class="bpm-pop-title" id="bpm-pop-title">BPM 설정</span>
        <span class="bpm-pop-status" id="bpm-pop-status">자동</span>
        <button type="button" class="bpm-pop-close" id="bpm-pop-close" title="닫기 (Esc)">✕</button>
      </div>
      <div class="bpm-pop-row">
        <button type="button" class="bpm-pop-btn" id="bpm-half-btn" title="2배 느리게 / 반템포 보정 (÷2)">÷2</button>
        <input type="number" class="bpm-pop-input" id="bpm-pop-input" min="40" max="400" step="1" placeholder="BPM" />
        <button type="button" class="bpm-pop-btn" id="bpm-dbl-btn" title="2배 빠르게 / 배템포 보정 (×2)">×2</button>
      </div>
      <div class="bpm-pop-fine-row">
        <button type="button" class="bpm-fine-btn" id="bpm-minus-5" title="-5 BPM">-5</button>
        <button type="button" class="bpm-fine-btn" id="bpm-minus-1" title="-1 BPM">-1</button>
        <button type="button" class="bpm-fine-btn" id="bpm-plus-1" title="+1 BPM">+1</button>
        <button type="button" class="bpm-fine-btn" id="bpm-plus-5" title="+5 BPM">+5</button>
      </div>
      <div class="bpm-pop-actions">
        <button type="button" class="bpm-tap-btn" id="bpm-tap-btn" title="박자에 맞춰 연속 클릭">🥁 TAP</button>
        <button type="button" class="bpm-reanalyze-btn" id="bpm-reanalyze-btn" title="오디오 파형에서 BPM 다시 자동 분석">🔄 재분석</button>
        <button type="button" class="bpm-apply-btn" id="bpm-apply-btn">적용</button>
      </div>
    `;
    document.body.appendChild(this._el);

    this._titleEl     = this._el.querySelector('#bpm-pop-title');
    this._statusEl    = this._el.querySelector('#bpm-pop-status');
    this._inputEl     = this._el.querySelector('#bpm-pop-input');
    this._tapBtn      = this._el.querySelector('#bpm-tap-btn');
    this._reanalyzeBtn = this._el.querySelector('#bpm-reanalyze-btn');

    this._el.querySelector('#bpm-pop-close').addEventListener('click', () => this.close());

    // ÷2 (2배로 잘못 잡힌 곡 반템포 보정 — 상한 400에서 내려오거나 70대까지 폭넓게 허용)
    this._el.querySelector('#bpm-half-btn').addEventListener('click', () => {
      const cur = parseFloat(this._inputEl.value) || this._track?.bpm;
      if (cur && cur >= 70) {
        const next = Math.max(40, Math.min(400, Math.round(cur / 2)));
        this._inputEl.value = next;
        this._commit(next, true);
      }
    });

    // ×2 (절반으로 잘못 잡힌 곡 2배속 보정 — 200 초과 곡도 최대 400까지 허용)
    this._el.querySelector('#bpm-dbl-btn').addEventListener('click', () => {
      const cur = parseFloat(this._inputEl.value) || this._track?.bpm;
      if (cur && cur <= 240) {
        const next = Math.max(40, Math.min(400, Math.round(cur * 2)));
        this._inputEl.value = next;
        this._commit(next, true);
      }
    });

    const stepBpm = (delta) => {
      const cur = parseFloat(this._inputEl.value) || this._track?.bpm || 140;
      const next = Math.max(40, Math.min(400, Math.round(cur + delta)));
      this._inputEl.value = next;
      this._commit(next, true);
    };

    this._el.querySelector('#bpm-minus-5').addEventListener('click', () => stepBpm(-5));
    this._el.querySelector('#bpm-minus-1').addEventListener('click', () => stepBpm(-1));
    this._el.querySelector('#bpm-plus-1').addEventListener('click', () => stepBpm(1));
    this._el.querySelector('#bpm-plus-5').addEventListener('click', () => stepBpm(5));

    this._tapBtn.addEventListener('click', () => this._recordTap());

    this._reanalyzeBtn.addEventListener('click', async () => {
      if (!this._track || !this.onReanalyzeBPM) return;
      this._reanalyzeBtn.disabled = true;
      this._reanalyzeBtn.textContent = '분석중…';
      try {
        const detected = await this.onReanalyzeBPM(this._track);
        if (detected) {
          this._inputEl.value = detected;
          this._syncStatusBadge();
        }
      } finally {
        this._reanalyzeBtn.disabled = false;
        this._reanalyzeBtn.textContent = '🔄 재분석';
      }
    });

    this._el.querySelector('#bpm-apply-btn').addEventListener('click', () => {
      const v = parseInt(this._inputEl.value, 10);
      if (isFinite(v) && v >= 40 && v <= 400) {
        this._commit(v, true);
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
    if (this._reanalyzeBtn) {
      this._reanalyzeBtn.style.display = track.file ? 'inline-flex' : 'none';
    }
    this._syncStatusBadge();

    this._el.style.display = 'flex';

    // 위치 계산 (화면 밖 넘침 방어)
    const rect = anchorEl.getBoundingClientRect();
    const popW = 248;
    const popH = 160;
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

  _syncStatusBadge() {
    if (!this._statusEl || !this._track) return;
    const isManual = Boolean(this._track._bpmManual);
    this._statusEl.textContent = isManual ? '📌 고정됨' : '자동';
    this._statusEl.classList.toggle('manual', isManual);
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
        this._commit(bpm, true);
      }
    } else {
      this._tapBtn.textContent = '🥁 한 번 더…';
    }
  }

  _commit(bpm, isManual = true) {
    if (this._track && this.onApplyBPM) {
      this._track._bpmManual = isManual;
      this.onApplyBPM(this._track, bpm, isManual);
      this._syncStatusBadge();
    }
  }
}
