/* Pure helpers for photo pop-ups: reading capture times, placing a photo on the route, and timing the cards. No app state, so they can be tested. */

export const MAX_PHOTOS = 8;

/* EXIF "2026:10:17 09:12:34" plus an optional "-04:00" offset -> epoch ms. Without an offset the time is taken in this browser's timezone. */
export function parseExifTime(raw, offset) {
  const m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(String(raw || ''));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const om = /^([+-])(\d\d):?(\d\d)$/.exec(String(offset || '').trim());
  if (om) return Date.UTC(y, mo - 1, d, h, mi, s) - (om[1] === '-' ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3])) * 60000;
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

/* closest route sample to a point: progress p (0..1) and the distance away in metres */
export function nearestOnTrack(track, lng, lat) {
  const g = track.grid, M = track.M, kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
  let best = Infinity, at = 0;
  for (let i = 0; i < M; i++) {
    const dx = (g.lng[i] - lng) * kx, dy = (g.lat[i] - lat) * ky, d = dx * dx + dy * dy;
    if (d < best) { best = d; at = i; }
  }
  return { p: at / (M - 1), dist: Math.sqrt(best) };
}

/* epoch ms -> progress p along a timed route, or null if it is more than a couple of minutes outside it */
export function timeToProgress(track, ms, slack = 120) {
  const g = track.grid, M = track.M, st = track.meta.startTime;
  if (!g.t || st == null || ms == null) return null;
  const t = (ms - st) / 1000;
  if (t < g.t[0] - slack || t > g.t[M - 1] + slack) return null;
  if (t <= g.t[0]) return 0;
  if (t >= g.t[M - 1]) return 1;
  let lo = 0, hi = M - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g.t[mid] <= t) lo = mid; else hi = mid; }
  return (lo + (t - g.t[lo]) / Math.max(1e-9, g.t[hi] - g.t[lo])) / (M - 1);
}

const FAR = 1000; // a photo further than this from the route is not on it

/* where a photo goes: a spot you picked, else its GPS, else its time. null = it needs a spot. */
export function placePhoto(ph, track) {
  if (ph.manualP != null) return { p: ph.manualP, how: 'manual' };
  if (ph.lat != null && ph.lng != null) {
    const n = nearestOnTrack(track, ph.lng, ph.lat);
    if (n.dist <= FAR) return { p: n.p, how: 'gps' };
  }
  const p = timeToProgress(track, ph.tMs);
  return p == null ? null : { p, how: 'time' };
}

/* When each card shows, as fractions of the video. items: [{ id, tau }] where tau is when the head reaches the photo.
   Cards never overlap: a later one waits for the earlier one, and is dropped if it would not fit before maxTau. */
export function schedulePhotos(items, duration, minTau, maxTau) {
  const show = 2.4 / duration, lead = 0.2 / duration, gap = 0.25 / duration, out = [];
  let prevEnd = -Infinity;
  for (const it of [...items].sort((a, b) => a.tau - b.tau)) {
    let start = Math.max(minTau, it.tau - lead, prevEnd + gap);
    if (start + show > maxTau) start = Math.max(minTau, maxTau - show);
    if (start < prevEnd + gap - 1e-9) continue; // no room
    prevEnd = start + show;
    out.push({ id: it.id, start, end: prevEnd });
  }
  return out;
}

/* 0..1: fades in at the start, out at the end */
export function cardAlpha(slot, tau, duration) {
  const fade = 0.4 / duration, sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (x * 6 - 15) + 10); };
  return Math.min(sm((tau - slot.start) / fade), 1 - sm((tau - (slot.end - fade)) / fade));
}
