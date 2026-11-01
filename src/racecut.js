/* racecut.js: pure logic for the "Race cut" mode (no DOM, so it runs unchanged in node tests).
   It picks out the moments worth lingering on (a surge, the final kick, the fastest split, a big climb, halfway)
   and builds a time warp: a monotone map from video progress to route progress that skims the steady stretches
   and slows down on the moments. With the intensity at 0 the warp is the identity, which is the classic flyover. */
import { clamp } from './core.js';

const MI = 1609.344;
const N = 1200; // warp resolution along the route

/* ------------------------------ reading the track ------------------------------ */
const total = (track) => track.grid.d[track.M - 1];

/* first index whose value is >= x (the array is non-decreasing) */
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

/* grid position (k - 1 + f) for display distance s, so p = pos / (M - 1) and any channel is lerp(a[k-1], a[k], f) */
function locate(track, s) {
  const d = track.grid.d;
  s = clamp(s, 0, d[track.M - 1]);
  const k = Math.max(1, lowerBound(d, s)), span = d[k] - d[k - 1];
  return { k, f: span > 0 ? clamp((s - d[k - 1]) / span, 0, 1) : 0 };
}

/* progress along the route (0..1) at display distance s */
export function pAtDist(track, s) {
  const { k, f } = locate(track, s);
  return (k - 1 + f) / (track.M - 1);
}

/* elapsed seconds at display distance s, or null without timestamps */
export function timeAtDist(track, s) {
  const t = track.grid.t; if (!t) return null;
  const { k, f } = locate(track, s);
  return t[k - 1] + (t[k] - t[k - 1]) * f;
}

/* average speed (m/s) between two distances, or null when there is no clock or no time passed */
export function speedBetween(track, s0, s1) {
  const a = timeAtDist(track, s0), b = timeAtDist(track, s1);
  return a === null || !(b - a > 0.5) ? null : (s1 - s0) / (b - a);
}

/* the full splits at a spacing, the same ones the distance markers use (the last partial split is not one) */
export function splitsOf(track, iv) {
  const out = [], len = total(track);
  for (let n = 1; n * iv < len - 5; n++) out.push({ n, a: (n - 1) * iv, b: n * iv, spd: speedBetween(track, (n - 1) * iv, n * iv) });
  return out;
}

/* ------------------------------ moments ------------------------------ */
/* How much of the head's time each kind of moment may take, and which wins when two overlap. */
const SHARE = { kick: 0.18, shift: 0.16, fastest: 0.12, climb: 0.1, half: 0.05 };

const PRIORITY = { kick: 4, shift: 3, fastest: 2, climb: 1, half: 0 };

const MAX_SHARE = 0.6; // the steady stretches always keep at least 40% of the time

export const MOMENT_TITLES = { kick: 'Final kick', shift: 'The shift', fastest: 'Fastest split', climb: 'Big climb', half: 'Halfway' };

/* Finds the moments of a route. `iv` is the split length in metres (a mile, a km, 500 m rowing...).
   Each moment: { kind, p0, p1 (the stretch it covers, 0..1), at (metres), share, plus the numbers its banner shows }. */
export function detectMoments(track, o) {
  o = o || {};
  const len = total(track), timed = !!track.grid.t, iv = o.iv || MI, found = [];
  if (!(len >= 800)) return found;
  const W = Math.min(MI, len / 12);
  const span = (a, b) => ({ p0: pAtDist(track, Math.max(0, a)), p1: pAtDist(track, Math.min(len, b)) });

  if (timed) {
    // the biggest step up in speed: the mile after a point against the mile before it
    let best = null;
    const step = Math.max(20, len / 500);
    for (let s = W; s <= len - W + 1e-6; s += step) {
      const before = speedBetween(track, s - W, s), after = speedBetween(track, s, s + W);
      if (!before || !after) continue;
      const gain = after / before - 1;
      if (!best || gain > best.gain) best = { s, gain, before, after };
    }
    if (best && best.gain >= 0.05) found.push({ kind: 'shift', at: best.s, from: best.before, to: best.after, ...span(best.s - 0.3 * W, best.s + 0.8 * W) });

    // the fastest full split, if it stands out from the rest
    const splits = splitsOf(track, iv).filter((x) => x.spd);
    if (splits.length >= 3) {
      const avg = splits.reduce((a, x) => a + x.spd, 0) / splits.length, top = splits.reduce((a, x) => (x.spd > a.spd ? x : a));
      if (top.spd >= avg * 1.04) found.push({ kind: 'fastest', at: top.b, n: top.n, to: top.spd, ...span(top.a, top.b) });
    }

    // the finish: the last stretch against the mile before it
    const kw = Math.min(MI / 4, len * 0.03), kick = speedBetween(track, len - kw, len), prev = speedBetween(track, Math.max(0, len - kw - W), len - kw);
    if (kick && prev && kick / prev >= 1.06) found.push({ kind: 'kick', at: len - kw, len: kw, from: prev, to: kick, ...span(len - kw, len) });

    // halfway, with the clock
    if (len >= 9000) found.push({ kind: 'half', at: len / 2, t: timeAtDist(track, len / 2), ...span(len / 2 - len * 0.012, len / 2 + len * 0.012) });
  } else if (len >= 9000) found.push({ kind: 'half', at: len / 2, t: null, ...span(len / 2 - len * 0.012, len / 2 + len * 0.012) });

  // the steepest stretch, if it is a real hill
  const gain = track.grid.gain, M = track.M;
  if (track.meta.hasEle && gain) {
    const wc = Math.min(800, len / 10), kw = Math.max(2, Math.round((wc / len) * (M - 1)));
    let best = null;
    for (let k = 0; k + kw < M; k++) { const g = gain[k + kw] - gain[k]; if (!best || g > best.g) best = { k, g }; }
    if (best && best.g >= 25 && best.g / wc >= 0.025) {
      const a = (best.k / (M - 1)) * len, b = ((best.k + kw) / (M - 1)) * len;
      found.push({ kind: 'climb', at: a, gain: best.g, grade: best.g / wc, ...span(a, b) });
    }
  }

  // when two overlap, the higher-priority one stays
  found.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind]);
  const kept = [];
  for (const m of found) if (!kept.some((k) => m.p0 < k.p1 + 0.04 && k.p0 < m.p1 + 0.04)) kept.push(m);
  kept.sort((a, b) => a.p0 - b.p0);

  let sum = kept.reduce((a, m) => a + SHARE[m.kind], 0);
  const scale = sum > MAX_SHARE ? MAX_SHARE / sum : 1;
  for (const m of kept) m.share = SHARE[m.kind] * scale;
  return kept;
}

/* ------------------------------ the time warp ------------------------------ */
const IDENTITY = { pAt: (u) => u, uAt: (p) => p, zoomAt: () => 0, identity: true };

/* How the video's clock maps onto the route. `u` is the story clock (0..1), `p` the route (0..1).
   Every moment gets its share of the clock, spread over its stretch with soft shoulders; whatever is left goes
   evenly to the rest of the route. intensity 0 is a plain constant-speed flyover, 1 is the full edit. */
export function buildWarp(moments, intensity) {
  const s = clamp(intensity, 0, 1);
  if (s === 0 || !moments.length) return IDENTITY;
  const share = moments.reduce((a, m) => a + m.share, 0), cruise = 1 - share;
  // one bump per moment: flat over its stretch, raised-cosine shoulders, scaled to hold exactly its share
  const bumps = moments.map((m) => {
    const sh = Math.max(0.012, 0.5 * (m.p1 - m.p0)), f = new Float64Array(N);
    let area = 0;
    for (let i = 0; i < N; i++) {
      const p = (i + 0.5) / N, d = p < m.p0 ? m.p0 - p : p > m.p1 ? p - m.p1 : 0;
      f[i] = d >= sh ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / sh)); area += f[i] / N;
    }
    return { f, k: m.share / Math.max(area, 1e-9) };
  });
  const rho = new Float64Array(N), cum = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    let raw = cruise; for (const b of bumps) raw += b.k * b.f[i];
    rho[i] = 1 - s + s * raw; // how much video time one unit of route gets, 1 = the even flyover
    cum[i + 1] = cum[i] + rho[i] / N;
  }
  const sum = cum[N];
  const inv = (arr, x) => { // position (0..1) where the cumulative curve reaches x
    const i = Math.max(0, lowerBound(arr, x) - 1), a = arr[i], b = arr[i + 1];
    return (i + (b > a ? clamp((x - a) / (b - a), 0, 1) : 0)) / N;
  };
  const pAt = (u) => clamp(inv(cum, clamp(u, 0, 1) * sum), 0, 1);
  const uAt = (p) => { const x = clamp(p, 0, 1) * N, i = Math.min(N - 1, Math.floor(x)); return (cum[i] + (cum[i + 1] - cum[i]) * (x - i)) / sum; };
  // The camera closes in when time slows and backs off when it flies. It is eased over the video's own clock
  // (about a second each way), so a short beat never makes the zoom pump.
  const raw = new Float64Array(N), zoom = new Float64Array(N), sigma = 0.04 * N, reach = Math.ceil(3 * sigma);
  for (let j = 0; j < N; j++) raw[j] = clamp(0.45 * Math.log2(rho[Math.min(N - 1, Math.floor(pAt((j + 0.5) / N) * N))]), -0.7, 0.8);
  for (let j = 0; j < N; j++) {
    let acc = 0, wsum = 0;
    for (let k = Math.max(0, j - reach); k <= Math.min(N - 1, j + reach); k++) { const w = Math.exp(-0.5 * ((k - j) / sigma) ** 2); acc += w * raw[k]; wsum += w; }
    zoom[j] = acc / wsum;
  }
  return {
    identity: false, pAt, uAt,
    zoomAt: (p) => { const x = clamp(uAt(p) * N - 0.5, 0, N - 1), i = Math.min(N - 2, Math.floor(x)); return zoom[i] + (zoom[i + 1] - zoom[i]) * (x - i); },
  };
}

/* Everything the camera and the overlay need for a Race cut. */
export function buildRace(track, o) {
  o = o || {};
  const moments = detectMoments(track, { iv: o.iv });
  return { moments, warp: buildWarp(moments, o.intensity === undefined ? 0.8 : o.intensity), intensity: o.intensity };
}

/* a good length for a race cut: short and punchy, a little longer for the long ones */
export function suggestRaceDuration(L) {
  return Math.round(clamp(20 + 6 * Math.log2(1 + L / 1000 / 10), 20, 45));
}

/* "1:59:59" or "59:30" as seconds, or null when it is not a time */
export function parseClock(text) {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*$/.exec(text || '');
  if (!m) return null;
  const h = m[1] ? +m[1] : 0, mi = +m[2], sec = +m[3];
  if (sec > 59 || (m[1] && mi > 59)) return null;
  return h * 3600 + mi * 60 + sec;
}
