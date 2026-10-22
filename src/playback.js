import * as C from './core.js';
import { R, S } from './state.js';
import { applyFrame } from './frames.js';
import { $ } from './util.js';

/* ------------------------------ playback ------------------------------ */
let lastTs = 0, holdUntil = 0;

export function tick(ts) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)); lastTs = ts;
  if (!S.playing || S.exporting || !S.track || R.dragging) return;
  if (S.tau >= 1) {
    if (!S.loop) { setPlaying(false); return; }
    if (!holdUntil) holdUntil = ts + 1300;
    if (ts < holdUntil) return;
    holdUntil = 0; applyFrame(0); return;
  }
  applyFrame(S.tau + dt / S.duration);
}

export function setPlaying(on) {
  S.playing = !!on && !!S.track;
  $('#icoPlay').hidden = S.playing; $('#icoPause').hidden = !S.playing;
  $('#playBtn').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  if (S.playing && S.tau >= 1 && !S.loop) applyFrame(0);
  holdUntil = 0;
}

export function updateTransport() {
  $('#scrub').value = Math.round(S.tau * 1000);
  $('#timeLabel').textContent = C.fmtDuration(S.tau * S.duration) + ' / ' + C.fmtDuration(S.duration);
}
