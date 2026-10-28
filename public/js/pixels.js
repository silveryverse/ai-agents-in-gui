export function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function rounded(ctx, x, y, w, h, fill, radius = 2) {
  px(ctx, x + radius, y, w - radius * 2, h, fill);
  px(ctx, x, y + radius, w, h - radius * 2, fill);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
