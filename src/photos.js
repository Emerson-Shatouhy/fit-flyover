import * as C from './core.js';
import { R, S } from './state.js';
import { MAX_PHOTOS, parseExifTime, placePhoto, schedulePhotos } from './photocore.js';

/* Photos the person added: the image (scaled down) and, if the file had them, where and when it was taken. Kept in this tab only. */
export const photos = [];

let nextId = 1;

const MAX_SIDE = 1080;

async function readMeta(file) {
  try {
    const ex = await import('exifr/dist/lite.esm.mjs');
    const t = await ex.parse(file, { reviveValues: false });
    if (!t) return {};
    return {
      lat: typeof t.latitude === 'number' ? t.latitude : null, lng: typeof t.longitude === 'number' ? t.longitude : null,
      tMs: parseExifTime(t.DateTimeOriginal || t.CreateDate, t.OffsetTimeOriginal || t.OffsetTime),
    };
  } catch (e) { return {}; }
}

/* returns { added, failed: [names], full: n skipped because of the cap } */
export async function addPhotos(files) {
  const res = { added: 0, failed: [], full: 0 };
  for (const f of files) {
    if (photos.length >= MAX_PHOTOS) { res.full++; continue; }
    try {
      const bmp = await createImageBitmap(f), k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close();
      photos.push(Object.assign({ id: nextId++, name: f.name, canvas, manualP: null, caption: '' }, await readMeta(f)));
      res.added++;
    } catch (e) { res.failed.push(f.name); }
  }
  return res;
}

export const removePhoto = (id) => { const i = photos.findIndex((p) => p.id === id); if (i >= 0) photos.splice(i, 1); };

export const clearPhotos = () => { photos.length = 0; };

export const placement = (ph) => (S.track ? placePhoto(ph, S.track) : null);

/* the moment (0..1 of the video) the head reaches progress p */
function tauOf(p) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (C.cameraAt(R.plan, mid).p >= p) hi = mid; else lo = mid; }
  return hi;
}

let cache = { key: '' };

/* every placed photo with its place on the route and its time slot (slot is null if there was no room for it) */
export function photoSlots() {
  if (!S.track || !R.plan || !photos.length) return [];
  const key = R.trackId + '|' + R.planId + '|' + S.duration + '|' + photos.map((p) => p.id + ':' + p.manualP).join(',');
  if (cache.key === key) return cache.list;
  const placed = [];
  for (const ph of photos) { const pl = placement(ph); if (pl) placed.push({ ph, p: pl.p, how: pl.how, tau: tauOf(pl.p) }); }
  const hold = R.plan.hold ? R.plan.hold + 0.05 : 0.02;
  const slots = schedulePhotos(placed.map((x) => ({ id: x.ph.id, tau: x.tau })), S.duration, hold + 0.01, 1 - hold - 0.01);
  for (const x of placed) { x.slot = slots.find((s) => s.id === x.ph.id) || null; x.n = x.slot ? slots.indexOf(x.slot) : -1; }
  cache = { key, list: placed };
  return placed;
}
