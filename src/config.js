export const FONT_NUM = '"Barlow Condensed","Arial Narrow","Roboto Condensed","Helvetica Neue",Arial,sans-serif';

export const FONT_TXT = '"Barlow",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

/* Dark and Light are drawn from OpenFreeMap vector tiles; the Esri rasters are the fallback if those cannot load */
const VECTOR_CREDIT = 'Basemap © OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors';

export const BASEMAPS = {
  sat: { credit: 'Imagery © Esri, Maxar, Earthstar Geographics', bg: '#0a0d10',
    hill: { ex: 0.3, shadow: '#05080b', hi: '#ffffff', accent: '#05080b' },
    sky: { 'sky-color': '#6e9ed6', 'horizon-color': '#d3e2f0', 'fog-color': '#e4edf5', 'sky-horizon-blend': 0.45, 'horizon-fog-blend': 0.55, 'fog-ground-blend': 0.3, 'atmosphere-blend': 0 } },
  dark: { credit: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors', vector: true, vcredit: VECTOR_CREDIT, bg: '#0b0f14',
    hill: { ex: 0.6, shadow: '#000000', hi: '#6f8396', accent: '#000000' },
    sky: { 'sky-color': '#0a1017', 'horizon-color': '#1b2735', 'fog-color': '#111a23', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.3, 'atmosphere-blend': 0 } },
  light: { credit: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors', vector: true, vcredit: VECTOR_CREDIT, bg: '#e9edf0',
    hill: { ex: 0.4, shadow: '#5d6b78', hi: '#ffffff', accent: '#5d6b78' },
    sky: { 'sky-color': '#a8c2d8', 'horizon-color': '#eef3f7', 'fog-color': '#f3f6f8', 'sky-horizon-blend': 0.45, 'horizon-fog-blend': 0.55, 'fog-ground-blend': 0.3, 'atmosphere-blend': 0 } },
};

export const TERRAIN_CREDIT = 'Terrain: Mapzen, AWS Terrain Tiles';

export const PRESETS = { chase: { pitch: 62 }, orbit: { pitch: 56 }, overhead: { pitch: 0 } };

export const ASPECTS = { '9:16': [9, 16], '4:5': [4, 5], '1:1': [1, 1], '16:9': [16, 9] };

export const SWATCHES = [['#FF5A1F', 'Ember'], ['#FFD21F', 'Gold'], ['#3DDC97', 'Mint'], ['#22C7F5', 'Cyan'], ['#FF3D8B', 'Pink'], ['#FFFFFF', 'White']];

export const SEGS = {
  basemap: [['sat', 'Satellite'], ['dark', 'Dark'], ['light', 'Light']],
  camera: [['chase', 'Chase'], ['orbit', 'Orbit'], ['overhead', 'Overhead']],
  units: [['mi', 'Imperial'], ['km', 'Metric']], // values stay 'mi'/'km' so saved settings keep working
  colorBy: [['solid', 'Solid'], ['hr', 'HR'], ['pwr', 'Power'], ['spd', 'Speed'], ['ele', 'Elev']],
  temp: [['auto', 'Auto'], ['F', '°F'], ['C', '°C']],
  labels: [['off', 'Off'], ['major', 'Major'], ['full', 'Full']],
  graph: [['none', 'Off'], ['ele', 'Elev'], ['hr', 'HR'], ['pwr', 'Power']],
};

export const MI_M = 1609.344;

/* "Marker every" choices as [metres, miles]: the same spacing in each system, so switching units keeps the pick */
export const MARKER_STEPS = [[100, 0.1], [250, 0.25], [500, 0.5], [1000, 1], [5000, 5]];

const metres = (mi) => String(Number((mi * MI_M).toFixed(4)));

/* the options for one unit system, as [value in metres, label] */
export function markerOptions(units) {
  return MARKER_STEPS.map(([m, mi]) => units === 'mi' ? [metres(mi), mi + ' mi'] : [String(m), m >= 1000 ? m / 1000 + ' km' : m + ' m']);
}

/* a saved or previous pick, carried over to the current unit system (or 'auto' if it is not one of the steps) */
export function markerForUnits(val, units) {
  if (val === 'auto') return 'auto';
  const hit = MARKER_STEPS.find(([m, mi]) => String(m) === String(val) || metres(mi) === String(val));
  if (!hit) return 'auto';
  return units === 'mi' ? metres(hit[1]) : String(hit[0]);
}

export const STORE_KEY ='route-flyover-settings-v1';

export const SAVED_KEYS = ['basemap', 'labels', 'b3d', 'color', 'color2', 'camera', 'aspect', 'res', 'pitch', 'zoom', 'terrain', 'fps', 'units', 'sport', 'markerEvery', 'graph', 'colorBy', 'markers', 'callouts', 'legend', 'safe', 'credit', 'loop', 'cards', 'weather', 'sun', 'wxfx', 'temp', 'stats'];
