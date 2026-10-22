import * as C from './core.js';
import { R, S } from './state.js';
import { effSport, paceOrSpeed } from './sport.js';
import { colorAt, colorModel } from './colour.js';
import { inkOn, rr, spacing } from './util.js';
import { FONT_NUM } from './config.js';

/* ------------------------------ distance markers ------------------------------ */
const MI = 1609.344;

let mkCache = { key: '' };

/* markers at a sport-appropriate spacing: each mile or km, every 500 m rowing, every 100 m swimming, or whatever "Marker every" says */
function markerInterval() {
  if (S.markerEvery !== 'auto') return +S.markerEvery;
  const sp = effSport();
  if (sp === 'rowing' || sp === 'paddling') return 500;
  if (sp === 'swimming') return 100;
  return S.units === 'mi' ? MI : 1000;
}

const fmtN = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

function distLabel(dist, iv) {
  if (iv >= 1000) { const v = dist / (S.units === 'mi' ? MI : 1000); return { tag: fmtN(v), title: (S.units === 'mi' ? 'MILE ' : 'KM ') + fmtN(v) }; }
  if (dist >= 1000) { const k = fmtN(Math.round(dist / 100) / 10); return { tag: k + 'k', title: k + ' KM' }; }
  return { tag: String(Math.round(dist)), title: Math.round(dist) + ' M' };
}

function markerModel() {
  const iv = markerInterval(), key = R.trackId + '|' + S.units + '|' + iv; if (mkCache.key === key) return mkCache;
  const g = S.track.grid, M = S.track.M, total = g.d[M - 1];
  let mult = 1; const count = Math.floor(total / iv);
  for (const m of [1, 2, 5, 10, 20, 50, 100]) { mult = m; if (count / m <= 30) break; }
  const items = []; let prevT = 0, k = 1;
  for (let n = mult; n * iv < total - 5; n += mult) {
    const target = n * iv;
    while (k < M - 1 && g.d[k] < target) k++;
    const f = g.d[k] > g.d[k - 1] ? Math.min(1, Math.max(0, (target - g.d[k - 1]) / (g.d[k] - g.d[k - 1]))) : 0;
    const at = (a) => (a ? a[k - 1] + (a[k] - a[k - 1]) * f : null), tt = at(g.t), dt = tt !== null ? tt - prevT : 0;
    items.push({ n, dist: target, label: distLabel(target, iv), p: (k - 1 + f) / (M - 1), lng: at(g.lng), lat: at(g.lat), t: tt, speed: dt > 0 ? (mult * iv) / dt : null, fast: false });
    if (tt !== null) prevT = tt;
  }
  const timed = items.filter((m) => m.speed);
  if (timed.length >= 3) timed.reduce((a, b) => (b.speed > a.speed ? b : a)).fast = true;
  mkCache = { key, items };
  return mkCache;
}

/* callouts need room to breathe: with dense markers, show one only when 3+ seconds have passed (the fastest split always shows) */
let coCache = { key: '' };

export function calloutList() {
  const mk = markerModel(), key = mk.key + '|' + R.planId + '|' + S.duration; if (coCache.key === key) return coCache.list;
  const list = []; let last = -Infinity;
  for (const m of mk.items) { const tau = markerTau(m); if (m.fast || (tau - last) * S.duration >= 3.2) { list.push(m); last = tau; } }
  coCache = { key, list };
  return list;
}

/* the moment (0..1 of the video) the head reaches a marker */
export function markerTau(m) {
  if (m.planId === R.planId) return m.tau;
  let lo = 0, hi = 1;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (C.cameraAt(R.plan, mid).p >= m.p) hi = mid; else lo = mid; }
  m.planId = R.planId; m.tau = hi;
  return hi;
}

export function drawMarkers(ctx, W, H) {
  if (!S.markers || !S.track || !R.frame || !R.map || typeof R.map.project !== 'function') return;
  const mk = markerModel(); if (!mk.items.length) return;
  const u = Math.min(W, H) / 1080, cam = R.frame.cam, cl = cam.center, latR = (cl[1] * Math.PI) / 180;
  const mpp = (78271.517 * Math.cos(latR)) / Math.pow(2, cam.zoom), kx = 111320 * Math.cos(latR), ky = 110574;
  const br = (cam.bearing * Math.PI) / 180, sb = Math.sin(br), cb = Math.cos(br);
  // with a steep tilt, anything well behind the camera would project mirrored onto the screen, so skip it
  const behind = cam.pitch > 25 ? -0.85 * 1.5 * H * Math.sin((cam.pitch * Math.PI) / 180) * mpp : -Infinity;
  const drawn = [];
  for (const m of mk.items) {
    if ((m.lng - cl[0]) * kx * sb + (m.lat - cl[1]) * ky * cb < behind) continue;
    let pt; try { pt = R.map.project([m.lng, m.lat]); } catch (e) { continue; }
    if (!pt || !isFinite(pt.x) || !isFinite(pt.y) || pt.x < -60 || pt.x > W + 60 || pt.y < -60 || pt.y > H + 60) continue;
    drawn.push({ m, x: pt.x, y: pt.y });
  }
  // keep tags off the stats and graph at the bottom of the frame
  const safe = S.safe && Math.abs(W / H - 9 / 16) < 0.02, limit = H - (safe ? H * 0.17 : 54 * u) - 360 * u;
  drawn.sort((a, b) => a.y - b.y); // far to near
  const cm = colorModel(), weight = Math.min(1, Math.max(0, cam.pitch / 60));
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const { m, x, y } of drawn) {
    const sy = Math.min(1, Math.max(0, y / H)), sc = 1 + weight * (0.6 + 0.5 * sy - 1);
    const fade = Math.min(1, Math.max(0, (limit - y) / (70 * u)));
    if (fade <= 0) continue;
    ctx.globalAlpha = fade;
    const passed = R.frame.p >= m.p, col = passed && cm ? colorAt(cm, m.p) : S.color;
    const stem = 38 * u * sc, r = 17 * u * sc, cy = y - stem;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8 * u;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5 * u * sc; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, cy + r); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 5 * u * sc, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fillStyle = passed ? col : '#fff'; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 3 * u * sc; ctx.strokeStyle = passed ? '#fff' : col; ctx.stroke();
    ctx.fillStyle = passed ? inkOn(col) : '#101418';
    const tl = m.label.tag.length;
    ctx.font = '700 ' + (tl > 3 ? 13 : tl > 2 ? 15 : 20) * u * sc + 'px ' + FONT_NUM;
    ctx.fillText(m.label.tag, x, cy + 1 * u * sc);
  }
  ctx.restore();
}

export function drawCallout(ctx, u, xRight, y, m, a, accent) {
  const e = a < 0.25 ? 1 - Math.pow(1 - a / 0.25, 3) : 1, alpha = a > 2.0 ? Math.max(0, 1 - (a - 2.0) / 0.4) : e;
  if (alpha <= 0) return;
  const l1 = m.label.title; let l2 = '';
  if (m.t !== null && m.speed) { const po = paceOrSpeed(m.speed); l2 = C.fmtDuration(m.t) + '    ' + po.value + ' ' + po.unit; }
  const f1 = 44 * u, f2 = 28 * u, f3 = 20 * u, px = 26 * u, py = 18 * u;
  ctx.save(); ctx.globalAlpha = alpha; ctx.shadowBlur = 0; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 ' + f1 + 'px ' + FONT_NUM; const w1 = ctx.measureText(l1).width;
  ctx.font = '600 ' + f2 + 'px ' + FONT_NUM; const w2 = l2 ? ctx.measureText(l2).width : 0;
  const w = Math.max(w1, w2, m.fast ? 170 * u : 0) + px * 2 + 8 * u, h = py * 2 + f1 * 0.78 + (l2 ? f2 + 6 * u : 0) + (m.fast ? f3 + 10 * u : 0);
  const x = xRight - w + (1 - e) * 60 * u;
  ctx.fillStyle = 'rgba(8,12,16,0.66)'; rr(ctx, x, y, w, h, 14 * u); ctx.fill();
  ctx.fillStyle = accent; rr(ctx, x, y, 8 * u, h, 4 * u); ctx.fill();
  let ty = y + py + f1 * 0.78;
  ctx.fillStyle = '#fff'; ctx.font = '700 ' + f1 + 'px ' + FONT_NUM; ctx.fillText(l1, x + px + 8 * u, ty);
  if (l2) { ty += f2 + 6 * u; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '600 ' + f2 + 'px ' + FONT_NUM; ctx.fillText(l2, x + px + 8 * u, ty); }
  if (m.fast) { ty += f3 + 10 * u; spacing(ctx, '0.14em'); ctx.fillStyle = accent; ctx.font = '700 ' + f3 + 'px ' + FONT_NUM; ctx.fillText('FASTEST SPLIT', x + px + 8 * u, ty); spacing(ctx, '0px'); }
  ctx.restore();
}
