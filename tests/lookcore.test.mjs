import test from 'node:test';
import assert from 'node:assert/strict';
import { lookFor, mixHex, sunPosition, weatherFor } from '../src/lookcore.js';

test('sun height at solar noon in Boston matches the maths (90 - lat + declination)', () => {
  const summer = sunPosition(Date.UTC(2026, 5, 21, 16, 57), 42.36, -71.06), winter = sunPosition(Date.UTC(2026, 11, 21, 16, 57), 42.36, -71.06);
  assert.ok(Math.abs(summer.alt - 71.1) < 1.5, 'summer ' + summer.alt);
  assert.ok(Math.abs(winter.alt - 24.2) < 1.5, 'winter ' + winter.alt);
  assert.ok(Math.abs(summer.az - 180) < 12, 'noon sun is in the south ' + summer.az);
});

test('the sun is up in the morning in the east and down at midnight', () => {
  const am = sunPosition(Date.UTC(2026, 9, 17, 12, 0), 42.3, -71.4); // 8 am EDT
  assert.ok(am.alt > 5 && am.alt < 30 && am.az > 90 && am.az < 140, JSON.stringify(am));
  assert.ok(sunPosition(Date.UTC(2026, 9, 17, 5, 0), 42.3, -71.4).alt < -20);
});

test('lighting follows the sun height', () => {
  const noon = lookFor({ ms: Date.UTC(2026, 5, 21, 16, 57), lat: 42.36, lng: -71.06 }), dusk = lookFor({ ms: Date.UTC(2026, 5, 21, 0, 40), lat: 42.36, lng: -71.06 }), night = lookFor({ ms: Date.UTC(2026, 5, 21, 6, 0), lat: 42.36, lng: -71.06 });
  assert.ok(noon.warm.a < 0.05 && noon.dim.a === 0 && noon.stage.mix === 0);
  assert.ok(dusk.warm.a > 0.1, 'golden or sunset warmth ' + dusk.warm.a + ' alt ' + dusk.sun.alt);
  assert.ok(night.dim.a > 0.3 && night.light.intensity < noon.light.intensity);
});

test('no time and no weather means no change', () => {
  const l = lookFor({ ms: null, lat: 0, lng: 0, code: null });
  assert.equal(l.light, null); assert.equal(l.warm.a, 0); assert.equal(l.dim.a, 0); assert.equal(l.grey, null); assert.equal(l.hillK, 1);
});

test('weather codes map to effects', () => {
  assert.equal(weatherFor(0).kind, 'clear');
  assert.equal(weatherFor(3).kind, 'overcast');
  assert.equal(weatherFor(45).kind, 'fog');
  assert.ok(weatherFor(65).rain > weatherFor(61).rain);
  assert.ok(weatherFor(73).snow > 0 && weatherFor(73).rain === 0);
  assert.equal(weatherFor(95).lightning, true);
});

test('weather dims the light and greys the sky, but keeps night dark', () => {
  const day = { ms: Date.UTC(2026, 5, 21, 16, 57), lat: 42.36, lng: -71.06 }, night = { ms: Date.UTC(2026, 5, 21, 6, 0), lat: 42.36, lng: -71.06 };
  assert.ok(lookFor({ ...day, code: 63 }).light.intensity < lookFor(day).light.intensity);
  assert.ok(lookFor({ ...day, code: 63 }).grey.mix > 0.5);
  assert.equal(lookFor({ ...night, code: 63 }).grey.mix, 0);
});

test('colour mixing', () => { assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080'); });
