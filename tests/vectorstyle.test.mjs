import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, vectorSpecs } from '../src/vectorstyle.js';

test('vector layers have unique ids and a source layer', () => {
  for (const k of ['dark', 'light']) {
    const specs = vectorSpecs(PALETTES[k], 1, false), ids = specs.map((s) => s.layer.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(specs.every((s) => s.layer['source-layer'] && s.layer.id.startsWith('v-')));
  }
});

test('labels start hidden and 3D buildings follow the flag', () => {
  const specs = vectorSpecs(PALETTES.dark, 1, true);
  assert.ok(specs.filter((s) => s.lvl).every((s) => s.layer.layout.visibility === 'none'));
  assert.equal(specs.find((s) => s.b3d).layer.layout.visibility, 'visible');
});
