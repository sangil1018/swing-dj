/**
 * TimeFormatter.js — 시간 포맷 유틸리티
 */
export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatRemainingTime(current, duration) {
  if (!isFinite(duration) || duration <= 0) return '0:00';
  const rem = Math.max(0, duration - (isFinite(current) ? current : 0));
  return `-${formatTime(rem)}`;
}

export function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '--:--';
  return formatTime(seconds);
}

export function formatSetDuration(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const total = Math.round(totalSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
