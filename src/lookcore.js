/* Pure maths for the "look" of a frame: where the sun was, and how the light and weather change the scene. No app state, so it can be tested. */

const RAD = Math.PI / 180, DAY = 864e5, clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;

/* the sun's height above the horizon (degrees) and its compass bearing (degrees clockwise from north); formulas from the SunCalc library */
export function sunPosition(ms, lat, lng) {
  const d = ms / DAY - 0.5 + 2440588 - 2451545, e = RAD * 23.4397;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const L = M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) - RAD * -lng - ra, phi = RAD * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)); // from south, towards the west
  return { alt: alt / RAD, az: (((az / RAD + 180) % 360) + 360) % 360 };
}

const hex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export const mixHex = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => lerp(v, y[i], t))); };

/* sun height -> how the scene is lit. Each row: [alt, warm r g b a, dim r g b a, light r g b intensity, sky r g b, horizon r g b, fog r g b, skyMix] */
const SUN = [
  [-14, 60, 80, 180, 0.08, 20, 30, 90, 0.42, 110, 130, 210, 0.22, 6, 9, 20, 16, 24, 44, 12, 18, 32, 1],
  [-6, 120, 110, 200, 0.16, 30, 40, 100, 0.28, 140, 160, 230, 0.3, 50, 56, 110, 150, 120, 150, 70, 76, 120, 1],
  [0, 255, 120, 80, 0.26, 60, 40, 90, 0.1, 255, 170, 130, 0.42, 138, 96, 150, 255, 154, 112, 217, 138, 120, 1],
  [5, 255, 170, 90, 0.2, 0, 0, 0, 0, 255, 214, 170, 0.5, 232, 148, 106, 255, 210, 160, 243, 201, 163, 0.75],
  [12, 255, 226, 180, 0.04, 0, 0, 0, 0, 255, 255, 255, 0.55, 232, 148, 106, 255, 210, 160, 243, 201, 163, 0.1],
  [30, 255, 244, 224, 0, 0, 0, 0, 0, 255, 255, 255, 0.55, 232, 148, 106, 255, 210, 160, 243, 201, 163, 0],
];

function sunRow(alt) {
  if (alt <= SUN[0][0]) return SUN[0].slice(1);
  if (alt >= SUN[SUN.length - 1][0]) return SUN[SUN.length - 1].slice(1);
  let i = 0; while (SUN[i + 1][0] < alt) i++;
  const a = SUN[i], b = SUN[i + 1], t = (alt - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((v, k) => lerp(v, b[k + 1], t));
}

/* the weather code (WMO, as Open-Meteo reports it) -> what to draw */
export function weatherFor(code) {
  const none = { kind: 'clear', rain: 0, snow: 0, desat: 0, dim: 0, haze: 0, lightK: 1, grey: 0, lightning: false };
  if (code == null || code <= 1) return none;
  const w = (o) => Object.assign({}, none, o);
  if (code === 2) return w({ kind: 'partly', desat: 0.06, lightK: 0.95, grey: 0.15 });
  if (code === 3) return w({ kind: 'overcast', desat: 0.22, haze: 0.12, lightK: 0.75, grey: 0.6 });
  if (code <= 48) return w({ kind: 'fog', desat: 0.3, haze: 0.5, lightK: 0.7, grey: 0.8 });
  if (code <= 57) return w({ kind: 'rain', rain: 0.25, desat: 0.25, dim: 0.08, haze: 0.15, lightK: 0.7, grey: 0.7 });
  if (code <= 67) { const r = code === 61 ? 0.4 : code === 65 || code === 67 ? 0.9 : 0.65; return w({ kind: 'rain', rain: r, desat: 0.28, dim: 0.1 + r * 0.08, haze: 0.15, lightK: 0.65, grey: 0.8 }); }
  if (code <= 77) { const s = code === 71 ? 0.35 : code === 75 ? 0.9 : code === 77 ? 0.4 : 0.6; return w({ kind: 'snow', snow: s, desat: 0.25, haze: 0.22, lightK: 0.8, grey: 0.6 }); }
  if (code <= 82) { const r = code === 80 ? 0.4 : code === 82 ? 0.9 : 0.65; return w({ kind: 'rain', rain: r, desat: 0.26, dim: 0.1 + r * 0.08, haze: 0.12, lightK: 0.7, grey: 0.75 }); }
  if (code <= 86) return w({ kind: 'snow', snow: code === 85 ? 0.5 : 0.8, desat: 0.25, haze: 0.22, lightK: 0.8, grey: 0.6 });
  return w({ kind: 'storm', rain: 0.9, desat: 0.3, dim: 0.22, haze: 0.18, lightK: 0.55, grey: 0.9, lightning: true });
}

const GREY = { sky: '#8c949c', horizon: '#c4cad0', fog: '#c4cad0' };

/* everything the renderer needs. ms/lat/lng: the moment and place for the sun (null = no sun lighting); code: weather code (null = none). */
export function lookFor({ ms, lat, lng, code }) {
  const sun = ms == null ? null : sunPosition(ms, lat, lng), wx = weatherFor(code);
  const look = { sun, wx, warm: { rgb: [0, 0, 0], a: 0 }, dim: { rgb: [0, 0, 0], a: wx.dim }, light: null, stage: null, grey: null, hillK: 1, hillAz: null };
  if (sun) {
    const r = sunRow(sun.alt);
    look.warm = { rgb: r.slice(0, 3), a: r[3] }; look.dim = { rgb: r.slice(4, 7), a: Math.min(0.6, r[7] + wx.dim) };
    look.light = { color: hex(r.slice(8, 11)), intensity: clamp(r[11] * wx.lightK, 0.12, 1), az: sun.az, polar: clamp(90 - sun.alt, 15, 80) };
    look.stage = { mix: r[21], sky: hex(r.slice(12, 15)), horizon: hex(r.slice(15, 18)), fog: hex(r.slice(18, 21)) };
    look.hillAz = sun.az;
    look.hillK = sun.alt >= 0 ? lerp(1.6, 0.7, clamp(sun.alt / 50, 0, 1)) : lerp(1.6, 0.5, clamp(-sun.alt / 12, 0, 1));
  }
  const daylight = sun ? clamp((sun.alt + 6) / 18, 0, 1) : 1;
  if (wx.grey > 0) look.grey = Object.assign({ mix: wx.grey * daylight }, GREY);
  return look;
}
