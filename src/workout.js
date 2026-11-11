/* workout.js: pure logic for Workout mode (no DOM, so it runs unchanged in node tests).
   Indoor rides have nothing to fly over, so the picture is the power itself. This reads the per-second power and heart rate,
   finds the hard efforts and the sets they come in (a "20 on / 40 off" set is five 20 s efforts a minute apart),
   and builds a time warp that plays the efforts and skims the rests. With the edit intensity at 0 the warp is the identity. */
import { clamp, smoother } from './core.js';

const MIN_EFFORT = 8; // seconds: shorter spikes (a sprint start, a coasting blip) are not efforts
const W_EFFORT = 1, W_REST = 0.15, W_GAP = 0.04; // how much video time a second of effort, rest inside a set, and everything else gets

let nextId = 1;

/* ------------------------------ reading the file ------------------------------ */
/* Trainer files carry no real route: Zwift writes made-up coordinates (Strava calls those rides VirtualRide) and a trainer
   FIT has none at all. */
export function isIndoor(parsed) {
  if (!parsed) return false;
  if (parsed.indoor) return true;
  const gps = parsed.points ? parsed.points.length : 0;
  return gps < 2 && !!parsed.series && parsed.series.length >= 30;
}

/* a running mean over +-half samples */
export function boxSmooth(a, half) {
  const n = a.length, pre = new Float64Array(n + 1), out = new Float32Array(n);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half); out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); }
  return out;
}

/* values on whole seconds. A gap in the clock longer than maxGap reads as zero (a pause) when zeroGap is set, otherwise it is bridged. */
function resample(secs, vals, n, zeroGap) {
  const idx = [];
  for (let i = 0; i < vals.length; i++) if (vals[i] !== null && vals[i] !== undefined && isFinite(vals[i])) idx.push(i);
  if (idx.length < Math.max(10, vals.length * 0.3)) return null;
  const out = new Float32Array(n);
  let k = 0;
  for (let s = 0; s < n; s++) {
    while (k + 1 < idx.length && secs[idx[k + 1]] <= s) k++;
    const a = idx[k], b = idx[Math.min(k + 1, idx.length - 1)];
    if (s <= secs[idx[0]] || a === b) out[s] = vals[a];
    else {
      const gap = secs[b] - secs[a];
      out[s] = zeroGap && gap > 10 ? 0 : vals[a] + (vals[b] - vals[a]) * clamp((s - secs[a]) / gap, 0, 1);
    }
  }
  return out;
}

const median = (a) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const mean = (arr, a, b) => { let t = 0; for (let i = a; i < b; i++) t += arr[i]; return b > a ? t / (b - a) : 0; };

/* ------------------------------ finding the efforts and sets ------------------------------ */
/* Efforts are the stretches well above the workout's own top end (55% of the 98th percentile), so it needs no FTP.
   Sets are runs of efforts with short rests between them; a pause several times longer than the usual rest starts a new set. */
export function detectIntervals(pwr, hr) {
  const n = pwr.length, none = { thr: 0, efforts: [], sets: [] };
  if (n < 60) return none;
  const sm = boxSmooth(pwr, 1), sorted = Float32Array.from(sm).sort();
  const p98 = sorted[Math.floor(0.98 * (n - 1))], thr = Math.max(0.55 * p98, 100);
  if (!(p98 >= 150)) return { ...none, thr };

  let runs = [], start = -1;
  for (let i = 0; i < n; i++) {
    const on = sm[i] >= thr;
    if (on && start < 0) start = i;
    else if (!on && start >= 0) { runs.push([start, i]); start = -1; }
  }
  if (start >= 0) runs.push([start, n]);
  const merged = [];
  for (const r of runs) { const l = merged[merged.length - 1]; if (l && r[0] - l[1] <= 3) l[1] = r[1]; else merged.push(r.slice()); }
  runs = merged.filter((r) => r[1] - r[0] >= MIN_EFFORT);

  const efforts = runs.map(([s, e]) => {
    const dur = e - s, a = dur >= 10 ? s + 2 : s, b = dur >= 10 ? e - 2 : e; // the ramp at each edge is not the effort's power
    return { s, e, dur, avg: mean(pwr, a, b) };
  });
  const work = efforts.reduce((t, e) => t + e.dur, 0);
  if (efforts.length < 2 || work > n * 0.6) return { thr, efforts: [], sets: [] }; // a steady ride has no intervals to show

  const gaps = efforts.slice(1).map((e, i) => e.s - efforts[i].e), brk = Math.max(90, 2.5 * median(gaps));
  const groups = [[efforts[0]]];
  for (let i = 1; i < efforts.length; i++) { if (gaps[i - 1] > brk) groups.push([]); groups[groups.length - 1].push(efforts[i]); }

  const sets = groups.map((g, j) => {
    const s = g[0].s, e = g[g.length - 1].e;
    let w = 0, wd = 0;
    for (const f of g) { w += f.avg * f.dur; wd += f.dur; }
    let restSum = 0, restN = 0;
    for (let i = 0; i < g.length - 1; i++) for (let t = g[i].e; t < g[i + 1].s; t++) { restSum += pwr[t]; restN++; }
    let hrPeak = null;
    if (hr) { hrPeak = 0; for (let t = s; t < Math.min(n, e + 15); t++) hrPeak = Math.max(hrPeak, hr[t]); }
    return { n: j + 1, s, e, efforts: g, count: g.length, dur: median(g.map((f) => f.dur)), workAvg: w / wd, restAvg: restN ? restSum / restN : null, hrPeak };
  });
  return { thr, efforts, sets };
}

/* a short length in the way you say it: 20 s, 5:00 */
export function fmtLen(sec) {
  if (sec < 90) return Math.max(5, Math.round(sec / 5) * 5) + ' s';
  const r = Math.round(sec / 5) * 5;
  return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0');
}

/* "5 × 20 s @ 500 W" for each set */
export function describeSets(w) {
  return w.sets.map((s) => s.count + ' × ' + fmtLen(s.dur) + ' @ ' + Math.round(s.workAvg) + ' W');
}

/* ------------------------------ building the workout ------------------------------ */
/* Everything the picture needs, from a parsed file, or null when there is no power to show. */
export function buildWorkout(parsed) {
  const src = (parsed.series && parsed.series.length ? parsed.series : parsed.points) || [];
  const pts = src.filter((p) => p && (p.pwr !== null && p.pwr !== undefined));
  if (pts.length < 30) return null;
  const timed = pts.filter((p) => p.t !== null && p.t !== undefined).length >= pts.length * 0.9;
  const secs = new Float64Array(pts.length);
  let last = 0;
  for (let i = 0; i < pts.length; i++) { last = timed && pts[i].t !== null && pts[i].t !== undefined ? Math.max(last, (pts[i].t - pts[0].t) / 1000) : (timed ? last : i); secs[i] = last; }
  const n = Math.floor(secs[pts.length - 1]) + 1;
  if (n < 30) return null;
  const pwr = resample(secs, pts.map((p) => p.pwr), n, true);
  if (!pwr) return null;
  const hr = resample(secs, pts.map((p) => (p.hr > 0 ? p.hr : null)), n, false);
  const found = detectIntervals(pwr, hr);
  const pcum = new Float64Array(n + 1);
  let maxPwr = 0;
  for (let i = 0; i < n; i++) { pcum[i + 1] = pcum[i] + pwr[i]; maxPwr = Math.max(maxPwr, pwr[i]); }
  let maxHr = 0, hrSum = 0;
  if (hr) for (let i = 0; i < n; i++) { maxHr = Math.max(maxHr, hr[i]); hrSum += hr[i]; }
  const w = {
    id: nextId++, n, T: n - 1, pwr, hr, pcum, thr: found.thr, efforts: found.efforts, sets: found.sets,
    show: boxSmooth(pwr, 1), hrShow: hr ? boxSmooth(hr, 2) : null, // 3 s power and 5 s heart rate for the live numbers, so they do not flicker
    startTime: pts[0].t === undefined ? null : pts[0].t, name: parsed.name || null, sport: parsed.sport || null,
    avgPwr: pcum[n] / n, maxPwr, maxHr: hr ? maxHr : null, avgHr: hr ? hrSum / n : null, hasHr: !!hr,
  };
  w.warp = buildWorkoutWarp(w, 0.8);
  return w;
}

/* a good length: a beat per effort, so a four-set session still lands near 30 s */
export function suggestWorkoutDuration(w) {
  return w.efforts.length ? Math.round(clamp(10 + 1.1 * w.efforts.length, 20, 45)) : 25;
}

/* ------------------------------ the time warp ------------------------------ */
/* video progress u (0..1) <-> workout seconds. Efforts get most of the clock, rests inside a set a little, the rest almost none.
   intensity 0 is a constant-speed playback, 1 is the full edit. */
export function buildWorkoutWarp(w, intensity) {
  const T = w.T, s = clamp(intensity, 0, 1);
  if (s === 0 || !w.sets.length) return { identity: true, timeAt: (u) => clamp(u, 0, 1) * T, uAt: (sec) => clamp(sec, 0, T) / T };
  const m = w.n - 1, raw = new Float64Array(m).fill(W_GAP);
  for (const set of w.sets) for (let t = set.s; t < Math.min(m, set.e); t++) raw[t] = W_REST;
  for (const f of w.efforts) for (let t = Math.max(0, Math.floor(f.s - 1.5)); t < Math.min(m, Math.ceil(f.e + 1.5)); t++) raw[t] = W_EFFORT;
  let tot = 0; for (let i = 0; i < m; i++) tot += raw[i];
  const sm = boxSmooth(raw, 2), mean1 = tot / m, rho = new Float64Array(m), cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) { rho[i] = 1 - s + s * (sm[i] / mean1); cum[i + 1] = cum[i] + rho[i]; }
  const total = cum[m];
  const timeAt = (u) => {
    const x = clamp(u, 0, 1) * total;
    let lo = 0, hi = m - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= x) lo = mid; else hi = mid - 1; }
    return Math.min(T, lo + (x - cum[lo]) / rho[lo]);
  };
  const uAt = (sec) => { const t = clamp(sec, 0, T), i = Math.min(m - 1, Math.floor(t)); return (cum[i] + rho[i] * (t - i)) / total; };
  return { identity: false, timeAt, uAt };
}

/* ------------------------------ frames ------------------------------ */
const CARD_FADE = 0.05; // the same card timing as the classic flyover

/* Where the workout is at video position tau (0..1): the second it shows, and how much of the title card is up.
   The card is fully up on the first and last frame, which are the same picture, so a loop has no seam. */
export function workoutFrame(w, tau, o) {
  o = o || {};
  tau = clamp(tau, 0, 1);
  const hold = o.cards ? Math.min(0.09, 1.5 / (o.duration || 30)) : 0, g = hold ? hold + CARD_FADE : 0;
  let card = 0;
  if (hold) {
    if (tau <= hold || tau >= 1 - hold) card = 1;
    else if (tau < hold + CARD_FADE) card = 1 - smoother((tau - hold) / CARD_FADE);
    else if (tau > 1 - hold - CARD_FADE) card = smoother((tau - (1 - hold - CARD_FADE)) / CARD_FADE);
  }
  const u = clamp((tau - g) / (1 - 2 * g), 0, 1);
  return { sec: w.warp.timeAt(u), card, u };
}

/* where in the session we are, in words */
export function statusAt(w, sec) {
  if (!w.sets.length) return { text: '', on: false };
  const sets = w.sets;
  for (const set of sets) {
    if (sec >= set.s && sec < set.e) {
      const k = set.efforts.filter((f) => f.s <= sec).length, on = set.efforts.some((f) => sec >= f.s && sec < f.e);
      return { text: 'SET ' + set.n + ' · EFFORT ' + k + ' OF ' + set.count, on, tag: on ? 'ON' : 'REST' };
    }
  }
  if (sec < sets[0].s) return { text: 'WARM-UP', on: false };
  if (sec >= sets[sets.length - 1].e) return { text: sec >= sets[sets.length - 1].e + 20 ? 'COOLDOWN' : 'SET ' + sets[sets.length - 1].n + ' DONE', on: false };
  return { text: 'RECOVERY', on: false };
}

/* a value at a fractional second */
export function valueAt(arr, sec) {
  const t = clamp(sec, 0, arr.length - 1), i = Math.min(arr.length - 2, Math.floor(t));
  return arr[i] + (arr[i + 1] - arr[i]) * (t - i);
}

/* ------------------------------ a sample ------------------------------ */
/* a 40 minute 20 s on / 40 s off session, so there is something to try without a file */
export function makeSampleWorkout() {
  const pts = [], t0 = Date.UTC(2026, 10, 11, 21, 39, 26);
  let sec = 0;
  const add = (len, f) => { for (let i = 0; i < len; i++, sec++) pts.push({ t: t0 + sec * 1000, pwr: Math.round(f(i)), hr: Math.round(60 + 110 * (1 - Math.exp(-sec / 700)) + 6 * Math.sin(sec / 35)) }); };
  const set = (on, off, count) => { for (let r = 0; r < count; r++) { add(20, () => on + (r % 2) * 2); add(40, () => off); } };
  add(420, (i) => 120 + 60 * Math.sin(i / 90) + i / 30);
  set(405, 100, 5); add(215, () => 130);
  for (let k = 0; k < 3; k++) { set(500, 125, 5); add(k === 2 ? 215 : 215, () => 150); }
  add(235, (i) => 70 - i / 8);
  return { points: [], series: pts, sport: 'cycling', name: 'Sample 20/40 workout (generated)', indoor: true };
}
