import { ASPECTS, SAVED_KEYS, STORE_KEY } from './config.js';
import { $ } from './util.js';

/* ------------------------------ state ------------------------------ */
export const S = {
  basemap: 'sat', labels: 'off', b3d: false, color: '#FF5A1F', camera: 'chase', aspect: '9:16', res: 720, duration: 30, pitch: 62, zoom: 0,
  terrain: 1.5, trimStart: 0, trimEnd: 0, colorBy: 'solid', sport: 'auto', markerEvery: 'auto', markers: true, callouts: true, legend: true, fps: 30, units: 'mi', title: '', subtitle: '', graph: 'ele', safe: true, credit: true, loop: true, cards: true, weather: false,
  stats: { dist: true, time: true, pace: true, gain: true, hr: true, power: false },
};

try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  for (const k of SAVED_KEYS) if (k in saved && typeof saved[k] === typeof S[k]) S[k] = k === 'stats' ? Object.assign(S.stats, saved.stats) : saved[k];
  if (saved.profile === false && !saved.graph) S.graph = 'none';
} catch (e) { /* storage unavailable */ }

S.trimView = false;

 S.track = null;

 S.tau = 0;

 S.playing = false;

 S.exporting = false;

export const save = () => { try { const o = {}; for (const k of SAVED_KEYS) o[k] = S[k]; localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } };

export const view = $('#view'), vctx = view.getContext('2d', { alpha: false });

export const host = $('#mapHost');

export let resolveMap = null;

export const mapReady = new Promise((r) => { resolveMap = r; });

/* mutable runtime references shared between modules */
export const R = { map: null, plan: null, frame: null, trackId: 0, planId: 0, exportCancel: false, dragging: false, raw: null, fullTrack: null, mapFailed: null, weather: null };

export const dims = () => {
  const [a, b] = ASPECTS[S.aspect], r = S.res, ev = (x) => Math.round(x / 2) * 2;
  return a <= b ? { W: ev(r), H: ev((r * b) / a) } : { W: ev((r * a) / b), H: ev(r) };
};

export const lineScale = () => { const { W, H } = dims(); return Math.min(W, H) / 1080; };
