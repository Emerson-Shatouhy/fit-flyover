export const $ = (s, r) => (r || document).querySelector(s);

export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const spacing = (ctx, v) => { try { ctx.letterSpacing = v; } catch (e) { /* older browsers */ } };

export function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export const inkOn = (hex) => { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#101418' : '#ffffff'; };

/* ------------------------------ controls ------------------------------ */
export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
