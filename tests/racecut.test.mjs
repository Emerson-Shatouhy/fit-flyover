import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../src/core.js';
import * as R from '../src/racecut.js';

/* a straight line with a pace profile: speedAt(metres) in m/s */
function lineTrack(len, speedAt) {
  const lat0 = 42.3, lng0 = -71.1, kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const pts = []; let t = Date.UTC(2026, 10, 1, 12), d = 0;
  while (d <= len) {
    pts.push({ lat: lat0, lon: lng0 + d / kx, ele: 20, t, hr: null, pwr: null, dist: d, spd: null });
    t += (10 / speedAt(d)) * 1000; d += 10;
  }
  return C.buildTrack({ points: pts, sport: 'running', name: 'synthetic' });
}

const LEN = 21000;
const surge = lineTrack(LEN, (d) => (d < 14000 ? 3.2 : d < LEN - 400 ? 3.7 : 4.6));
const steady = lineTrack(LEN, (d) => 3.3 + 0.03 * Math.sin(d / 900));
const kinds = (ms) => ms.map((m) => m.kind);

/* ---------- classic mode is untouched ---------- */
test('classic mode: the camera matches the original code to the last digit', () => {
  const gold = JSON.parse(fs.readFileSync(new URL('./classic-golden.json', import.meta.url), 'utf8')), track = C.buildTrack(C.makeSample());
  let n = 0;
  for (const key of Object.keys(gold)) {
    const [style, cards] = key.split('+');
    const plan = C.planCamera(track, { style, width: 1080, height: 1920, pitch: 62, zoomOffset: 0, duration: 30, cards: !!cards, buildings: false });
    for (const row of gold[key]) {
      const c = C.cameraAt(plan, row[0]), now = [c.center[0], c.center[1], c.zoom, c.bearing, c.pitch, c.padTop, c.p, c.card, c.line];
      now.forEach((v, i) => { assert.ok(Math.abs(v - row[i + 1]) < 1e-9, key + ' @' + row[0] + ' field ' + i); n++; });
    }
  }
  assert.ok(n > 300);
});

test('a plan without a race option has no race in it', () => {
  assert.equal(C.planCamera(surge, { style: 'chase', width: 1080, height: 1920, pitch: 62, duration: 30, cards: true }).race, null);
});

/* ---------- moments ---------- */
test('finds the shift, the kick and halfway where they are', () => {
  const ms = R.detectMoments(surge, { iv: 1609.344 }), by = (k) => ms.find((m) => m.kind === k);
  assert.ok(by('shift') && Math.abs(by('shift').at / LEN - 14000 / LEN) < 0.03, 'shift near 14 km: ' + JSON.stringify(kinds(ms)));
  assert.ok(by('shift').to > by('shift').from * 1.1, 'speeds are before and after');
  assert.ok(by('kick') && by('kick').p1 > 0.99 && by('kick').to > by('kick').from * 1.1, 'kick at the end');
  assert.ok(by('half') && Math.abs(by('half').p0 - 0.5) < 0.03, 'halfway');
});

test('moments are in order, never overlap, and leave the steady stretches most of the time', () => {
  const ms = R.detectMoments(surge, { iv: 1609.344 });
  for (let i = 1; i < ms.length; i++) assert.ok(ms[i].p0 >= ms[i - 1].p1, 'overlap at ' + i);
  assert.ok(ms.reduce((a, m) => a + m.share, 0) <= 0.6 + 1e-9);
});

test('a steady run has no shift or kick', () => {
  const ms = R.detectMoments(steady, { iv: 1609.344 });
  assert.ok(!kinds(ms).includes('shift') && !kinds(ms).includes('kick'), JSON.stringify(kinds(ms)));
});

test('short or untimed routes degrade gracefully', () => {
  assert.deepEqual(R.detectMoments(lineTrack(600, () => 3), {}), []);
  const untimed = C.buildTrack(Object.assign(C.makeSample(), { points: C.makeSample().points.map((p) => Object.assign({}, p, { t: null })) }));
  assert.doesNotThrow(() => R.buildRace(untimed, { iv: 1609.344 }));
});

/* ---------- the warp ---------- */
test('intensity 0 is the plain flyover', () => {
  const w = R.buildWarp(R.detectMoments(surge, {}), 0);
  for (const u of [0, 0.1, 0.37, 0.5, 0.93, 1]) { assert.equal(w.pAt(u), u); assert.equal(w.zoomAt(u), 0); }
});

test('the warp is a monotone map from 0 to 0 and 1 to 1, and uAt undoes pAt', () => {
  const ms = R.detectMoments(surge, {}), w = R.buildWarp(ms, 1);
  assert.ok(Math.abs(w.pAt(0)) < 1e-12 && Math.abs(w.pAt(1) - 1) < 1e-12);
  let prev = -1;
  for (let i = 0; i <= 2000; i++) { const p = w.pAt(i / 2000); assert.ok(p > prev - 1e-15, 'monotone at ' + i); prev = p; }
  for (const u of [0.05, 0.3, 0.66, 0.97]) assert.ok(Math.abs(w.uAt(w.pAt(u)) - u) < 1e-6, 'round trip ' + u);
});

test('moments get far more video time than their distance, and the steady stretches fly', () => {
  const ms = R.detectMoments(surge, {}), w = R.buildWarp(ms, 1);
  const cruise = (w.uAt(0.4) - w.uAt(0.1)) / 0.3; // video time per unit of route in the steady first stretch
  assert.ok(cruise < 0.9, 'the first stretch is quicker than even: ' + cruise.toFixed(2));
  for (const k of ['shift', 'kick']) {
    const m = ms.find((x) => x.kind === k), rate = (w.uAt(m.p1) - w.uAt(m.p0)) / (m.p1 - m.p0);
    assert.ok(rate > 1.5 && rate > 2.5 * cruise, k + ' runs at ' + rate.toFixed(2) + ' against ' + cruise.toFixed(2));
  }
});

test('less intensity sits between the even flyover and the full edit', () => {
  const ms = R.detectMoments(surge, {}), full = R.buildWarp(ms, 1), half = R.buildWarp(ms, 0.5), m = ms.find((x) => x.kind === 'kick');
  const took = (w) => w.uAt(m.p1) - w.uAt(m.p0), even = m.p1 - m.p0;
  assert.ok(took(half) > even && took(half) < took(full));
});

/* ---------- the camera in a race cut ---------- */
const racePlan = (style, cards, duration = 30) => C.planCamera(surge, { style, width: 1080, height: 1920, pitch: 62, zoomOffset: 0, duration, cards, race: R.buildRace(surge, { iv: 1609.344, intensity: 0.8 }) });
const same = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, what + ': ' + a + ' vs ' + b);

for (const style of ['chase', 'overhead', 'orbit']) {
  test('race cut ' + style + ': first and last frame are the same picture, and the loop is seamless', () => {
    const p = racePlan(style, true), a = C.cameraAt(p, 0), b = C.cameraAt(p, 1);
    same(a.center[0], b.center[0], 'lng'); same(a.center[1], b.center[1], 'lat'); same(a.zoom, b.zoom, 'zoom'); same(a.pitch, b.pitch, 'pitch');
    same(((a.bearing - b.bearing + 540) % 360) - 180, 0, 'bearing'); same(a.card, 1, 'card'); same(b.card, 1, 'card'); same(a.line, 1, 'line'); same(b.line, 1, 'line');
  });

  test('race cut ' + style + ': the head only moves forward, and is home before the card returns', () => {
    const p = racePlan(style, true), h = p.hold; let prev = 0;
    for (let i = 0; i <= 1200; i++) { const c = C.cameraAt(p, i / 1200); assert.ok(c.p >= prev - 1e-12, 'backwards at ' + i); prev = c.p; }
    assert.equal(C.cameraAt(p, 1 - h - 0.05).p, 1); assert.equal(C.cameraAt(p, h).p, 0);
  });

  test('race cut ' + style + ': nothing jumps from one frame to the next', () => {
    // the zoom may move more than a classic flyover's (it closes in on moments), but only a little more
    const p = racePlan(style, true); let prev = C.cameraAt(p, 0), room = 0.04;
    const base = C.planCamera(surge, { style, width: 1080, height: 1920, pitch: 62, zoomOffset: 0, duration: 30, cards: true }); let bp = C.cameraAt(base, 0), worst = 0;
    for (let i = 1; i <= 900; i++) { const c = C.cameraAt(base, i / 900); worst = Math.max(worst, Math.abs(c.zoom - bp.zoom)); bp = c; }
    for (let i = 1; i <= 900; i++) {
      const cur = C.cameraAt(p, i / 900);
      assert.ok(Math.abs(cur.zoom - prev.zoom) < worst + room, 'zoom step at ' + i + ': ' + Math.abs(cur.zoom - prev.zoom) + ' vs classic ' + worst);
      assert.ok(Math.abs(cur.card - prev.card) < 0.1 && Math.abs(cur.line - prev.line) < 0.1, 'card/route step at ' + i);
      assert.ok(Math.abs(cur.p - prev.p) < 0.02, 'head step at ' + i + ': ' + Math.abs(cur.p - prev.p));
      prev = cur;
    }
  });
}

test('race cut with the card off still starts at the start and ends at the end', () => {
  const p = racePlan('chase', false);
  assert.equal(C.cameraAt(p, 0).p, 0); assert.equal(C.cameraAt(p, 1).p, 1); assert.equal(C.cameraAt(p, 0.5).card, 0);
});

test('the shift and the kick stay on screen long enough to read', () => {
  for (const d of [15, 30, 45]) {
    const p = racePlan('chase', true, d), ms = p.race.moments;
    for (const k of ['shift', 'kick']) {
      const m = ms.find((x) => x.kind === k), secs = (C.tauAtP(p, m.p1) - C.tauAtP(p, m.p0)) * d;
      assert.ok(secs >= (d === 15 ? 1.2 : 1.8), k + ' on screen ' + secs.toFixed(2) + ' s of ' + d);
    }
  }
});

test('tauAtP finds when the head gets there', () => {
  const p = racePlan('chase', true);
  for (const target of [0.2, 0.5, 0.8]) { const tau = C.tauAtP(p, target); assert.ok(Math.abs(C.cameraAt(p, tau).p - target) < 1e-3, 'p at ' + target); }
});

/* ---------- small helpers ---------- */
test('parseClock reads h:mm:ss and mm:ss and refuses the rest', () => {
  assert.equal(R.parseClock('1:47:30'), 6450); assert.equal(R.parseClock(' 59:30 '), 3570); assert.equal(R.parseClock('0:45:00'), 2700);
  for (const bad of ['', '45', '1:75:00', '1:2:3', 'abc', '12:60', null, undefined]) assert.equal(R.parseClock(bad), null, String(bad));
});

test('a race cut is suggested short, and a little longer for longer routes', () => {
  const a = R.suggestRaceDuration(5000), b = R.suggestRaceDuration(21097), c = R.suggestRaceDuration(180000);
  assert.ok(a >= 20 && c <= 45 && a <= b && b <= c, [a, b, c].join(','));
});
