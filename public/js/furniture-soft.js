import { shade } from "./sprites.js";
import { px, hash2 } from "./pixels.js";

const WOOD = "#7c5238";
const WOOD_LIGHT = "#9a6a48";
const WOOD_DARK = "#4c3123";
const STEEL = "#8d9baa";
const STEEL_LIGHT = "#b7c2ce";
const STEEL_DARK = "#4a5664";
const DARK = "#171d27";

function steam(ctx, x, y, t, color = "rgba(235,235,235,0.28)") {
  for (let i = 0; i < 3; i += 1) {
    const rise = ((t * 8 + i * 6) % 18);
    px(ctx, x + Math.sin(t * 1.3 + i) * 2, y - rise, 2, 2, color);
  }
}

function shadow(ctx, x, y, w) {
  px(ctx, x + 3, y - 2, w - 6, 2, "rgba(0,0,0,0.22)");
}

export function drawSofa(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#f472b6";
  const dark = shade(accent, -0.38);
  const light = shade(accent, 0.22);
  shadow(ctx, x, y + h, w);

  px(ctx, x + 2, y + 3, w - 4, 17, dark);
  px(ctx, x + 4, y + 5, w - 8, 8, accent);
  px(ctx, x + 6, y + 6, w / 2 - 10, 5, light);
  px(ctx, x + w / 2 + 4, y + 6, w / 2 - 10, 5, shade(accent, 0.08));
  px(ctx, x + 2, y + 16, w - 4, 12, accent);
  px(ctx, x + 5, y + 18, w - 10, 8, light);
  px(ctx, x + w / 2, y + 18, 2, 8, dark);
  px(ctx, x, y + 6, 5, 22, dark);
  px(ctx, x + w - 5, y + 6, 5, 22, dark);
  px(ctx, x + 2, y + 8, 2, 16, light);
  px(ctx, x + w - 4, y + 8, 2, 16, shade(accent, 0.1));
  px(ctx, x + 5, y + h - 4, 3, 4, WOOD_DARK);
  px(ctx, x + w - 8, y + h - 4, 3, 4, WOOD_DARK);
  // Throw blanket.
  px(ctx, x + w - 24, y + 12, 12, 8, "#e8c48a");
  px(ctx, x + w - 22, y + 14, 8, 2, "#c99c5c");
  // Cushion buttons.
  px(ctx, x + w * 0.28, y + 10, 2, 2, dark);
  px(ctx, x + w * 0.7, y + 10, 2, 2, dark);

  if (item.cat) {
    const cx = x + w * 0.62;
    const cy = y + 17;
    const flick = Math.floor(t * 1.6) % 4 === 0 ? 2 : 0;
    px(ctx, cx, cy, 12, 7, "#d8904d");
    px(ctx, cx + 2, cy - 4, 8, 5, "#e5a35a");
    px(ctx, cx + 1, cy - 6, 3, 3, "#d8904d");
    px(ctx, cx + 8, cy - 6, 3, 3, "#d8904d");
    px(ctx, cx + 2, cy - 6, 1, 2, "#f2c89a");
    px(ctx, cx + 9, cy - 6, 1, 2, "#f2c89a");
    px(ctx, cx + 3, cy - 2, 1, 1, "#3a2a22");
    px(ctx, cx + 8, cy - 2, 1, 1, "#3a2a22");
    px(ctx, cx + 5, cy - 3, 3, 1, "#9a5a34");
    px(ctx, cx + 11, cy + 3 + flick, 4, 2, "#d8904d");
    px(ctx, cx + 14, cy + 1 + flick, 2, 3, "#e5a35a");
    // Stripes.
    px(ctx, cx + 3, cy + 2, 1, 4, "#9a5a34");
    px(ctx, cx + 6, cy + 1, 1, 5, "#9a5a34");
    px(ctx, cx + 9, cy + 2, 1, 3, "#9a5a34");
  }
}

export function drawCoffeeTable(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  shadow(ctx, x, y + h, w);
  px(ctx, x + 2, y + 3, w - 4, 5, WOOD_LIGHT);
  px(ctx, x + 3, y + 5, w - 6, 11, WOOD);
  px(ctx, x + 5, y + 7, w - 10, 7, shade(WOOD, 0.1));
  px(ctx, x + 4, y + 15, 3, h - 16, WOOD_DARK);
  px(ctx, x + w - 7, y + 15, 3, h - 16, WOOD_DARK);
  px(ctx, x + 5, y + h - 3, w - 10, 2, "rgba(0,0,0,0.16)");
  // Magazines.
  px(ctx, x + 8, y + 8, 13, 8, "#d9d4c5");
  px(ctx, x + 9, y + 9, 11, 6, "#b4534b");
  px(ctx, x + 12, y + 11, 5, 2, "#f0e5d0");
  px(ctx, x + w - 24, y + 8, 9, 7, "#8ab4a2");
  // Mug.
  px(ctx, x + w - 34, y + 8, 6, 5, "#e9e4d8");
  px(ctx, x + w - 28, y + 9, 2, 2, "#e9e4d8");
  px(ctx, x + w - 33, y + 8, 4, 1, "#5a3a32");
}

export function drawCounter(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#fcd34d";
  shadow(ctx, x, y + h, w);
  // Backsplash and counter.
  px(ctx, x + 1, y, w - 2, 4, shade(accent, -0.55));
  px(ctx, x + 1, y + 4, w - 2, 8, "#d8cbb2");
  px(ctx, x + 2, y + 5, w - 4, 2, "#efe4cc");
  px(ctx, x + 1, y + 12, w - 2, 18, "#8b6a48");
  px(ctx, x + 3, y + 14, w - 6, 14, "#997653");
  for (let i = 0; i < 4; i += 1) {
    const cx = x + 6 + i * ((w - 14) / 4);
    px(ctx, cx, y + 16, (w - 22) / 4, 11, "#8b6a48");
    px(ctx, cx + 3, y + 19, 2, 1, "#d8cbb2");
  }
  // Sink.
  px(ctx, x + 8, y + 5, 20, 6, "#5a697a");
  px(ctx, x + 9, y + 6, 18, 4, "#394958");
  px(ctx, x + 26, y + 1, 2, 6, STEEL_LIGHT);
  px(ctx, x + 22, y + 1, 6, 2, STEEL_LIGHT);
  // Stove.
  px(ctx, x + 38, y + 5, 26, 6, "#2c333d");
  for (let i = 0; i < 4; i += 1) {
    px(ctx, x + 41 + (i % 2) * 11, y + 6 + Math.floor(i / 2) * 2, 5, 2, "#59636f");
  }
  // Coffee machine.
  px(ctx, x + w - 38, y - 2, 20, 14, "#3a3f47");
  px(ctx, x + w - 35, y + 1, 14, 5, "#5b636e");
  px(ctx, x + w - 33, y + 7, 10, 3, "#20252c");
  px(ctx, x + w - 28, y + 9, 2, 2, "#e8d6a8");
  steam(ctx, x + w - 27, y - 4, t);
  // Fruit bowl and cutting board.
  px(ctx, x + 70, y + 6, 16, 3, "#b98b5a");
  px(ctx, x + 73, y + 3, 4, 3, "#d35f4d");
  px(ctx, x + 78, y + 3, 4, 3, "#e0b64d");
  px(ctx, x + 75, y + 4, 3, 2, "#7da35a");
  // Utensils.
  px(ctx, x + 88, y + 4, 17, 3, "#6b4a36");
  px(ctx, x + 90, y + 1, 2, 4, STEEL);
  px(ctx, x + 95, y + 1, 2, 4, STEEL);
  px(ctx, x + 100, y + 1, 2, 4, STEEL);
}

export function drawIsland(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#fcd34d";
  shadow(ctx, x, y + h, w);
  px(ctx, x + 2, y + 3, w - 4, 7, "#e0d3b8");
  px(ctx, x + 3, y + 4, w - 6, 2, "#f4e9d0");
  px(ctx, x + 1, y + 10, w - 2, 16, "#8a6446");
  px(ctx, x + 4, y + 12, w - 8, 12, "#9a7350");
  px(ctx, x + w / 2, y + 12, 2, 12, "#6d4c35");
  // Cutting board, bowl, coffee pot.
  px(ctx, x + 8, y + 4, 14, 5, "#b98756");
  px(ctx, x + 11, y + 2, 7, 3, "#d8c7a1");
  px(ctx, x + w - 20, y + 3, 10, 4, "#7aa0a8");
  px(ctx, x + w - 18, y + 1, 6, 3, "#9bc0c6");
  px(ctx, x + w - 34, y + 2, 6, 6, "#39424c");
  px(ctx, x + w - 33, y + 2, 4, 2, "#8c6a45");
  // Stools on the near side.
  for (const sx of [x + 8, x + w - 20]) {
    px(ctx, sx, y + h - 2, 12, 3, "#3a2c24");
    px(ctx, sx + 1, y + h, 2, 5, "#241c18");
    px(ctx, sx + 9, y + h, 2, 5, "#241c18");
    px(ctx, sx + 3, y + h - 5, 6, 3, accent);
  }
}

export function drawFridge(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  shadow(ctx, x, y + h, w);
  px(ctx, x + 2, y + 2, w - 4, h - 4, "#c7ced6");
  px(ctx, x + 3, y + 3, w - 6, h - 6, "#e2e7eb");
  px(ctx, x + 3, y + Math.floor(h * 0.38), w - 6, 2, "#9aa4ae");
  px(ctx, x + 4, y + 4, 2, h - 10, "#f4f7f9");
  px(ctx, x + 6, y + 7, 2, Math.floor(h * 0.24), "#8f9aa4");
  px(ctx, x + 6, y + Math.floor(h * 0.47), 2, Math.floor(h * 0.38), "#8f9aa4");
  // Magnets and a note.
  px(ctx, x + 11, y + 10, 4, 4, "#e0b64d");
  px(ctx, x + 17, y + 8, 5, 4, "#d35f4d");
  px(ctx, x + 12, y + 20, 10, 8, "#f6efdc");
  px(ctx, x + 13, y + 22, 8, 1, "#8a7a62");
  px(ctx, x + 13, y + 24, 6, 1, "#8a7a62");
  px(ctx, x + 14, y + 26, 4, 1, "#8a7a62");
  px(ctx, x + 2, y + h - 5, w - 4, 3, "rgba(0,0,0,0.2)");
}

export function drawServerRack(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#fb923c";
  shadow(ctx, x, y + h, w);
  px(ctx, x + 1, y, w - 2, h - 3, "#232b36");
  px(ctx, x + 2, y + 2, w - 4, h - 6, "#313b48");
  px(ctx, x + 3, y + 3, w - 6, 2, "#596574");
  for (let row = 0; row < 11; row += 1) {
    const ry = y + 6 + row * ((h - 14) / 11);
    px(ctx, x + 4, ry, w - 8, 3, "#242d38");
    px(ctx, x + 5, ry + 1, 3, 1, accent);
    const lit = Math.floor(t * 2.4 + row * 0.9 + item.tx) % 7;
    for (let led = 0; led < 3; led += 1) {
      const on = (led + lit) % 3 !== 0;
      px(ctx, x + w - 10 - led * 3, ry + 1, 1, 1, on ? (led === 0 ? "#7ef0a8" : "#fbbf24") : "#1b222b");
    }
  }
  px(ctx, x + 1, y + h - 4, w - 2, 3, "#161c24");
  // Cables.
  px(ctx, x + 5, y + h - 2, 3, 4, "#c2413a");
  px(ctx, x + 11, y + h - 2, 2, 3, "#3b82f6");
  px(ctx, x + 18, y + h - 2, 2, 4, "#f59e0b");
}

export function drawArcade(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#f472b6";
  shadow(ctx, x, y + h, w);
  px(ctx, x + 2, y + 4, w - 4, h - 6, "#2a2233");
  px(ctx, x + 3, y + 2, w - 6, 10, "#3b2d4a");
  px(ctx, x + 5, y + 4, w - 10, 2, accent);
  px(ctx, x + 5, y + 7, w - 10, 1, shade(accent, -0.3));
  px(ctx, x + 5, y + 14, w - 10, 15, "#101624");
  const glow = Math.floor(t * 3) % 2 ? 0.9 : 0.7;
  ctx.globalAlpha = glow;
  px(ctx, x + 6, y + 15, w - 12, 13, "#153a4a");
  px(ctx, x + 8, y + 17, 5, 2, "#4ade80");
  px(ctx, x + 8, y + 20, 8, 1, "#38bdf8");
  px(ctx, x + 8, y + 23, 6, 1, "#fbbf24");
  ctx.globalAlpha = 1;
  px(ctx, x + 3, y + 30, w - 6, 8, "#3a2c48");
  px(ctx, x + 6, y + 31, 3, 3, "#f4e3b2");
  px(ctx, x + 11, y + 31, 4, 4, "#ef4444");
  px(ctx, x + 16, y + 32, 3, 2, "#93c5fd");
  px(ctx, x + 4, y + 39, w - 8, 5, "#1c1626");
  px(ctx, x + 5, y + 41, 4, 2, accent);
  px(ctx, x + w - 12, y + 40, 5, 2, "#f59e0b");
  // Coin slot.
  px(ctx, x + w / 2 - 2, y + h - 5, 4, 3, "#0f141c");
  px(ctx, x + w / 2 - 1, y + h - 4, 2, 1, "#facc15");
}
