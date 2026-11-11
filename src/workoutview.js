/* workoutview.js: draws one Workout mode frame. Pure canvas code (no DOM, no app state), so it can be rendered from node tests.
   Layout, top to bottom: title and date, the live power number and where we are in the session, the power profile with a stamp
   over each set, a heart rate strip, and a stats row. The title card sits over the finished profile and takes turns with the HUD. */
import * as C from './core.js';
import { FONT_NUM } from './config.js';
import { inkOn, rr, spacing } from './util.js';
import { statusAt, valueAt } from './workout.js';

const clamp = C.clamp;

const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

const fitFont = (ctx, text, weight, size, min, maxW) => {
  let f = size; ctx.font = weight + ' ' + f + 'px ' + FONT_NUM;
  while (f > min && ctx.measureText(text).width > maxW) { f -= 1; ctx.font = weight + ' ' + f + 'px ' + FONT_NUM; }
};

/* the profile cut into columns (mean power, mean heart rate), cached per workout and column count */
const binCache = new WeakMap();

function binsOf(w, ncol) {
  const hit = binCache.get(w);
  if (hit && hit.ncol === ncol) return hit;
  const p = new Float32Array(ncol), h = w.hr ? new Float32Array(ncol) : null;
  for (let c = 0; c < ncol; c++) {
    const a = Math.floor((c / ncol) * w.n), b = Math.max(a + 1, Math.floor(((c + 1) / ncol) * w.n));
    let sp = 0, sh = 0;
    for (let i = a; i < b; i++) { sp += w.pwr[i]; if (h) sh += w.hr[i]; }
    p[c] = sp / (b - a); if (h) h[c] = sh / (b - a);
  }
  let hLo = Infinity, hHi = -Infinity;
  if (h) for (let c = 0; c < ncol; c++) { hLo = Math.min(hLo, h[c]); hHi = Math.max(hHi, h[c]); }
  const out = { ncol, p, h, hLo, hHi };
  binCache.set(w, out);
  return out;
}

/* every position the frame is built from, derived from the canvas size */
function layout(W, H, o, w) {
  const u = Math.min(W, H) / 1080, safe = o.safe && Math.abs(W / H - 9 / 16) < 0.02;
  const topInset = safe ? H * 0.085 : 46 * u, botInset = safe ? H * 0.17 : 54 * u;
  const innerW = Math.min(W - 120 * u, 1500 * u), x0 = (W - innerW) / 2;
  const bottomY = H - botInset, sfs = 72 * u;
  const statsTop = bottomY - sfs * 0.74 - 16 * u - 20 * u;
  const axisY = statsTop - 22 * u, hrOn = !!w.hr, hrH = hrOn ? 70 * u : 0;
  const hrBottom = axisY - 34 * u, hrTop = hrBottom - hrH;
  const powerBottom = hrOn ? hrTop - 44 * u : hrBottom, chartH = clamp(H * 0.27, 150 * u, 560 * u);
  const powerTop = powerBottom - chartH, stampTop = powerTop - 100 * u;
  return { u, safe, topInset, botInset, innerW, x0, bottomY, sfs, statsTop, axisY, hrBottom, hrTop, hrH, powerBottom, powerTop, chartH, stampTop };
}

function drawBackground(ctx, W, H, w, g, f, o) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0f14'); bg.addColorStop(1, '#111820');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // a glow behind the hero number that swells with the power
  const p = valueAt(w.show, f.sec) / Math.max(w.maxPwr, 1), a = 0.04 + 0.2 * p * p * (1 - f.card);
  const cy = (g.topInset + g.stampTop) / 2 + g.u * 60, rad = Math.max(W, H) * 0.55;
  const rg = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, rad);
  rg.addColorStop(0, rgba(o.color, a)); rg.addColorStop(1, rgba(o.color, 0));
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
}

/* minute marks along the bottom: every 5, 10, 15... minutes, whichever gives at most six */
function drawAxis(ctx, w, g) {
  const steps = [1, 2, 5, 10, 15, 30, 60], mins = w.T / 60, step = steps.find((s) => mins / s <= 6) || 60;
  ctx.save();
  ctx.font = '600 ' + 22 * g.u + 'px ' + FONT_NUM; spacing(ctx, '0.1em'); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.textBaseline = 'alphabetic';
  for (let m = 0; m * 60 <= w.T; m += step) {
    const x = g.x0 + (g.innerW * m * 60) / w.T;
    ctx.textAlign = m === 0 ? 'left' : 'center'; ctx.fillText(m === 0 ? '0' : m + (m === step ? ' MIN' : ''), x, g.axisY);
  }
  spacing(ctx, '0px'); ctx.restore();
}

/* the power profile and heart rate strip. Everything up to litSec is lit; the rest is faint. */
function drawChart(ctx, w, g, litSec, o) {
  const { u, x0, innerW } = g, ncol = Math.max(80, Math.round(innerW / (2.6 * u))), b = binsOf(w, ncol), colW = innerW / ncol;
  const maxP = Math.max(w.maxPwr, 100), litX = x0 + (innerW * clamp(litSec, 0, w.T)) / w.T;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x0, g.powerBottom, innerW, 2 * u);
  for (let c = 0; c < ncol; c++) {
    const v = b.p[c], h = Math.max(2 * u, (v / maxP) * g.chartH), x = x0 + c * colW, lit = x + colW / 2 <= litX, eff = v >= w.thr && w.efforts.length > 0;
    if (eff) { ctx.fillStyle = o.color; ctx.globalAlpha = lit ? 1 : 0.28; } else { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = lit ? 0.34 : 0.1; }
    ctx.fillRect(x, g.powerBottom - h, colW + 0.5, h);
  }
  ctx.globalAlpha = 1;
  if (b.h) {
    const lo = Math.max(40, b.hLo - 5), hi = Math.max(lo + 20, b.hHi + 5);
    const yOf = (v) => g.hrBottom - ((v - lo) / (hi - lo)) * g.hrH;
    const line = () => { ctx.beginPath(); for (let c = 0; c < ncol; c++) { const x = x0 + (c + 0.5) * colW, y = yOf(b.h[c]); if (c) ctx.lineTo(x, y); else ctx.moveTo(x, y); } };
    ctx.lineJoin = 'round'; ctx.lineWidth = 3 * u;
    line(); ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(x0 - 4 * u, g.hrTop - 20 * u, litX - x0 + 4 * u, g.hrH + 40 * u); ctx.clip();
    line(); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke(); ctx.restore();
    ctx.font = '600 ' + 20 * u + 'px ' + FONT_NUM; spacing(ctx, '0.14em'); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('HEART RATE', x0, g.hrTop - 8 * u);
    ctx.textAlign = 'right'; ctx.fillText(Math.round(b.hLo) + ' TO ' + Math.round(b.hHi) + ' BPM', x0 + innerW, g.hrTop - 8 * u); spacing(ctx, '0px');
  }
  ctx.restore();
  drawAxis(ctx, w, g);
}

/* a stamp over each set: its name always, its numbers once the set is done */
function drawStamps(ctx, w, g, litSec, o) {
  const { u } = g, acc = o.color2 || o.color;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (const set of w.sets) {
    const cx = g.x0 + (g.innerW * (set.s + set.e) / 2) / w.T, done = litSec >= set.e + 1, going = litSec >= set.s;
    ctx.globalAlpha = done ? 1 : going ? 0.7 : 0.32;
    spacing(ctx, '0.1em'); ctx.font = '700 ' + 27 * u + 'px ' + FONT_NUM; ctx.fillStyle = '#fff';
    ctx.fillText('SET ' + set.n, cx, g.stampTop + 26 * u);
    if (done) {
      spacing(ctx, '0.04em'); ctx.font = '700 ' + 31 * u + 'px ' + FONT_NUM; ctx.fillStyle = acc;
      ctx.fillText(Math.round(set.workAvg) + ' W', cx, g.stampTop + 60 * u);
      if (set.hrPeak) { ctx.font = '600 ' + 23 * u + 'px ' + FONT_NUM; ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillText('HR ' + Math.round(set.hrPeak), cx, g.stampTop + 88 * u); }
    }
  }
  spacing(ctx, '0px'); ctx.restore();
}

/* title and date at the top of the HUD (the same look as the map flyover) */
function drawHeader(ctx, W, w, g, o) {
  const { u, x0, innerW } = g, acc = o.color2 || o.color;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12 * u;
  const title = (o.title || w.name || 'Workout').toUpperCase();
  let tfs = 76 * u; ctx.font = '700 ' + tfs + 'px ' + FONT_NUM; spacing(ctx, '0.03em');
  while (tfs > 38 * u && ctx.measureText(title).width > innerW) { tfs -= 2 * u; ctx.font = '700 ' + tfs + 'px ' + FONT_NUM; }
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const ty = g.topInset + tfs * 0.78; ctx.fillText(title, x0, ty);
  let base = ty;
  if (w.startTime) {
    const d = new Date(w.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    ctx.font = '600 ' + 30 * u + 'px ' + FONT_NUM; spacing(ctx, '0.14em'); ctx.fillStyle = acc; base = ty + 44 * u; ctx.fillText(d, x0, base);
  }
  const sub = (o.subtitle || '').trim().toUpperCase();
  if (sub) { base += 40 * u; ctx.fillStyle = 'rgba(255,255,255,0.92)'; spacing(ctx, '0.06em'); fitFont(ctx, sub, 600, 30 * u, 18 * u, innerW); ctx.fillText(sub, x0, base); }
  spacing(ctx, '0px'); ctx.restore();
  return base;
}

/* the big live power number with where we are in the session under it */
function drawHero(ctx, W, w, g, f, o, headerBottom) {
  const { u } = g, acc = o.color2 || o.color, cx = W / 2;
  const avail = g.stampTop - headerBottom - 24 * u;
  const hf = clamp(avail * 0.6, 90 * u, Math.min(g.stampTop * 0.3, g.innerW * 0.42));
  const cap = hf * 0.72, st = statusAt(w, f.sec), room = cap + 34 * u + 22 * u + 62 * u + 22 * u <= avail, pill = !!st.tag && room; // short layouts fold ON / REST into the line instead
  const blockH = cap + (st.text ? 56 * u + (pill ? 84 * u : 0) : 0);
  const top = headerBottom + 24 * u + Math.max(0, (avail - blockH) / 2), base = top + cap;
  const val = String(Math.round(valueAt(w.show, f.sec)));
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 16 * u;
  ctx.font = '700 ' + hf + 'px ' + FONT_NUM;
  const wz = ctx.measureText('000').width, ufs = hf * 0.3;
  ctx.font = '500 ' + ufs + 'px ' + FONT_NUM; const wu = ctx.measureText('W').width + ufs * 0.2, left = cx - (wz + wu) / 2;
  ctx.font = '700 ' + hf + 'px ' + FONT_NUM; ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(val, left + wz, base);
  ctx.font = '500 ' + ufs + 'px ' + FONT_NUM; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'left'; ctx.fillText('W', left + wz + ufs * 0.2, base);
  if (st.text) {
    ctx.shadowBlur = 0; ctx.textAlign = 'center'; spacing(ctx, '0.14em'); ctx.font = '600 ' + 36 * u + 'px ' + FONT_NUM; ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(st.tag && !pill ? st.text + ' · ' + st.tag : st.text, cx, base + 22 * u + 34 * u);
    if (pill) {
      const lab = st.tag, pf = 30 * u; ctx.font = '700 ' + pf + 'px ' + FONT_NUM; spacing(ctx, '0.2em');
      const pw = ctx.measureText(lab).width + 56 * u, ph = 48 * u, py = base + 22 * u + 34 * u + 22 * u;
      if (st.on) { ctx.fillStyle = acc; rr(ctx, cx - pw / 2, py, pw, ph, ph / 2); ctx.fill(); ctx.fillStyle = inkOn(acc); }
      else { ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2 * u; rr(ctx, cx - pw / 2, py, pw, ph, ph / 2); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,0.7)'; }
      ctx.fillText(lab, cx + 0.1 * pf, py + ph * 0.7);
    }
  }
  spacing(ctx, '0px'); ctx.restore();
}

function drawPlayhead(ctx, w, g, f, o) {
  const acc = o.color2 || o.color, x = g.x0 + (g.innerW * f.sec) / w.T;
  ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(x - 1.5 * g.u, g.stampTop + 100 * g.u - 14 * g.u, 3 * g.u, (g.hrOn ? g.hrBottom : g.powerBottom) - (g.stampTop + 86 * g.u) + 2 * g.u);
  ctx.beginPath(); ctx.arc(x, g.stampTop + 100 * g.u - 14 * g.u, 9 * g.u, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 4 * g.u; ctx.strokeStyle = acc; ctx.stroke();
  ctx.restore();
}

/* the stats row: elapsed time, heart rate now, running average power */
function drawStats(ctx, w, g, f, o) {
  const st = o.stats || {}, it = [], whole = Math.floor(f.sec);
  if (st.time) it.push({ label: 'TIME', value: C.fmtDuration(f.sec), unit: '' });
  if (st.hr && w.hr) it.push({ label: 'HEART RATE', value: String(Math.round(valueAt(w.hrShow, f.sec))), unit: 'bpm' });
  if (st.power) it.push({ label: 'AVG POWER', value: String(Math.round(w.pcum[whole + 1] / (whole + 1))), unit: 'W' });
  if (!it.length) return;
  const { u, x0, innerW } = g, step = innerW / it.length, fs = g.sfs;
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12 * u;
  it.forEach((s, i) => {
    const x = x0 + i * step;
    ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = '600 ' + 26 * u + 'px ' + FONT_NUM; spacing(ctx, '0.14em'); ctx.fillText(s.label, x, g.bottomY - fs * 0.74 - 16 * u); spacing(ctx, '0px');
    ctx.fillStyle = '#fff'; ctx.font = '700 ' + fs + 'px ' + FONT_NUM; ctx.fillText(s.value, x, g.bottomY);
    if (s.unit) { const vw = ctx.measureText(s.value.replace(/\d/g, '0')).width; ctx.font = '500 ' + fs * 0.4 + 'px ' + FONT_NUM; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(s.unit, x + vw + fs * 0.1, g.bottomY); }
  });
  ctx.restore();
}

/* The intro / finish card: big title and date over the finished profile, the session totals along the bottom. */
function drawCard(ctx, W, H, w, g, a, o) {
  const { u, innerW } = g, acc = o.color2 || o.color, cx = W / 2;
  ctx.save(); ctx.globalAlpha = a;
  const gt = ctx.createLinearGradient(0, 0, 0, H * 0.4); gt.addColorStop(0, 'rgba(0,0,0,0.5)'); gt.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gt; ctx.fillRect(0, 0, W, H * 0.4);
  ctx.translate(0, (a - 1) * 18 * u);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 16 * u;
  const title = (o.title || w.name || 'Workout').toUpperCase();
  let tfs = 124 * u; ctx.font = '700 ' + tfs + 'px ' + FONT_NUM; spacing(ctx, '0.03em');
  while (tfs > 54 * u && ctx.measureText(title).width > innerW) { tfs -= 2 * u; ctx.font = '700 ' + tfs + 'px ' + FONT_NUM; }
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let y = g.topInset + tfs * 0.8; ctx.fillText(title, cx, y);
  spacing(ctx, '0px'); ctx.shadowBlur = 0; ctx.fillStyle = acc;
  y += 26 * u; rr(ctx, cx - 56 * u, y, 112 * u, 6 * u, 3 * u); ctx.fill();
  let ly = y + 6 * u;
  const sub = (o.subtitle || '').trim().toUpperCase();
  if (sub) { ly += 50 * u; ctx.shadowBlur = 12 * u; ctx.fillStyle = 'rgba(255,255,255,0.95)'; spacing(ctx, '0.08em'); fitFont(ctx, sub, 600, 46 * u, 24 * u, innerW); ctx.fillText(sub, cx, ly); ly += 6 * u; }
  if (w.startTime) {
    const d = new Date(w.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    ly += 46 * u; ctx.shadowBlur = 12 * u; ctx.fillStyle = acc; ctx.font = '600 ' + 38 * u + 'px ' + FONT_NUM; spacing(ctx, '0.16em'); ctx.fillText(d, cx, ly);
  }
  const cols = [{ label: 'TIME', value: C.fmtDuration(w.T), unit: '' }, { label: 'AVG POWER', value: String(Math.round(w.avgPwr)), unit: 'W' }];
  if (w.efforts.length) cols.push({ label: 'EFFORTS', value: String(w.efforts.length), unit: '' });
  const vfs = (cols.length > 2 ? 72 : 84) * u, ufs = vfs * 0.4, lfs = 26 * u, base = g.bottomY, colW = Math.min(innerW / Math.max(2, cols.length), 420 * u);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 14 * u;
  cols.forEach((c, i) => {
    const x = cx + (i - (cols.length - 1) / 2) * colW;
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.font = '600 ' + lfs + 'px ' + FONT_NUM; spacing(ctx, '0.16em');
    ctx.fillText(c.label, x, base - vfs * 0.86 - 10 * u);
    spacing(ctx, '0px'); ctx.font = '700 ' + vfs + 'px ' + FONT_NUM;
    const vw = ctx.measureText(c.value).width; ctx.font = '500 ' + ufs + 'px ' + FONT_NUM; const uw = c.unit ? ctx.measureText(c.unit).width + ufs * 0.15 : 0, tot = vw + uw;
    ctx.textAlign = 'left'; ctx.font = '700 ' + vfs + 'px ' + FONT_NUM; ctx.fillStyle = '#fff'; ctx.fillText(c.value, x - tot / 2, base);
    if (c.unit) { ctx.font = '500 ' + ufs + 'px ' + FONT_NUM; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(c.unit, x - tot / 2 + vw + ufs * 0.15, base); }
  });
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  for (let i = 1; i < cols.length; i++) ctx.fillRect(cx + (i - cols.length / 2) * colW - 1 * u, base - vfs * 0.9, 2 * u, vfs * 0.9 + 6 * u);
  ctx.restore();
}

/* One frame. f = { sec, card } from workoutFrame. o = { color, color2, title, subtitle, stats, safe }. */
export function drawWorkout(ctx, W, H, w, f, o) {
  const g = layout(W, H, o, w), cardA = clamp((f.card - 0.5) * 2, 0, 1), hudA = clamp((0.5 - f.card) * 2, 0, 1);
  g.hrOn = !!w.hr;
  drawBackground(ctx, W, H, w, g, f, o);
  // under the card the whole session is lit; as the card clears the lit part pulls back to the playhead
  const lit = Math.max(f.sec, f.card * w.T);
  drawChart(ctx, w, g, lit, o);
  drawStamps(ctx, w, g, lit, o);
  if (hudA > 0) {
    ctx.save(); ctx.globalAlpha = hudA;
    const hb = drawHeader(ctx, W, w, g, o);
    drawHero(ctx, W, w, g, f, o, hb);
    drawPlayhead(ctx, w, g, f, o);
    drawStats(ctx, w, g, f, o);
    ctx.restore();
  }
  if (cardA > 0) drawCard(ctx, W, H, w, g, cardA, o);
}
