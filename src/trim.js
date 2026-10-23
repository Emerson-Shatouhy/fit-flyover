import * as C from './core.js';
import { R, S, dims, view } from './state.js';
import { $, rr, spacing } from './util.js';
import { setPlaying, updateTransport } from './playback.js';
import { EMPTY_FC, EMPTY_PT, applyRouteColor, styleUp } from './map.js';
import { applyFrame } from './frames.js';
import { composite } from './hud.js';
import { segCoords } from './colour.js';
import { FONT_NUM } from './config.js';
import { setStatus, setTrack } from './activity.js';
import { detectRace } from './autotrim.js';

/* ------------------------------ trim ------------------------------ */
let trimTimer = 0;

const hasT = (p) => p.t !== null && p.t !== undefined && isFinite(p.t);

function rawSpan() {
  // seconds of timestamped activity; without timestamps assume roughly one point per second
  let t0 = null, t1 = null;
  for (const p of R.raw.points) if (hasT(p)) { if (t0 === null) t0 = p.t; t1 = p.t; }
  return t0 !== null && t1 > t0 ? { t0, t1, secs: (t1 - t0) / 1000, timed: true } : { secs: R.raw.points.length, timed: false };
}

function trimmedParsed() {
  const sp = rawSpan(), pts = R.raw.points;
  if (sp.timed) {
    const a = sp.t0 + S.trimStart * 1000, b = sp.t1 - S.trimEnd * 1000;
    return Object.assign({}, R.raw, { points: pts.filter((p) => !hasT(p) || (p.t >= a && p.t <= b)) });
  }
  return Object.assign({}, R.raw, { points: pts.slice(S.trimStart, Math.max(S.trimStart + 2, pts.length - S.trimEnd)) });
}

export function adoptRaw(parsed) {
  R.raw = parsed; R.fullTrack = null; S.trimStart = 0; S.trimEnd = 0;
  const max = Math.max(1, Math.floor(rawSpan().secs * 0.9));
  for (const id of ['trimStart', 'trimEnd']) { $('#' + id).max = max; $('#' + id).step = max > 1800 ? 5 : 1; $('#' + id)._sync(); }
  updateTrimNote();
  return parsed;
}

/* seconds from the start of the file -> progress p (0..1) along the full course */
function trimOff() { const sp = rawSpan(); return sp.timed && R.fullTrack.meta.startTime != null ? (R.fullTrack.meta.startTime - sp.t0) / 1000 : 0; }

function timeToP(sec) {
  const g = R.fullTrack.grid, M = R.fullTrack.M;
  if (!g.t) return Math.min(1, Math.max(0, sec / rawSpan().secs));
  const t = sec - trimOff();
  if (t <= g.t[0]) return 0; if (t >= g.t[M - 1]) return 1;
  let lo = 0, hi = M - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g.t[mid] <= t) lo = mid; else hi = mid; }
  return (lo + (t - g.t[lo]) / Math.max(1e-9, g.t[hi] - g.t[lo])) / (M - 1);
}

/* where the two cut points fall on the full course, in time and distance */
function trimInfo() {
  const T = rawSpan().secs, a = S.trimStart, b = T - S.trimEnd;
  return { a, b, T, da: C.sampleTrack(R.fullTrack, timeToP(a)).d, db: C.sampleTrack(R.fullTrack, timeToP(b)).d };
}

const fmtDist = (m) => C.fmtDistance(m, S.units) + ' ' + C.distUnit(S.units);

function updateTrimNote() {
  if (!R.raw) return;
  const T = rawSpan().secs, trimmed = S.trimStart || S.trimEnd;
  if (R.fullTrack && trimmed) { const i = trimInfo(); $('#trimNote').textContent = 'Keeping ' + C.fmtDuration(i.a) + ' to ' + C.fmtDuration(i.b) + ' (' + fmtDist(i.da) + ' to ' + fmtDist(i.db) + ') of ' + C.fmtDuration(T); }
  else $('#trimNote').textContent = 'Drag a slider, or the START and END handles on the preview, to choose where it begins and ends.';
  $('#trimBox').hidden = false;
}

/* Trim view: playback stops and the map shows the whole course, with the kept part lit and the cut parts faint.
   Dragging only moves the lit section and the flags (cheap); the real trimmed track is rebuilt a moment after you stop. */
const lineFeat = (c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });

const endsFeat = (c) => ({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: c[0] } },
  { type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: c[c.length - 1] } } ] });

export function enterTrimView() {
  if (!S.track || !R.fullTrack || S.exporting || S.trimView) return;
  S.trimView = true; setPlaying(false); view.style.touchAction = 'none'; applyTrimView();
}

export function exitTrimView(play) {
  if (!S.trimView) return;
  S.trimView = false; view.style.touchAction = ''; view.style.cursor = '';
  if (R.map && S.track) {
    const c = S.track.line.coords;
    R.map.getSource('route-full').setData(lineFeat(c)); R.map.getSource('ends').setData(endsFeat(c));
    applyRouteColor(); applyFrame(S.tau);
  }
  if (play) setPlaying(true);
}

export function applyTrimView() {
  if (!R.map || !R.fullTrack || !S.track) { composite(); return; }
  const { W, H } = dims(), b = R.fullTrack.bounds, la = (R.fullTrack.lat0 * Math.PI) / 180;
  const wM = Math.max(60, (b.e - b.w) * 111320 * Math.cos(la)), hM = Math.max(60, (b.n - b.s) * 110574);
  const padT = H * 0.14, padB = H * 0.34, mpp = Math.max(wM / (W * 0.78), hM / ((H - padT - padB) * 0.84));
  R.map.jumpTo({ center: [(b.w + b.e) / 2, (b.s + b.n) / 2], zoom: Math.min(17, Math.log2((78271.517 * Math.cos(la)) / mpp)), bearing: 0, pitch: 0, padding: { top: padT, bottom: padB, left: 0, right: 0 } });
  if (styleUp()) { R.map.setLayoutProperty('prog', 'visibility', 'visible'); R.map.setLayoutProperty('prog-seg', 'visibility', 'none'); }
  R.map.getSource('route-full').setData(lineFeat(R.fullTrack.line.coords));
  R.map.getSource('route-seg').setData(EMPTY_FC);
  R.map.getSource('head').setData(EMPTY_PT);
  applyTrimLive();
  updateTransport();
}

function trimPoints() {
  const T = rawSpan().secs, pa = timeToP(S.trimStart), pb = Math.max(pa + 1e-4, timeToP(T - S.trimEnd));
  return { pa, pb, A: C.sampleTrack(R.fullTrack, pa), B: C.sampleTrack(R.fullTrack, pb) };
}

function applyTrimLive() {
  if (!S.trimView || !R.map || !R.fullTrack) return;
  const { pa, pb, A, B } = trimPoints(), L = R.fullTrack.L;
  R.map.getSource('route-done').setData(lineFeat(segCoords(R.fullTrack.line, pa * L, Math.max(pa * L + 1, pb * L))));
  R.map.getSource('ends').setData(endsFeat([[A.lng, A.lat], [B.lng, B.lat]]));
  composite();
}

let liveQueued = false;

function scheduleTrimLive() { if (liveQueued) return; liveQueued = true; requestAnimationFrame(() => { liveQueued = false; applyTrimLive(); }); }

/* the speed-over-time strip with the two draggable handles */
function stripGeom() {
  const W = view.width, H = view.height, u = Math.min(W, H) / 1080, innerW = Math.min(W - 120 * u, 1500 * u);
  const safe = S.safe && Math.abs(W / H - 9 / 16) < 0.02, bot = H - (safe ? H * 0.17 : 54 * u), bottom = bot - 124 * u;
  return { u, x0: (W - innerW) / 2, w: innerW, bot, bottom, top: bottom - 120 * u };
}

let stripCache = { ft: null, n: 0 };

function stripSeries(n) {
  if (stripCache.ft === R.fullTrack && stripCache.n === n) return stripCache;
  const spd = R.fullTrack.grid.spd; if (!spd) { stripCache = { ft: R.fullTrack, n, arr: null }; return stripCache; }
  const T = rawSpan().secs, M = R.fullTrack.M, raw0 = new Float64Array(n), arr = new Float64Array(n);
  for (let i = 0; i < n; i++) { const c = timeToP((T * i) / (n - 1)) * (M - 1), k = Math.min(M - 2, Math.floor(c)); raw0[i] = spd[k] + (spd[k + 1] - spd[k]) * (c - k); }
  for (let i = 0; i < n; i++) { let a = 0, m = 0; for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { a += raw0[j]; m++; } arr[i] = a / m; }
  const sorted = Float64Array.from(arr).sort();
  stripCache = { ft: R.fullTrack, n, arr, max: Math.max(1, sorted[Math.floor(n * 0.98)] * 1.08) };
  return stripCache;
}

export function drawTrimOverlay(ctx, W, H) {
  const info = trimInfo(), sg = stripGeom(), u = sg.u, x0 = sg.x0, innerW = sg.w, T = info.T;
  const safe = S.safe && Math.abs(W / H - 9 / 16) < 0.02, top = safe ? H * 0.085 : 46 * u, bot = sg.bot;
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  let g = ctx.createLinearGradient(0, 0, 0, H * 0.2); g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.2);
  g = ctx.createLinearGradient(0, sg.top - 120 * u, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,0.78)'); g.addColorStop(1, 'rgba(0,0,0,0.88)'); ctx.fillStyle = g; ctx.fillRect(0, sg.top - 120 * u, W, H - sg.top + 120 * u);
  // flags on the map at the two cut points
  const { A, B } = trimPoints();
  for (const [label, pos, col, sec, side] of [['START', A, '#35D07F', info.a, -1], ['END', B, '#FF4D4D', info.b, 1]]) {
    let pt; try { pt = R.map.project([pos.lng, pos.lat]); } catch (e) { continue; }
    if (!pt || !isFinite(pt.x) || !isFinite(pt.y)) continue;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10 * u;
    const txt = label + '  ' + C.fmtDuration(sec); ctx.font = '700 ' + 26 * u + 'px ' + FONT_NUM; spacing(ctx, '0.08em');
    const tw = ctx.measureText(txt).width, bw = tw + 28 * u, bh = 44 * u;
    let bx = side < 0 ? pt.x - bw - 18 * u : pt.x + 18 * u; bx = Math.max(8 * u, Math.min(W - bw - 8 * u, bx));
    const by = Math.max(8 * u, Math.min(H - bh - 8 * u, pt.y - bh - 14 * u));
    ctx.fillStyle = 'rgba(8,12,16,0.82)'; rr(ctx, bx, by, bw, bh, 10 * u); ctx.fill();
    ctx.fillStyle = col; rr(ctx, bx, by, 6 * u, bh, 3 * u); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.fillText(txt, bx + 18 * u, by + bh * 0.68); spacing(ctx, '0px');
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 12 * u, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 4 * u; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  // header
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12 * u; ctx.fillStyle = '#fff';
  ctx.font = '700 ' + 70 * u + 'px ' + FONT_NUM; spacing(ctx, '0.04em'); ctx.fillText('TRIM', x0, top + 56 * u);
  ctx.font = '600 ' + 24 * u + 'px ' + FONT_NUM; spacing(ctx, '0.12em'); ctx.fillStyle = S.color; ctx.fillText('DRAG THE HANDLES · PLAY TO WATCH THE CUT', x0, top + 98 * u); spacing(ctx, '0px');
  // speed over time, with the cut parts dimmed
  ctx.shadowBlur = 0;
  const n = Math.max(40, Math.round(innerW)), ser = stripSeries(n), h = sg.bottom - sg.top;
  const xa = x0 + (innerW * info.a) / T, xb = x0 + (innerW * info.b) / T;
  if (ser.arr) {
    const path = new Path2D(); path.moveTo(x0, sg.bottom);
    for (let i = 0; i < n; i++) path.lineTo(x0 + (innerW * i) / (n - 1), sg.bottom - Math.min(1, ser.arr[i] / ser.max) * h);
    path.lineTo(x0 + innerW, sg.bottom); path.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill(path);
    ctx.save(); ctx.beginPath(); ctx.rect(xa, sg.top - 20 * u, Math.max(0, xb - xa), h + 40 * u); ctx.clip(); ctx.globalAlpha = 0.92; ctx.fillStyle = S.color; ctx.fill(path); ctx.restore();
  } else { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x0, sg.bottom - 6 * u, innerW, 6 * u); ctx.fillStyle = S.color; ctx.fillRect(xa, sg.bottom - 6 * u, Math.max(0, xb - xa), 6 * u); }
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '600 ' + 20 * u + 'px ' + FONT_NUM; spacing(ctx, '0.1em');
  ctx.fillText(ser.arr ? 'SPEED OVER TIME' : 'TIMELINE', x0, sg.bottom + 26 * u); ctx.textAlign = 'right'; ctx.fillText(C.fmtDuration(T), x0 + innerW, sg.bottom + 26 * u); ctx.textAlign = 'left'; spacing(ctx, '0px');
  for (const [x, col, , sec, side] of [[xa, '#35D07F', 'START', info.a, -1], [xb, '#FF4D4D', 'END', info.b, 1]]) {
    ctx.strokeStyle = col; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(x, sg.top - 12 * u); ctx.lineTo(x, sg.bottom + 6 * u); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, sg.top - 12 * u, 15 * u, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 4 * u; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 ' + 28 * u + 'px ' + FONT_NUM;
    const lab = C.fmtDuration(sec), lw = ctx.measureText(lab).width; let sd = side;
    if (sd < 0 && x - 24 * u - lw < 8 * u) sd = 1; else if (sd > 0 && x + 24 * u + lw > W - 8 * u) sd = -1;
    ctx.textAlign = sd < 0 ? 'right' : 'left'; ctx.fillText(lab, x + sd * 24 * u, sg.top - 4 * u); ctx.textAlign = 'left';
  }
  // totals
  const cols = [['START', C.fmtDuration(info.a), fmtDist(info.da)], ['END', C.fmtDuration(info.b), fmtDist(info.db)], ['KEEPING', C.fmtDuration(Math.max(0, info.b - info.a)), fmtDist(Math.max(0, info.db - info.da))]];
  const step = innerW / 3;
  cols.forEach(([lab, v1, v2], i) => {
    const x = x0 + i * step;
    ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = '600 ' + 22 * u + 'px ' + FONT_NUM; spacing(ctx, '0.14em'); ctx.fillText(lab, x, bot - 54 * u); spacing(ctx, '0px');
    ctx.fillStyle = '#fff'; ctx.font = '700 ' + 48 * u + 'px ' + FONT_NUM; ctx.fillText(v1, x, bot);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '500 ' + 22 * u + 'px ' + FONT_NUM; ctx.fillText(v2, x, bot + 26 * u);
  });
  ctx.restore();
}

/* dragging the handles on the preview */
export function bindTrimDrag() {
  let grab = null;
  const toCanvas = (e) => { const r = view.getBoundingClientRect(), k = r.width || view.width; return [((e.clientX - r.left) * view.width) / k, ((e.clientY - r.top) * view.height) / (r.height || view.height)]; };
  const overStrip = (cx, cy) => { const sg = stripGeom(), u = sg.u; return cy > sg.top - 60 * u && cy < sg.bottom + 50 * u && cx > sg.x0 - 36 * u && cx < sg.x0 + sg.w + 36 * u; };
  const move = (cx) => {
    const sg = stripGeom(), T = rawSpan().secs, t = Math.round(Math.min(1, Math.max(0, (cx - sg.x0) / sg.w)) * T), gap = Math.ceil(T * 0.05), cap = Math.floor(T * 0.9);
    if (grab === 'a') S.trimStart = Math.max(0, Math.min(t, T - S.trimEnd - gap, cap));
    else S.trimEnd = Math.max(0, Math.min(T - t, T - S.trimStart - gap, cap));
    $('#trimStart')._sync(); $('#trimEnd')._sync(); updateTrimNote(); scheduleTrimLive(); queueRetrim();
  };
  view.addEventListener('pointerdown', (e) => {
    if (!S.trimView) return;
    const [cx, cy] = toCanvas(e); if (!overStrip(cx, cy)) return;
    const sg = stripGeom(), T = rawSpan().secs, ax = sg.x0 + (sg.w * S.trimStart) / T, bx = sg.x0 + (sg.w * (T - S.trimEnd)) / T;
    grab = Math.abs(cx - ax) <= Math.abs(cx - bx) ? 'a' : 'b';
    try { view.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    e.preventDefault(); move(cx);
  });
  view.addEventListener('pointermove', (e) => {
    if (!S.trimView) return;
    const [cx, cy] = toCanvas(e);
    if (grab) move(cx); else view.style.cursor = overStrip(cx, cy) ? 'ew-resize' : '';
  });
  const end = () => { grab = null; };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
}

export function onTrim(moved) {
  enterTrimView();
  // the two trims share the activity: keep at least 5% of it, giving way on the slider that was not moved
  const T = rawSpan().secs, room = Math.floor(T * 0.95);
  if (S.trimStart + S.trimEnd > room) {
    if (moved === 'trimStart') S.trimEnd = Math.max(0, room - S.trimStart); else S.trimStart = Math.max(0, room - S.trimEnd);
    $('#trimStart')._sync(); $('#trimEnd')._sync();
  }
  updateTrimNote(); scheduleTrimLive(); queueRetrim();
}

/* put the handles on the race: the hardest sustained effort in the file. Always a starting point, the handles still move after. */
export function autoTrim() {
  if (!R.raw || !R.fullTrack || S.exporting) return;
  const sp = rawSpan(), note = $('#trimNote');
  if (!sp.timed) { note.textContent = 'Auto-detect needs timestamps, and this file has none.'; return; }
  const res = detectRace(R.raw.points);
  if (res.confidence === 'none') { note.textContent = res.note; return; }
  const T = sp.secs, step = Math.max(1, +$('#trimStart').step || 1), cap = Math.floor(T * 0.9), room = Math.floor(T * 0.95);
  // snap outward to the slider step so the handle shows exactly what was kept
  S.trimStart = Math.min(cap, Math.floor(res.start / step) * step);
  S.trimEnd = Math.min(cap, Math.floor(Math.max(0, T - res.end) / step) * step);
  if (S.trimStart + S.trimEnd > room) S.trimEnd = Math.max(0, room - S.trimStart);
  $('#trimStart')._sync(); $('#trimEnd')._sync();
  onTrim('trimStart');
  if (res.note) note.textContent = res.note + ' ' + note.textContent;
}

/* the real trimmed track is rebuilt once the handles stop moving */
function queueRetrim() {
  clearTimeout(trimTimer);
  trimTimer = setTimeout(async () => {
    if (!R.raw || S.exporting) return;
    try { await setTrack(C.buildTrack(trimmedParsed()), { retrim: true }); setStatus(''); }
    catch (e) { setStatus('Cannot trim that much: ' + (e.message || e), 'warn'); }
  }, 250);
}
