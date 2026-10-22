import * as C from './core.js';
import { S } from './state.js';

/* ------------------------------ overlay ------------------------------ */
/* ------------------------------ sport and pace ------------------------------ */
export const SPORTS = [['auto', 'Auto'], ['running', 'Run'], ['cycling', 'Ride'], ['rowing', 'Row'], ['paddling', 'Paddle'], ['swimming', 'Swim'], ['walking', 'Walk'], ['hiking', 'Hike'], ['other', 'Other']];

export const SPORT_NAME = Object.fromEntries(SPORTS);

export const effSport = () => (S.sport !== 'auto' ? S.sport : (S.track && S.track.meta.sport) || 'other');

/* how pace is written: per mile or km on foot, per 500 m rowing and paddling, per 100 m swimming, speed for rides */
export function paceSpec() {
  const sp = effSport(), u = S.units;
  if (sp === 'rowing' || sp === 'paddling') return { pace: true, base: 500, unit: '/500m', label: 'Split', tenths: true };
  if (sp === 'swimming') return { pace: true, base: 100, unit: '/100m', label: 'Pace' };
  if (sp === 'cycling') return { pace: false };
  const foot = sp === 'running' || sp === 'walking' || sp === 'hiking' || !(S.track && S.track.meta.avgSpeed > 4.2);
  return foot ? { pace: true, base: u === 'mi' ? 1609.344 : 1000, unit: C.paceUnit(u), label: 'Pace' } : { pace: false };
}

export function fmtPaceSpec(ps, mps) {
  if (!(mps > 0.2)) return '–';
  const sec = ps.base / mps; if (sec > 5999) return '–';
  if (ps.tenths) { const t = Math.round(sec * 10) / 10, m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0'); }
  const r = Math.round(sec); return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0');
}

export function paceOrSpeed(mps) {
  const ps = paceSpec();
  return ps.pace ? { value: fmtPaceSpec(ps, mps), unit: ps.unit, label: ps.label } : { value: C.fmtSpeed(mps, S.units), unit: C.speedUnit(S.units), label: 'Speed' };
}

export function statItems(head) {
  const t = S.track, u = S.units, m = t.meta, it = [];
  if (S.stats.dist) it.push({ k: 'dist', label: 'Distance', value: C.fmtDistance(head.d, u), unit: C.distUnit(u) });
  if (S.stats.time && m.hasTime) it.push({ k: 'time', label: 'Time', value: C.fmtDuration(head.t), unit: '' });
  if (S.stats.pace && head.spd !== null) {
    const po = paceOrSpeed(head.spd);
    it.push({ k: po.label.toLowerCase(), label: po.label, value: po.value, unit: po.unit });
  }
  if (S.stats.gain && m.hasEle) it.push({ k: 'gain', label: 'Elev gain', value: C.fmtElev(head.gain, u), unit: C.elevUnit(u) });
  if (S.stats.hr && m.hasHr) it.push({ k: 'hr', label: 'Heart rate', value: String(Math.round(head.hr)), unit: 'bpm' });
  if (S.stats.power && m.hasPower) it.push({ k: 'pwr', label: 'Power', value: String(Math.round(head.pwr)), unit: 'W' });
  return it;
}
