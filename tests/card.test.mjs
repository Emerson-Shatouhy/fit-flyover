import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core.js';

const track = C.buildTrack(C.makeSample());
const plan = (style, cards, duration = 30) => C.planCamera(track, { style, width: 1080, height: 1920, pitch: 62, zoomOffset: 0, duration, cards });
const same = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, what + ': ' + a + ' vs ' + b);

for (const style of ['chase', 'overhead', 'orbit']) {
  test(style + ': first and last frame are the same picture', () => {
    const p = plan(style, true), a = C.cameraAt(p, 0), b = C.cameraAt(p, 1);
    same(a.center[0], b.center[0], 'lng'); same(a.center[1], b.center[1], 'lat');
    same(a.zoom, b.zoom, 'zoom'); same(a.pitch, b.pitch, 'pitch'); same(a.padTop, b.padTop, 'padTop');
    // bearings are compared around the dial (the orbit ends a full turn later)
    same(((a.bearing - b.bearing + 540) % 360) - 180, 0, 'bearing');
    same(a.card, 1, 'card up at the start'); same(b.card, 1, 'card up at the end');
    same(a.line, 1, 'route drawn at the start'); same(b.line, 1, 'route drawn at the end');
  });

  test(style + ': the head is home before the card returns, and starts only after it has cleared', () => {
    const p = plan(style, true), h = p.hold;
    assert.ok(h > 0);
    assert.equal(C.cameraAt(p, 1 - h - 0.05).p, 1);
    assert.equal(C.cameraAt(p, h).p, 0);
    assert.ok(C.cameraAt(p, h).card === 1 && C.cameraAt(p, h + 0.05).card < 1e-9);
  });

  test(style + ': the card and the route move smoothly (no jumps)', () => {
    const p = plan(style, true); let prev = C.cameraAt(p, 0);
    for (let i = 1; i <= 900; i++) {
      const cur = C.cameraAt(p, i / 900);
      assert.ok(cur.card >= 0 && cur.card <= 1, 'card in range');
      assert.ok(Math.abs(cur.card - prev.card) < 0.1, 'card step at ' + i);
      assert.ok(Math.abs(cur.line - prev.line) < 0.1, 'route step at ' + i);
      prev = cur;
    }
  });

  test(style + ': with the card off nothing about the route changes', () => {
    const p = plan(style, false);
    for (const t of [0, 0.2, 0.5, 0.8, 1]) { const c = C.cameraAt(p, t); assert.equal(c.card, 0); assert.equal(c.line, c.p); }
    assert.equal(C.cameraAt(p, 0).p, 0);
  });
}

test('the card holds for about 1.5 s whatever the length', () => {
  for (const d of [18, 30, 60]) { const h = plan('chase', true, d).hold; assert.ok(h * d <= 1.5 + 1e-9 && (d >= 18 ? h > 0 : true), d + ' s'); }
});
