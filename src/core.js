/* core.js: pure logic for the Route Flyover app.
   FIT / GPX / TCX parsing, track preparation, camera planning, formatting.
   No DOM access, so it runs unchanged in the browser and in node tests. */

const RAD = Math.PI / 180;
const EARTH = 6371008.8;
const WORLD_M = 40075016.686; // equatorial circumference
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

/* ------------------------------------------------------------------ */
/* FIT                                                                 */
/* ------------------------------------------------------------------ */
const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in unix seconds
const REC_FIELDS = { 253: 1, 0: 1, 1: 1, 2: 1, 78: 1, 3: 1, 5: 1, 6: 1, 73: 1, 7: 1 };
const SESSION_FIELDS = { 5: 1, 6: 1 };

function readScalar(dv, off, sz, bt, le) {
  switch (bt & 0x1f) {
    case 0: case 2: { if (sz !== 1) return null; const v = dv.getUint8(off); return v === 0xff ? null : v; }
    case 1: { if (sz !== 1) return null; const v = dv.getInt8(off); return v === 0x7f ? null : v; }
    case 3: { if (sz !== 2) return null; const v = dv.getInt16(off, le); return v === 0x7fff ? null : v; }
    case 4: { if (sz !== 2) return null; const v = dv.getUint16(off, le); return v === 0xffff ? null : v; }
    case 5: { if (sz !== 4) return null; const v = dv.getInt32(off, le); return v === 0x7fffffff ? null : v; }
    case 6: { if (sz !== 4) return null; const v = dv.getUint32(off, le); return v === 0xffffffff ? null : v; }
    case 10: { if (sz !== 1) return null; const v = dv.getUint8(off); return v === 0 ? null : v; }
    case 11: { if (sz !== 2) return null; const v = dv.getUint16(off, le); return v === 0 ? null : v; }
    case 12: { if (sz !== 4) return null; const v = dv.getUint32(off, le); return v === 0 ? null : v; }
    default: return null;
  }
}

const FIT_SPORTS = { 1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 15: 'rowing', 17: 'hiking', 19: 'paddling', 41: 'paddling', 88: 'paddling' };

function parseFit(buf) {
  if (buf.byteLength < 14) throw new Error('That file is too small to be a FIT file.');
  const dv = new DataView(buf);
  const hdr = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('Not a FIT file.');
  const end = Math.min(hdr + dv.getUint32(4, true), buf.byteLength);
  const defs = {};
  const points = [];
  let sport = null;
  let lastTs = 0;
  let pos = hdr;
  try {
    while (pos < end) {
      const h = dv.getUint8(pos++);
      let local, isDef = false, hasDev = false, compressed = false, tOff = 0;
      if (h & 0x80) { compressed = true; local = (h >> 5) & 3; tOff = h & 0x1f; }
      else { isDef = !!(h & 0x40); hasDev = !!(h & 0x20); local = h & 0x0f; }

      if (isDef) {
        pos++; // reserved
        const le = dv.getUint8(pos++) === 0;
        const gmn = dv.getUint16(pos, le); pos += 2;
        const nf = dv.getUint8(pos++);
        const fields = [];
        let size = 0;
        for (let i = 0; i < nf; i++) {
          const sz = dv.getUint8(pos + 1);
          fields.push({ num: dv.getUint8(pos), sz, bt: dv.getUint8(pos + 2), off: size });
          size += sz; pos += 3;
        }
        let devSize = 0;
        if (hasDev) {
          const nd = dv.getUint8(pos++);
          for (let i = 0; i < nd; i++) { devSize += dv.getUint8(pos + 1); pos += 3; }
        }
        defs[local] = { gmn, le, fields, size, devSize };
        continue;
      }

      const d = defs[local];
      if (!d) throw new Error('Corrupt FIT data (message without definition).');
      const start = pos;
      pos += d.size + d.devSize;
      if (pos > end) break;

      const wantRec = d.gmn === 20, wantSes = d.gmn === 18;
      if (!wantRec && !wantSes && !compressed) continue;
      const rec = {};
      if (wantRec || wantSes) {
        const want = wantRec ? REC_FIELDS : SESSION_FIELDS;
        for (const f of d.fields) {
          if (!want[f.num] && f.num !== 253) continue;
          const v = readScalar(dv, start + f.off, f.sz, f.bt, d.le);
          if (v !== null) rec[f.num] = v;
        }
      }
      if (compressed) {
        let ts = lastTs - (lastTs % 32) + tOff;
        if (tOff < (lastTs % 32)) ts += 32;
        lastTs = ts; rec[253] = ts;
      } else if (rec[253] !== undefined) lastTs = rec[253];

      if (wantSes) {
        if (sport === null && rec[5] !== undefined) sport = FIT_SPORTS[rec[5]] || 'other';
        continue;
      }
      if (!wantRec || rec[0] === undefined || rec[1] === undefined) continue;
      const alt = rec[78] !== undefined ? rec[78] : rec[2];
      const spd = rec[73] !== undefined ? rec[73] : rec[6];
      points.push({
        lat: rec[0] * (180 / 2147483648),
        lon: rec[1] * (180 / 2147483648),
        ele: alt !== undefined ? alt / 5 - 500 : null,
        t: rec[253] !== undefined ? (rec[253] + FIT_EPOCH) * 1000 : null,
        hr: rec[3] !== undefined ? rec[3] : null,
        pwr: rec[7] !== undefined ? rec[7] : null,
        dist: rec[5] !== undefined ? rec[5] / 100 : null,
        spd: spd !== undefined ? spd / 1000 : null,
      });
    }
  } catch (e) {
    if (!points.length) throw e; // keep what we decoded from a truncated file
  }
  return { points, sport, name: null };
}

/* ------------------------------------------------------------------ */
/* GPX / TCX (tag scanning, no DOM needed)                             */
/* ------------------------------------------------------------------ */
const unxml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tagText = (src, name) => {
  const m = src.match(new RegExp('<(?:\\w+:)?' + name + '(?:\\s[^>]*)?>([^<]*(?:<!\\[CDATA\\[[\\s\\S]*?\\]\\]>[^<]*)*)</(?:\\w+:)?' + name + '>', 'i'));
  return m ? unxml(m[1]) : null;
};
const numOrNull = (s) => { if (s === null || s === '') return null; const v = parseFloat(s); return isFinite(v) ? v : null; };
const timeOrNull = (s) => { if (!s) return null; const v = Date.parse(s); return isFinite(v) ? v : null; };
const sportFromText = (s) => {
  if (!s) return null; s = s.toLowerCase();
  if (/run|jog/.test(s)) return 'running';
  if (/bik|cycl|ride/.test(s)) return 'cycling';
  if (/swim/.test(s)) return 'swimming';
  if (/\brow(ing|er)?\b|\berg\b/.test(s)) return 'rowing';
  if (/paddl|kayak|cano/.test(s)) return 'paddling';
  if (/hik/.test(s)) return 'hiking';
  if (/walk/.test(s)) return 'walking';
  return 'other';
};

function parseGpx(text) {
  const points = [];
  for (const tag of ['trkpt', 'rtept']) {
    const re = new RegExp('<' + tag + '\\b([^>]*?)(?:/>|>([\\s\\S]*?)</' + tag + '>)', 'g');
    let m;
    while ((m = re.exec(text))) {
      const la = /\blat\s*=\s*["']([^"']+)["']/.exec(m[1]);
      const lo = /\blon\s*=\s*["']([^"']+)["']/.exec(m[1]);
      if (!la || !lo) continue;
      const body = m[2] || '';
      points.push({
        lat: parseFloat(la[1]), lon: parseFloat(lo[1]),
        ele: numOrNull(tagText(body, 'ele')),
        t: timeOrNull(tagText(body, 'time')),
        hr: numOrNull(tagText(body, 'hr')),
        pwr: numOrNull(tagText(body, 'power') || tagText(body, 'watts')),
        dist: null, spd: null,
      });
    }
    if (points.length) break;
  }
  const trk = /<trk\b[^>]*>([\s\S]*?)(?:<trkseg|<trkpt)/i.exec(text);
  const name = (trk && tagText(trk[1], 'name')) || tagText((/<metadata\b[\s\S]*?<\/metadata>/i.exec(text) || [''])[0], 'name');
  const type = trk && tagText(trk[1], 'type');
  return { points, sport: sportFromText(type), name: name || null };
}

function parseTcx(text) {
  const points = [];
  const re = /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/g;
  let m;
  while ((m = re.exec(text))) {
    const b = m[1];
    const lat = numOrNull(tagText(b, 'LatitudeDegrees')), lon = numOrNull(tagText(b, 'LongitudeDegrees'));
    if (lat === null || lon === null) continue;
    const hrBlock = /<HeartRateBpm\b[^>]*>([\s\S]*?)<\/HeartRateBpm>/i.exec(b);
    points.push({
      lat, lon,
      ele: numOrNull(tagText(b, 'AltitudeMeters')),
      t: timeOrNull(tagText(b, 'Time')),
      hr: hrBlock ? numOrNull(tagText(hrBlock[1], 'Value')) : null,
      pwr: numOrNull(tagText(b, 'Watts')),
      dist: numOrNull(tagText(b, 'DistanceMeters')),
      spd: numOrNull(tagText(b, 'Speed')),
    });
  }
  const sp = /<Activity\b[^>]*\bSport\s*=\s*["']([^"']+)["']/i.exec(text);
  return { points, sport: sp ? sportFromText(sp[1]) : null, name: null };
}

async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/* Reads FIT / GPX / TCX (optionally .gz) from an ArrayBuffer. */
async function readActivityFile(buf, filename) {
  let u8 = new Uint8Array(buf);
  let fname = filename || '';
  if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    buf = await gunzip(buf); u8 = new Uint8Array(buf); fname = fname.replace(/\.gz$/i, '');
  }
  let out;
  if (u8.length >= 12 && u8[8] === 0x2e && u8[9] === 0x46 && u8[10] === 0x49 && u8[11] === 0x54) out = parseFit(buf);
  else {
    const text = new TextDecoder('utf-8').decode(u8);
    const head = text.slice(0, 6000);
    if (/<gpx[\s>]/i.test(head)) out = parseGpx(text);
    else if (/<TrainingCenterDatabase/i.test(head)) out = parseTcx(text);
    else throw new Error('Unsupported file. Use a .fit, .gpx or .tcx file (.gz is fine).');
  }
  if (!out.name) out.name = fname.replace(/\.(fit|gpx|tcx)$/i, '').replace(/[_]+/g, ' ').trim() || null;
  return out;
}

/* ------------------------------------------------------------------ */
/* Track preparation                                                   */
/* ------------------------------------------------------------------ */
function haversine(la1, lo1, la2, lo2) {
  const dLa = (la2 - la1) * RAD, dLo = (lo2 - lo1) * RAD;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* largest i in [0, n-2] with arr[i] <= x */
function floorIdx(arr, x) {
  let lo = 0, hi = arr.length - 1;
  if (hi < 1) return 0;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid] <= x) lo = mid; else hi = mid; }
  return lo;
}

function fillGaps(a) { // NaN gaps: linear inside, nearest at the ends. Returns false if nothing valid.
  const n = a.length; let first = -1;
  for (let i = 0; i < n; i++) if (!Number.isNaN(a[i])) { first = i; break; }
  if (first < 0) return false;
  for (let i = 0; i < first; i++) a[i] = a[first];
  let prev = first;
  for (let i = first + 1; i < n; i++) {
    if (Number.isNaN(a[i])) continue;
    for (let k = prev + 1; k < i; k++) a[k] = lerp(a[prev], a[i], (k - prev) / (i - prev));
    prev = i;
  }
  for (let i = prev + 1; i < n; i++) a[i] = a[prev];
  return true;
}

function smoothByDistance(a, g, half) {
  const n = a.length, out = new Float64Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    while (g[i] - g[lo] > half) lo++;
    while (hi + 1 < n && g[hi + 1] - g[i] <= half) hi++;
    out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
  }
  return out;
}

function smoothByIndex(a, half) {
  const n = a.length, out = new Float64Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
    out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
  }
  return out;
}

/* Douglas-Peucker on local metres, iterative. Returns kept indices. */
function simplifyIdx(x, y, tol) {
  const n = x.length, keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]], tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const dx = x[b] - x[a], dy = y[b] - y[a], len2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      let d2;
      if (len2 === 0) d2 = (x[i] - x[a]) ** 2 + (y[i] - y[a]) ** 2;
      else {
        const t = clamp(((x[i] - x[a]) * dx + (y[i] - y[a]) * dy) / len2, 0, 1);
        d2 = (x[i] - (x[a] + t * dx)) ** 2 + (y[i] - (y[a] + t * dy)) ** 2;
      }
      if (d2 > best) { best = d2; bi = i; }
    }
    if (best > tol2) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const idx = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  return idx;
}

function buildTrack(parsed, opts) {
  opts = opts || {};
  const maxLinePts = opts.maxLinePoints || 2500;
  let pts = parsed.points.filter((p) => isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0));
  if (pts.length < 2) throw new Error('No GPS route found in this file. Indoor activities have nothing to fly over.');

  // drop GPS teleports
  const kept = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = kept[kept.length - 1], b = pts[i];
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    const dt = a.t !== null && b.t !== null ? (b.t - a.t) / 1000 : null;
    if ((dt && dt > 0 && d / dt > 70 && d > 200) || d > 20000) continue;
    kept.push(b);
  }
  pts = kept;
  const n = pts.length;
  if (n < 2) throw new Error('Not enough GPS points to build a route.');

  const lat = new Float64Array(n), lon = new Float64Array(n), g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = pts[i].lat; lon[i] = pts[i].lon;
    if (i) g[i] = g[i - 1] + haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
  }
  const L = g[n - 1];
  if (L < 50) throw new Error('This route is shorter than 50 m, so there is nothing to fly over.');

  // display distance: prefer the device's own distance when it agrees with the GPS path
  let dd = g;
  {
    const r = new Float64Array(n); let ok = 0;
    for (let i = 0; i < n; i++) { const v = pts[i].dist; r[i] = v === null || v === undefined ? NaN : v; if (!Number.isNaN(r[i])) ok++; }
    if (ok >= n * 0.9 && fillGaps(r)) {
      const base = r[0]; let mx = 0;
      for (let i = 0; i < n; i++) { mx = Math.max(mx, r[i] - base); r[i] = mx; }
      if (r[n - 1] > L * 0.85 && r[n - 1] < L * 1.18) dd = r;
    }
  }

  // elapsed time
  let te = null;
  {
    const t = new Float64Array(n); let ok = 0;
    for (let i = 0; i < n; i++) { const v = pts[i].t; t[i] = v === null || v === undefined ? NaN : v; if (!Number.isNaN(t[i])) ok++; }
    if (ok >= n * 0.9 && fillGaps(t)) {
      let mx = t[0]; te = new Float64Array(n);
      for (let i = 0; i < n; i++) { mx = Math.max(mx, t[i]); te[i] = (mx - t[0]) / 1000; }
      if (te[n - 1] <= 0) te = null;
    }
  }

  // elevation
  let ele = null;
  {
    const e = new Float64Array(n); let ok = 0;
    for (let i = 0; i < n; i++) { const v = pts[i].ele; e[i] = v === null || v === undefined ? NaN : v; if (!Number.isNaN(e[i])) ok++; }
    if (ok >= n * 0.8 && fillGaps(e)) ele = smoothByDistance(e, g, 30);
  }

  // heart rate / power
  const channel = (key, minFrac, half) => {
    const a = new Float64Array(n); let ok = 0;
    for (let i = 0; i < n; i++) { const v = pts[i][key]; a[i] = v === null || v === undefined || v <= 0 ? NaN : v; if (!Number.isNaN(a[i])) ok++; }
    if (ok < n * minFrac || !fillGaps(a)) return null;
    return smoothByIndex(a, half);
  };
  const hr = channel('hr', 0.3, 3);
  const pwr = channel('pwr', 0.3, 2);

  // speed (m/s) on raw points
  let spd = null;
  if (te) {
    spd = new Float64Array(n);
    let j1 = 0, j2 = 0;
    for (let i = 0; i < n; i++) {
      while (te[i] - te[j1] > 6) j1++;
      while (j2 + 1 < n && te[j2 + 1] - te[i] <= 6) j2++;
      const dt = te[j2] - te[j1];
      spd[i] = dt >= 2 ? (dd[j2] - dd[j1]) / dt : NaN;
    }
    if (!fillGaps(spd)) spd = null;
  } else {
    const s = new Float64Array(n); let ok = 0;
    for (let i = 0; i < n; i++) { const v = pts[i].spd; s[i] = v === null || v === undefined ? NaN : v; if (!Number.isNaN(s[i])) ok++; }
    if (ok >= n * 0.8 && fillGaps(s)) spd = smoothByIndex(s, 3);
  }

  // simplified polyline used for drawing, indexes into raw points
  let latMin = Infinity, latMax = -Infinity;
  for (let i = 0; i < n; i++) { if (lat[i] < latMin) latMin = lat[i]; if (lat[i] > latMax) latMax = lat[i]; }
  const lat0 = (latMin + latMax) / 2;
  const kx = 111320 * Math.cos(lat0 * RAD), ky = 110574;
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = lon[i] * kx; Y[i] = lat[i] * ky; }
  let tol = 1.5, idx = simplifyIdx(X, Y, tol);
  while (idx.length > maxLinePts) { tol *= 1.6; idx = simplifyIdx(X, Y, tol); }
  const lineCoords = idx.map((i) => [lon[i], lat[i]]);
  const lineG = Float64Array.from(idx, (i) => g[i]);

  // uniform grid along the route
  const M = clamp(Math.round(L / 4), 800, 2400);
  const gl = { lng: new Float64Array(M), lat: new Float64Array(M), d: new Float64Array(M), ele: ele ? new Float64Array(M) : null,
    hr: hr ? new Float64Array(M) : null, pwr: pwr ? new Float64Array(M) : null, spd: spd ? new Float64Array(M) : null,
    t: te ? new Float64Array(M) : null, gain: new Float64Array(M) };
  const at = (arr, i, f) => lerp(arr[i], arr[i + 1], f);
  for (let k = 0; k < M; k++) {
    const s = (L * k) / (M - 1);
    const li = floorIdx(lineG, s);
    const lf = lineG[li + 1] > lineG[li] ? clamp((s - lineG[li]) / (lineG[li + 1] - lineG[li]), 0, 1) : 0;
    gl.lng[k] = lerp(lineCoords[li][0], lineCoords[li + 1][0], lf);
    gl.lat[k] = lerp(lineCoords[li][1], lineCoords[li + 1][1], lf);
    const i = floorIdx(g, s);
    const f = g[i + 1] > g[i] ? clamp((s - g[i]) / (g[i + 1] - g[i]), 0, 1) : 0;
    gl.d[k] = at(dd, i, f) - dd[0];
    if (ele) gl.ele[k] = at(ele, i, f);
    if (hr) gl.hr[k] = at(hr, i, f);
    if (pwr) gl.pwr[k] = at(pwr, i, f);
    if (spd) gl.spd[k] = at(spd, i, f);
    if (te) gl.t[k] = at(te, i, f);
  }
  // elevation gain with a small dead band so GPS noise does not add up
  let eleMin = Infinity, eleMax = -Infinity;
  if (ele) {
    let ref = gl.ele[0], total = 0;
    for (let k = 0; k < M; k++) {
      const e = gl.ele[k];
      if (e > ref + 1.5) { total += e - ref; ref = e; } else if (e < ref - 1.5) ref = e;
      gl.gain[k] = total;
      eleMin = Math.min(eleMin, e); eleMax = Math.max(eleMax, e);
    }
  }

  let w = Infinity, e2 = -Infinity, s2 = Infinity, n2 = -Infinity;
  for (let k = 0; k < M; k++) { w = Math.min(w, gl.lng[k]); e2 = Math.max(e2, gl.lng[k]); s2 = Math.min(s2, gl.lat[k]); n2 = Math.max(n2, gl.lat[k]); }

  const totalDist = dd[n - 1] - dd[0];
  const totalTime = te ? te[n - 1] : null;
  const avgSpeed = totalTime ? totalDist / totalTime : null;
  let sport = parsed.sport;
  if (!sport || sport === 'other') sport = avgSpeed && avgSpeed > 4.8 ? 'cycling' : sport || null;

  return {
    L, M, grid: gl,
    line: { coords: lineCoords, g: lineG },
    bounds: { w, s: s2, e: e2, n: n2 },
    lat0,
    meta: {
      name: parsed.name || null, sport,
      startTime: pts[0].t, hasTime: !!te, hasEle: !!ele, hasHr: !!hr, hasPower: !!pwr,
      totalDist, totalTime, avgSpeed, gain: ele ? gl.gain[M - 1] : null, eleMin, eleMax,
      rawPoints: parsed.points.length, usedPoints: n,
    },
  };
}

/* Channel values at progress p (0..1) along the route. */
function sampleTrack(track, p) {
  const gl = track.grid, M = track.M;
  const c = clamp(p, 0, 1) * (M - 1);
  const i = Math.min(M - 2, Math.floor(c)), f = c - i;
  const v = (a) => (a ? lerp(a[i], a[i + 1], f) : null);
  return { lng: v(gl.lng), lat: v(gl.lat), d: v(gl.d), ele: v(gl.ele), hr: v(gl.hr), pwr: v(gl.pwr), spd: v(gl.spd), t: v(gl.t), gain: v(gl.gain), s: p * track.L };
}

/* Coordinates of the drawn route up to distance s, ending exactly at the head. */
function lineUpTo(track, s) {
  const { coords, g } = track.line;
  if (s <= 0) return [coords[0], coords[0]];
  if (s >= track.L) return coords;
  const i = floorIdx(g, s);
  const f = g[i + 1] > g[i] ? clamp((s - g[i]) / (g[i + 1] - g[i]), 0, 1) : 0;
  const out = coords.slice(0, i + 1);
  out.push([lerp(coords[i][0], coords[i + 1][0], f), lerp(coords[i][1], coords[i + 1][1], f)]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */
const norm360 = (a) => ((a % 360) + 360) % 360;
const angleLerp = (a, b, t) => { const d = ((b - a + 540) % 360) - 180; return a + d * t; };

/* trapezoid velocity profile so the head eases in and out */
function easeProgress(u) {
  u = clamp(u, 0, 1);
  const r = 0.06, v = 1 / (1 - r);
  if (u < r) return (v * u * u) / (2 * r);
  if (u > 1 - r) return 1 - (v * (1 - u) * (1 - u)) / (2 * r);
  return v * (u - r / 2);
}

const TIMELINE = {
  chase: { p0: 0.10, p1: 0.90, intro: 0.18, outro: 0.84 },
  overhead: { p0: 0.10, p1: 0.90, intro: 0.18, outro: 0.84 },
  orbit: { p0: 0.04, p1: 0.96, intro: 0, outro: 1 },
};

/* hold = share of the video (each end) spent sitting on the title card. The head only starts after it and is home before it returns. */
function progressAt(style, tau, hold) {
  const T = TIMELINE[style] || TIMELINE.chase, g = hold ? hold + CARD_FADE : 0; // run only between the card clearing and the card returning
  const p0 = Math.max(T.p0, g), p1 = Math.min(T.p1, 1 - g);
  return easeProgress((tau - p0) / (p1 - p0));
}

/* The intro and finish card. It is fully up on the first and last frame, which are the same picture (the whole route, title over it),
   so a looping video has no seam. 1 = card showing, 0 = gone. */
const CARD_FADE = 0.05;

function cardAmount(plan, tau) {
  const h = plan.hold; if (!h) return 0;
  if (tau <= h || tau >= 1 - h) return 1;
  if (tau < h + CARD_FADE) return 1 - smoother((tau - h) / CARD_FADE);
  if (tau > 1 - h - CARD_FADE) return smoother((tau - (1 - h - CARD_FADE)) / CARD_FADE);
  return 0;
}

/* how much of the route is drawn: the finished route sits under the card, then pulls back to the start as the card clears */
function lineProgress(plan, tau, p) {
  const h = plan.hold; if (!h) return p;
  const retract = tau <= h ? 1 : tau < h + CARD_FADE ? 1 - smoother((tau - h) / CARD_FADE) : 0;
  return Math.max(p, retract);
}

function localFrame(track) {
  const lat0 = track.lat0, lng0 = (track.bounds.w + track.bounds.e) / 2;
  const kx = 111320 * Math.cos(lat0 * RAD), ky = 110574;
  return { lat0, lng0, kx, ky, toXY: (lng, lat) => [(lng - lng0) * kx, (lat - lat0) * ky], toLL: (x, y) => [lng0 + x / kx, lat0 + y / ky] };
}

/* best bearing and zoom to frame the whole route in a W x H view */
function frameWholeRoute(track, W, H, pitch) {
  const F = localFrame(track), M = track.M, step = Math.max(1, Math.floor(M / 240));
  const xs = [], ys = [];
  for (let k = 0; k < M; k += step) { const [x, y] = F.toXY(track.grid.lng[k], track.grid.lat[k]); xs.push(x); ys.push(y); }
  const availW = W * 0.80, availH = H * 0.62;
  const foreshorten = 0.5 + 0.5 * Math.cos(clamp(pitch, 0, 80) * RAD);
  let best = null;
  for (let b = 0; b < 360; b += 5) {
    const cb = Math.cos(b * RAD), sb = Math.sin(b * RAD);
    let rmin = Infinity, rmax = -Infinity, umin = Infinity, umax = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      const r = xs[i] * cb - ys[i] * sb, u = xs[i] * sb + ys[i] * cb;
      if (r < rmin) rmin = r; if (r > rmax) rmax = r; if (u < umin) umin = u; if (u > umax) umax = u;
    }
    const wM = Math.max(rmax - rmin, 60), hM = Math.max((umax - umin) * foreshorten, 60);
    const mppNeeded = Math.max(wM / availW, hM / availH); // metres per pixel
    const z = Math.log2((WORLD_M * Math.cos(F.lat0 * RAD)) / (512 * mppNeeded));
    if (!best || z > best.z) best = { z, b, cr: (rmin + rmax) / 2, cu: (umin + umax) / 2 };
  }
  const cb = Math.cos(best.b * RAD), sb = Math.sin(best.b * RAD);
  const x = best.cr * cb + best.cu * sb, y = -best.cr * sb + best.cu * cb;
  return { bearing: best.b, zoom: Math.min(best.z - 0.2, 16), center: F.toLL(x, y) };
}

/* smoothed travel direction along the route (compass degrees) */
function buildHeading(track, windowMeters) {
  const F = localFrame(track), M = track.M, gl = track.grid;
  const stepM = track.L / (M - 1);
  const S = new Float64Array(M + 1), C = new Float64Array(M + 1);
  const ang = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const a = Math.max(0, i - 2), b = Math.min(M - 1, i + 2);
    const dx = (gl.lng[b] - gl.lng[a]) * F.kx, dy = (gl.lat[b] - gl.lat[a]) * F.ky;
    ang[i] = Math.hypot(dx, dy) < 1e-6 ? (i ? ang[i - 1] : 0) : Math.atan2(dx, dy);
    S[i + 1] = S[i] + Math.sin(ang[i]); C[i + 1] = C[i] + Math.cos(ang[i]);
  }
  const P = (arr, x) => { x = clamp(x, 0, M); const i = Math.min(M - 1, Math.floor(x)); return lerp(arr[i], arr[i + 1], x - i); };
  const ws = Math.max(4, windowMeters / stepM);
  return (p) => {
    const c = clamp(p, 0, 1) * (M - 1);
    const a = c - 0.35 * ws, b = c + 1.1 * ws;
    const sx = P(S, b) - P(S, a), cx = P(C, b) - P(C, a);
    const i = Math.round(c);
    const th = Math.hypot(sx, cx) < 1e-3 * ws ? ang[Math.min(M - 1, i)] : Math.atan2(sx, cx);
    return norm360(th / RAD);
  };
}

/* Everything the per-frame camera needs. */
function planCamera(track, o) {
  const style = o.style || 'chase', W = o.width, H = o.height, short = Math.min(W, H);
  const pitch = o.pitch, zoomOffset = o.zoomOffset || 0, duration = o.duration || 30;
  const T = TIMELINE[style] || TIMELINE.chase;
  const cosLat = Math.cos(track.lat0 * RAD);
  const v = track.L / (duration * (T.p1 - T.p0));
  const visibleM = Math.max(1100, 4.5 * v);
  const zRef = clamp(Math.log2((WORLD_M * cosLat * 1080) / (512 * visibleM)), 9.6, 15.6);
  const followZoom = zRef + zoomOffset + Math.log2(short / 1080);
  const visibleActual = (WORLD_M * cosLat * 1080) / (512 * Math.pow(2, zRef + zoomOffset));
  const ovPitch = style === 'overhead' ? Math.min(pitch, 20) : clamp(pitch - 8, 0, 60);
  const whole = frameWholeRoute(track, W, H, ovPitch);
  const hold = o.cards ? Math.min(0.09, 1.5 / duration) : 0; // about 1.5 s on the card at each end
  return {
    style, track, W, H, pitch, zoomOffset, followZoom, hold,
    heading: buildHeading(track, clamp(visibleActual * 0.7, 300, 10000)),
    overview: { center: whole.center, zoom: whole.zoom, bearing: whole.bearing, pitch: ovPitch },
    padTop: style === 'chase' ? 0.24 * H : style === 'overhead' ? 0.08 * H : 0,
  };
}

function cameraAt(plan, tau) {
  const { style, track } = plan, T = TIMELINE[style] || TIMELINE.chase, h = plan.hold || 0;
  const p = progressAt(style, tau, h);
  const ov = plan.overview, card = cardAmount(plan, tau), line = lineProgress(plan, tau, p);
  if (style === 'orbit') {
    // a full turn, so the last frame lines up with the first and the loop is seamless
    return { center: ov.center, zoom: ov.zoom + 0.35 + plan.zoomOffset * 0.6, bearing: norm360(ov.bearing + 360 * tau), pitch: plan.pitch, padTop: 0, p, card, line };
  }
  const head = sampleTrack(track, p);
  const follow = {
    center: [head.lng, head.lat], zoom: plan.followZoom, pitch: plan.pitch,
    bearing: style === 'overhead' ? 0 : plan.heading(p),
  };
  let w = 0; // 1 = overview, 0 = follow
  // the overview is held while the card is up, then the camera dives in; on the way out it pulls back to the overview before the card returns
  if (tau <= h) w = 1;
  else if (tau < T.intro) w = 1 - smoother((tau - h) / (T.intro - h));
  else if (tau > T.outro) w = smoother((tau - T.outro) / (1 - h - T.outro));
  const ovb = style === 'overhead' ? 0 : ov.bearing;
  return {
    center: [lerp(follow.center[0], ov.center[0], w), lerp(follow.center[1], ov.center[1], w)],
    zoom: lerp(follow.zoom, ov.zoom, w),
    pitch: lerp(follow.pitch, ov.pitch, w),
    bearing: norm360(angleLerp(follow.bearing, ovb, w)),
    padTop: lerp(plan.padTop, 0, w),
    p, card, line,
  };
}

/* suggested video length for a given route length */
function suggestDuration(L) {
  return Math.round(clamp(14 + 5.5 * Math.log2(1 + L / 1000 / 2.5), 18, 60));
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
const MI = 1609.344;
const pad2 = (n) => String(n).padStart(2, '0');
function fmtDistance(m, units) {
  return (units === 'mi' ? m / MI : m / 1000).toFixed(2);
}
const distUnit = (u) => (u === 'mi' ? 'mi' : 'km');
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
}
function fmtPace(mps, units) {
  if (!(mps > 0.3)) return '–';
  let sec = Math.round((units === 'mi' ? MI : 1000) / mps);
  if (sec > 5999) return '–';
  return Math.floor(sec / 60) + ':' + pad2(sec % 60);
}
const paceUnit = (u) => (u === 'mi' ? '/mi' : '/km');
const fmtSpeed = (mps, units) => (mps >= 0 ? ((mps * 3600) / (units === 'mi' ? MI : 1000)).toFixed(1) : '–');
const speedUnit = (u) => (u === 'mi' ? 'mph' : 'km/h');
const fmtElev = (m, units) => String(Math.round(units === 'mi' ? m * 3.28084 : m));
const elevUnit = (u) => (u === 'mi' ? 'ft' : 'm');

/* ------------------------------------------------------------------ */
/* Sample route (generated, not real data)                             */
/* ------------------------------------------------------------------ */
function makeSample() {
  const lat0 = 44.2795, lng0 = -73.9799, kx = 111320 * Math.cos(lat0 * RAD), ky = 110574;
  const pts = [], N = 900, t0 = Date.UTC(2026, 8, 12, 11, 0, 0);
  let t = t0, prevX = null, prevY = null, dist = 0;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const r = 2300 * (1 + 0.28 * Math.sin(3 * th + 0.4) + 0.12 * Math.sin(5 * th + 1.3) + 0.07 * Math.cos(2 * th));
    const x = r * Math.cos(th), y = r * 0.8 * Math.sin(th);
    const ele = 590 + 70 * Math.sin(2 * th + 1) + 32 * Math.sin(5 * th) + 14 * Math.sin(11 * th);
    if (prevX !== null) {
      const d = Math.hypot(x - prevX, y - prevY); dist += d;
      const grade = (ele - pts[pts.length - 1].ele) / Math.max(d, 1);
      t += (1000 * d) / (3.15 - clamp(grade * 5, -0.6, 1.2));
    }
    prevX = x; prevY = y;
    pts.push({ lat: lat0 + y / ky, lon: lng0 + x / kx, ele, t, hr: Math.round(146 + 14 * Math.sin(th * 3) + 8 * Math.sin(th * 7)), pwr: null, dist, spd: null });
  }
  return { points: pts, sport: 'running', name: 'Sample loop (generated)' };
}

export {
  parseFit, parseGpx, parseTcx, readActivityFile, buildTrack, sampleTrack, lineUpTo, planCamera, cameraAt, progressAt, frameWholeRoute, buildHeading, suggestDuration, makeSample, fmtDistance, distUnit, fmtDuration, fmtPace, paceUnit, fmtSpeed, speedUnit, fmtElev, elevUnit, haversine, clamp, lerp, smoother, norm360,
};
