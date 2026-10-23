import * as C from './core.js';
import { $ } from './util.js';
import { R, S, mapReady, view } from './state.js';
import { adoptRaw, applyTrimView } from './trim.js';
import { fitView, syncControls } from './controls.js';
import { applyRouteColor } from './map.js';
import { applyFrame, replan } from './frames.js';
import { setPlaying } from './playback.js';
import { loadWeather } from './weather.js';
import { renderPhotos, resetPhotos } from './photoui.js';
import { SPORT_NAME, paceOrSpeed } from './sport.js';

/* ------------------------------ loading ------------------------------ */
export function setStatus(msg, kind) {
  for (const el of [$('#status'), $('#dropStatus')]) { el.textContent = msg || ''; el.className = 'status' + (kind ? ' ' + kind : ''); }
}

const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

export async function loadFile(file) {
  if (S.exporting) return;
  const T0 = performance.now(), lap = (what) => console.log('[flyover] ' + what + ' ' + Math.round(performance.now() - T0) + ' ms');
  const mb = (file.size / 1048576).toFixed(1);
  try {
    setStatus('Reading ' + file.name + ' (' + mb + ' MB)…'); await paint();
    const buf = await file.arrayBuffer(); lap('file read');
    setStatus('Decoding ' + file.name + '…'); await paint();
    const parsed = await C.readActivityFile(buf, file.name); lap('decoded ' + (parsed.points ? parsed.points.length : '?') + ' points');
    setStatus('Building the route…'); await paint();
    const track = C.buildTrack(adoptRaw(parsed)); lap('route built');
    if (R.mapFailed) throw new Error(R.mapFailed);
    setStatus('Starting the map…'); await paint();
    await withTimeout(mapReady, 15000, 'The map did not start within 15 seconds. WebGL may be unavailable, or the map library was blocked. Check the browser console (F12) for details.');
    lap('map ready');
    await setTrack(track); lap('shown');
    setStatus('Loading map tiles…');
    const done = () => { if (!S.exporting && S.track === track) setStatus(''); };
    const loadedP = new Promise((r) => { if (R.map.loaded()) return r(); R.map.once('idle', r); });
    withTimeout(loadedP, 20000, 'slow').then(done, () => { if (S.track === track) setStatus('Map tiles are loading slowly. The preview will fill in as they arrive.', 'warn'); });
  } catch (e) { console.error(e); setStatus(e.message || String(e), 'error'); }
}

export async function setTrack(track, opts) {
  opts = opts || {};
  await mapReady;
  S.track = track; R.trackId++;
  if (!opts.retrim) { R.fullTrack = track; S.trimView = false; }
  if (!opts.retrim) { S.duration = C.suggestDuration(track.L); S.title = track.meta.name || ''; $('#title').value = S.title; S.subtitle = ''; $('#subtitle').value = ''; }
  $('#drop').hidden = true; view.hidden = false;
  for (const id of ['playBtn', 'scrub', 'exportBtn']) $('#' + id).disabled = false;
  $('#replaceBtn').hidden = false;
  for (const [k, has] of [['hr', track.meta.hasHr], ['power', track.meta.hasPower], ['gain', track.meta.hasEle], ['time', track.meta.hasTime], ['pace', track.meta.hasTime || track.grid.spd]]) {
    const el = $('[data-stat="' + k + '"]'); el.disabled = !has;
  }
  for (const [v, has] of [['ele', track.meta.hasEle], ['hr', track.meta.hasHr], ['pwr', track.meta.hasPower]]) { const b = $('[data-seg="graph"] [data-val="' + v + '"]'); if (b) b.disabled = !has; }
  for (const [v, has] of [['hr', track.meta.hasHr], ['pwr', track.meta.hasPower], ['spd', !!track.grid.spd], ['ele', track.meta.hasEle]]) { const b = $('[data-seg="colorBy"] [data-val="' + v + '"]'); if (b) b.disabled = !has; }
  if (!opts.retrim) resetPhotos();
  $('#weatherChk').disabled = !track.meta.hasTime;
  syncControls();
  updateActivityPanel();
  if (!opts.retrim && S.weather) loadWeather().then(() => { if (S.track) applyFrame(S.tau); });
  applyRouteColor();
  R.map.getSource('route-full').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: track.line.coords } });
  const c = track.line.coords;
  R.map.getSource('ends').setData({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: c[0] } },
    { type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: c[c.length - 1] } } ] });
  if (S.trimView) { replan(); applyTrimView(); }
  else { fitView(); replan(); applyFrame(0); setPlaying(true); }
  renderPhotos(); // statuses depend on the new route and camera plan
}

export function updateActivityPanel() {
  const t = S.track; if (!t) return;
  const m = t.meta, u = S.units;
  const cell = (label, val, unit) => '<div><span>' + label + '</span><b>' + val + (unit ? '<small>' + unit + '</small>' : '') + '</b></div>';
  const po = m.avgSpeed ? paceOrSpeed(m.avgSpeed) : null;
  const avg = po ? cell('Avg ' + po.label.toLowerCase(), po.value, po.unit) : '';
  $('#kv').innerHTML = cell('Distance', C.fmtDistance(m.totalDist, u), C.distUnit(u)) + (m.totalTime ? cell('Time', C.fmtDuration(m.totalTime), '') : '') +
    (m.gain !== null ? cell('Elev gain', C.fmtElev(m.gain, u), C.elevUnit(u)) : '') + avg;
  $('#sport').querySelector('option[value="auto"]').textContent = 'Auto: ' + (SPORT_NAME[m.sport || 'other'] || 'Other');
  $('#kv').hidden = false; $('#noActivity').hidden = true;
  const bits = [];
  if (m.sport && m.sport !== 'other') bits.push(m.sport[0].toUpperCase() + m.sport.slice(1));
  bits.push(m.usedPoints.toLocaleString('en-US') + ' GPS points');
  const ch = []; if (m.hasHr) ch.push('heart rate'); if (m.hasPower) ch.push('power'); if (!m.hasEle) ch.push('no elevation'); if (!m.hasTime) ch.push('no timestamps');
  $('#activityNote').textContent = bits.join(' · ') + (ch.length ? ' · ' + ch.join(', ') : '');
  $('#activityNote').hidden = false;
  const d = m.startTime ? new Date(m.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  $('#topMeta').textContent = (m.name || 'Activity') + (d ? ' · ' + d : '');
}
