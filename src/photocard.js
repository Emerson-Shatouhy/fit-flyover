import { S } from './state.js';
import { rr } from './util.js';
import { FONT_NUM } from './config.js';
import { cardAlpha } from './photocore.js';
import { photoSlots } from './photos.js';

/* A photo pops up as a polaroid when the head reaches the spot where it was taken. They alternate sides and tilt a little each way. */
export function drawPhotos(ctx, W, H) {
  if (!S.track || !photoSlots().length) return;
  const tau = S.tau, portrait = H > W, s = Math.min(W, H), u = s / 1080;
  for (const x of photoSlots()) {
    if (!x.slot) continue;
    const a = cardAlpha(x.slot, tau, S.duration); if (a <= 0.01) continue;
    const img = x.ph.canvas, ar = Math.min(1.33, Math.max(0.75, img.width / img.height));
    const cw = portrait ? 0.44 * W : 0.46 * H, b = cw * 0.04, pw = cw - 2 * b, ph = pw / ar, chin = cw * 0.15, ch = b + ph + chin;
    const left = x.n % 2 === 0;
    const cx = portrait ? W * (left ? 0.34 : 0.66) : W * (left ? 0.26 : 0.74);
    const top = portrait ? H * 0.255 : (H - ch) / 2;
    const rise = (1 - a) * 28 * u, sc = 0.9 + 0.1 * a;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx, top + ch / 2 + rise); ctx.rotate(((left ? -3.2 : 3.2) * Math.PI) / 180); ctx.scale(sc, sc);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 26 * u; ctx.shadowOffsetY = 8 * u;
    ctx.fillStyle = '#f7f5ef'; rr(ctx, -cw / 2, -ch / 2, cw, ch, 6 * u); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // the photo, cropped to fill its frame
    const bx = -cw / 2 + b, by = -ch / 2 + b, iar = img.width / img.height;
    let sw = img.width, sh = img.height, sx = 0, sy = 0;
    if (iar > ar) { sw = img.height * ar; sx = (img.width - sw) / 2; } else { sh = img.width / ar; sy = (img.height - sh) / 2; }
    ctx.save(); ctx.beginPath(); ctx.rect(bx, by, pw, ph); ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, bx, by, pw, ph); ctx.restore();
    const cap = (x.ph.caption || '').trim();
    if (cap) { // the caption goes on the chin, shrunk to fit
      let fs = chin * 0.48; ctx.font = '600 ' + fs + 'px ' + FONT_NUM;
      while (fs > 10 * u && ctx.measureText(cap).width > pw) { fs -= 1; ctx.font = '600 ' + fs + 'px ' + FONT_NUM; }
      ctx.fillStyle = '#1b2026'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cap, 0, ch / 2 - chin * 0.5 + 1 * u);
    } else { ctx.fillStyle = S.color2 || S.color; ctx.fillRect(-18 * u, ch / 2 - chin * 0.5 - 2.5 * u, 36 * u, 5 * u); } // no caption: a small accent mark
    ctx.restore();
  }
}
