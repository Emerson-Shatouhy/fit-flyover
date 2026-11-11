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
- `src/workout.js`: pure logic for Workout mode (indoor detection, efforts and sets, time warp, frames); `src/workoutview.js`: draws a Workout frame
- `src/trim.js`: start/end trimming with live preview; `activity.js`: file loading
- `src/controls.js`: sidebar UI; `exporter.js`: MP4 export; `main.js`: boot

## Race cut mode

Style tab, Mode: **Classic** is the original constant-speed flyover and is unchanged. **Race cut** is a highlight edit for longer races (best at 15 to 45 s):

- It finds the moments worth lingering on from the pace data: the biggest surge ("The shift"), the finish ("Final kick"), the fastest split, a big climb, and halfway.
- The video skims the steady stretches and slows down for those moments, and the camera closes in on them and backs off in between. Edit intensity 0% is the plain flyover again.
- Each moment gets a title banner with its numbers. The intro/finish card gains a finish time and an optional PR badge. Type your official finish time and the card (and its average pace) use it instead of the watch time.
- A goal time adds a live "ahead / behind" readout to the stats row. The Overlay tab's graph gains a Pace option, which Race cut switches to by default.

The warp keeps the first and last frame identical, so loops stay seamless. Tests in `tests/racecut.test.mjs` include a golden check that Classic still produces exactly the camera it always did.

## Workout mode

Indoor trainer rides (Zwift, a smart trainer with no GPS) have nothing to fly over, so there is no map. A GPX that Strava marks `VirtualRide`, or any file with no coordinates, switches the app into Workout mode on load (a sample is on the start screen too). The video is the power profile:

- It finds the hard efforts from the power channel (stretches above 55% of the workout's own 98th percentile, so no FTP is needed) and groups them into sets (a pause several times longer than the usual rest starts a new set). A 20 s on / 40 s off session reads as "5 × 20 s" per set. A steady ride has no intervals and plays as a plain power profile.
- The frame is a big live power number, where you are in the session ("Set 2 · Effort 3 of 5", ON / REST), the whole power profile that fills in as it plays, a stamp over each set when it finishes (average effort power and peak heart rate), a heart rate strip, and a stats row. The title card sits over the finished profile at both ends, so loops are seamless.
- Edit intensity (Style tab) skims the rests and the gaps between sets and plays the efforts at full tilt; 0% is an even-speed playback. Efforts get a beat each, so a four-set session suggests about 32 s.
- Effort colour and Date and accent colour work as on the map; format, size, length, title, subtitle, stats (time, heart rate, avg power) and the safe zone all apply. Map-only options are hidden.

Both the map and Workout renderers write to the same canvas, so export, the scrubber and looping are shared. Tests are in `tests/workout.test.mjs`.

Basemaps are keyless (Esri imagery and gray canvases, AWS terrain tiles).
