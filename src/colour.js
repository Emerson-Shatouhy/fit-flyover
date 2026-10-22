import * as C from './core.js';
import { R, S } from './state.js';
import { fmtPaceSpec, paceSpec } from './sport.js';

/* ------------------------------ route colouring ------------------------------ */
const RAMP = [[0, [58, 123, 255]], [0.25, [32, 211, 194]], [0.5, [123, 224, 74]], [0.75, [255, 210, 31]], [1, [255, 61, 46]]];

export const LUT = (() => {
  const out = [], hx = (n) => ('0' + Math.round(n).toString(16)).slice(-2);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let k = 0; while (k < RAMP.length - 2 && t > RAMP[k + 1][0]) k++;
    const [t0, c0] = RAMP[k], [t1, c1] = RAMP[k + 1], f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    out.push('#' + [0, 1, 2].map((j) => hx(c0[j] + (c1[j] - c0[j]) * f)).join(''));
  }
  return out;
})();

const COLOR_SMOOTH = { hr: 0.004, pwr: 0.008, spd: 0.008, ele: 0.003 };

const COLOR_MINSPAN = { hr: 15, pwr: 80, spd: 0.6, ele: 20 };

export function colorKey() {
  if (!S.track || S.colorBy === 'solid') return 'solid';
  const m = S.track.meta, ok = { hr: m.hasHr, pwr: m.hasPower, spd: !!S.track.grid.spd, ele: m.hasEle };
  return ok[S.colorBy] ? S.colorBy : 'solid';
}

/* smoothed channel along the route plus a robust low/high range (5th to 95th percentile) so one spike does not flatten the colours */
let cmCache = { key: '' };

export function colorModel() {
  const kind = colorKey(); if (kind === 'solid') return null;
  const key = R.trackId + '|' + kind; if (cmCache.key === key) return cmCache;
  const src = S.track.grid[kind], M = S.track.M, w = Math.max(1, Math.round(M * COLOR_SMOOTH[kind]));
  const pre = new Float64Array(M + 1); for (let k = 0; k < M; k++) pre[k + 1] = pre[k] + src[k];
  const sm = new Float64Array(M);
  for (let k = 0; k < M; k++) { const a = Math.max(0, k - w), b = Math.min(M - 1, k + w); sm[k] = (pre[b + 1] - pre[a]) / (b - a + 1); }
  const sorted = Float64Array.from(sm).sort(), q = (f) => sorted[Math.min(M - 1, Math.max(0, Math.round(f * (M - 1))))];
  let lo = q(0.05), hi = q(0.95);
  if (hi - lo < COLOR_MINSPAN[kind]) { const mid = (lo + hi) / 2; lo = mid - COLOR_MINSPAN[kind] / 2; hi = mid + COLOR_MINSPAN[kind] / 2; }
  cmCache = { key, kind, sm, lo, hi };
  return cmCache;
}

export function colorAt(cm, p) {
  const n = cm.sm.length, c = Math.min(1, Math.max(0, p)) * (n - 1), i = Math.min(n - 2, Math.floor(c)), f = c - i;
  const v = cm.sm[i] + (cm.sm[i + 1] - cm.sm[i]) * f;
  return LUT[Math.round(Math.min(1, Math.max(0, (v - cm.lo) / (cm.hi - cm.lo))) * 255)];
}

export function legendInfo(cm) {
  const u = S.units;
  const f = {
    hr: [(v) => String(Math.round(v)), ' bpm', 'HEART RATE'], pwr: [(v) => String(Math.round(v)), ' W', 'POWER'],
    ele: [(v) => C.fmtElev(v, u), ' ' + C.elevUnit(u), 'ELEVATION'],
    spd: (() => { const ps = paceSpec(); return ps.pace ? [(v) => fmtPaceSpec(ps, v), ' ' + ps.unit, ps.label.toUpperCase()] : [(v) => C.fmtSpeed(v, u), ' ' + C.speedUnit(u), 'SPEED']; })(),
  }[cm.kind];
  return { label: f[2], left: f[0](cm.lo), right: f[0](cm.hi) + f[1] };
}

/* The coloured route is drawn as short coloured pieces that grow with the head (a line gradient would only be 256 steps wide). */
const SEG_N = 200;

let segCache = { key: '' };

const idxAt = (g, s) => { let lo = 0, hi = g.length - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g[mid] <= s) lo = mid; else hi = mid - 1; } return lo; };

function pointAt(line, s) {
  const { coords, g } = line, i = idxAt(g, s), f = g[i + 1] > g[i] ? Math.min(1, Math.max(0, (s - g[i]) / (g[i + 1] - g[i]))) : 0;
  return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f];
}

export function segCoords(line, s0, s1) {
  const out = [pointAt(line, s0)], i0 = idxAt(line.g, s0), i1 = idxAt(line.g, s1);
  for (let k = i0 + 1; k <= i1; k++) if (line.g[k] > s0 && line.g[k] < s1) out.push(line.coords[k]);
  out.push(pointAt(line, s1));
  return out;
}

function segFeatures(cm) {
  const key = R.trackId + '|' + cm.kind; if (segCache.key === key) return segCache;
  const t = S.track, feats = [], cols = [];
  for (let j = 0; j < SEG_N; j++) {
    const c = colorAt(cm, (j + 0.5) / SEG_N); cols.push(c);
    feats.push({ type: 'Feature', properties: { c }, geometry: { type: 'LineString', coordinates: segCoords(t.line, (t.L * j) / SEG_N, (t.L * (j + 1)) / SEG_N) } });
  }
  segCache = { key, feats, cols };
  return segCache;
}

export function updateSegSource(cm, p) {
  const sc = segFeatures(cm), L = S.track.L, s = p * L, w = L / SEG_N, j = Math.min(SEG_N, Math.floor(s / w));
  const out = sc.feats.slice(0, j);
  if (j < SEG_N && s > j * w + 1e-6) out.push({ type: 'Feature', properties: { c: sc.cols[j] }, geometry: { type: 'LineString', coordinates: segCoords(S.track.line, j * w, s) } });
  R.map.getSource('route-seg').setData({ type: 'FeatureCollection', features: out });
}
