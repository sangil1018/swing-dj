/**
 * TimeFormatter.js — 시간 포맷 유틸리티
 */
export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  return formatTime(seconds);
}
