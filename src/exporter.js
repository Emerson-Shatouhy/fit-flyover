import * as C from './core.js';
import { $, $$, sleep } from './util.js';
import { setStatus } from './activity.js';
import { R, S, dims, view } from './state.js';
import { exitTrimView } from './trim.js';
import { setPlaying } from './playback.js';
import { applyFrame, settle } from './frames.js';

/* ------------------------------ export ------------------------------ */
const slug = (s) => (s || 'route').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'route';

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function showProgress(frac, text) { $('#bar').hidden = false; $('#barFill').style.width = (frac * 100).toFixed(1) + '%'; setStatus(text); }

export async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  try { await Promise.race([Promise.all(['700 40px "Barlow Condensed"', '600 40px "Barlow Condensed"', '500 20px "Barlow"'].map((f) => document.fonts.load(f))), sleep(3000)]); } catch (e) { /* fall back to system fonts */ }
}

async function waitVisible() {
  while (document.hidden && !R.exportCancel) { setStatus('Paused. Bring this tab to the front to continue.', 'warn'); await sleep(400); }
}

export async function exportVideo() {
  if (!S.track || S.exporting) return;
  exitTrimView(false);
  S.exporting = true; R.exportCancel = false; setPlaying(false);
  document.body.classList.add('exporting');
  $$('[data-lock]').forEach((e) => { e.inert = true; });
  $('#exportBtn').hidden = true; $('#cancelBtn').hidden = false; $('#tilesNote').hidden = true;
  const keep = S.tau; let result = null, wake = null;
  try {
    await fontsReady();
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
    const base = slug(S.title || S.track.meta.name) + '-flyover';
    result = window.VideoEncoder && window.VideoFrame ? await exportWebCodecs(base) : 'unsupported';
    if (result === 'unsupported') result = await exportRealtime(base);
  } catch (e) { console.error(e); setStatus('Export failed: ' + (e.message || e), 'error'); }
  finally {
    if (wake) try { await wake.release(); } catch (e) { /* ignore */ }
    S.exporting = false; document.body.classList.remove('exporting');
    $$('[data-lock]').forEach((e) => { e.inert = false; });
    $('#exportBtn').hidden = false; $('#cancelBtn').hidden = true; $('#bar').hidden = true;
    applyFrame(keep);
  }
  if (R.exportCancel) setStatus('Export cancelled.');
  else if (result && result.name) setStatus('Saved ' + result.name + ' (' + (result.size / 1048576).toFixed(1) + ' MB).');
}

async function exportWebCodecs(base) {
  const { W, H } = dims(), fps = S.fps, total = Math.max(2, Math.round(S.duration * fps));
  const bitrate = Math.round(Math.min(30e6, Math.max(6e6, W * H * fps * 0.14)));
  let cfg = null;
  for (const codec of ['avc1.64002A', 'avc1.4D002A', 'avc1.42002A']) {
    const c = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
    try { const r = await VideoEncoder.isConfigSupported(c); if (r && r.supported) { cfg = r.config || c; break; } } catch (e) { /* try next */ }
  }
  if (!cfg) return 'unsupported';
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  enc.configure(cfg);
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    if (R.exportCancel) { try { enc.close(); } catch (e) { /* ignore */ } return null; }
    await waitVisible();
    applyFrame(i / (S.cards ? total : total - 1)); // with the card on, stopping one frame short keeps the loop from showing the first picture twice
    await settle();
    const f = new VideoFrame(view, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(f, { keyFrame: i % (fps * 2) === 0 }); f.close();
    while (enc.encodeQueueSize > 8 && !encErr) await sleep(4);
    if (encErr) throw encErr;
    const done = i + 1, eta = ((performance.now() - t0) / done) * (total - done) / 1000;
    showProgress(done / total, 'Rendering frame ' + done + ' of ' + total + (done > 8 ? ' · about ' + C.fmtDuration(eta) + ' left' : ''));
  }
  showProgress(1, 'Finishing the file…');
  await enc.flush(); enc.close(); muxer.finalize();
  const blob = new Blob([target.buffer], { type: 'video/mp4' }), name = base + '.mp4';
  download(blob, name);
  return { name, size: blob.size };
}

/* fallback for browsers without WebCodecs: records the live canvas in real time */
async function exportRealtime(base) {
  const types = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = window.MediaRecorder && types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('This browser cannot record video. Use a recent Chrome, Edge or Safari.');
  setStatus('Preparing tiles…'); applyFrame(0); await settle();
  const stream = view.captureStream(S.fps), chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });
  rec.start(250);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      if (R.exportCancel) return resolve();
      const tau = Math.min(1, (performance.now() - t0) / 1000 / S.duration);
      applyFrame(tau); showProgress(tau, 'Recording in real time…');
      if (tau >= 1) return resolve();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await sleep(300); rec.stop(); await stopped; stream.getTracks().forEach((t) => t.stop());
  if (R.exportCancel) return null;
  const blob = new Blob(chunks, { type: mime.split(';')[0] }), name = base + (mime.includes('mp4') ? '.mp4' : '.webm');
  download(blob, name);
  return { name, size: blob.size };
}
