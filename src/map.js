import { R, S, dims, host, lineScale, resolveMap } from './state.js';
import { BASEMAPS } from './config.js';
import { setStatus } from './activity.js';
import { composite } from './hud.js';
import { colorKey } from './colour.js';
import { OFM, PALETTES, SRC, ensureVector, updateVector } from './vectorstyle.js';

/* ------------------------------ map ------------------------------ */
const EMPTY_LINE = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };

export const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export const EMPTY_PT = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} };

function buildStyle() {
  const u = lineScale(), b = BASEMAPS[S.basemap];
  const raster = (id, url, max) => ({ type: 'raster', tiles: [url], tileSize: 256, maxzoom: max });
  const rl = (id) => ({ id, type: 'raster', source: id, layout: { visibility: S.basemap === id ? 'visible' : 'none' }, paint: { 'raster-fade-duration': 0 } });
  return {
    version: 8,
    glyphs: OFM.glyphs,
    sky: b.sky,
    terrain: { source: 'dem', exaggeration: S.terrain },
    sources: {
      sat: raster('sat', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 18),
      dark: raster('dark', 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', 16),
      light: raster('light', 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', 16),
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 15, encoding: 'terrarium' },
      'route-full': { type: 'geojson', data: EMPTY_LINE, tolerance: 0.2 },
      'route-done': { type: 'geojson', data: EMPTY_LINE, tolerance: 0.2 },
      'route-seg': { type: 'geojson', data: EMPTY_FC, tolerance: 0.2 },
      head: { type: 'geojson', data: EMPTY_PT },
      ends: { type: 'geojson', data: EMPTY_FC },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': b.bg } },
      rl('sat'), rl('dark'), rl('light'),
      { id: 'hill', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': b.hill.ex, 'hillshade-shadow-color': b.hill.shadow, 'hillshade-highlight-color': b.hill.hi, 'hillshade-accent-color': b.hill.accent } },
      { id: 'route-base', type: 'line', source: 'route-full', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': 5 * u } },
      { id: 'prog-glow', type: 'line', source: 'route-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': S.color, 'line-opacity': 0.4, 'line-blur': 7 * u, 'line-width': 18 * u } },
      { id: 'prog-casing', type: 'line', source: 'route-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-opacity': 0.4, 'line-width': 10 * u } },
      { id: 'prog', type: 'line', source: 'route-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': S.color, 'line-width': 6.5 * u } },
      { id: 'prog-seg', type: 'line', source: 'route-seg', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': ['get', 'c'], 'line-width': 6.5 * u } },
      { id: 'ends', type: 'circle', source: 'ends', paint: { 'circle-radius': 8 * u, 'circle-color': ['match', ['get', 'kind'], 'start', '#35D07F', '#FF4D4D'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 * u, 'circle-pitch-alignment': 'viewport' } },
      { id: 'head-halo', type: 'circle', source: 'head', paint: { 'circle-radius': 20 * u, 'circle-color': S.color, 'circle-opacity': 0.35, 'circle-blur': 0.7, 'circle-pitch-alignment': 'viewport' } },
      { id: 'head', type: 'circle', source: 'head', paint: { 'circle-radius': 9.5 * u, 'circle-color': '#ffffff', 'circle-stroke-color': S.color, 'circle-stroke-width': 4 * u, 'circle-pitch-alignment': 'viewport' } },
    ],
  };
}


export async function initMap() {
  const { W, H } = dims();
  host.style.width = W + 'px'; host.style.height = H + 'px';
  let maplibregl;
  try { maplibregl = (await import('maplibre-gl')).default; } catch (e) {
    R.mapFailed = 'The map library (MapLibre) failed to load. Check your connection and reload.';
    setStatus(R.mapFailed, 'error'); return;
  }
  try {
    R.map = new maplibregl.Map({
      container: host, style: buildStyle(), center: [-73.98, 44.28], zoom: 11, pitch: 60, bearing: 0,
      interactive: false, attributionControl: false, pixelRatio: 1, maxPitch: 85, fadeDuration: 0,
      canvasContextAttributes: { antialias: true },
    });
  } catch (e) {
    R.mapFailed = 'Could not start the map renderer. WebGL may be disabled or unavailable in this browser (' + (e.message || e) + ').';
    setStatus(R.mapFailed, 'error'); return;
  }
  // The style is usable as soon as it parses. Waiting for 'load' would also wait for the first batch of tiles.
  let started = false;
  const start = () => { if (started) return; started = true; applyBasemap(); applyRouteColor(); applyLineStyle(); resolveMap(); };
  R.map.once('style.load', start);
  R.map.once('load', start);
  R.map.on('render', composite);
  let errs = 0, vecErrs = 0;
  R.map.on('sourcedata', (e) => { if (e.sourceId === SRC && e.isSourceLoaded) R.vecOk = true; });
  // if the vector tiles never arrive, draw Dark and Light from the Esri rasters instead
  const useFallback = () => { R.vecFail = true; applyBasemap(); setStatus('The vector map could not load, so Dark and Light are using the Esri map instead.', 'warn'); };
  R.map.on('error', (e) => {
    const msg = (e && e.error && e.error.message) || '';
    if (/abort/i.test(msg)) return;
    if (e && e.sourceId === SRC) { vecErrs++; if (vecErrs >= 6 && !R.vecOk && !R.vecFail) useFallback(); return; }
    errs++;
    if (errs === 4) setStatus('Some map tiles failed to load. Check your connection; the video will have gaps there.', 'warn');
    console.warn('map error', e && e.error ? e.error : e);
  });
}

export const styleUp = () => !!(R.map && R.map.style && R.map.getLayer('sat'));

const vecOn = () => !!BASEMAPS[S.basemap].vector && !R.vecFail;

function applyVector() {
  const on = vecOn();
  if (on) ensureVector(R.map, PALETTES[S.basemap], lineScale(), S.b3d);
  updateVector(R.map, { p: PALETTES[S.basemap] || PALETTES.dark, u: lineScale(), on, labels: S.labels, b3d: S.b3d });
}

export function applyBasemap() {
  if (!styleUp()) return;
  const b = BASEMAPS[S.basemap], vec = vecOn();
  for (const id of ['sat', 'dark', 'light']) R.map.setLayoutProperty(id, 'visibility', id === S.basemap && !vec ? 'visible' : 'none');
  R.map.setPaintProperty('hill', 'hillshade-exaggeration', b.hill.ex);
  R.map.setPaintProperty('hill', 'hillshade-shadow-color', b.hill.shadow);
  R.map.setPaintProperty('hill', 'hillshade-highlight-color', b.hill.hi);
  R.map.setPaintProperty('hill', 'hillshade-accent-color', b.hill.accent);
  R.map.setPaintProperty('bg', 'background-color', vec ? PALETTES[S.basemap].land : b.bg);
  R.map.setSky(b.sky);
  applyVector();
}

export function applyRouteColor() {
  if (!styleUp()) return;
  const on = colorKey() !== 'solid';
  R.map.setPaintProperty('prog', 'line-color', S.color);
  R.map.setLayoutProperty('prog', 'visibility', on ? 'none' : 'visible');
  R.map.setLayoutProperty('prog-seg', 'visibility', on ? 'visible' : 'none');
  R.map.setPaintProperty('prog-glow', 'line-color', on ? '#ffffff' : S.color);
  R.map.setPaintProperty('prog-glow', 'line-opacity', on ? 0.28 : 0.4);
  R.map.setPaintProperty('head-halo', 'circle-color', on ? '#ffffff' : S.color);
  R.map.setPaintProperty('head', 'circle-stroke-color', S.color);
}

export function applyLineStyle() {
  if (!styleUp()) return;
  const u = lineScale();
  applyVector();
  R.map.setPaintProperty('route-base', 'line-width', 5 * u);
  R.map.setPaintProperty('prog-glow', 'line-width', 18 * u); R.map.setPaintProperty('prog-glow', 'line-blur', 7 * u);
  R.map.setPaintProperty('prog-casing', 'line-width', 10 * u);
  R.map.setPaintProperty('prog', 'line-width', 6.5 * u); R.map.setPaintProperty('prog-seg', 'line-width', 6.5 * u);
  R.map.setPaintProperty('ends', 'circle-radius', 8 * u); R.map.setPaintProperty('ends', 'circle-stroke-width', 3 * u);
  R.map.setPaintProperty('head-halo', 'circle-radius', 20 * u);
  R.map.setPaintProperty('head', 'circle-radius', 9.5 * u); R.map.setPaintProperty('head', 'circle-stroke-width', 4 * u);
}
