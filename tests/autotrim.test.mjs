import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRace } from '../src/autotrim.js';

/* build points along a straight line from a list of [seconds, metres per second] legs */
function make(legs, { t0 = Date.UTC(2026, 9, 1, 12), jitter = 0 } = {}) {
  const pts = []; let d = 0, t = 0, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (const [secs, v] of legs) {
    for (let i = 0; i < secs; i++) {
      d += Math.max(0, v + jitter * rnd()); t++;
      pts.push({ lat: 42 + d / 111320, lon: -71, ele: null, t: t0 + t * 1000, hr: null, pwr: null, dist: null, spd: null });
    }
  }
  return pts;
}

const within = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, what + ': got ' + got + ', wanted ' + want + ' +/- ' + tol);

test('finds a race between a warm-up and a cool-down', () => {
  // 10 min easy at 2.8, 2 min standing, 20 min race at 4.0, 8 min easy at 2.5
  const r = detectRace(make([[600, 2.8], [120, 0], [1200, 4.0], [480, 2.5]], { jitter: 0.3 }));
  assert.equal(r.confidence, 'high');
  within(r.start, 720, 20, 'start'); within(r.end, 1920, 20, 'end');
});

test('rolling start straight out of a warm-up jog', () => {
  const r = detectRace(make([[900, 2.9], [1500, 4.2], [600, 2.0]], { jitter: 0.3 }));
  within(r.start, 900, 25, 'start'); within(r.end, 2400, 25, 'end');
});

test('picks the fastest effort when there are several', () => {
  const r = detectRace(make([[300, 2.5], [240, 3.6], [300, 2.0], [900, 4.4], [300, 2.0]], { jitter: 0.2 }));
  within(r.start, 840, 25, 'start'); within(r.end, 1740, 25, 'end');
});

test('a short stop inside the race does not split it', () => {
  const r = detectRace(make([[300, 2.5], [600, 4.0], [12, 0], [600, 4.0], [300, 2.5]], { jitter: 0.2 }));
  within(r.start, 300, 25, 'start'); within(r.end, 1512, 25, 'end');
});

test('a steady activity is flagged as low confidence and barely cut', () => {
  const r = detectRace(make([[1800, 3.5]], { jitter: 0.2 }));
  assert.equal(r.confidence, 'low');
  assert.ok(r.start <= 30 && r.total - r.end <= 30);
});

test('no timestamps gives a clear message instead of a guess', () => {
  const pts = make([[600, 3]]).map((p) => Object.assign(p, { t: null }));
  assert.equal(detectRace(pts).confidence, 'none');
});
