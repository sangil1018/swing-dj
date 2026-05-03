/**
 * EQPanel.js — 5밴드 이퀄라이저 UI
 *
 * 기능:
 *  - 5밴드 세로 슬라이더 (±12dB)
 *  - dB 눈금자 (좌측 고정 스케일)
 *  - 빌트인 프리셋 (Flat / Bass Boost / Warm / Bright / Vocal / Swing Jazz)
 *  - 커스텀 프리셋 저장/삭제/불러오기 (localStorage 영구 저장)
 *  - 마지막 EQ 설정 자동 복원
 */

const EQ_BANDS = [
  { label: '60 Hz',  freq: 60 },
  { label: '250 Hz', freq: 250 },
  { label: '1 kHz',  freq: 1000 },
  { label: '4 kHz',  freq: 4000 },
  { label: '16 kHz', freq: 16000 },
];

const BUILTIN_PRESETS = {
  'Flat':       [0, 0, 0, 0, 0],
  'Bass Boost': [8, 4, 0, -2, -2],
  'Warm':       [4, 2, -1, -2, -4],
  'Bright':     [-2, 0, 2, 4, 6],
  'Vocal':      [-2, 0, 4, 4, 2],
  'Swing Jazz': [3, 1, 0, 2, 3],
};

// dB 눈금 정의 (상단 +12 → 하단 -12)
const DB_SCALE = ['+12', '+6', '0', '-6', '-12'];

export class EQPanel {
  constructor(container, audioEngine, storage) {
    this.container = container;
    this.engine    = audioEngine;
    this.storage   = storage;

    this._sliders       = [];
    this._valueEls      = [];
    this._bandEls       = [];
    this._currentBands  = [0, 0, 0, 0, 0];
    this._activePreset  = null;   // 현재 활성 프리셋 버튼 el
    this._activePreset  = null;   // 현재 활성 프리셋 버튼 el
  }

  render() {

    this.container.innerHTML = `
      <div class="eq-wrap">

        <!-- ── 헤더: 제목 + 빌트인 프리셋 ── -->
        <div class="eq-header">
          <span class="eq-title">Equalizer</span>
          <div class="eq-presets" id="eq-builtin-presets">
            ${Object.keys(BUILTIN_PRESETS).map((p) =>
              `<button class="eq-preset-btn" data-preset="${p}">${p}</button>`
            ).join('')}
          </div>
        </div>

        <!-- ── 슬라이더 영역: 눈금자 + 5밴드 ── -->
        <div class="eq-body" id="eq-body">

          <!-- 좌측 dB 눈금자 -->
          <div class="eq-scale" aria-hidden="true">
            ${DB_SCALE.map((v) =>
              `<span class="eq-scale-mark ${v === '0' ? 'zero' : ''}">${v}</span>`
            ).join('')}
          </div>

          <!-- 5밴드 슬라이더 -->
          <div class="eq-sliders" id="eq-sliders-grid">
            ${EQ_BANDS.map((b, i) => `
              <div class="eq-band" id="eq-band-${i}">
                <span class="eq-value" id="eq-val-${i}">0</span>
                <div class="eq-slider-wrap">
                  <div class="eq-centerline"></div>
                  <input
                    type="range"
                    id="eq-slider-${i}"
                    class="eq-slider"
                    data-index="${i}"
                    min="-12" max="12" step="0.5" value="0"
                    aria-label="${b.label} EQ"
                  />
                </div>
                <span class="eq-label">${b.label}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // ── 슬라이더 이벤트 연결 ──────────────────────────────
    EQ_BANDS.forEach((_, i) => {
      const slider = this.container.querySelector(`#eq-slider-${i}`);
      const valEl  = this.container.querySelector(`#eq-val-${i}`);
      const bandEl = this.container.querySelector(`#eq-band-${i}`);
      this._sliders.push(slider);
      this._valueEls.push(valEl);
      this._bandEls.push(bandEl);

      slider.addEventListener('input', () => {
        this._setBand(i, parseFloat(slider.value), false);
        this._clearActivePreset();
      });
    });

    // ── 빌트인 프리셋 버튼 ───────────────────────────────
    this.container.querySelectorAll('.eq-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bands = BUILTIN_PRESETS[btn.dataset.preset];
        if (bands) { this.applyBands(bands); this._setActivePreset(btn); }
      });
    });

    // ── 마지막 설정 복원 ─────────────────────────────────
    const saved = this.storage.getSettings().eqBands;
    if (saved?.length === 5) {
      this.applyBands(saved);
      // 저장된 값이 빌트인 프리셋과 일치하면 활성화 표시
      this._matchBuiltinPreset(saved);
    } else {
      this._setActivePreset(this.container.querySelector('[data-preset="Flat"]'));
    }

    this._bodyEl = this.container.querySelector('#eq-body');
  }

  // ── 공개 메서드 ──────────────────────────────────────────

  setBodyVisible(visible) {
    if (this._bodyEl) {
      this._bodyEl.style.display = visible ? 'flex' : 'none';
    }
  }

  applyBands(bands) {
    bands.forEach((v, i) => this._setBand(i, v, true));
    this._saveSettings();
  }

  getBands() { return [...this._currentBands]; }

  // ── 내부 메서드 ──────────────────────────────────────────

  _setBand(i, v, fromPreset) {
    if (!this._sliders[i]) return;
    v = Math.round(v * 2) / 2;           // 0.5 단위로 스냅
    this._sliders[i].value   = v;
    this._currentBands[i]    = v;

    // 수치 레이블
    const label = v === 0 ? '0' : (v > 0 ? `+${v}` : `${v}`);
    this._valueEls[i].textContent = label;

    // dB 색상 클래스
    this._bandEls[i].classList.remove('band-pos', 'band-neg', 'band-zero');
    if      (v > 0)  this._bandEls[i].classList.add('band-pos');
    else if (v < 0)  this._bandEls[i].classList.add('band-neg');
    else             this._bandEls[i].classList.add('band-zero');

    this.engine.setEQBand(i, v);
    if (!fromPreset) this._saveSettings();
  }

  _setActivePreset(btn) {
    this.container.querySelectorAll('.eq-preset-btn, .eq-custom-btn')
      .forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this._activePreset = btn;
  }

  _clearActivePreset() {
    this.container.querySelectorAll('.eq-preset-btn, .eq-custom-btn')
      .forEach((b) => b.classList.remove('active'));
    this._activePreset = null;
  }

  _matchBuiltinPreset(bands) {
    for (const [name, preset] of Object.entries(BUILTIN_PRESETS)) {
      if (preset.every((v, i) => v === bands[i])) {
        const btn = this.container.querySelector(`[data-preset="${name}"]`);
        if (btn) this._setActivePreset(btn);
        return;
      }
    }
  }

  _saveSettings() {
    const s = this.storage.getSettings();
    s.eqBands = [...this._currentBands];
    this.storage.saveSettings(s);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
