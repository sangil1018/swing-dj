/**
 * EQPanel.js — 5밴드 이퀄라이저 UI
 *
 * 기능:
 *  - 5밴드 세로 슬라이더 (±12dB, 더블클릭 시 0dB 즉시 리셋)
 *  - Bit-Perfect / EQ Active 상태 뱃지
 *  - dB 눈금자 (좌측 고정 스케일)
 *  - 빌트인 프리셋 + 커스텀 프리셋 저장/삭제
 *  - 마지막 EQ 설정 자동 복원
 */
import { showToast } from '../utils/Toast.js';

const EQ_BANDS = [
  { label: '60 Hz',  freq: 60 },
  { label: '250 Hz', freq: 250 },
  { label: '1 kHz',  freq: 1000 },
  { label: '4 kHz',  freq: 4000 },
  { label: '16 kHz', freq: 16000 },
];

const BUILTIN_PRESETS = {
  'Flat':       [0, 0, 0, 0, 0],
  'Swing Jazz': [3, 1, 0, 2, 3],
  'Warm':       [4, 2, -1, -2, -4],
  'Bright':     [-2, 0, 2, 4, 6],
  'Vocal':      [-2, 0, 4, 4, 2],
  'Bass Cut':   [-5, -2, 0, 1, 1],
};

// dB 눈금 정의 (상단 +12 → 하단 -12)
const DB_SCALE = ['+12', '+6', '0', '-6', '-12'];

export class EQPanel {
  constructor(container, audioEngine, storage) {
    this.container = container;
    this.engine    = audioEngine;
    this.storage   = storage;

    this._sliders      = [];
    this._valueEls     = [];
    this._bandEls      = [];
    this._currentBands = [0, 0, 0, 0, 0];
    this._activePreset = null;
  }

  render() {
    this.container.innerHTML = `
      <div class="eq-wrap">

        <!-- ── 헤더: 제목 + 상태 뱃지 + 하이파이 DSP 토글 + 프리셋 ── -->
        <div class="eq-header">
          <div class="eq-title-group">
            <div class="eq-title-badges">
              <span class="eq-title">Equalizer</span>
              <span class="eq-mode-badge bit-perfect" id="eq-mode-badge" role="button" tabindex="0" title="클릭 시 0dB Bit-Perfect 직결 모드로 초기화 (EQ 필터 우회)">Bit-Perfect</span>
              <span class="eq-sr-badge" id="eq-sr-badge" title="오디오 엔진 네이티브 샘플레이트 및 신호 경로">Direct</span>
            </div>
            <div class="eq-dsp-actions">
              <button type="button" class="eq-dsp-btn" id="btn-autogain" title="트랙 간 음량 자동 평준화 (Auto-Gain: -14 dBFS RMS 기준 자동 보정 및 피크 보호)">🔊 Auto-Gain</button>
              <button type="button" class="eq-dsp-btn" id="btn-mono" title="빠/홀 PA 환경을 위한 모노 출력 합산 (빈티지 스테레오 재즈 음원의 좌우 악기 쏠림 방지)">🎧 Mono</button>
            </div>
          </div>
          <div class="eq-presets" id="eq-presets-bar"></div>
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
                <span class="eq-value" id="eq-val-${i}" title="더블클릭하여 0dB로 초기화">0</span>
                <div class="eq-slider-wrap">
                  <div class="eq-centerline"></div>
                  <input
                    type="range"
                    id="eq-slider-${i}"
                    class="eq-slider"
                    data-index="${i}"
                    min="-12" max="12" step="0.5" value="0"
                    title="${b.label} (더블클릭: 0dB 리셋)"
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

    this._modeBadgeEl = this.container.querySelector('#eq-mode-badge');
    this._srBadgeEl   = this.container.querySelector('#eq-sr-badge');
    this._autoGainBtn = this.container.querySelector('#btn-autogain');
    this._monoBtn     = this.container.querySelector('#btn-mono');
    this._presetsBar  = this.container.querySelector('#eq-presets-bar');
    this._bodyEl      = this.container.querySelector('#eq-body');

    // Auto-Gain 및 Mono 토글 이벤트
    this._autoGainBtn?.addEventListener('click', () => {
      const next = !this.engine.autoGainEnabled;
      this.engine.setAutoGain(next);
      const s = this.storage.getSettings();
      s.autoGain = next;
      this.storage.saveSettings(s);
      this.syncAudioModeUI();
      showToast(next ? '🔊 Auto-Gain ON: 트랙 간 음량을 -14 dBFS 기준으로 자동 평준화합니다' : '🔊 Auto-Gain OFF: 원음 볼륨 그대로 출력합니다');
    });

    this._monoBtn?.addEventListener('click', () => {
      const next = !this.engine.monoOutput;
      this.engine.setMonoOutput(next);
      const s = this.storage.getSettings();
      s.monoOutput = next;
      this.storage.saveSettings(s);
      this.syncAudioModeUI();
      showToast(next ? '🎧 Mono 출력 ON: 좌/우 채널을 합산하여 양쪽 스피커에 균등 출력합니다' : '🎧 Stereo 출력 복귀');
    });

    // Bit-Perfect / EQ Active 배지 클릭 시 Flat 초기화
    this._modeBadgeEl?.addEventListener('click', () => {
      const isFlat = this._currentBands.every((g) => Math.abs(g) < 0.01);
      if (!isFlat) {
        this.applyBands([0, 0, 0, 0, 0]);
        showToast('Bit-Perfect 직결 모드로 복귀 (0dB Flat 초기화)');
      } else {
        showToast('현재 Bit-Perfect 직결 모드 (EQ 필터 우회)입니다');
      }
    });
    this._modeBadgeEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._modeBadgeEl.click();
      }
    });

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
        this._matchPreset(this._currentBands);
      });

      // 더블클릭 시 해당 대역 0dB 즉시 초기화
      const resetSingleBand = () => {
        this._setBand(i, 0, false);
        this._matchPreset(this._currentBands);
      };
      slider.addEventListener('dblclick', resetSingleBand);
      valEl.addEventListener('dblclick', resetSingleBand);
    });

    this._renderPresetsBar();

    // ── 마지막 설정 복원 ─────────────────────────────────
    const settings = this.storage.getSettings();
    if (settings.autoGain != null) this.engine.setAutoGain(settings.autoGain);
    if (settings.monoOutput != null) this.engine.setMonoOutput(settings.monoOutput);

    const saved = settings.eqBands;
    if (saved?.length === 5) {
      this.applyBands(saved);
    } else {
      this.applyBands([0, 0, 0, 0, 0]);
    }
    this.syncAudioModeUI();
  }

  syncAudioModeUI() {
    this._updateModeBadge();
    if (this._autoGainBtn) {
      const on = Boolean(this.engine.autoGainEnabled);
      this._autoGainBtn.classList.toggle('active', on);
      const agDb = this.engine.currentTrackGainDb;
      if (on && Math.abs(agDb) >= 0.1) {
        const sign = agDb > 0 ? '+' : '';
        this._autoGainBtn.textContent = `🔊 AG ${sign}${agDb.toFixed(1)}dB`;
      } else {
        this._autoGainBtn.textContent = '🔊 Auto-Gain';
      }
    }
    if (this._monoBtn) {
      const mono = Boolean(this.engine.monoOutput);
      this._monoBtn.classList.toggle('active', mono);
      this._monoBtn.textContent = mono ? '🎧 Mono ON' : '🎧 Mono';
    }
    if (this._srBadgeEl) {
      const srKhz = ((this.engine.sampleRate || 48000) / 1000).toFixed(1).replace(/\.0$/, '');
      const pure = this.engine.isPureDirect;
      this._srBadgeEl.textContent = pure ? `${srKhz}kHz Pure` : `${srKhz}kHz DSP`;
      this._srBadgeEl.classList.toggle('pure', pure);
      this._srBadgeEl.title = pure
        ? `네이티브 ${srKhz}kHz Pure Direct 경로 (EQ·리미터 완전 우회, 병렬 스펙트럼 탭)`
        : `네이티브 ${srKhz}kHz DSP 보호 경로 (-0.5dBFS 피크 리미터 및 헤드룸 보호 활성)`;
    }
  }

  _renderPresetsBar() {
    if (!this._presetsBar) return;
    const customPresets = this.storage.getEQPresets();

    const builtinHtml = Object.keys(BUILTIN_PRESETS).map((p) =>
      `<button class="eq-preset-btn" data-preset="${escAttr(p)}">${escHtml(p)}</button>`
    ).join('');

    const customHtml = Object.keys(customPresets).map((name) =>
      `<button class="eq-preset-btn eq-custom-btn" data-custom="${escAttr(name)}" title="클릭: 적용 / 우클릭: 삭제">${escHtml(name)} <span class="eq-custom-del" data-del="${escAttr(name)}">×</span></button>`
    ).join('');

    this._presetsBar.innerHTML = `
      ${builtinHtml}
      ${customHtml}
      <button class="eq-preset-btn eq-save-custom-btn" id="eq-save-custom-btn" title="현재 EQ 수치를 내 프리셋으로 저장">+ 저장</button>
    `;

    // 빌트인 프리셋 클릭
    this._presetsBar.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bands = BUILTIN_PRESETS[btn.dataset.preset];
        if (bands) this.applyBands(bands);
      });
    });

    // 커스텀 프리셋 클릭 / 삭제
    this._presetsBar.querySelectorAll('[data-custom]').forEach((btn) => {
      const name = btn.dataset.custom;
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.eq-custom-del')) {
          e.stopPropagation();
          this.storage.deleteEQPreset(name);
          this._renderPresetsBar();
          this._matchPreset(this._currentBands);
          showToast(`프리셋 삭제됨: ${name}`);
          return;
        }
        const latest = this.storage.getEQPresets()[name];
        if (latest) this.applyBands(latest);
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`"${name}" EQ 프리셋을 삭제할까요?`)) {
          this.storage.deleteEQPreset(name);
          this._renderPresetsBar();
          this._matchPreset(this._currentBands);
          showToast(`프리셋 삭제됨: ${name}`);
        }
      });
    });

    // + 저장 버튼
    this._presetsBar.querySelector('#eq-save-custom-btn')?.addEventListener('click', () => {
      const name = prompt('저장할 EQ 프리셋 이름을 입력하세요 (예: 홍대 빠 울림 보정):');
      if (!name || !name.trim()) return;
      const cleanName = name.trim().slice(0, 20);
      this.storage.saveEQPreset(cleanName, this._currentBands);
      this._renderPresetsBar();
      this._matchPreset(this._currentBands);
      showToast(`EQ 프리셋 저장됨: ${cleanName}`);
    });
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
    this._matchPreset(this._currentBands);
  }

  getBands() { return [...this._currentBands]; }

  // ── 내부 메서드 ──────────────────────────────────────────

  _setBand(i, v, fromPreset) {
    if (!this._sliders[i]) return;
    v = Math.max(-12, Math.min(12, Math.round(v * 2) / 2)); // 0.5 단위 스냅
    this._sliders[i].value = v;
    this._currentBands[i]  = v;

    // 수치 레이블
    const label = v === 0 ? '0' : (v > 0 ? `+${v}` : `${v}`);
    this._valueEls[i].textContent = label;

    // dB 색상 클래스
    this._bandEls[i].classList.remove('band-pos', 'band-neg', 'band-zero');
    if      (v > 0) this._bandEls[i].classList.add('band-pos');
    else if (v < 0) this._bandEls[i].classList.add('band-neg');
    else            this._bandEls[i].classList.add('band-zero');

    this.engine.setEQBand(i, v);
    this.syncAudioModeUI();
    if (!fromPreset) this._saveSettings();
  }

  _updateModeBadge() {
    if (!this._modeBadgeEl) return;
    const isFlat = this._currentBands.every((g) => Math.abs(g) < 0.01);
    const isPure = isFlat && !this.engine.autoGainEnabled;
    if (!isFlat) {
      this._modeBadgeEl.textContent = 'EQ Active';
    } else if (this.engine.autoGainEnabled) {
      this._modeBadgeEl.textContent = 'Auto-Gain';
    } else {
      this._modeBadgeEl.textContent = 'Bit-Perfect';
    }
    this._modeBadgeEl.classList.toggle('bit-perfect', isPure);
    this._modeBadgeEl.classList.toggle('active', !isPure);
  }

  _setActivePreset(btn) {
    this.container.querySelectorAll('.eq-preset-btn')
      .forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this._activePreset = btn;
  }

  _matchPreset(bands) {
    this._setActivePreset(null);
    for (const [name, preset] of Object.entries(BUILTIN_PRESETS)) {
      if (preset.every((v, i) => v === bands[i])) {
        const btn = this._presetsBar?.querySelector(`[data-preset="${CSS.escape(name)}"]`);
        if (btn) this._setActivePreset(btn);
        return;
      }
    }
    const customs = this.storage.getEQPresets();
    for (const [name, preset] of Object.entries(customs)) {
      if (Array.isArray(preset) && preset.every((v, i) => v === bands[i])) {
        const btn = this._presetsBar?.querySelector(`[data-custom="${CSS.escape(name)}"]`);
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
  return String(s).replace(/&/g,'&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
