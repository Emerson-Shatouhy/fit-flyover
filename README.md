# fit-flyover

Turn a FIT, GPX or TCX activity into a Strava-style flyover video loop. Everything runs in the browser: parsing, 3D map, overlay and MP4 encoding (WebCodecs).

Live: https://fit-flyover.vercel.app

## Develop

```
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
npm run lint
```

## Layout

- `src/core.js`: pure logic (FIT/GPX/TCX parsing, track prep, camera planning, formatting)
- `src/state.js`: settings, shared runtime refs, canvas sizing
- `src/map.js`: MapLibre setup and basemaps; `frames.js`: camera and frame updates
- `src/hud.js`, `colour.js`, `markers.js`, `sport.js`: overlay drawing, route colouring, distance markers, per-sport pace
- `src/trim.js`: start/end trimming with live preview; `activity.js`: file loading
- `src/controls.js`: sidebar UI; `exporter.js`: MP4 export; `main.js`: boot

Basemaps are keyless (Esri imagery and gray canvases, AWS terrain tiles).
