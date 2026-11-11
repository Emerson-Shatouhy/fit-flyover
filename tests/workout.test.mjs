import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core.js';
import * as W from '../src/workout.js';

/* the same shape as a real 20 on / 40 off session: warm-up, a lighter opener set, then three hard sets, then a cooldown */
const sample = () => W.buildWorkout(W.makeSampleWorkout());
const w = sample();

/* ---------- reading the file ---------- */
test('indoor: a VirtualRide GPX, or a file with no coordinates, is a workout; a normal activity is not', () => {
  const gpx = '<gpx><trk><name>Zwift - x</name><type>VirtualRide</type><trkseg><trkpt lat="1" lon="2"><time>2026-01-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>';
  assert.equal(W.isIndoor(C.parseGpx(gpx)), true);
  assert.equal(W.isIndoor({ points: [], series: new Array(60).fill({ t: 0, pwr: 100, hr: 120 }) }), true);
  assert.equal(W.isIndoor({ points: new Array(500).fill({ lat: 1, lon: 1 }), series: null }), false);
  assert.equal(W.isIndoor(C.parseGpx('<gpx><trk><name>Morning run</name><type>running</type><trkseg></trkseg></trk></gpx>')), false);
});

test('buildWorkout: a file with no power is not a workout', () => {
  const pts = Array.from({ length: 100 }, (_, i) => ({ t: i * 1000, pwr: null, hr: 120 }));
  assert.equal(W.buildWorkout({ points: [], series: pts }), null);
});

test('buildWorkout: puts the samples on whole seconds, and a long pause reads as zero power', () => {
  const pts = [];
  for (let i = 0; i < 60; i++) pts.push({ t: i * 1000, pwr: 200, hr: 130 });
  for (let i = 80; i < 140; i++) pts.push({ t: i * 1000, pwr: 200, hr: 130 }); // 20 s with no records
  const x = W.buildWorkout({ points: [], series: pts });
  assert.equal(x.n, 140);
  assert.equal(x.pwr[30], 200);
  assert.equal(x.pwr[70], 0);
});

/* ---------- finding the efforts ---------- */
test('detect: four sets of five 20 s efforts, with the right power', () => {
  assert.equal(w.sets.length, 4);
  assert.equal(w.efforts.length, 20);
  for (const s of w.sets) { assert.equal(s.count, 5); assert.ok(Math.abs(s.dur - 21) <= 2, 'effort length ' + s.dur); }
  assert.ok(Math.abs(w.sets[0].workAvg - 407) < 6, 'opener ' + w.sets[0].workAvg);
  for (const s of w.sets.slice(1)) assert.ok(Math.abs(s.workAvg - 500) < 6, 'set ' + s.workAvg);
  for (const s of w.sets) assert.ok(Math.abs(s.restAvg - (s.n === 1 ? 100 : 125)) < 8, 'rest ' + s.restAvg);
  assert.deepEqual(W.describeSets(w).map((x) => x.split(' @ ')[0]), ['5 × 20 s', '5 × 20 s', '5 × 20 s', '5 × 20 s']);
});

test('detect: a set peak heart rate is read from the set and the seconds after it', () => {
  for (const s of w.sets) assert.ok(s.hrPeak >= w.hr[s.e - 1] - 1 && s.hrPeak <= w.maxHr);
});

test('detect: a steady endurance ride has no intervals to show', () => {
  const pts = Array.from({ length: 1800 }, (_, i) => ({ t: i * 1000, pwr: 180 + 20 * Math.sin(i / 60), hr: 130 }));
  const x = W.buildWorkout({ points: [], series: pts });
  assert.equal(x.sets.length, 0);
  assert.equal(x.efforts.length, 0);
});

test('detect: a few long efforts are one set, and the sprint at the start of a ride is not an effort', () => {
  const pts = [];
  let t = 0;
  const add = (len, p) => { for (let i = 0; i < len; i++, t++) pts.push({ t: t * 1000, pwr: p, hr: 140 }); };
  add(5, 480); add(600, 130); // a few seconds of sprint, then the warm-up
  for (let r = 0; r < 3; r++) { add(300, 330); add(240, 120); }
  add(300, 100);
  const x = W.buildWorkout({ points: [], series: pts });
  assert.equal(x.efforts.length, 3);
  assert.equal(x.sets.length, 1);
  assert.equal(x.sets[0].count, 3);
  assert.equal(W.fmtLen(x.sets[0].dur), '5:00');
});

/* ---------- the time warp ---------- */
test('warp: runs from 0 to the end, always forward, and uAt undoes timeAt', () => {
  const warp = W.buildWorkoutWarp(w, 0.8);
  assert.equal(warp.timeAt(0), 0);
  assert.ok(Math.abs(warp.timeAt(1) - w.T) < 1e-6);
  let prev = -1;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400, s = warp.timeAt(u);
    assert.ok(s >= prev, 'monotone at ' + u); prev = s;
    assert.ok(Math.abs(warp.uAt(s) - u) < 1e-6, 'inverse at ' + u);
  }
});

test('warp: intensity 0 is a constant-speed playback', () => {
  const warp = W.buildWorkoutWarp(w, 0);
  assert.equal(warp.identity, true);
  assert.ok(Math.abs(warp.timeAt(0.5) - w.T / 2) < 1e-9);
});

test('warp: an effort gets far more video time than the same stretch of rest', () => {
  const warp = W.buildWorkoutWarp(w, 0.8), f = w.sets[1].efforts[1], rest = w.sets[1].efforts[1].e + 5;
  const videoPerSec = (a, b) => (warp.uAt(b) - warp.uAt(a)) / (b - a);
  const eff = videoPerSec(f.s + 2, f.e - 2), restRate = videoPerSec(rest, rest + 20), gap = videoPerSec(w.sets[0].e + 30, w.sets[0].e + 150);
  assert.ok(eff > restRate * 3, 'effort ' + eff + ' vs rest ' + restRate);
  assert.ok(restRate > gap * 2, 'rest ' + restRate + ' vs gap ' + gap);
});

test('warp: at the suggested length every effort is on screen for a beat of at least a second', () => {
  const warp = W.buildWorkoutWarp(w, 0.8), len = W.suggestWorkoutDuration(w);
  for (const f of w.efforts) assert.ok((warp.uAt(f.e) - warp.uAt(f.s)) * len >= 0.8, 'effort at ' + f.s);
  assert.ok(len >= 20 && len <= 45);
});

/* ---------- frames ---------- */
test('frames: the first and last frame are the same picture (the whole session under the title card)', () => {
  for (const cards of [true, false]) {
    const a = W.workoutFrame(w, 0, { cards, duration: 30 }), b = W.workoutFrame(w, 1, { cards, duration: 30 });
    assert.equal(a.card, cards ? 1 : 0); assert.equal(b.card, a.card);
    assert.equal(a.sec, 0); assert.ok(Math.abs(b.sec - w.T) < 1e-6);
  }
});

test('frames: the card clears before the clock starts and returns after it stops', () => {
  const o = { cards: true, duration: 30 }, hold = 0.05, fade = 0.05;
  assert.equal(W.workoutFrame(w, hold, o).card, 1);
  assert.equal(W.workoutFrame(w, hold + fade + 0.01, o).card, 0);
  assert.equal(W.workoutFrame(w, hold + fade, o).sec, 0);
  const mid = W.workoutFrame(w, 0.5, o);
  assert.equal(mid.card, 0); assert.ok(mid.sec > 0 && mid.sec < w.T);
});

test('status: says where the session is', () => {
  assert.equal(W.statusAt(w, 10).text, 'WARM-UP');
  const f = w.sets[1].efforts[2], s = W.statusAt(w, f.s + 5);
  assert.equal(s.text, 'SET 2 · EFFORT 3 OF 5'); assert.equal(s.on, true);
  assert.equal(W.statusAt(w, f.e + 10).on, false);
  assert.equal(W.statusAt(w, w.sets[0].e + 60).text, 'RECOVERY');
  assert.equal(W.statusAt(w, w.T - 5).text, 'COOLDOWN');
});
