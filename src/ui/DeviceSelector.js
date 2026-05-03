/**
 * DeviceSelector.js — 오디오 출력 장치 선택 UI
 * navigator.mediaDevices.enumerateDevices() + AudioContext.setSinkId()
 */

export class DeviceSelector {
  constructor(audioEngine) {
    this.engine = audioEngine;
    this.devices = [];
    this._mainSel = null;
    this._cueSel  = null;
  }

  async mount(mainSelectEl, cueSelectEl) {
    this._mainSel = mainSelectEl;
    this._cueSel  = cueSelectEl;

    // 장치 목록 로드 (초기엔 권한 요청 안함)
    await this._loadDevices(false);

    mainSelectEl.addEventListener('change', async (e) => {
      if (e.target.value === 'request_permission') {
        await this._loadDevices(true);
        return;
      }
      await this.engine.setMainDevice(mainSelectEl.value);
    });

    cueSelectEl.addEventListener('change', async (e) => {
      if (e.target.value === 'request_permission') {
        await this._loadDevices(true);
        return;
      }
      await this.engine.setCueDevice(cueSelectEl.value);
    });

    // 장치 변경 감지
    navigator.mediaDevices?.addEventListener('devicechange', () => {
      this._loadDevices(false);
    });
  }

  async _loadDevices(requestPermission = false) {
    try {
      let all = await navigator.mediaDevices.enumerateDevices();
      let outputs = all.filter((d) => d.kind === 'audiooutput');

      // 라벨이 없으면 (권한 미부여 상태)
      if (outputs.length > 0 && !outputs[0].label && requestPermission) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop()); // 즉시 종료
          all = await navigator.mediaDevices.enumerateDevices();
          outputs = all.filter((d) => d.kind === 'audiooutput');
        } catch (err) {
          console.warn('Audio permission denied for device labels', err);
        }
      }

      this.devices = outputs;
      this._renderOptions();
    } catch (e) {
      console.warn('DeviceSelector: enumerateDevices failed', e);
    }
  }

  _renderOptions() {
    [this._mainSel, this._cueSel].forEach((sel, i) => {
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = '';

      const defaultOpt = document.createElement('option');
      defaultOpt.value = 'default';
      defaultOpt.textContent = i === 0 ? '🔊 시스템 기본 출력 (메인)' : '🎧 시스템 기본 출력 (큐)';
      sel.appendChild(defaultOpt);

      let needsPermission = false;
      this.devices.forEach((dev, idx) => {
        if (!dev.label && idx === 0) needsPermission = true;
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `알 수 없는 장치 (${dev.deviceId.slice(0, 5)}…)`;
        sel.appendChild(opt);
      });

      if (needsPermission) {
        const permOpt = document.createElement('option');
        permOpt.value = 'request_permission';
        permOpt.textContent = '🔒 권한 허용하여 장치 이름 보기';
        sel.appendChild(permOpt);
      }

      // 이전 선택 복원
      if (current && [...sel.options].some((o) => o.value === current)) {
        sel.value = current;
      } else if (current === 'request_permission') {
        sel.value = 'default'; // 권한 요청 후에는 기본값으로
      }
    });
  }

  /* 저장된 장치 ID 복원 */
  async restoreDevices(mainId, cueId) {
    if (mainId && this._mainSel) {
      this._mainSel.value = mainId;
      if (mainId !== 'default' && mainId !== 'request_permission') {
        await this.engine.setMainDevice(mainId);
      }
    }
    if (cueId && this._cueSel) {
      this._cueSel.value = cueId;
      if (cueId !== 'default' && cueId !== 'request_permission') {
        await this.engine.setCueDevice(cueId);
      }
    }
  }
}
