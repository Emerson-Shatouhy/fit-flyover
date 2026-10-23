import test from 'node:test';
import assert from 'node:assert/strict';
import { cardAlpha, nearestOnTrack, parseExifTime, placePhoto, schedulePhotos, timeToProgress } from '../src/photocore.js';

// a straight 1 km route heading east, one sample every 10 s from 12:00 UTC
const M = 101, track = { M, grid: { lng: [], lat: [], t: [] }, meta: { startTime: Date.UTC(2026, 9, 17, 12, 0, 0) } };
for (let i = 0; i < M; i++) { track.grid.lng.push(-71 + (i * 10) / 111320 / Math.cos(0.7)); track.grid.lat.push(42); track.grid.t.push(i * 10); }

test('exif time uses the offset when there is one', () => {
  assert.equal(parseExifTime('2026:10:17 08:00:00', '-04:00'), Date.UTC(2026, 9, 17, 12, 0, 0));
  assert.equal(parseExifTime('2026:10:17 08:00:00', '+05:30'), Date.UTC(2026, 9, 17, 2, 30, 0));
  assert.equal(parseExifTime('nonsense'), null);
  assert.equal(parseExifTime('2026:10:17 08:00:00'), new Date(2026, 9, 17, 8, 0, 0).getTime());
});

test('nearest point on the route', () => {
  const n = nearestOnTrack(track, track.grid.lng[50], 42.00005);
  assert.equal(Math.round(n.p * 100), 50); assert.ok(n.dist < 10);
});

test('time to progress, with slack at the ends and null beyond', () => {
  const at = (s) => timeToProgress(track, track.meta.startTime + s * 1000);
  assert.ok(Math.abs(at(500) - 0.5) < 1e-6);
  assert.equal(at(-60), 0); assert.equal(at(1050), 1);
  assert.equal(at(-500), null); assert.equal(at(2000), null);
});

test('placement prefers a picked spot, then GPS, then time; far photos fall back to time', () => {
  assert.deepEqual(placePhoto({ manualP: 0.3, lat: 42, lng: track.grid.lng[10] }, track), { p: 0.3, how: 'manual' });
  assert.equal(placePhoto({ lat: 42, lng: track.grid.lng[20] }, track).how, 'gps');
  const far = placePhoto({ lat: 43, lng: -71, tMs: track.meta.startTime + 250000 }, track);
  assert.equal(far.how, 'time'); assert.ok(Math.abs(far.p - 0.25) < 1e-6);
  assert.equal(placePhoto({ lat: 43, lng: -71 }, track), null);
});

test('cards queue instead of overlapping and are dropped when out of room', () => {
  const s = schedulePhotos([{ id: 'a', tau: 0.3 }, { id: 'b', tau: 0.3 }, { id: 'c', tau: 0.31 }], 30, 0.2, 0.8);
  assert.equal(s.length, 3);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].start >= s[i - 1].end);
  const tight = schedulePhotos([{ id: 'a', tau: 0.3 }, { id: 'b', tau: 0.3 }, { id: 'c', tau: 0.3 }], 30, 0.2, 0.45);
  assert.ok(tight.length < 3 && tight.every((x) => x.end <= 0.45 + 1e-9));
});

test('card alpha fades in and out', () => {
  const slot = { start: 0.3, end: 0.4 };
  assert.equal(cardAlpha(slot, 0.29, 30), 0);
  assert.equal(cardAlpha(slot, 0.35, 30), 1);
  assert.ok(cardAlpha(slot, 0.305, 30) > 0 && cardAlpha(slot, 0.305, 30) < 1);
});
