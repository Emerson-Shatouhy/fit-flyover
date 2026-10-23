import { R, S } from './state.js';

/* Colour grading and weather drawn over the map: the warm or dim tint from the sun, haze, rain, snow and lightning.
   Everything moves with the video time (tau) and repeats a whole number of times, so the first and last frames match and the loop has no seam. */
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const col = (c, a) => 'rgba(' + c.map((v) => Math.round(v)).join(',') + ',' + a + ')';

function drawRain(ctx, W, H, k, tau, u) {
  const n = Math.round(110 + 190 * k);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 1.6 * u; ctx.strokeStyle = 'rgba(225,235,248,' + (0.22 + 0.2 * k) + ')'; ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = (1000 + 800 * rnd(i * 4 + 3)) * u, len = (26 + 34 * rnd(i * 4 + 4)) * u, span = H + len;
    const cycles = Math.max(1, Math.round((S.duration * v) / span)), y = (((rnd(i * 4 + 2) + tau * cycles) % 1) * span) - len, x = rnd(i * 4 + 1) * (W + 0.3 * H) - 0.1 * H;
    ctx.moveTo(x, y); ctx.lineTo(x - 0.2 * len, y + len);
  }
  ctx.stroke(); ctx.restore();
}

function drawSnow(ctx, W, H, k, tau, u) {
  const n = Math.round(70 + 170 * k);
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.82)';
  for (let i = 0; i < n; i++) {
    const r = (1.8 + 4.2 * rnd(i * 5 + 3)) * u, v = (55 + 95 * rnd(i * 5 + 4)) * u, span = H + 2 * r;
    const cycles = Math.max(1, Math.round((S.duration * v) / span)), y = (((rnd(i * 5 + 2) + tau * cycles) % 1) * span) - r;
    const wob = Math.sin(2 * Math.PI * (tau * (1 + Math.floor(3 * rnd(i * 5 + 5))) + rnd(i * 5 + 6))) * (12 + 24 * rnd(i * 5 + 7)) * u;
    ctx.beginPath(); ctx.arc(rnd(i * 5 + 1) * W + wob, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* a few quick double flashes spread over the video */
function lightning(tau) {
  const flashes = Math.max(2, Math.round(S.duration / 7));
  let a = 0;
  for (let i = 0; i < flashes; i++) {
    const t0 = 0.18 + 0.64 * ((i + 0.3 + 0.4 * rnd(i + 9)) / flashes), dt = (tau - t0) * S.duration;
    if (dt >= 0 && dt < 0.5) a = Math.max(a, 0.5 * Math.pow(1 - dt / 0.5, 2) * (dt > 0.18 && dt < 0.26 ? 0.4 : 1));
  }
  return a;
}

export function drawLook(ctx, W, H) {
  const L = R.look; if (!L) return;
  const u = Math.min(W, H) / 1080, tau = S.tau, wx = L.wx;
  ctx.save();
  if (L.warm.a > 0.004) { ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = col(L.warm.rgb, L.warm.a); ctx.fillRect(0, 0, W, H); }
  if (wx.desat > 0.004) { ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = col([128, 128, 128], wx.desat); ctx.fillRect(0, 0, W, H); }
  if (L.dim.a > 0.004) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = col(L.dim.rgb[0] || L.dim.rgb[1] || L.dim.rgb[2] ? L.dim.rgb : [70, 80, 100], L.dim.a); ctx.fillRect(0, 0, W, H); }
  ctx.globalCompositeOperation = 'source-over';
  if (wx.haze > 0.004) { // a soft haze that is thickest toward the horizon at the top of the frame
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.7); g.addColorStop(0, col([214, 220, 226], wx.haze * 1.6)); g.addColorStop(1, col([214, 220, 226], 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (wx.rain > 0) drawRain(ctx, W, H, wx.rain, tau, u);
  if (wx.snow > 0) drawSnow(ctx, W, H, wx.snow, tau, u);
  if (wx.lightning) { const a = lightning(tau); if (a > 0.01) { ctx.fillStyle = 'rgba(235,242,255,' + a + ')'; ctx.fillRect(0, 0, W, H); } }
  ctx.restore();
}
