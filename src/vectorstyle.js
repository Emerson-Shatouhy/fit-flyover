/* Flat vector Dark and Light maps (roads, water, parks, buildings, optional labels and 3D buildings) drawn from OpenFreeMap's
   OpenMapTiles data. The layers are added the first time a vector style is chosen, so nothing is requested from OpenFreeMap otherwise. */

export const OFM = {
  tilejson: 'https://tiles.openfreemap.org/planet',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
};

export const SRC = 'omt';

/* palettes for the two looks */
export const PALETTES = {
  dark: {
    land: '#262d3c', civic: '#2d364b', park: '#1d4a3a', wood: '#1a4335', water: '#0c2174', waterway: '#16329a',
    building: '#333c50', buildingEdge: '#3c465c', extrusion: '#4a5570',
    path: '#5d6882', rail: '#3f485c', casing: '#1a202e',
    road: { minor: '#4b546a', secondary: '#5f6a84', major: '#7d88a2', motorway: '#9aa5bf' },
    label: '#e8edf7', halo: 'rgba(15,19,29,0.88)', waterLabel: '#7b90ff', roadLabel: '#d3dae9', parkLabel: '#86e3ae',
  },
  light: {
    land: '#f1ede4', civic: '#e9e4d8', park: '#cde5bd', wood: '#c1ddb1', water: '#a6cce9', waterway: '#8dbbe0',
    building: '#e1dccf', buildingEdge: '#d4cec1', extrusion: '#dcd6c9',
    path: '#d3cdc0', rail: '#b9b4a9', casing: '#cdc7ba',
    road: { minor: '#ffffff', secondary: '#ffffff', major: '#fff1cc', motorway: '#ffd88c' },
    label: '#2a2f3a', halo: 'rgba(255,255,255,0.92)', waterLabel: '#3a73b5', roadLabel: '#4b5262', parkLabel: '#3e7b3b',
  },
};

const ZOOM = ['zoom'];

/* a width that grows with zoom: stops are [zoom, px at 1080 wide], scaled by u for the render size */
const grow = (stops, u, mult = 1, add = 0) => ['interpolate', ['exponential', 1.4], ZOOM, ...stops.flatMap(([z, w]) => [z, (w * mult + add) * u])];

const W = {
  path: [[13, 0.5], [16, 1.6], [18, 3.2]],
  minor: [[12, 0.3], [14, 1.3], [16, 3.2], [18, 8]],
  secondary: [[10, 0.5], [13, 1.5], [15, 3.8], [17, 8.5], [19, 19]],
  major: [[8, 0.6], [12, 2], [14, 4.4], [16, 9], [18, 19]],
  motorway: [[6, 0.6], [10, 1.6], [13, 3.8], [15, 7.5], [17, 15]],
};

const inClass = (list) => ['in', ['get', 'class'], ['literal', list]];
const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
const roadFilter = (list) => ['all', inClass(list), notTunnel];
const NAME = ['coalesce', ['get', 'name:latin'], ['get', 'name']];
const FONT = { regular: ['Noto Sans Regular'], bold: ['Noto Sans Bold'], italic: ['Noto Sans Italic'] };

/* Every layer, bottom to top. grp: 'area' goes under the hillshade (so the relief still shows), 'top' goes over it.
   lvl: which Labels setting shows it ('major' or 'full'); labels are hidden entirely at 'off'. */
export function vectorSpecs(p, u, labels3d) {
  const line = (id, sl, filter, color, stops, extra) => ({ grp: 'top', layer: { id, type: 'line', source: SRC, 'source-layer': sl, filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: Object.assign({ 'line-color': color, 'line-width': grow(stops, u) }, extra || {}) } });
  const casing = (id, sl, filter, stops) => ({ grp: 'top', layer: { id, type: 'line', source: SRC, 'source-layer': sl, filter, layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': p.casing, 'line-width': grow(stops, u, 1, 1.6) } } });
  const text = (id, lvl, sl, filter, font, size, color, extra) => ({
    grp: 'top', lvl,
    layer: Object.assign({ id, type: 'symbol', source: SRC, 'source-layer': sl, filter,
      layout: Object.assign({ 'text-field': NAME, 'text-font': font, 'text-size': ['interpolate', ['linear'], ZOOM, ...size.flatMap(([z, s]) => [z, s * u])], 'text-max-width': 8, visibility: 'none' }, (extra && extra.layout) || {}),
      paint: { 'text-color': color, 'text-halo-color': p.halo, 'text-halo-width': 1.6 * u } }, (extra && extra.top) || {}),
  });
  return [
    { grp: 'area', layer: { id: 'v-landcover', type: 'fill', source: SRC, 'source-layer': 'landcover', filter: inClass(['grass', 'wood', 'wetland']), paint: { 'fill-color': ['match', ['get', 'class'], 'wood', p.wood, p.park], 'fill-opacity': 0.9 } } },
    { grp: 'area', layer: { id: 'v-landuse-civic', type: 'fill', source: SRC, 'source-layer': 'landuse', filter: inClass(['school', 'hospital', 'university', 'college', 'industrial', 'commercial', 'retail']), paint: { 'fill-color': p.civic, 'fill-opacity': 0.8 } } },
    { grp: 'area', layer: { id: 'v-landuse-green', type: 'fill', source: SRC, 'source-layer': 'landuse', filter: inClass(['cemetery', 'pitch', 'playground', 'stadium', 'zoo', 'theme_park']), paint: { 'fill-color': p.park, 'fill-opacity': 0.9 } } },
    { grp: 'area', layer: { id: 'v-park', type: 'fill', source: SRC, 'source-layer': 'park', paint: { 'fill-color': p.park, 'fill-opacity': 0.9 } } },
    { grp: 'area', layer: { id: 'v-water', type: 'fill', source: SRC, 'source-layer': 'water', paint: { 'fill-color': p.water } } },
    { grp: 'area', layer: { id: 'v-waterway', type: 'line', source: SRC, 'source-layer': 'waterway', filter: inClass(['river', 'canal', 'stream']), layout: { 'line-cap': 'round' }, paint: { 'line-color': p.waterway, 'line-width': grow([[10, 0.4], [14, 1.6], [18, 5]], u) } } },
    { grp: 'area', layer: { id: 'v-bld', type: 'fill', source: SRC, 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingEdge } } },

    line('v-path', 'transportation', roadFilter(['path', 'pedestrian']), p.path, W.path),
    line('v-rail', 'transportation', ['all', inClass(['rail']), notTunnel], p.rail, [[10, 0.4], [14, 1], [17, 2]]),
    casing('v-minor-casing', 'transportation', roadFilter(['minor', 'service', 'track']), W.minor),
    line('v-minor', 'transportation', roadFilter(['minor', 'service', 'track']), p.road.minor, W.minor),
    casing('v-secondary-casing', 'transportation', roadFilter(['secondary', 'tertiary']), W.secondary),
    line('v-secondary', 'transportation', roadFilter(['secondary', 'tertiary']), p.road.secondary, W.secondary),
    casing('v-major-casing', 'transportation', roadFilter(['primary', 'trunk']), W.major),
    line('v-major', 'transportation', roadFilter(['primary', 'trunk']), p.road.major, W.major),
    casing('v-motorway-casing', 'transportation', roadFilter(['motorway']), W.motorway),
    line('v-motorway', 'transportation', roadFilter(['motorway']), p.road.motorway, W.motorway),

    { grp: 'top', b3d: true, layer: { id: 'v-bld3d', type: 'fill-extrusion', source: SRC, 'source-layer': 'building', minzoom: 13, layout: { visibility: labels3d ? 'visible' : 'none' },
      paint: { 'fill-extrusion-color': p.extrusion, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.88 } } },

    text('v-lbl-city', 'major', 'place', inClass(['city', 'town']), FONT.bold, [[6, 12], [10, 17], [14, 24]], p.label, { top: { maxzoom: 15 } }),
    text('v-lbl-place', 'major', 'place', inClass(['village', 'suburb', 'hamlet', 'neighbourhood', 'quarter']), FONT.regular, [[10, 12], [14, 18]], p.label, { top: { minzoom: 10 } }),
    text('v-lbl-water', 'major', 'water_name', null, FONT.italic, [[8, 11], [14, 18]], p.waterLabel),
    text('v-lbl-road-major', 'major', 'transportation_name', inClass(['motorway', 'trunk', 'primary']), FONT.regular, [[11, 11], [16, 16]], p.roadLabel, { layout: { 'symbol-placement': 'line', 'text-letter-spacing': 0.04 }, top: { minzoom: 11 } }),
    text('v-lbl-road', 'full', 'transportation_name', inClass(['secondary', 'tertiary', 'minor', 'service']), FONT.regular, [[13, 11], [17, 16]], p.roadLabel, { layout: { 'symbol-placement': 'line' }, top: { minzoom: 13 } }),
    text('v-lbl-park', 'full', 'poi', ['==', ['get', 'class'], 'park'], FONT.regular, [[13, 12], [17, 17]], p.parkLabel, { top: { minzoom: 13 } }),
  ].map((s) => { if (s.layer.filter === null) delete s.layer.filter; return s; });
}

/* adds the source and layers once; before the hillshade for the flat areas, before the route for everything else */
export function ensureVector(map, p, u, b3d) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'vector', url: OFM.tilejson });
  for (const s of vectorSpecs(p, u, b3d)) map.addLayer(s.layer, s.grp === 'area' ? 'hill' : 'route-base');
}

/* colours, widths and what is showing, from the current settings */
export function updateVector(map, { p, u, on, labels, b3d }) {
  if (!map.getSource(SRC)) return;
  for (const s of vectorSpecs(p, u, b3d)) {
    const id = s.layer.id; if (!map.getLayer(id)) continue;
    for (const [k, v] of Object.entries(s.layer.paint || {})) map.setPaintProperty(id, k, v);
    let show = on;
    if (s.lvl) show = on && (labels === 'full' || (labels === 'major' && s.lvl === 'major'));
    if (s.b3d) show = on && b3d;
    if (id === 'v-bld') show = on && !b3d; // the 3D buildings replace the flat ones
    map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
  }
}
