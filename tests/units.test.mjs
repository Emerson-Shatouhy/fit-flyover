import test from 'node:test';
import assert from 'node:assert/strict';
import { markerForUnits, markerOptions } from '../src/config.js';

test('marker options are the same spacings in each system', () => {
  assert.deepEqual(markerOptions('km').map((o) => o[1]), ['100 m', '250 m', '500 m', '1 km', '5 km']);
  assert.deepEqual(markerOptions('mi').map((o) => o[1]), ['0.1 mi', '0.25 mi', '0.5 mi', '1 mi', '5 mi']);
  assert.equal(markerOptions('mi')[3][0], '1609.344');
});

test('a pick carries over when the units change', () => {
  assert.equal(markerForUnits('1000', 'mi'), '1609.344');
  assert.equal(markerForUnits('1609.344', 'km'), '1000');
  assert.equal(markerForUnits('250', 'mi'), '402.336');
  assert.equal(markerForUnits('402.336', 'km'), '250');
});

test('auto stays auto, and an unknown saved value falls back to auto', () => {
  assert.equal(markerForUnits('auto', 'km'), 'auto');
  assert.equal(markerForUnits('777', 'mi'), 'auto');
});

test('every option round-trips through both systems', () => {
  for (const u of ['km', 'mi']) for (const [v] of markerOptions(u)) {
    const other = u === 'km' ? 'mi' : 'km';
    assert.equal(markerForUnits(markerForUnits(v, other), u), v);
  }
});
