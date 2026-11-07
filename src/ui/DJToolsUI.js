/**
 * DJToolsUI.js — 스윙 DJ 전용 도구 패널 (🏆 컴핏모드 타이머 + ⏱️ 메트로놈)
 *
 * 1) 컴핏모드 (Competition Mode):
 *    - 기본 1분 40초 (100초) 카운트다운 타이머
 *    - 마지막 5초 (조정 가능) 자동 부드러운 페이드아웃 후 정지
 *    - 분/초 직접 입력, ±5초/±10초 조절, 프리셋(1:00 / 1:30 / 1:40 / 2:00) 지원
 *
 * 2) 메트로놈 (Metronome):
 *    - 40~360 BPM, 4박 시각적 비트 LED (BPM 속도별 색상 연동)
 *    - 정박 / 스윙 셔플 / 2&4 백비트 모드, CUE(헤드폰) / MAIN(스피커) 출력 전환
 *    - TAP 템포 및 현재 트랙 BPM 원클릭 동기화
 */

import { applyBPMTierClass, getBPMTier } from '../utils/BPMTier.js';
import { formatTime } from '../utils/TimeFormatter.js';
import { showToast } from '../utils/Toast.js';

export class DJToolsUI {
  constructor(container, player, audioEngine, metronome) {
    this.container = container;
    this.player    = player;
    this.engine    = audioEngine;
    this.metronome = metronome;

    // 컴핏모드 상태 (기본 1분 40초 = 100초, 마지막 5초 페이드아웃)
    this.compMode        = false;
    this.compDurationSec = 100;
    this.compFadeSec     = 5;
    this._compElapsedSec = 0;
    this._compFading     = false;
    this._compFinished   = false;
    this._lastTickTime   = null;
    this._rafId          = null;

    // 메트로놈 TAP 기록
    this._metroTaps = [];

    // 콜백
    this.onSettingsChange = null; // (partialSettings) => void
    this.onStatusChange   = null; // (msg: string) => void
    this.onCompEnded      = null; // () => Promise<void> | void
    this.getReferenceBPM  = null; // () => number | null
  }

  mount() {
    this.container.innerHTML = `
      <div class="dj-tools-wrap">

        <!-- ══ 1. 컴핏모드 (Competition Timer) 카드 ══ -->
        <section class="dj-tool-card comp-card" id="comp-card" aria-label="컴핏모드 타이머">
          <div class="dj-tool-header">
            <div class="dj-tool-title-group">
              <button type="button" class="comp-toggle-btn" id="btn-comp-mode" title="컴핏모드 켜기/끄기 (단축키: C)">
                <span class="pill-dot"></span>
                <span id="comp-mode-label">🏆 컴핏모드 OFF</span>
              </button>
              <span class="comp-status-badge" id="comp-status-badge">대기 (기본 1:40 · 5초 페이드)</span>
            </div>

            <div class="comp-header-right">
              <div class="comp-timer-readout" id="comp-timer-display" title="컴핏 남은 시간">01:40</div>
              <button type="button" class="dj-mini-btn" id="comp-reset-btn" title="컴핏 타이머 처음(지정 시간)으로 리셋">↺ 리셋</button>
            </div>
          </div>

          <!-- 컴핏 진행 바 (마지막 페이드아웃 구간 시각화 + 클릭 시크 지원) -->
          <div class="comp-progress-wrap">
            <span class="comp-time-sub" id="comp-elapsed-label">0:00</span>
            <div class="comp-progress-bar" id="comp-progress-bar" title="클릭하여 컴핏 타이머 위치 이동">
              <div class="comp-fade-zone" id="comp-fade-zone" style="width:5%"></div>
              <div class="comp-progress-fill" id="comp-progress-fill" style="width:0%"></div>
            </div>
            <span class="comp-time-sub" id="comp-target-label">1:40</span>
          </div>

          <!-- 컴핏 시간 설정 컨트롤 -->
          <div class="comp-controls-row">
            <div class="comp-time-inputs" title="컴핏 지정 시간 (분 : 초)">
              <span class="comp-ctrl-label">지정시간</span>
              <input type="number" id="comp-min-input" class="comp-num-input" min="0" max="15" step="1" value="1" aria-label="컴핏 분" />
              <span class="comp-unit">분</span>
              <input type="number" id="comp-sec-input" class="comp-num-input" min="0" max="59" step="1" value="40" aria-label="컴핏 초" />
              <span class="comp-unit">초</span>
            </div>

            <div class="comp-step-btns">
              <button type="button" class="dj-step-btn" id="comp-minus-10" title="10초 감소">-10s</button>
              <button type="button" class="dj-step-btn" id="comp-minus-5" title="5초 감소">-5s</button>
              <button type="button" class="dj-step-btn" id="comp-plus-5" title="5초 증가">+5s</button>
              <button type="button" class="dj-step-btn" id="comp-plus-10" title="10초 증가">+10s</button>
            </div>

            <div class="comp-presets">
              <button type="button" class="dj-preset-chip" data-comp-sec="60">1:00</button>
              <button type="button" class="dj-preset-chip" data-comp-sec="90">1:30</button>
              <button type="button" class="dj-preset-chip active" data-comp-sec="100">1:40</button>
              <button type="button" class="dj-preset-chip" data-comp-sec="120">2:00</button>
            </div>

            <div class="comp-fade-setting" title="종료 직전 자동 페이드아웃 시간(초)">
              <span class="comp-ctrl-label">페이드</span>
              <input type="number" id="comp-fade-input" class="comp-num-input comp-fade-num" min="1" max="15" step="1" value="5" aria-label="페이드아웃 초" />
              <span class="comp-unit">초</span>
            </div>
          </div>
        </section>

        <!-- ══ 2. 메트로놈 (Metronome) 카드 ══ -->
        <section class="dj-tool-card metro-card" id="metro-card" aria-label="메트로놈">
          <div class="dj-tool-header">
            <div class="dj-tool-title-group">
              <button type="button" class="metro-toggle-btn" id="metro-toggle-btn" title="메트로놈 시작/정지 (단축키: M)">
                <span id="metro-toggle-label">⏱️ 메트로놈 ▶</span>
              </button>

              <!-- 4박 시각적 비트 인디케이터 -->
              <div class="metro-beats" id="metro-beats" title="4/4 박자 비트 표시">
                <span class="metro-beat-dot" data-beat="0">1</span>
                <span class="metro-beat-dot" data-beat="1">2</span>
                <span class="metro-beat-dot" data-beat="2">3</span>
                <span class="metro-beat-dot" data-beat="3">4</span>
              </div>
            </div>

            <div class="metro-header-right">
              <span class="bpm-badge" id="metro-tier-badge" title="현재 메트로놈 BPM 속도 구간">~160</span>
              <button type="button" class="dj-mini-btn metro-out-btn" id="metro-output-btn" title="메트로놈 출력 채널 전환 (헤드폰 CUE / 메인 스피커)">🎧 CUE</button>
            </div>
          </div>

          <div class="metro-controls-row">
            <div class="metro-bpm-group">
              <button type="button" class="dj-step-btn" id="metro-minus-5" title="-5 BPM">-5</button>
              <button type="button" class="dj-step-btn" id="metro-minus-1" title="-1 BPM">-1</button>
              <input type="number" id="metro-bpm-input" class="metro-bpm-input" min="40" max="360" step="1" value="140" aria-label="메트로놈 BPM" />
              <span class="comp-unit">BPM</span>
              <button type="button" class="dj-step-btn" id="metro-plus-1" title="+1 BPM">+1</button>
              <button type="button" class="dj-step-btn" id="metro-plus-5" title="+5 BPM">+5</button>
            </div>

            <div class="metro-action-group">
              <button type="button" class="dj-mini-btn metro-tap-btn" id="metro-tap-btn" title="박자에 맞춰 연속 클릭하여 템포 측정">🥁 TAP</button>
              <button type="button" class="dj-mini-btn" id="metro-sync-btn" title="현재 로드된 곡의 BPM으로 동기화">🎵 현재곡</button>
              <select id="metro-mode-select" class="metro-mode-select" title="메트로놈 리듬 스타일">
                <option value="straight">정박 (1-4)</option>
                <option value="swing">스윙 (셔플)</option>
                <option value="backbeat">백비트 (2&4)</option>
              </select>
            </div>
          </div>
        </section>

      </div>
    `;

    // DOM 참조 — 컴핏모드
    this._compCard       = this.container.querySelector('#comp-card');
    this._btnCompMode    = this.container.querySelector('#btn-comp-mode');
    this._compModeLabel  = this.container.querySelector('#comp-mode-label');
    this._compStatusBadge = this.container.querySelector('#comp-status-badge');
    this._compTimerEl    = this.container.querySelector('#comp-timer-display');
    this._compResetBtn   = this.container.querySelector('#comp-reset-btn');
    this._compElapsedEl  = this.container.querySelector('#comp-elapsed-label');
    this._compTargetEl   = this.container.querySelector('#comp-target-label');
    this._compBarEl      = this.container.querySelector('#comp-progress-bar');
    this._compFillEl     = this.container.querySelector('#comp-progress-fill');
    this._compFadeZoneEl = this.container.querySelector('#comp-fade-zone');
    this._compMinInput   = this.container.querySelector('#comp-min-input');
    this._compSecInput   = this.container.querySelector('#comp-sec-input');
    this._compFadeInput  = this.container.querySelector('#comp-fade-input');
    this._compPresetBtns = Array.from(this.container.querySelectorAll('[data-comp-sec]'));

    // DOM 참조 — 메트로놈
    this._metroCard      = this.container.querySelector('#metro-card');
    this._metroToggleBtn = this.container.querySelector('#metro-toggle-btn');
    this._metroToggleLbl = this.container.querySelector('#metro-toggle-label');
    this._metroBeatDots  = Array.from(this.container.querySelectorAll('.metro-beat-dot'));
    this._metroTierBadge = this.container.querySelector('#metro-tier-badge');
    this._metroOutBtn    = this.container.querySelector('#metro-output-btn');
    this._metroBpmInput  = this.container.querySelector('#metro-bpm-input');
    this._metroTapBtn    = this.container.querySelector('#metro-tap-btn');
    this._metroSyncBtn   = this.container.querySelector('#metro-sync-btn');
    this._metroModeSel   = this.container.querySelector('#metro-mode-select');

    this._bindCompEvents();
    this._bindMetroEvents();
    this._syncCompUI();
    this._syncMetroUI();
  }

  /* ═══════════════════════════════════════════════════════
     1. 컴핏모드 (Competition Mode) 로직
     ═══════════════════════════════════════════════════════ */
  _bindCompEvents() {
    this._btnCompMode.addEventListener('click', () => {
      this.setCompMode(!this.compMode, true);
    });

    this._compResetBtn.addEventListener('click', () => {
      this.resetCompTimer(true);
    });

    const applyMinSecInputs = () => {
      const m = Math.max(0, Math.min(15, parseInt(this._compMinInput.value, 10) || 0));
      const s = Math.max(0, Math.min(59, parseInt(this._compSecInput.value, 10) || 0));
      const total = Math.max(10, m * 60 + s);
      this.setCompDuration(total, true);
    };

    this._compMinInput.addEventListener('change', applyMinSecInputs);
    this._compSecInput.addEventListener('change', applyMinSecInputs);

    this.container.querySelector('#comp-minus-10').addEventListener('click', () => {
      this.setCompDuration(this.compDurationSec - 10, true);
    });
    this.container.querySelector('#comp-minus-5').addEventListener('click', () => {
      this.setCompDuration(this.compDurationSec - 5, true);
    });
    this.container.querySelector('#comp-plus-5').addEventListener('click', () => {
      this.setCompDuration(this.compDurationSec + 5, true);
    });
    this.container.querySelector('#comp-plus-10').addEventListener('click', () => {
      this.setCompDuration(this.compDurationSec + 10, true);
    });

    this._compPresetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = parseInt(btn.dataset.compSec, 10);
        if (isFinite(sec)) this.setCompDuration(sec, true);
      });
    });

    this._compFadeInput.addEventListener('change', () => {
      const f = Math.max(1, Math.min(15, parseInt(this._compFadeInput.value, 10) || 5));
      this.setCompFadeSec(f, true);
    });

    // 컴핏 진행 바 클릭 시 해당 경과 시간으로 이동 (테스트 및 현장 수동 조절 지원)
    this._compBarEl.addEventListener('pointerdown', (e) => {
      const rect = this._compBarEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.seekCompTimer(ratio * this.compDurationSec);
    });
  }

  setCompMode(enabled, notify = false) {
    this.compMode = Boolean(enabled);
    if (!this.compMode && this._compFading) {
      this.engine.cancelMainFade(true);
      this._compFading = false;
    }
    if (this.compMode) {
      this._compFinished = false;
      if (this.player.isPlaying) {
        this._startCompLoop();
      }
    } else {
      this._stopCompLoop();
    }
    this._syncCompUI();

    if (notify) {
      showToast(
        this.compMode
          ? `🏆 컴핏모드 ON (${formatTime(this.compDurationSec)} · 마지막 ${this.compFadeSec}초 페이드아웃)`
          : '컴핏모드 OFF'
      );
      this.onSettingsChange?.({
        compMode: this.compMode,
        compDurationSec: this.compDurationSec,
        compFadeSec: this.compFadeSec,
      });
    }
  }

  setCompDuration(seconds, notify = false) {
    const clamped = Math.max(10, Math.min(900, Math.round(Number(seconds) || 100)));
    this.compDurationSec = clamped;
    if (this.compFadeSec >= clamped) {
      this.compFadeSec = Math.max(1, Math.min(5, Math.floor(clamped / 3)));
    }
    if (this._compElapsedSec > clamped) {
      this._compElapsedSec = 0;
    }
    this._compFinished = false;
    this._syncCompUI();

    if (notify) {
      showToast(`컴핏 지정 시간: ${formatTime(this.compDurationSec)} (마지막 ${this.compFadeSec}초 페이드)`);
      this.onSettingsChange?.({
        compMode: this.compMode,
        compDurationSec: this.compDurationSec,
        compFadeSec: this.compFadeSec,
      });
    }
  }

  setCompFadeSec(fadeSec, notify = false) {
    const maxAllowed = Math.max(1, Math.min(15, this.compDurationSec - 2));
    this.compFadeSec = Math.max(1, Math.min(maxAllowed, Math.round(Number(fadeSec) || 5)));
    this._syncCompUI();

    if (notify) {
      showToast(`컴핏 마지막 ${this.compFadeSec}초 페이드아웃 설정됨`);
      this.onSettingsChange?.({
        compMode: this.compMode,
        compDurationSec: this.compDurationSec,
        compFadeSec: this.compFadeSec,
      });
    }
  }

  resetCompTimer(notify = false) {
    this._compElapsedSec = 0;
    this._compFinished   = false;
    if (this._compFading) {
      this.engine.cancelMainFade(true);
      this._compFading = false;
    }
    this._lastTickTime = performance.now();
    this._syncCompUI();
    if (notify) {
      showToast(`컴핏 타이머 리셋 (${formatTime(this.compDurationSec)})`);
    }
  }

  seekCompTimer(elapsedSec) {
    const target = Math.max(0, Math.min(this.compDurationSec, Number(elapsedSec) || 0));
    this._compElapsedSec = target;
    this._compFinished = false;
    const remaining = this.compDurationSec - this._compElapsedSec;
    if (remaining > this.compFadeSec && this._compFading) {
      this.engine.cancelMainFade(true);
      this._compFading = false;
    }
    this._lastTickTime = performance.now();
    this._checkCompThresholds();
    this._syncCompUI();
  }

  /** 메인 플레이어 재생/일시정지 상태 변경 시 호출 */
  notifyPlayerStateChange() {
    if (this.player.isPlaying && this.compMode) {
      if (this._compFinished || this._compElapsedSec >= this.compDurationSec - 0.05) {
        this._compElapsedSec = 0;
        this._compFinished = false;
        this._compFading = false;
      }
      this._startCompLoop();
    } else {
      this._stopCompLoop();
      if (!this.player.isPlaying && this._compFading) {
        this._compFading = false;
        this.engine.restoreMainVolume();
      }
    }
    this._syncCompUI();
  }

  /** 새 트랙 로드 시 컴핏 타이머 자동 리셋 */
  notifyTrackLoaded() {
    this.resetCompTimer(false);
  }

  _startCompLoop() {
    if (this._rafId) return;
    this._lastTickTime = performance.now();
    const tick = (now) => {
      if (!this.compMode || !this.player.isPlaying) {
        this._rafId = null;
        this._syncCompUI();
        return;
      }
      const dt = Math.max(0, Math.min(0.25, (now - (this._lastTickTime ?? now)) / 1000));
      this._lastTickTime = now;
      this._compElapsedSec = Math.min(this.compDurationSec, this._compElapsedSec + dt);

      this._checkCompThresholds();
      this._syncCompUI();

      if (this.compMode && this.player.isPlaying && !this._compFinished) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = null;
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopCompLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastTickTime = null;
  }

  _checkCompThresholds() {
    if (!this.compMode || !this.player.isPlaying) return;
    const remaining = Math.max(0, this.compDurationSec - this._compElapsedSec);

    // 1) 타이머 종료 도달 (0초) → 즉시 정지 & 볼륨 복구
    if (remaining <= 0.02) {
      this._compElapsedSec = this.compDurationSec;
      this._compFinished   = true;
      this._compFading     = false;
      this.engine.cancelMainFade(false);
      this.player.pause();
      this.engine.restoreMainVolume();
      showToast(`🏆 컴핏 타이머 종료 (${formatTime(this.compDurationSec)}) — 자동 정지됨`);
      this.onStatusChange?.(`🏆 컴핏 라운드 종료 (${formatTime(this.compDurationSec)})`);
      this.onCompEnded?.();
      return;
    }

    // 2) 마지막 N초(기본 5초) 진입 → 자동 페이드아웃 시작
    if (remaining <= this.compFadeSec && !this._compFading) {
      this._compFading = true;
      this.engine.startMainFadeOut(remaining, null);
      showToast(`🔉 컴핏 마지막 ${Math.ceil(remaining)}초 페이드아웃 시작`);
      this.onStatusChange?.(`🏆 컴핏 페이드아웃 중 (${Math.ceil(remaining)}초 남음): ${this.player.currentTrack?.name ?? ''}`);
    }
  }

  _syncCompUI() {
    if (!this._compCard) return;
    const remaining = Math.max(0, this.compDurationSec - this._compElapsedSec);
    const remMin = Math.floor(remaining / 60);
    const remSec = Math.ceil(remaining % 60);
    const normMin = remSec === 60 ? remMin + 1 : remMin;
    const normSec = remSec === 60 ? 0 : remSec;

    this._compCard.classList.toggle('comp-active', this.compMode);
    this._compCard.classList.toggle('comp-fading', this.compMode && this._compFading);
    this._btnCompMode.classList.toggle('active', this.compMode);
    this._compModeLabel.textContent = this.compMode ? '🏆 컴핏모드 ON' : '🏆 컴핏모드 OFF';

    this._compTimerEl.textContent = `${String(normMin).padStart(2, '0')}:${String(normSec).padStart(2, '0')}`;
    this._compTimerEl.classList.toggle('fading', this.compMode && this._compFading);

    // 상태 배지
    if (!this.compMode) {
      this._compStatusBadge.textContent = `대기 (${formatTime(this.compDurationSec)} · ${this.compFadeSec}초 페이드)`;
    } else if (this._compFinished) {
      this._compStatusBadge.textContent = `🏁 라운드 종료 (${formatTime(this.compDurationSec)})`;
    } else if (this._compFading) {
      this._compStatusBadge.textContent = `🔉 마지막 ${this.compFadeSec}초 페이드아웃 중…`;
    } else if (this.player.isPlaying) {
      this._compStatusBadge.textContent = `⏱️ 라운드 진행 중 (${this.compFadeSec}초 전 페이드)`;
    } else {
      this._compStatusBadge.textContent = `⏸ 준비 완료 (재생 시 카운트다운)`;
    }

    // 진행 바
    const pct = this.compDurationSec > 0
      ? Math.min(100, (this._compElapsedSec / this.compDurationSec) * 100)
      : 0;
    const fadePct = this.compDurationSec > 0
      ? Math.min(100, (this.compFadeSec / this.compDurationSec) * 100)
      : 5;

    this._compFillEl.style.width     = `${pct.toFixed(2)}%`;
    this._compFadeZoneEl.style.width = `${fadePct.toFixed(2)}%`;
    this._compElapsedEl.textContent  = formatTime(this._compElapsedSec);
    this._compTargetEl.textContent   = formatTime(this.compDurationSec);

    // 입력 필드 동기화 (포커스 중이 아닐 때만)
    const targetMin = Math.floor(this.compDurationSec / 60);
    const targetSec = this.compDurationSec % 60;
    if (document.activeElement !== this._compMinInput) {
      this._compMinInput.value = String(targetMin);
    }
    if (document.activeElement !== this._compSecInput) {
      this._compSecInput.value = String(targetSec);
    }
    if (document.activeElement !== this._compFadeInput) {
      this._compFadeInput.value = String(this.compFadeSec);
    }

    // 프리셋 버튼 활성화 표시
    this._compPresetBtns.forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.compSec, 10) === this.compDurationSec);
    });
  }

  /* ═══════════════════════════════════════════════════════
     2. 메트로놈 (Metronome) 로직
     ═══════════════════════════════════════════════════════ */
  _bindMetroEvents() {
    this._metroToggleBtn.addEventListener('click', () => {
      this.metronome.toggle();
    });

    const changeMetroBPM = (nextBpm) => {
      const applied = this.metronome.setBPM(nextBpm);
      this._syncMetroUI();
      this.onSettingsChange?.({ metronomeBpm: applied });
    };

    this.container.querySelector('#metro-minus-5').addEventListener('click', () => changeMetroBPM(this.metronome.bpm - 5));
    this.container.querySelector('#metro-minus-1').addEventListener('click', () => changeMetroBPM(this.metronome.bpm - 1));
    this.container.querySelector('#metro-plus-1').addEventListener('click',  () => changeMetroBPM(this.metronome.bpm + 1));
    this.container.querySelector('#metro-plus-5').addEventListener('click',  () => changeMetroBPM(this.metronome.bpm + 5));

    this._metroBpmInput.addEventListener('change', () => {
      changeMetroBPM(this._metroBpmInput.value);
    });

    // TAP 템포
    this._metroTapBtn.addEventListener('click', () => {
      const now = performance.now();
      if (this._metroTaps.length > 0 && now - this._metroTaps[this._metroTaps.length - 1] > 2200) {
        this._metroTaps = [];
      }
      this._metroTaps.push(now);
      if (this._metroTaps.length > 8) this._metroTaps.shift();

      if (this._metroTaps.length >= 2) {
        let sum = 0;
        for (let i = 1; i < this._metroTaps.length; i++) {
          sum += this._metroTaps[i] - this._metroTaps[i - 1];
        }
        const avgMs = sum / (this._metroTaps.length - 1);
        const bpm = Math.max(40, Math.min(360, Math.round(60000 / avgMs)));
        changeMetroBPM(bpm);
        this._metroTapBtn.textContent = `🥁 ${bpm}`;
      } else {
        this._metroTapBtn.textContent = '🥁 탭…';
      }
    });

    // 현재곡 BPM 동기화
    this._metroSyncBtn.addEventListener('click', () => {
      const refBpm = this.getReferenceBPM?.();
      if (refBpm) {
        changeMetroBPM(refBpm);
        showToast(`메트로놈 동기화: ${refBpm} BPM`);
      } else {
        showToast('현재 로드된 곡에 감지된 BPM 정보가 없습니다');
      }
    });

    // 리듬 모드 선택
    this._metroModeSel.addEventListener('change', (e) => {
      this.metronome.setMode(e.target.value);
      this.onSettingsChange?.({ metronomeMode: this.metronome.mode });
    });

    // 출력 채널 전환 (🎧 CUE <-> 🔊 MAIN)
    this._metroOutBtn.addEventListener('click', () => {
      const nextOut = this.metronome.output === 'cue' ? 'main' : 'cue';
      this.metronome.setOutput(nextOut);
      this._syncMetroUI();
      showToast(nextOut === 'cue' ? '메트로놈 출력: 🎧 CUE (헤드폰)' : '메트로놈 출력: 🔊 MAIN (스피커)');
      this.onSettingsChange?.({ metronomeOutput: nextOut });
    });

    // 메트로놈 콜백 연결
    this.metronome.onStateChange = () => {
      this._syncMetroUI();
    };

    this.metronome.onBeat = (beatIdx, bpm) => {
      const tier = getBPMTier(bpm);
      this._metroBeatDots.forEach((dot, idx) => {
        const isCurrent = idx === beatIdx;
        dot.classList.toggle('active', isCurrent);
        dot.classList.toggle('accent', isCurrent && beatIdx === 0);
        applyBPMTierClass(dot, isCurrent && tier ? bpm : null);
      });
    };

    // 전역 단축키 ('C': 컴핏모드 토글, 'M': 메트로놈 시작/정지)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        this.setCompMode(!this.compMode, true);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        const playing = this.metronome.toggle();
        showToast(playing ? `⏱️ 메트로놈 시작 (${this.metronome.bpm} BPM)` : '⏱️ 메트로놈 정지');
      }
    });
  }

  _syncMetroUI() {
    if (!this._metroCard) return;
    const isPlaying = this.metronome.isPlaying;
    const bpm = this.metronome.bpm;
    const tier = getBPMTier(bpm);

    this._metroCard.classList.toggle('metro-active', isPlaying);
    this._metroToggleBtn.classList.toggle('active', isPlaying);
    this._metroToggleLbl.textContent = isPlaying ? '⏱️ 메트로놈 ■ 정지' : '⏱️ 메트로놈 ▶ 시작';

    if (!isPlaying) {
      this._metroBeatDots.forEach((dot) => {
        dot.classList.remove('active', 'accent');
        applyBPMTierClass(dot, null);
      });
    }

    if (document.activeElement !== this._metroBpmInput) {
      this._metroBpmInput.value = String(bpm);
    }

    if (tier && this._metroTierBadge) {
      this._metroTierBadge.textContent = tier.label;
      this._metroTierBadge.title = tier.desc;
      applyBPMTierClass(this._metroTierBadge, bpm);
    }

    if (this._metroOutBtn) {
      const isMain = this.metronome.output === 'main';
      this._metroOutBtn.textContent = isMain ? '🔊 MAIN' : '🎧 CUE';
      this._metroOutBtn.classList.toggle('out-main', isMain);
    }

    if (this._metroModeSel) {
      this._metroModeSel.value = this.metronome.mode;
    }
  }

  restoreSettings(settings) {
    if (!settings) return;
    if (settings.compDurationSec != null) this.setCompDuration(settings.compDurationSec, false);
    if (settings.compFadeSec != null)     this.setCompFadeSec(settings.compFadeSec, false);
    if (settings.compMode != null)        this.setCompMode(settings.compMode, false);
    if (settings.metronomeBpm != null)    this.metronome.setBPM(settings.metronomeBpm);
    if (settings.metronomeMode)           this.metronome.setMode(settings.metronomeMode);
    if (settings.metronomeOutput)         this.metronome.setOutput(settings.metronomeOutput);
    this._syncCompUI();
    this._syncMetroUI();
  }
}
