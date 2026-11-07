/**
 * BPMTier.js — 스윙 재즈 BPM 속도별 7단계 색상 구분 유틸리티
 *
 * 구간:
 *  1) ~160     (Slow / Groove)
 *  2) 160~180  (Medium Slow)
 *  3) 180~200  (Medium)
 *  4) 200~230  (Medium Fast)
 *  5) 230~260  (Fast)
 *  6) 260~300  (Very Fast / Balboa)
 *  7) 300~     (Extreme / Fast Jam)
 */

export const BPM_TIERS = [
  { id: 't1', className: 'bpm-tier-1', label: '~160',    desc: '~160 BPM (Slow / Groove)',       min: 0,   max: 160 },
  { id: 't2', className: 'bpm-tier-2', label: '160~180', desc: '160~180 BPM (Medium Slow)',      min: 160, max: 180 },
  { id: 't3', className: 'bpm-tier-3', label: '180~200', desc: '180~200 BPM (Medium)',           min: 180, max: 200 },
  { id: 't4', className: 'bpm-tier-4', label: '200~230', desc: '200~230 BPM (Medium Fast)',      min: 200, max: 230 },
  { id: 't5', className: 'bpm-tier-5', label: '230~260', desc: '230~260 BPM (Fast)',             min: 230, max: 260 },
  { id: 't6', className: 'bpm-tier-6', label: '260~300', desc: '260~300 BPM (Very Fast)',        min: 260, max: 300 },
  { id: 't7', className: 'bpm-tier-7', label: '300~',    desc: '300~ BPM (Extreme / Fast Jam)',  min: 300, max: Infinity },
];

export const BPM_TIER_CLASSES = BPM_TIERS.map((t) => t.className);

/**
 * 주어진 BPM 값에 해당하는 속도 구간 객체 반환
 * (~160: <160, 160~180: 160<=bpm<180, ..., 300~: >=300)
 */
export function getBPMTier(bpm) {
  const n = Number(bpm);
  if (!isFinite(n) || n <= 0) return null;
  if (n < 160) return BPM_TIERS[0];
  if (n < 180) return BPM_TIERS[1];
  if (n < 200) return BPM_TIERS[2];
  if (n < 230) return BPM_TIERS[3];
  if (n < 260) return BPM_TIERS[4];
  if (n < 300) return BPM_TIERS[5];
  return BPM_TIERS[6];
}

/**
 * 주어진 BPM 값에 해당하는 CSS 클래스명 반환
 */
export function getBPMTierClass(bpm) {
  const tier = getBPMTier(bpm);
  return tier ? tier.className : '';
}

/**
 * DOM 엘리먼트에 BPM 구간 색상 클래스 적용
 */
export function applyBPMTierClass(el, bpm) {
  if (!el) return;
  el.classList.remove(...BPM_TIER_CLASSES);
  const cls = getBPMTierClass(bpm);
  if (cls) el.classList.add(cls);
}

/**
 * 트랙의 BPM이 특정 tierId('t1'~'t7') 구간에 속하는지 판별
 */
export function matchesBPMTier(bpm, tierId) {
  if (!tierId) return true;
  const tier = getBPMTier(bpm);
  return tier ? tier.id === tierId : false;
}
