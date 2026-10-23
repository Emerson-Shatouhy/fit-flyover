import { $ } from './util.js';
import { S } from './state.js';
import { refresh } from './frames.js';
import { MAX_PHOTOS } from './photocore.js';
import { addPhotos, clearPhotos, photoSlots, photos, placement, removePhoto } from './photos.js';

/* The Photos section of the Overlay tab */
const WORDS = { gps: 'Placed by GPS', time: 'Placed by time', manual: 'Placed by hand' };

function status(ph) {
  const pl = placement(ph);
  if (!pl) return { text: ph.lat != null || ph.tMs != null ? 'Not on this route. Pick a spot.' : 'No location or time. Pick a spot.', warn: true };
  const x = photoSlots().find((s) => s.ph === ph);
  if (x && !x.slot) return { text: 'No room: too close to another photo.', warn: true };
  return { text: WORDS[pl.how], warn: false };
}

const thumb = (ph) => {
  if (ph.thumb) return ph.thumb;
  const c = document.createElement('canvas'), k = 64 / Math.max(ph.canvas.width, ph.canvas.height);
  c.width = Math.round(ph.canvas.width * k); c.height = Math.round(ph.canvas.height * k);
  c.getContext('2d').drawImage(ph.canvas, 0, 0, c.width, c.height);
  return (ph.thumb = c.toDataURL('image/jpeg', 0.7));
};

export function renderPhotos() {
  const list = $('#photoList'); list.replaceChildren();
  $('#photoAddBtn').disabled = !S.track || photos.length >= MAX_PHOTOS;
  $('#photoCount').textContent = photos.length ? photos.length + ' of ' + MAX_PHOTOS : '';
  for (const ph of photos) {
    const li = document.createElement('li'), st = status(ph), pl = placement(ph);
    li.innerHTML = '<img alt=""><div class="pmeta"><b></b><span></span></div><button class="link" type="button" aria-label="Remove photo">Remove</button>';
    li.querySelector('img').src = thumb(ph);
    li.querySelector('b').textContent = ph.name;
    const span = li.querySelector('span'); span.textContent = st.text; span.className = st.warn ? 'warn' : '';
    li.querySelector('button').addEventListener('click', () => { removePhoto(ph.id); renderPhotos(); refresh(); });
    if (!pl || pl.how === 'manual') { // a slider to put it on the route by hand
      const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 1000; r.value = pl ? Math.round(pl.p * 1000) : 500; r.setAttribute('aria-label', 'Position along the route');
      r.addEventListener('input', () => { ph.manualP = r.value / 1000; const s2 = status(ph); span.textContent = s2.text; span.className = s2.warn ? 'warn' : ''; refresh(); });
      li.appendChild(r);
    }
    const cap = document.createElement('input'); cap.type = 'text'; cap.maxLength = 40; cap.placeholder = 'Caption (optional)'; cap.value = ph.caption; cap.setAttribute('aria-label', 'Caption for ' + ph.name); cap.autocomplete = 'off';
    cap.addEventListener('input', () => { ph.caption = cap.value; refresh(); });
    li.appendChild(cap);
    list.appendChild(li);
  }
}

export function bindPhotos() {
  const input = $('#photoInput'), note = $('#photoNote');
  $('#photoAddBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const files = [...input.files]; input.value = ''; if (!files.length) return;
    const res = await addPhotos(files), bits = [];
    if (res.failed.length) bits.push(res.failed.length === 1 ? res.failed[0] + ' could not be read (HEIC photos only open in Safari).' : res.failed.length + ' photos could not be read (HEIC photos only open in Safari).');
    if (res.full) bits.push('Up to ' + MAX_PHOTOS + ' photos. ' + res.full + ' not added.');
    note.textContent = bits.join(' '); note.hidden = !bits.length;
    renderPhotos(); refresh();
  });
}

/* a new activity starts without the last one's photos */
export function resetPhotos() { clearPhotos(); $('#photoNote').hidden = true; renderPhotos(); }
