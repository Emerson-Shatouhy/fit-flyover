export const FONT_NUM = '"Barlow Condensed","Arial Narrow","Roboto Condensed","Helvetica Neue",Arial,sans-serif';

export const FONT_TXT = '"Barlow",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

export const BASEMAPS = {
  sat: { credit: 'Imagery © Esri, Maxar, Earthstar Geographics', bg: '#0a0d10',
    hill: { ex: 0.3, shadow: '#05080b', hi: '#ffffff', accent: '#05080b' },
    sky: { 'sky-color': '#6e9ed6', 'horizon-color': '#d3e2f0', 'fog-color': '#e4edf5', 'sky-horizon-blend': 0.45, 'horizon-fog-blend': 0.55, 'fog-ground-blend': 0.3, 'atmosphere-blend': 0 } },
  dark: { credit: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors', bg: '#0b0f14',
    hill: { ex: 0.6, shadow: '#000000', hi: '#6f8396', accent: '#000000' },
    sky: { 'sky-color': '#0a1017', 'horizon-color': '#1b2735', 'fog-color': '#111a23', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.3, 'atmosphere-blend': 0 } },
  light: { credit: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors', bg: '#e9edf0',
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
  units: [['mi', 'Miles'], ['km', 'Kilometres']],
  colorBy: [['solid', 'Solid'], ['hr', 'HR'], ['pwr', 'Power'], ['spd', 'Speed'], ['ele', 'Elev']],
  graph: [['none', 'Off'], ['ele', 'Elev'], ['hr', 'HR'], ['pwr', 'Power']],
};

export const STORE_KEY = 'route-flyover-settings-v1';

export const SAVED_KEYS = ['basemap', 'color', 'camera', 'aspect', 'res', 'pitch', 'zoom', 'terrain', 'fps', 'units', 'sport', 'markerEvery', 'graph', 'colorBy', 'markers', 'callouts', 'legend', 'safe', 'credit', 'loop', 'stats'];
