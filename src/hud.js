import * as C from './core.js';
import { R, S, vctx, view } from './state.js';
import { statItems } from './sport.js';
import { BASEMAPS, FONT_NUM, FONT_TXT, TERRAIN_CREDIT } from './config.js';
import { $, rr, spacing } from './util.js';
import { LUT, colorAt, colorModel, legendInfo } from './colour.js';
import { calloutList, drawCallout, drawMarkers, markerTau } from './markers.js';
import { drawTrimOverlay } from './trim.js';
import { weatherLine } from './weather.js';

const basemapCredit = () => { const b = BASEMAPS[S.basemap]; return b.vector && !R.vecFail ? b.vcredit : b.credit; };

let layoutCache = { key: '', fs: 0, labelFs: 0 };

/* picks one value size and one label size so every column fits, using the widest values seen along the route */
function statLayout(ctx, items, u, colW) {
  const key = [R.trackId, S.units, view.width, view.height, items.map((i) => i.k).join(',')].join('|');
  if (layoutCache.key === key) return layoutCache;
  const samples = [0.25, 0.5, 0.75, 1].map((p) => statItems(C.sampleTrack(S.track, p)));
  let fs = 84 * u;
  const widest = () => Math.max(...items.map((it, idx) => {
    let w = 0;
    ctx.font = '700 ' + fs + 'px ' + FONT_NUM;
    for (const s of samples) w = Math.max(w, ctx.measureText(s[idx] ? s[idx].value : it.value).width);
    let wu = 0;
    if (it.unit) { ctx.font = '500 ' + fs * 0.4 + 'px ' + FONT_NUM; wu = ctx.measureText(it.unit).width + fs * 0.1; }
    return w + wu;
  }));
  while (fs > 36 * u && widest() > colW) fs -= 2 * u;
  let labelFs = 26 * u;
  const widestLabel = () => { ctx.font = '600 ' + labelFs + 'px ' + FONT_NUM; spacing(ctx, '0.14em'); const w = Math.max(...items.map((it) => ctx.measureText(it.label.toUpperCase()).width)); spacing(ctx, '0px'); return w; };
  while (labelFs > 15 * u && widestLabel() > colW * 0.9) labelFs -= 1 * u;
  layoutCache = { key, fs, labelFs };
  return layoutCache;
}

const GRAPH_META = { ele: { label: 'ELEVATION', unit: '' }, hr: { label: 'HEART RATE', unit: ' bpm' }, pwr: { label: 'POWER', unit: ' W' } };

function graphKey() {
  const m = S.track.meta, ok = { ele: m.hasEle, hr: m.hasHr, pwr: m.hasPower };
  if (S.graph === 'none') return 'none';
  return ok[S.graph] ? S.graph : (m.hasEle ? 'ele' : 'none');
}

/* bins the route into n columns; heart rate and power are averaged over a window so the chart is readable */
let serCache = { key: '' };

function graphSeries(kind, n) {
  const key = R.trackId + '|' + kind + '|' + n;
  if (serCache.key === key) return serCache;
  const src = S.track.grid[kind], M = S.track.M, arr = new Float64Array(n);
  const pre = new Float64Array(M + 1);
  for (let k = 0; k < M; k++) pre[k + 1] = pre[k] + src[k];
  const w = kind === 'ele' ? 0 : Math.max(1, (M / n) * (kind === 'pwr' ? 2.5 : 1.5));
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const c = (i * (M - 1)) / (n - 1), a = Math.max(0, Math.round(c - w)), b = Math.min(M - 1, Math.round(c + w));
    arr[i] = kind === 'ele' ? src[Math.round(c)] : (pre[b + 1] - pre[a]) / (b - a + 1);
    mn = Math.min(mn, arr[i]); mx = Math.max(mx, arr[i]);
  }
  let lo, hi;
  if (kind === 'ele') { lo = S.track.meta.eleMin; hi = S.track.meta.eleMax; const mid = (lo + hi) / 2, half = Math.max(hi - lo, 30) / 2 * 1.12; lo = mid - half; hi = mid + half; }
  else if (kind === 'pwr') { lo = 0; hi = Math.max(mx * 1.1, 100); }
  else { const span = Math.max(mx - mn, 20), pad = span * 0.12, mid = (mx + mn) / 2; lo = mid - span / 2 - pad; hi = mid + span / 2 + pad; }
  serCache = { key, arr, lo, hi, mn, mx };
  return serCache;
}

/* the date and card rule colour: the second colour, or the route colour if none is picked */
const accent2 = () => S.color2 || S.color;

const subtitleText = () => (S.subtitle || '').trim().toUpperCase();

/* sets the font to the largest size at or below `size` (down to `min`) that fits `maxW`; letter spacing must already be set */
function fitFont(ctx, text, weight, size, min, maxW) {
  let f = size; ctx.font = weight + ' ' + f + 'px ' + FONT_NUM;
  while (f > min && ctx.measureText(text).width > maxW) { f -= 1; ctx.font = weight + ' ' + f + 'px ' + FONT_NUM; }
}

function drawHud(ctx, W, H) {
  const t = S.track;
  if (!t || !R.frame) return;
  const u = Math.min(W, H) / 1080;
  const safe = S.safe && Math.abs(W / H - 9 / 16) < 0.02;
  const topInset = safe ? H * 0.085 : 46 * u, botInset = safe ? H * 0.17 : 54 * u;
  const innerW = Math.min(W - 120 * u, 1500 * u), x0 = (W - innerW) / 2;
  const head = R.frame.head, items = statItems(head), cm = colorModel();
  const bottomY = H - botInset;

  let fs = 0, valueBase = bottomY, labelBase = bottomY, statsTop = bottomY, lay = null;
  const colW = items.length ? innerW / items.length - 16 * u : 0;
  if (items.length) {
    lay = statLayout(ctx, items, u, colW); fs = lay.fs;
    valueBase = bottomY; labelBase = valueBase - fs * 0.74 - 16 * u; statsTop = labelBase - 20 * u;
  }
  const gk = graphKey(), profOn = gk !== 'none';
  const profH = 116 * u, profBottom = statsTop - (items.length ? 30 * u : 0), profTop = profBottom - profH;
  const blockTop = (profOn ? profTop : statsTop) - 150 * u;

  ctx.save();
  let g = ctx.createLinearGradient(0, 0, 0, topInset + 240 * u);
  g.addColorStop(0, 'rgba(0,0,0,0.62)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, topInset + 240 * u);
  if (items.length || profOn) {
    g = ctx.createLinearGradient(0, blockTop, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = g; ctx.fillRect(0, blockTop, W, H - blockTop);
  }

  // title and date
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12 * u;
  const title = (S.title || t.meta.name || 'Route Flyover').toUpperCase();
  let tfs = 76 * u;
  ctx.font = '700 ' + tfs + 'px ' + FONT_NUM; spacing(ctx, '0.03em');
  while (tfs > 38 * u && ctx.measureText(title).width > innerW) { tfs -= 2 * u; ctx.font = '700 ' + tfs + 'px ' + FONT_NUM; }
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const ty = topInset + tfs * 0.78;
  ctx.fillText(title, x0, ty);
  if (t.meta.startTime) {
    const d = new Date(t.meta.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    ctx.font = '600 ' + 30 * u + 'px ' + FONT_NUM; spacing(ctx, '0.14em'); ctx.fillStyle = accent2();
    ctx.fillText(d, x0, ty + 44 * u);
  }
  let dateBase = ty + (t.meta.startTime ? 44 * u : 0);
  const wx = weatherLine();
  if (wx && t.meta.startTime) { // the weather sits right under the date
    dateBase += 40 * u; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '600 ' + 28 * u + 'px ' + FONT_NUM; spacing(ctx, '0.12em');
    ctx.fillText(wx, x0, dateBase);
  }
  const sub = subtitleText();
  if (sub) { // the subtitle sits under the date; the legend below makes room for it
    dateBase += 40 * u; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.92)'; spacing(ctx, '0.06em');
    fitFont(ctx, sub, 600, 30 * u, 18 * u, innerW); ctx.fillText(sub, x0, dateBase);
  }
  spacing(ctx, '0px');

  // colour legend
  if (cm && S.legend) {
    const li = legendInfo(cm), ly = dateBase + 42 * u, bw = Math.min(300 * u, innerW * 0.45), bh = 12 * u;
    ctx.shadowBlur = 0;
    ctx.font = '600 ' + 20 * u + 'px ' + FONT_NUM; spacing(ctx, '0.14em'); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'left';
    ctx.fillText(li.label, x0, ly);
    const lg = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
    for (let i = 0; i <= 8; i++) lg.addColorStop(i / 8, LUT[Math.round((i / 8) * 255)]);
    ctx.fillStyle = lg; rr(ctx, x0, ly + 10 * u, bw, bh, bh / 2); ctx.fill();
    ctx.font = '600 ' + 22 * u + 'px ' + FONT_NUM; spacing(ctx, '0.06em'); ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(li.left, x0, ly + 10 * u + bh + 24 * u);
    ctx.textAlign = 'right'; ctx.fillText(li.right, x0 + bw, ly + 10 * u + bh + 24 * u); ctx.textAlign = 'left';
    spacing(ctx, '0px'); ctx.shadowBlur = 12 * u;
  }

  // split callout when the head passes a marker
  if (S.callouts && R.plan) {
    let act = null, aa = 0;
    for (const m of calloutList()) { const a = (S.tau - markerTau(m)) * S.duration; if (a >= 0 && a < 2.4) { act = m; aa = a; } }
    if (act) drawCallout(ctx, u, x0 + innerW, ty + 26 * u, act, aa, cm ? colorAt(cm, act.p) : S.color);
  }

  // graph: elevation, heart rate or power along the route
  if (profOn) {
    const n = Math.max(40, Math.min(360, Math.round(innerW / (3 * u))));
    const ser = graphSeries(gk, n), arr = ser.arr;
    const yOf = (v) => profBottom - ((v - ser.lo) / (ser.hi - ser.lo)) * profH;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([x0 + (innerW * i) / (n - 1), yOf(arr[i])]);
    const fi = Math.min(n - 1.001, Math.max(0, R.frame.p * (n - 1))), i0 = Math.floor(fi);
    const curV = gk === 'ele' ? head.ele : arr[i0] + (arr[i0 + 1] - arr[i0]) * (fi - i0);
    const curX = x0 + innerW * R.frame.p, curY = yOf(curV);
    const path = new Path2D(); path.moveTo(pts[0][0], profBottom);
    for (const p of pts) path.lineTo(p[0], p[1]);
    path.lineTo(pts[n - 1][0], profBottom); path.closePath();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill(path);
    ctx.save(); ctx.beginPath(); ctx.rect(x0 - 2, profTop - 20 * u, curX - x0 + 2, profH + 40 * u); ctx.clip();
    let areaFill = S.color;
    if (cm) { areaFill = ctx.createLinearGradient(x0, 0, x0 + innerW, 0); for (let i = 0; i <= 40; i++) areaFill.addColorStop(i / 40, colorAt(cm, i / 40)); }
    ctx.globalAlpha = 0.9; ctx.fillStyle = areaFill; ctx.fill(path); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5 * u; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(curX, curY, 9 * u, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4 * u; ctx.strokeStyle = cm ? colorAt(cm, R.frame.p) : S.color; ctx.stroke();
    if (gk !== 'ele') {
      const gm = GRAPH_META[gk];
      ctx.font = '600 ' + 22 * u + 'px ' + FONT_NUM; spacing(ctx, '0.14em'); ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.textAlign = 'left'; ctx.fillText(gm.label, x0, profTop - 12 * u);
      spacing(ctx, '0px'); ctx.textAlign = 'right';
      ctx.fillText(Math.round(ser.mn) + ' to ' + Math.round(ser.mx) + gm.unit, x0 + innerW, profTop - 12 * u);
      ctx.textAlign = 'left';
    }
    ctx.shadowBlur = 12 * u;
  }

  // stats row
  if (items.length) {
    const colStep = innerW / items.length;
    items.forEach((it, i) => {
      const x = x0 + i * colStep;
      ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = '600 ' + lay.labelFs + 'px ' + FONT_NUM; spacing(ctx, '0.14em');
      ctx.fillText(it.label.toUpperCase(), x, labelBase); spacing(ctx, '0px');
      ctx.fillStyle = '#fff'; ctx.font = '700 ' + fs + 'px ' + FONT_NUM;
      ctx.fillText(it.value, x, valueBase);
      if (it.unit) {
        const vw = ctx.measureText(it.value.replace(/\d/g, '0')).width; // digits measured as zeros so the unit does not jitter
        ctx.font = '500 ' + fs * 0.4 + 'px ' + FONT_NUM; ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(it.unit, x + vw + fs * 0.1, valueBase);
      }
    });
  }

  ctx.restore();
}

/* the map credit stays on screen the whole time, card or not */
function drawCredit(ctx, W, H) {
  if (!S.credit) return;
  const u = Math.min(W, H) / 1080;
  ctx.save(); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.font = '500 ' + 16 * u + 'px ' + FONT_TXT; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(basemapCredit() + ' · ' + TERRAIN_CREDIT, W - 26 * u, H - 16 * u);
  ctx.restore();
}

/* The intro / finish card: the title and date over the whole route. a = how much of it is showing (0..1). */
function drawCard(ctx, W, H, a) {
  const t = S.track; if (!t) return;
  const u = Math.min(W, H) / 1080;
  const safe = S.safe && Math.abs(W / H - 9 / 16) < 0.02, topInset = safe ? H * 0.085 : 46 * u;
  const innerW = Math.min(W - 120 * u, 1500 * u), cx = W / 2;
  ctx.save();
  ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  g.addColorStop(0, 'rgba(0,0,0,0.66)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.4);
  ctx.translate(0, (a - 1) * 18 * u); // rises a little as it fades in, drops as it fades out
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 16 * u;
  const title = (S.title || t.meta.name || 'Route Flyover').toUpperCase();
  let tfs = 124 * u;
  ctx.font = '700 ' + tfs + 'px ' + FONT_NUM; spacing(ctx, '0.03em');
  while (tfs > 54 * u && ctx.measureText(title).width > innerW) { tfs -= 2 * u; ctx.font = '700 ' + tfs + 'px ' + FONT_NUM; }
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let y = topInset + tfs * 0.8;
  ctx.fillText(title, cx, y);
  spacing(ctx, '0px');
  ctx.shadowBlur = 0; ctx.fillStyle = accent2();
  y += 26 * u; rr(ctx, cx - 56 * u, y, 112 * u, 6 * u, 3 * u); ctx.fill();
  let ly = y + 6 * u;
  const sub = subtitleText();
  if (sub) { // under the rule, in white, with the date after it
    ly += 50 * u; ctx.shadowBlur = 12 * u; ctx.fillStyle = 'rgba(255,255,255,0.95)'; spacing(ctx, '0.08em');
    fitFont(ctx, sub, 600, 46 * u, 24 * u, innerW); ctx.fillText(sub, cx, ly); ly += 6 * u;
  }
  if (t.meta.startTime) {
    const d = new Date(t.meta.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    ly += 46 * u; ctx.shadowBlur = 12 * u; ctx.fillStyle = accent2(); ctx.font = '600 ' + 38 * u + 'px ' + FONT_NUM; spacing(ctx, '0.16em');
    ctx.fillText(d, cx, ly);
    const wx = weatherLine();
    if (wx) { ly += 48 * u; ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = '600 ' + 34 * u + 'px ' + FONT_NUM; spacing(ctx, '0.12em'); ctx.fillText(wx, cx, ly); }
  }
  spacing(ctx, '0px');
  ctx.restore();
}

/* markers and the HUD are drawn on their own layer so they can fade out under the card */
let hudLayer = null;

function drawOverlays(W, H, card) {
  // the card and the HUD take turns: the card is gone before the HUD starts to appear (and the reverse at the end), so their titles never overlap
  const cardA = Math.min(1, Math.max(0, (card - 0.5) * 2)), hudA = Math.min(1, Math.max(0, (0.5 - card) * 2));
  if (hudA >= 1) drawMarkers(vctx, W, H), drawHud(vctx, W, H);
  else if (hudA > 0) {
    if (!hudLayer) hudLayer = document.createElement('canvas');
    if (hudLayer.width !== W || hudLayer.height !== H) { hudLayer.width = W; hudLayer.height = H; }
    const lc = hudLayer.getContext('2d'); lc.clearRect(0, 0, W, H);
    drawMarkers(lc, W, H); drawHud(lc, W, H);
    vctx.save(); vctx.globalAlpha = hudA; vctx.drawImage(hudLayer, 0, 0); vctx.restore();
  }
  if (cardA > 0) drawCard(vctx, W, H, cardA);
}

export function composite() {
  const W = view.width, H = view.height;
  vctx.fillStyle = '#0a0d10'; vctx.fillRect(0, 0, W, H);
  if (R.map) { const mc = R.map.getCanvas(); if (mc && mc.width > 0 && mc.height > 0) vctx.drawImage(mc, 0, 0, W, H); }
  if (S.trimView && S.track) drawTrimOverlay(vctx, W, H);
  else if (S.track && R.frame) { drawOverlays(W, H, (R.frame.cam && R.frame.cam.card) || 0); drawCredit(vctx, W, H); }
  if (R.map) $('#tilesNote').hidden = !S.track || S.exporting || R.map.loaded();
}
