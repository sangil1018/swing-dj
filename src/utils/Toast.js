/**
 * Toast.js — 전역 토스트 알림 유틸리티 (중복 겹침 방지)
 */

let _activeToast = null;
let _hideTimer   = null;
let _removeTimer = null;

export function showToast(msg, duration = 2600) {
  if (!msg) return;

  if (_hideTimer)   { clearTimeout(_hideTimer);   _hideTimer = null; }
  if (_removeTimer) { clearTimeout(_removeTimer); _removeTimer = null; }

  if (!_activeToast || !_activeToast.isConnected) {
    _activeToast = document.createElement('div');
    _activeToast.className = 'toast';
    _activeToast.setAttribute('role', 'status');
    _activeToast.setAttribute('aria-live', 'polite');
    document.body.appendChild(_activeToast);
  }

  _activeToast.textContent = msg;
  // 리플로우를 통해 재등장 피드백 유지
  _activeToast.classList.remove('show');
  void _activeToast.offsetWidth;
  _activeToast.classList.add('show');

  _hideTimer = setTimeout(() => {
    if (_activeToast) {
      _activeToast.classList.remove('show');
      const el = _activeToast;
      _removeTimer = setTimeout(() => {
        if (el && !el.classList.contains('show')) {
          el.remove();
          if (_activeToast === el) _activeToast = null;
        }
      }, 280);
    }
  }, duration);
}
