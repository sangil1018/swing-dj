/**
 * DeviceSelector.js — 오디오 출력 장치 선택 UI
 * navigator.mediaDevices.enumerateDevices() + AudioContext.setSinkId()
 */
import { showToast } from '../utils/Toast.js';

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
      const ok = await this.engine.setMainDevice(mainSelectEl.value);
      if (!ok) {
        mainSelectEl.value = 'default';
        showToast('메인 출력 장치 전환에 실패하여 기본 장치로 유지합니다');
      }
    });

    cueSelectEl.addEventListener('change', async (e) => {
      if (e.target.value === 'request_permission') {
        await this._loadDevices(true);
        return;
      }
      const ok = await this.engine.setCueDevice(cueSelectEl.value);
      if (!ok) {
        cueSelectEl.value = 'default';
        showToast('CUE 출력 장치 전환에 실패하여 기본 장치로 유지합니다');
      }
    });

    // 장치 연결/해제 감지
    navigator.mediaDevices?.addEventListener('devicechange', async () => {
      const prevMain = this._mainSel?.value;
      const prevCue  = this._cueSel?.value;
      await this._loadDevices(false);

      if (prevMain && prevMain !== 'default' && this._mainSel?.value === 'default') {
        await this.engine.setMainDevice('default');
        showToast('메인 출력 장치가 해제되어 시스템 기본으로 전환되었습니다');
      }
      if (prevCue && prevCue !== 'default' && this._cueSel?.value === 'default') {
        await this.engine.setCueDevice('default');
        showToast('CUE 출력 장치가 해제되어 시스템 기본으로 전환되었습니다');
      }
    });
  }

  async _loadDevices(requestPermission = false) {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      let all = await navigator.mediaDevices.enumerateDevices();
      let outputs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');

      // 라벨이 없으면 (권한 미부여 상태)
      const allOutputs = all.filter((d) => d.kind === 'audiooutput');
      if (allOutputs.length > 0 && !allOutputs[0].label && requestPermission) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop()); // 즉시 종료
          all = await navigator.mediaDevices.enumerateDevices();
          outputs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
          showToast('오디오 장치 이름을 불러왔습니다');
        } catch (err) {
          console.warn('Audio permission denied for device labels', err);
          showToast('장치 이름 표시를 위해 브라우저 권한 허용이 필요합니다');
        }
      }

      this.devices = outputs;
      this._renderOptions(allOutputs.length > 0 && !allOutputs[0].label);
    } catch (e) {
      console.warn('DeviceSelector: enumerateDevices failed', e);
    }
  }

  _renderOptions(needsPermission = false) {
    [this._mainSel, this._cueSel].forEach((sel, i) => {
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = '';

      const defaultOpt = document.createElement('option');
      defaultOpt.value = 'default';
      defaultOpt.textContent = i === 0 ? '🔊 시스템 기본 출력 (메인)' : '🎧 시스템 기본 출력 (큐)';
      sel.appendChild(defaultOpt);

      this.devices.forEach((dev) => {
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

      // 이전 선택 복원 (연결 해제 시 기본값 폴백)
      if (current && current !== 'request_permission' && [...sel.options].some((o) => o.value === current)) {
        sel.value = current;
      } else {
        sel.value = 'default';
      }
    });
  }

  /* 저장된 장치 ID 안전 복원 (장치가 분리되어 있으면 기본 장치 유지) */
  async restoreDevices(mainId, cueId) {
    if (this._mainSel) {
      const hasMain = mainId && [...this._mainSel.options].some((o) => o.value === mainId);
      const targetMain = hasMain ? mainId : 'default';
      this._mainSel.value = targetMain;
      if (targetMain !== 'default' && targetMain !== 'request_permission') {
        await this.engine.setMainDevice(targetMain);
      }
    }
    if (this._cueSel) {
      const hasCue = cueId && [...this._cueSel.options].some((o) => o.value === cueId);
      const targetCue = hasCue ? cueId : 'default';
      this._cueSel.value = targetCue;
      if (targetCue !== 'default' && targetCue !== 'request_permission') {
        await this.engine.setCueDevice(targetCue);
      }
    }
  }
}
