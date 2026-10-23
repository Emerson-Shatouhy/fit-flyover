import * as C from './core.js';
import { R, S, dims } from './state.js';
import { applyTrimView } from './trim.js';
import { composite } from './hud.js';
import { colorAt, colorModel, updateSegSource } from './colour.js';
import { updateTransport } from './playback.js';

/* ------------------------------ frames ------------------------------ */
export function replan() {
  if (!S.track) { R.plan = null; return; }
  const { W, H } = dims();
  R.plan = C.planCamera(S.track, { style: S.camera, width: W, height: H, pitch: S.pitch, zoomOffset: S.zoom, duration: S.duration, cards: S.cards, buildings: S.b3d && S.basemap !== 'sat' });
  R.planId++;
}

export function applyFrame(tau) {
  S.tau = Math.min(1, Math.max(0, tau));
  if (S.trimView && S.track && R.map) { applyTrimView(); return; }
  if (!S.track || !R.plan || !R.map) { composite(); return; }
  const cam = C.cameraAt(R.plan, S.tau);
  const head = C.sampleTrack(S.track, cam.p);
  R.frame = { cam, head, p: cam.p };
  R.map.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch, padding: { top: cam.padTop, bottom: 0, left: 0, right: 0 } });
  // under the title card the route is shown finished and the head dot is hidden, so the first and last frames match
  R.map.getSource('route-done').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: C.lineUpTo(S.track, cam.line * S.track.L) } });
  R.map.getSource('head').setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [head.lng, head.lat] } });
  const vis = 1 - cam.card;
  R.map.setPaintProperty('head', 'circle-opacity', vis); R.map.setPaintProperty('head', 'circle-stroke-opacity', vis);
  R.map.setPaintProperty('head-halo', 'circle-opacity', 0.35 * vis);
  const cm = colorModel();
  if (cm) { updateSegSource(cm, cam.line); R.map.setPaintProperty('head', 'circle-stroke-color', colorAt(cm, cam.p)); }
  updateTransport();
}

export const refresh = () => applyFrame(S.tau);

/* waits until the map has drawn a frame with every tile in place */
export function settle(timeout) {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(to); R.map.off('render', chk); resolve(); };
    const chk = () => { if (R.map.loaded()) fin(); };
    const to = setTimeout(fin, timeout || 15000);
    R.map.on('render', chk);
    R.map.triggerRepaint();
  });
}
