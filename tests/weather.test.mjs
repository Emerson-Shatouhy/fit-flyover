import test from 'node:test';
import assert from 'node:assert/strict';
import { codeText, pickHour, weatherText } from '../src/weathercore.js';

const json = { utc_offset_seconds: -14400, hourly: { time: ['2026-10-17T08:00', '2026-10-17T09:00', '2026-10-17T10:00'], temperature_2m: [8, 10.4, 12], weather_code: [0, 3, 61] } };

test('picks the hour nearest the start in the place\'s local time', () => {
  // 13:10 UTC = 09:10 local at -4h
  assert.deepEqual(pickHour(json, Date.UTC(2026, 9, 17, 13, 10)), { tempC: 10.4, code: 3 });
  // 13:40 UTC rounds up to 10:00 local
  assert.deepEqual(pickHour(json, Date.UTC(2026, 9, 17, 13, 40)), { tempC: 12, code: 61 });
  assert.equal(pickHour(json, Date.UTC(2026, 9, 18, 13, 0)), null);
});

test('text follows the unit system', () => {
  assert.equal(weatherText({ tempC: 10.4, code: 3 }, 'mi'), '51°F · OVERCAST');
  assert.equal(weatherText({ tempC: 10.4, code: 3 }, 'km'), '10°C · OVERCAST');
  assert.equal(weatherText(null, 'mi'), '');
  assert.equal(codeText(63), 'Rain');
});
