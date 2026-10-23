import * as C from './core.js';
import { $, $$, hexToRgb } from './util.js';
import { SPORTS } from './sport.js';
import { PRESETS, SEGS, SWATCHES, markerForUnits, markerOptions } from './config.js';
import { adoptRaw, autoTrim, bindTrimDrag, enterTrimView, exitTrimView, refreshTrimNote, resetTrim } from './trim.js';
import { applyFrame, refresh, replan } from './frames.js';
import { applyBasemap, applyLineStyle, applyRouteColor, styleUp } from './map.js';
import { R, S, dims, host, save, view } from './state.js';
import { loadFile, setStatus, setTrack, updateActivityPanel } from './activity.js';
import { setPlaying } from './playback.js';
import { exportVideo } from './exporter.js';

function setAccent(hex) {
  const [r, g, b] = hexToRgb(hex), root = document.documentElement.style;
  root.setProperty('--accent', hex);
  root.setProperty('--on-accent', (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#101418' : '#ffffff');
}

export function buildControls() {
  for (const [v, label] of SPORTS) { const o = document.createElement('option'); o.value = v; o.textContent = label; $('#sport').appendChild(o); }
  $$('[data-seg]').forEach((el) => {
    const key = el.dataset.seg;
    SEGS[key].forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.val = v; b.textContent = label;
      b.addEventListener('click', () => onSeg(key, v));
      el.appendChild(b);
    });
  });
  const sw = $('#swatches');
  SWATCHES.forEach(([hex, name]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.val = hex; b.setAttribute('aria-label', name); b.title = name; b.style.setProperty('--c', hex);
    b.addEventListener('click', () => onColor(hex));
    sw.appendChild(b);
  });
  const custom = document.createElement('label');
  custom.title = 'Custom colour'; custom.id = 'customSwatch';
  custom.innerHTML = '<input type="color" id="customColor" aria-label="Custom route colour">';
  sw.appendChild(custom);
  $('#customColor').addEventListener('input', (e) => onColor(e.target.value.toUpperCase()));

  bindRange('duration', 'duration', (v) => v + ' s', () => { replan(); refresh(); updateAutoLen(); });
  bindRange('pitch', 'pitch', (v) => v + '°', () => { replan(); refresh(); });
  bindRange('zoom', 'zoom', (v) => (v > 0 ? '+' : '') + v.toFixed(1), () => { replan(); refresh(); });
  bindRange('terrain', 'terrain', (v) => v.toFixed(1) + '×', () => { if (styleUp()) R.map.setTerrain({ source: 'dem', exaggeration: S.terrain }); refresh(); });

  $('#aspect').value = S.aspect; $('#res').value = String(S.res); $('#fps').value = String(S.fps);
  $('#aspect').addEventListener('change', (e) => { S.aspect = e.target.value; save(); applySize(); });
  $('#res').addEventListener('change', (e) => { S.res = +e.target.value; save(); applySize(); });
  $('#fps').addEventListener('change', (e) => { S.fps = +e.target.value; save(); });
  $('#sport').addEventListener('change', (e) => { S.sport = e.target.value; save(); syncControls(); updateActivityPanel(); refresh(); });
  $('#markerEvery').addEventListener('change', (e) => { S.markerEvery = e.target.value; save(); refresh(); });
  $('#title').addEventListener('input', (e) => { S.title = e.target.value; refresh(); });
  $('#subtitle').addEventListener('input', (e) => { S.subtitle = e.target.value; refresh(); });
  $$('[data-stat]').forEach((el) => { el.checked = !!S.stats[el.dataset.stat]; el.addEventListener('change', () => { S.stats[el.dataset.stat] = el.checked; save(); refresh(); }); });
  for (const [id, key] of [['creditChk', 'credit'], ['safeChk', 'safe'], ['markersChk', 'markers'], ['calloutsChk', 'callouts'], ['legendChk', 'legend'], ['cardsChk', 'cards']]) {
    const el = $('#' + id); el.checked = !!S[key];
    el.addEventListener('change', () => { S[key] = el.checked; save(); if (key === 'cards') replan(); refresh(); }); // the card changes the camera timing
  }
  $('#loopChk').checked = S.loop;
  $('#loopChk').addEventListener('change', (e) => { S.loop = e.target.checked; save(); });
  $('#autoLen').addEventListener('click', () => { S.duration = C.suggestDuration(S.track.L); syncControls(); replan(); refresh(); });
  buildTabs();
  syncControls();
}

/* Activity / Style / Overlay: one group on screen at a time, arrow keys move between tabs */
function buildTabs() {
  const tabs = $$('.tabs [role="tab"]');
  const show = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t));
    t.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (k) { e.preventDefault(); show(tabs[(i + k + tabs.length) % tabs.length], true); }
      else if (e.key === 'Home') { e.preventDefault(); show(tabs[0], true); } else if (e.key === 'End') { e.preventDefault(); show(tabs[tabs.length - 1], true); }
    });
  });
}

/* the "Marker every" choices follow the units: 250 m in metric, 0.25 mi in imperial, and the pick carries over */
let markerUnits = null;

function syncMarkerOptions() {
  S.markerEvery = markerForUnits(S.markerEvery, S.units);
  const sel = $('#markerEvery');
  if (markerUnits !== S.units) {
    sel.replaceChildren(new Option('Auto', 'auto'), ...markerOptions(S.units).map(([v, label]) => new Option(label, v)));
    markerUnits = S.units;
  }
  sel.value = S.markerEvery;
}

function bindRange(id, key, fmt, onInput) {
  const el = $('#' + id);
  const sync = () => {
    el.value = S[key];
    el.style.setProperty('--fill', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
    $('#' + id + 'Out').textContent = fmt(+el.value);
  };
  el.addEventListener('input', () => { S[key] = parseFloat(el.value); sync(); onInput(); save(); });
  el._sync = sync; sync();
}

function updateAutoLen() {
  const b = $('#autoLen');
  if (!S.track) { b.hidden = true; return; }
  const s = C.suggestDuration(S.track.L);
  b.hidden = s === S.duration; b.textContent = 'use ' + s + ' s';
}

export function syncControls() {
  for (const id of ['duration', 'pitch', 'zoom', 'terrain']) $('#' + id)._sync();
  $$('[data-seg]').forEach((el) => $$('button', el).forEach((b) => b.setAttribute('aria-checked', String(S[el.dataset.seg] === b.dataset.val))));
  $$('#swatches button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.val.toUpperCase() === S.color.toUpperCase())));
  const isCustom = !SWATCHES.some(([h]) => h.toUpperCase() === S.color.toUpperCase());
  $('#customSwatch').classList.toggle('on', isCustom);
  if (/^#[0-9a-f]{6}$/i.test(S.color)) $('#customColor').value = S.color.toLowerCase();
  $('#sport').value = S.sport; syncMarkerOptions();
  setAccent(S.color); updateAutoLen();
}

function onSeg(key, val) {
  S[key] = val;
  if (key === 'camera') S.pitch = PRESETS[val].pitch;
  save(); syncControls();
  if (key === 'basemap') applyBasemap();
  if (key === 'camera') replan();
  if (key === 'colorBy') applyRouteColor();
  if (key === 'units') { updateActivityPanel(); refreshTrimNote(); } // marker options already followed in syncControls
  refresh();
}

function onColor(hex) { S.color = hex; save(); syncControls(); applyRouteColor(); refresh(); }

function applySize() {
  const { W, H } = dims();
  view.width = W; view.height = H;
  host.style.width = W + 'px'; host.style.height = H + 'px';
  if (R.map) { R.map.resize(); applyLineStyle(); }
  fitView(); replan(); refresh();
}

export function fitView() {
  const st = $('#stage'), { W, H } = dims();
  const k = Math.max(0.1, Math.min((st.clientWidth - 40) / W, (st.clientHeight - 40) / H, 1.5));
  view.style.width = Math.floor(W * k) + 'px'; view.style.height = Math.floor(H * k) + 'px';
}

export function bindEvents() {
  const input = $('#fileInput');
  $('#pickBtn').addEventListener('click', () => input.click());
  $('#replaceBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); input.value = ''; });
  $('#sampleBtn').addEventListener('click', async () => {
    try { await setTrack(C.buildTrack(adoptRaw(C.makeSample()))); setStatus(''); } catch (e) { setStatus(e.message, 'error'); }
  });
  const app = $('#app'), drop = $('#drop');
  app.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  app.addEventListener('dragleave', (e) => { if (!app.contains(e.relatedTarget)) drop.classList.remove('over'); });
  app.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f);
  });
  $('#playBtn').addEventListener('click', () => {
    if (S.exporting) return;
    if (S.trimView) { exitTrimView(false); applyFrame(0); setPlaying(true); return; } // preview the trimmed flyover from the start
    if (!S.playing && S.tau >= 1) applyFrame(0);
    setPlaying(!S.playing);
  });
  $('#trimAdjustBtn').addEventListener('click', enterTrimView);
  $('#trimAutoBtn').addEventListener('click', autoTrim);
  bindTrimDrag();
  $('#trimResetBtn').addEventListener('click', resetTrim);
  const scrub = $('#scrub');
  scrub.addEventListener('input', () => { if (S.trimView) exitTrimView(false); applyFrame(scrub.value / 1000); });
  scrub.addEventListener('pointerdown', () => { R.dragging = true; });
  window.addEventListener('pointerup', () => { R.dragging = false; });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || /^(INPUT|SELECT|BUTTON|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    e.preventDefault(); $('#playBtn').click();
  });
  $('#exportBtn').addEventListener('click', exportVideo);
  $('#cancelBtn').addEventListener('click', () => { R.exportCancel = true; setStatus('Cancelling…'); });
  if (window.ResizeObserver) new ResizeObserver(fitView).observe($('#stage')); else window.addEventListener('resize', fitView);
}
