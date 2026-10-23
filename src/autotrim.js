import { haversine } from './core.js';

/* Finds the race (the hardest sustained effort) inside an activity so the trim handles can be placed for you.
   Works on speed over time: the warm-up, cool-down and standing around are all slower than the race itself.
   Input is the raw parsed points; output is in seconds from the first timestamped point, the same units as the trim sliders. */

const GRID = 1;            // resample to 1 Hz
const MOVING = 0.5;        // m/s, below this counts as standing still
const EFFORT = 0.8;        // a race second is at least this fraction of the best sustained speed
const BRIDGE = 45;         // s, short dips (a corner, a feed stop) do not end the race; the 20 s smoothing stretches a dip, so this is generous
const MIN_RACE = 45;       // s, shorter blocks are surges, not races
const LEAD = 3, TAIL = 3;  // s of padding either side

const median = (a) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };

const percentile = (a, q) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

/* centred moving mean, half-width h samples */
function smooth(a, h) {
  const n = a.length, out = new Float64Array(n), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + a[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - h), hi = Math.min(n - 1, i + h); out[i] = (cs[hi + 1] - cs[lo]) / (hi - lo + 1); }
  return out;
}

function medianFilter(a, h) {
  const n = a.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = median(a.subarray(Math.max(0, i - h), Math.min(n, i + h + 1)));
  return out;
}

/* speed in m/s on a 1 Hz grid starting at the first timestamped point */
export function speedGrid(points) {
  const pts = points.filter((p) => p.t !== null && p.t !== undefined && isFinite(p.t));
  if (pts.length < 20) return null;
  const t0 = pts[0].t, n = Math.floor((pts[pts.length - 1].t - t0) / 1000 / GRID) + 1;
  if (n < 60) return null;
  // cumulative distance at each point: device distance when it is there, otherwise from the GPS track
  const haveDist = pts.filter((p) => p.dist !== null && p.dist !== undefined).length >= pts.length * 0.8;
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    cum[i] = haveDist && b.dist !== null && b.dist !== undefined && a.dist !== null && a.dist !== undefined
      ? cum[i - 1] + Math.max(0, b.dist - a.dist) : cum[i - 1] + haversine(a.lat, a.lon, b.lat, b.lon);
  }
  const d = new Float64Array(n); let k = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * GRID * 1000;
    while (k + 1 < pts.length - 1 && pts[k + 1].t <= t) k++;
    const a = pts[k], b = pts[k + 1], span = b.t - a.t;
    // inside a long gap (paused timer) distance stays put rather than drifting across it
    d[i] = span > 30000 ? (t - a.t < span / 2 ? cum[k] : cum[k + 1]) : cum[k] + (cum[k + 1] - cum[k]) * Math.min(1, Math.max(0, (t - a.t) / Math.max(1, span)));
  }
  const raw = new Float64Array(n), h = 3;
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - h), hi = Math.min(n - 1, i + h); raw[i] = (d[hi] - d[lo]) / Math.max(1, (hi - lo) * GRID); }
  return medianFilter(raw, 2); // drops the odd GPS spike
}

/* returns { start, end, confidence, note } in seconds, or null when there is not enough to go on */
export function detectRace(points) {
  const s = speedGrid(points);
  if (!s) return { start: 0, end: 0, confidence: 'none', note: 'Auto-detect needs timestamps and at least a minute of data.' };
  const n = s.length, moving = [];
  for (let i = 0; i < n; i++) if (s[i] > MOVING) moving.push(s[i]);
  if (moving.length < MIN_RACE) return { start: 0, end: 0, confidence: 'none', note: 'Could not find any sustained movement to detect a race from.' };

  const r = smooth(s, 10);                       // 20 s picture of effort
  const peak = percentile(Array.from(r), 0.98);  // best sustained speed, ignoring blips
  const theta = EFFORT * peak;

  // runs above the effort line, bridging short dips
  const blocks = []; let a = -1, last = -1;
  for (let i = 0; i < n; i++) {
    if (r[i] >= theta) { if (a < 0) a = i; last = i; }
    else if (a >= 0 && i - last > BRIDGE) { blocks.push([a, last]); a = -1; }
  }
  if (a >= 0) blocks.push([a, last]);
  const scored = blocks.filter(([x, y]) => y - x >= MIN_RACE).map(([x, y]) => {
    let sum = 0; for (let i = x; i <= y; i++) sum += s[i];
    return { x, y, dist: sum * GRID, med: median(s.subarray(x, y + 1)) };
  }).sort((p, q) => q.dist - p.dist);
  if (!scored.length) return { start: 0, end: 0, confidence: 'none', note: 'No sustained hard effort found, so there is nothing obvious to cut.' };

  const B = scored[0], sm = smooth(s, 2);
  // the block edge is where the 20 s average crossed the line; the real start is the low point just before the speed-up
  let start = B.x, lowest = Infinity;
  for (let i = Math.max(0, B.x - 25); i <= B.x; i++) if (sm[i] <= lowest + 0.1) { if (sm[i] < lowest) lowest = sm[i]; start = i; }
  // the real finish is the last second still near race speed, shortly after the block edge
  let end = B.y;
  for (let i = Math.min(n - 1, B.y + 20); i >= B.y - 10; i--) if (sm[i] >= 0.7 * B.med) { end = i; break; }
  start = Math.max(0, start - LEAD); end = Math.min(n - 1, end + TAIL);

  // how clearly the race stands out from the rest of the movement
  const rest = []; for (let i = 0; i < n; i++) if ((i < start || i > end) && s[i] > MOVING) rest.push(s[i]);
  const cut = start + (n - 1 - end);
  const contrast = rest.length >= 30 ? B.med / Math.max(0.1, median(rest)) : Infinity;
  const confidence = cut < Math.max(15, n * 0.03) ? 'low' : contrast >= 1.15 ? 'high' : 'low';
  const note = cut < Math.max(15, n * 0.03) ? 'The activity is already mostly the race, so only a little was cut.'
    : confidence === 'low' ? 'The race does not stand out much from the rest, so check the cut points.' : '';
  return { start, end, confidence, note, total: n - 1 };
}
