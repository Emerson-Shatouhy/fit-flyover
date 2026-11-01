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
- `src/racecut.js`: pure logic for Race cut mode (moments detector, time warp, clock parsing)
- `src/trim.js`: start/end trimming with live preview; `activity.js`: file loading
- `src/controls.js`: sidebar UI; `exporter.js`: MP4 export; `main.js`: boot

## Race cut mode

Style tab, Mode: **Classic** is the original constant-speed flyover and is unchanged. **Race cut** is a highlight edit for longer races (best at 15 to 45 s):

- It finds the moments worth lingering on from the pace data: the biggest surge ("The shift"), the finish ("Final kick"), the fastest split, a big climb, and halfway.
- The video skims the steady stretches and slows down for those moments, and the camera closes in on them and backs off in between. Edit intensity 0% is the plain flyover again.
- Each moment gets a title banner with its numbers. The intro/finish card gains a finish time and an optional PR badge. Type your official finish time and the card (and its average pace) use it instead of the watch time.
- A goal time adds a live "ahead / behind" readout to the stats row. The Overlay tab's graph gains a Pace option, which Race cut switches to by default.

The warp keeps the first and last frame identical, so loops stay seamless. Tests in `tests/racecut.test.mjs` include a golden check that Classic still produces exactly the camera it always did.

Basemaps are keyless (Esri imagery and gray canvases, AWS terrain tiles).
