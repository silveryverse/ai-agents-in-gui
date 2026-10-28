import { shade } from "./sprites.js";
import { px, hash2, rounded } from "./pixels.js";
import {
  drawSofa,
  drawCoffeeTable,
  drawCounter,
  drawIsland,
  drawFridge,
  drawServerRack,
  drawArcade,
} from "./furniture-soft.js";

const WOOD = "#7b5238";
const WOOD_LIGHT = "#9b6b4a";
const WOOD_DARK = "#4b3023";
const STEEL = "#8e9baa";
const STEEL_LIGHT = "#bdc7d2";
const STEEL_DARK = "#46515e";

function shadow(ctx, x, y, w) {
  px(ctx, x + 3, y - 2, w - 6, 2, "rgba(0,0,0,0.22)");
}

function monitor(ctx, x, y, w, h, accent, t, seed = 0) {
  px(ctx, x - 1, y - 1, w + 2, h + 2, "#141a24");
  px(ctx, x, y, w, h, "#0b1220");
  px(ctx, x + 1, y + 1, w - 2, h - 2, "#132033");
  const flicker = (Math.floor(t * 1.7 + seed) % 17) !== 0;
  ctx.globalAlpha = flicker ? 0.9 : 0.55;
  for (let row = 0; row < Math.floor((h - 4) / 2); row += 1) {
    const lineWidth = 3 + Math.floor(hash2(seed + row, row) * (w - 8));
    px(ctx, x + 3, y + 3 + row * 2, lineWidth, 1, row === 0 ? accent : "#5d7b9a");
  }
  ctx.globalAlpha = 1;
  px(ctx, x + w / 2 - 1, y + h, 2, 3, "#2a3340");
  px(ctx, x + w / 2 - 4, y + h + 3, 8, 2, "#1e2632");
}

function chair(ctx, cx, y, accent) {
  px(ctx, cx - 7, y, 14, 4, "#2f3542");
  px(ctx, cx - 6, y + 4, 12, 5, "#3a4252");
  px(ctx, cx - 5, y + 8, 2, 4, "#232a35");
  px(ctx, cx + 3, y + 8, 2, 4, "#232a35");
  px(ctx, cx - 1, y + 3, 2, 2, shade(accent, -0.2));
}

export function drawDesk(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#818cf8";
  shadow(ctx, x, y + h, w);

  const count = item.monitors ?? 1;
  const screenW = count > 2 ? 18 : count > 1 ? 22 : 26;
  const gap = 8;
  const total = count * screenW + (count - 1) * gap;
  let mx = x + (w - total) / 2;
  for (let i = 0; i < count; i += 1) {
    monitor(ctx, mx, y - 9, screenW, 15, accent, t, item.tx + i * 3);
    mx += screenW + gap;
  }

  px(ctx, x + 2, y + 6, w - 4, 4, WOOD_LIGHT);
  px(ctx, x + 3, y + 9, w - 6, 8, WOOD);
  px(ctx, x + 4, y + 16, w - 8, 6, WOOD_DARK);
  px(ctx, x + 4, y + 22, 4, h - 23, "#39241b");
  px(ctx, x + w - 8, y + 22, 4, h - 23, "#39241b");
  px(ctx, x + 6, y + 22, 2, 2, "#5b3b29");
  px(ctx, x + w - 8, y + 22, 2, 2, "#5b3b29");

  // Keyboard, mouse, mug, papers.
  px(ctx, x + w / 2 - 11, y + 12, 22, 4, "#d6d1c4");
  px(ctx, x + w / 2 - 10, y + 13, 20, 2, "#b9b3a5");
  for (let i = 0; i < 5; i += 1) px(ctx, x + w / 2 - 9 + i * 4, y + 13, 1, 1, "#7c776d");
  px(ctx, x + w / 2 + 14, y + 12, 3, 3, "#d6d1c4");
  const mx2 = x + w - 14;
  px(ctx, mx2, y + 8, 6, 5, "#e7e0d2");
  px(ctx, mx2 + 6, y + 9, 2, 2, "#e7e0d2");
  px(ctx, mx2 + 1, y + 8, 4, 1, "#8d5b4a");
  if (Math.floor(t * 1.6 + item.tx) % 5 === 0) {
    px(ctx, mx2 + 2, y + 5, 1, 2, "rgba(240,240,240,0.28)");
    px(ctx, mx2 + 4, y + 3, 1, 2, "rgba(240,240,240,0.2)");
  }
  px(ctx, x + 9, y + 9, 9, 6, "#d9d1b9");
  px(ctx, x + 10, y + 10, 7, 4, "#7e9b84");
  px(ctx, x + 11, y + 11, 4, 1, "#d9d1b9");

  chair(ctx, x + w / 2, y + 23, accent);
}

export function drawLabBench(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#5eead4";
  shadow(ctx, x, y + h, w);

  // Bench top and steel frame.
  px(ctx, x + 1, y + 5, w - 2, 5, STEEL_LIGHT);
  px(ctx, x + 2, y + 6, w - 4, 2, "#dbe3ea");
  px(ctx, x + 2, y + 10, w - 4, 4, STEEL);
  px(ctx, x + 3, y + 14, 2, h - 15, STEEL_DARK);
  px(ctx, x + w - 5, y + 14, 2, h - 15, STEEL_DARK);
  px(ctx, x + 6, y + 17, w - 12, 2, "#3b4652");
  px(ctx, x + 6, y + 21, w - 12, 2, "#3b4652");

  // Sink and flasks.
  px(ctx, x + 8, y + 2, 18, 6, "#5d6b7a");
  px(ctx, x + 9, y + 3, 16, 4, "#2f3d4a");
  px(ctx, x + 25, y - 4, 2, 7, STEEL_LIGHT);
  px(ctx, x + 21, y - 4, 6, 2, STEEL_LIGHT);
  for (let i = 0; i < 3; i += 1) {
    const fx = x + 38 + i * 16;
    px(ctx, fx, y + 1, 6, 4, "rgba(180,230,240,0.28)");
    px(ctx, fx + 1, y + 3, 4, 2, i === 0 ? "#5eead4" : i === 1 ? "#c084fc" : "#38bdf8");
    px(ctx, fx + 2, y - 1, 2, 2, "rgba(220,245,250,0.5)");
  }
  // Microscope.
  px(ctx, x + 90, y - 3, 4, 8, "#2b333d");
  px(ctx, x + 88, y + 3, 8, 2, "#4a5664");
  px(ctx, x + 92, y - 6, 6, 3, "#5b6775");
  px(ctx, x + 96, y - 4, 2, 4, "#8fa0b0");
  // Terminal.
  monitor(ctx, x + w - 30, y - 10, 20, 14, accent, t, item.tx + 11);
  // Chair tucked under.
  chair(ctx, x + w / 2 - 10, y + 20, accent);
}

export function drawMeetingTable(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#fbbf24";
  shadow(ctx, x, y + h, w);

  rounded(ctx, x + 2, y + 4, w - 4, h - 12, "#5a3c2b", 6);
  rounded(ctx, x + 4, y + 5, w - 8, h - 16, WOOD, 5);
  rounded(ctx, x + 8, y + 7, w - 16, h - 22, WOOD_LIGHT, 4);
  px(ctx, x + 10, y + 9, w - 20, 1, "rgba(255,230,190,0.18)");
  px(ctx, x + 8, y + h - 10, 4, 10, WOOD_DARK);
  px(ctx, x + w - 12, y + h - 10, 4, 10, WOOD_DARK);

  // Papers, laptops, coffee.
  px(ctx, x + 12, y + 12, 14, 9, "#e7dfc9");
  px(ctx, x + 13, y + 13, 12, 7, "#f2ead6");
  for (let i = 0; i < 4; i += 1) px(ctx, x + 15, y + 14 + i * 2, 7 - i, 1, "#9b8f7a");
  px(ctx, x + w - 34, y + 11, 16, 10, "#2c3441");
  px(ctx, x + w - 33, y + 12, 14, 7, "#4b6d8c");
  px(ctx, x + w - 31, y + 13, 6, 1, accent);
  px(ctx, x + w - 31, y + 15, 9, 1, "#93b4cf");
  px(ctx, x + w / 2 - 2, y + 9, 7, 6, "#e8e0d1");
  px(ctx, x + w / 2 + 5, y + 10, 2, 2, "#e8e0d1");
  px(ctx, x + w / 2, y + 9, 3, 1, "#7b4a3a");
  for (let i = 0; i < 4; i += 1) {
    const cx = x + 14 + i * ((w - 28) / 3);
    px(ctx, cx, y + h - 9, 10, 3, "#3b4250");
    px(ctx, cx + 1, y + h - 6, 2, 3, "#232a35");
    px(ctx, cx + 7, y + h - 6, 2, 3, "#232a35");
  }
  // Sticky notes on the wall side.
  px(ctx, x + 4, y - 4, 6, 6, "#f6d365");
  px(ctx, x + 11, y - 3, 6, 6, "#f4978e");
  px(ctx, x + 18, y - 4, 6, 6, "#a8dadc");
}

export function drawConsole(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#fb923c";
  shadow(ctx, x, y + h, w);

  const count = item.monitors ?? 3;
  const screenW = 19;
  const gap = 6;
  let mx = x + (w - (count * screenW + (count - 1) * gap)) / 2;
  for (let i = 0; i < count; i += 1) {
    monitor(ctx, mx, y - 10, screenW, 14, i === 0 ? "#4ade80" : accent, t, item.tx + i * 5);
    mx += screenW + gap;
  }

  px(ctx, x + 2, y + 5, w - 4, 4, "#6d7b8c");
  px(ctx, x + 3, y + 9, w - 6, 8, "#3b4654");
  px(ctx, x + 4, y + 17, w - 8, 5, "#26303b");
  px(ctx, x + 4, y + 22, 4, h - 23, "#1e262f");
  px(ctx, x + w - 8, y + 22, 4, h - 23, "#1e262f");
  px(ctx, x + w / 2 - 12, y + 11, 24, 4, "#1e2632");
  for (let i = 0; i < 6; i += 1) px(ctx, x + w / 2 - 10 + i * 4, y + 12, 2, 1, accent);
  // Big guarded deploy button.
  px(ctx, x + w - 26, y + 8, 10, 7, "#111820");
  px(ctx, x + w - 24, y + 9, 6, 5, "#ef4444");
  px(ctx, x + w - 23, y + 10, 4, 1, "#fca5a5");
  // Status lights.
  for (let i = 0; i < 4; i += 1) {
    px(ctx, x + 8 + i * 5, y + 19, 2, 2, Math.floor(t * 2 + i) % 3 ? "#4ade80" : "#1f2937");
  }
  chair(ctx, x + w / 2, y + 22, accent);
}

export function drawTestBench(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#38bdf8";
  shadow(ctx, x, y + h, w);

  const count = item.monitors ?? 2;
  for (let i = 0; i < count; i += 1) {
    const mx = x + 12 + i * 38;
    monitor(ctx, mx, y - 9, 26, 15, i === 0 ? "#4ade80" : accent, t, item.tx + i * 4);
    // Test result ticks on the first screen.
    if (i === 0) {
      px(ctx, mx + 3, y + 6, 3, 1, "#4ade80");
      px(ctx, mx + 3, y + 9, 5, 1, "#4ade80");
      px(ctx, mx + 3, y + 12, 2, 1, "#fbbf24");
    }
  }
  px(ctx, x + 2, y + 6, w - 4, 5, "#596674");
  px(ctx, x + 3, y + 11, w - 6, 8, "#333d49");
  px(ctx, x + 4, y + 19, w - 8, 4, "#222b35");
  px(ctx, x + 4, y + 23, 4, h - 24, "#1c242d");
  px(ctx, x + w - 8, y + 23, 4, h - 24, "#1c242d");
  // Tool cart / cables.
  px(ctx, x + w - 20, y + 10, 12, 6, "#3d4a57");
  px(ctx, x + w - 18, y + 11, 8, 4, "#242e38");
  px(ctx, x + 8, y + 15, 3, h - 20, "#ef4444");
  px(ctx, x + 12, y + 15, 2, h - 22, "#3b82f6");
  px(ctx, x + 15, y + 15, 2, h - 18, "#facc15");
  chair(ctx, x + w / 2, y + 23, accent);
}

export function drawBookshelf(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#94a3b8";
  shadow(ctx, x, y + h, w);

  px(ctx, x + 1, y + 1, w - 2, h - 2, WOOD_DARK);
  px(ctx, x + 2, y + 2, w - 4, h - 4, WOOD);
  px(ctx, x + 3, y + 3, w - 6, h - 6, "#5b3c2a");
  px(ctx, x + 2, y + 2, 3, h - 4, WOOD_LIGHT);
  const shelfCount = Math.max(2, Math.floor(h / 16));
  for (let shelf = 0; shelf < shelfCount; shelf += 1) {
    const sy = y + 3 + shelf * ((h - 6) / shelfCount);
    px(ctx, x + 3, sy + 11, w - 6, 2, WOOD_DARK);
    // Books.
    let bx = x + 4;
    let index = 0;
    while (bx < x + w - 6) {
      const bookW = 2 + Math.floor(hash2(item.tx + index, shelf) * 3);
      const bookH = 6 + Math.floor(hash2(shelf, index + item.ty) * 5);
      const colors = ["#c084fc", "#5eead4", "#fbbf24", "#f472b6", "#60a5fa", "#fb923c", "#a3e635"];
      px(ctx, bx, sy + 11 - bookH, bookW, bookH, colors[(index + shelf) % colors.length]);
      px(ctx, bx, sy + 11 - bookH, 1, bookH, "rgba(255,255,255,0.14)");
      bx += bookW + 1;
      index += 1;
    }
    if (hash2(shelf, item.tx) > 0.55) {
      // A tiny trailing plant.
      px(ctx, x + w - 9, sy + 2, 4, 4, "#7a4a32");
      px(ctx, x + w - 10, sy - 1, 5, 4, "#6b8f4e");
      px(ctx, x + w - 7, sy - 3, 2, 4, "#86ad62");
    }
  }
  px(ctx, x + 1, y + h - 4, w - 2, 3, "#2c1d16");
  // A little label.
  px(ctx, x + 4, y + 4, w - 8, 2, accent);
}

export function drawCabinet(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  const accent = item.accent ?? "#94a3b8";
  shadow(ctx, x, y + h, w);
  px(ctx, x + 1, y + 1, w - 2, h - 2, "#39434e");
  px(ctx, x + 2, y + 2, w - 4, h - 4, "#596673");
  const rows = Math.max(2, Math.floor(h / 12));
  for (let row = 0; row < rows; row += 1) {
    const ry = y + 3 + row * ((h - 6) / rows);
    px(ctx, x + 4, ry, w - 8, Math.max(4, (h - 8) / rows - 2), "#4c5864");
    px(ctx, x + w / 2 - 3, ry + 2, 6, 1, accent);
    px(ctx, x + w / 2 - 1, ry + 3, 2, 1, "#cdd5dd");
  }
  px(ctx, x + 1, y + h - 4, w - 2, 3, "#202832");
}

export function drawPlant(ctx, item, t = 0) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const n = hash2(item.tx, item.ty);
  const sway = Math.round(Math.sin(t * 0.8 + item.tx * 0.7) * 0.8);
  const pot = n > 0.5 ? "#a55a3f" : "#7f6a4d";
  const leafA = n > 0.5 ? "#5f8f4d" : "#4f7f5a";
  const leafB = shade(leafA, 0.18);
  const leafC = shade(leafA, -0.22);
  shadow(ctx, x, y + 16, 16);
  px(ctx, x + 4, y + 10, 8, 6, pot);
  px(ctx, x + 5, y + 10, 6, 1, shade(pot, 0.25));
  px(ctx, x + 6, y + 13, 4, 1, shade(pot, -0.25));
  const stemX = x + 8;
  px(ctx, stemX - 1 + sway, y + 3, 2, 9, leafC);
  const leaves = [
    [x + 3, y + 2, 5, 3],
    [x + 8, y + 1, 5, 3],
    [x + 1, y + 6, 5, 3],
    [x + 9, y + 5, 6, 3],
    [x + 4, y + 0, 4, 3],
    [x + 7, y + 8, 5, 2],
  ];
  for (let i = 0; i < leaves.length; i += 1) {
    const [lx, ly, lw, lh] = leaves[i];
    px(ctx, lx + sway, ly, lw, lh, i % 3 === 0 ? leafB : i % 3 === 1 ? leafA : leafC);
    px(ctx, lx + 1 + sway, ly, Math.max(1, lw - 2), 1, "rgba(255,255,255,0.12)");
  }
  if (n > 0.7) px(ctx, x + 13 + sway, y + 1, 2, 2, "#facc15");
}

export function drawLamp(ctx, item, t = 0) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const glow = 0.28 + Math.sin(t * 1.3 + item.tx) * 0.06;
  shadow(ctx, x, y + 16, 16);
  px(ctx, x + 5, y + 14, 6, 2, "#2a303a");
  px(ctx, x + 7, y + 5, 2, 10, "#59636f");
  px(ctx, x + 4, y + 0, 8, 6, "#e8c48a");
  px(ctx, x + 3, y + 1, 10, 4, "#f2d7a4");
  px(ctx, x + 5, y + 2, 6, 2, "#fff0c8");
  px(ctx, x + 2, y + 4, 12, 1, `rgba(255,220,150,${glow.toFixed(2)})`);
}

export function drawBench(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const w = item.tw * 16;
  const h = item.th * 16;
  shadow(ctx, x, y + h, w);
  px(ctx, x + 2, y - 1, w - 4, 4, WOOD_DARK);
  px(ctx, x + 3, y, w - 6, 2, WOOD_LIGHT);
  px(ctx, x + 1, y + 4, w - 2, 7, WOOD);
  px(ctx, x + 2, y + 5, w - 4, 2, "#a5744f");
  for (let i = x + 10; i < x + w - 8; i += 12) px(ctx, i, y + 5, 1, 5, "rgba(40,25,18,0.35)");
  px(ctx, x + 4, y + 11, 3, h - 11, WOOD_DARK);
  px(ctx, x + w - 7, y + 11, 3, h - 11, WOOD_DARK);
  px(ctx, x + 4, y + h - 2, 3, 2, "rgba(0,0,0,0.28)");
  px(ctx, x + w - 7, y + h - 2, 3, 2, "rgba(0,0,0,0.28)");
  // A folded newspaper left on the seat.
  px(ctx, x + w - 20, y + 5, 10, 4, "#d7d0be");
  px(ctx, x + w - 19, y + 6, 8, 2, "#8a9c8a");
}

export function drawCooler(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  shadow(ctx, x, y + 16, 16);
  px(ctx, x + 2, y + 8, 12, 8, "#35404e");
  px(ctx, x + 3, y + 9, 10, 6, "#4b5a6c");
  px(ctx, x + 4, y + 13, 8, 2, "#26303b");
  // Water bottle.
  px(ctx, x + 5, y - 3, 6, 11, "rgba(180, 230, 245, 0.45)");
  px(ctx, x + 6, y - 2, 4, 9, "rgba(120, 210, 235, 0.55)");
  px(ctx, x + 6, y - 5, 4, 3, "#c7d5df");
  px(ctx, x + 6, y - 6, 4, 2, "#94a3b8");
  const bubble = Math.floor(t * 2 + item.tx) % 5;
  px(ctx, x + 7, y + 2 + bubble, 1, 1, "rgba(240,250,255,0.7)");
  // Cups and tap.
  px(ctx, x + 1, y + 9, 3, 4, "#e8e2d4");
  px(ctx, x + 12, y + 9, 3, 4, "#d6d0c2");
  px(ctx, x + 7, y + 8, 2, 2, "#8fa0b0");
}

export function drawBeanbag(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#eab308";
  px(ctx, x + 2, y + 6, 13, 9, shade(accent, -0.28));
  rounded(ctx, x + 1, y + 4, 14, 10, accent, 4);
  px(ctx, x + 3, y + 5, 6, 4, shade(accent, 0.18));
  px(ctx, x + 4, y + 11, 8, 2, shade(accent, -0.18));
  px(ctx, x + 2, y + 14, 12, 2, "rgba(0,0,0,0.16)");
}

export function drawScope(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#5eead4";
  shadow(ctx, x, y + 32, 16);
  // Tripod and angled telescope tube.
  px(ctx, x + 7, y + 16, 2, 12, "#3a444f");
  px(ctx, x + 4, y + 27, 8, 2, "#28313a");
  px(ctx, x + 2, y + 30, 12, 2, "#1c242c");
  px(ctx, x + 3, y + 6, 10, 6, "#687886");
  px(ctx, x + 2, y + 5, 5, 2, "#aeb9c2");
  px(ctx, x + 12, y + 7, 3, 4, accent);
  px(ctx, x + 13, y + 8, 1, 2, "#e9ffff");
  px(ctx, x + 8, y + 12, 3, 5, "#4b5864");
  px(ctx, x + 6, y + 14, 7, 2, "#313b45");
  // A small star chart on the desk.
  px(ctx, x + 2, y + 19, 6, 4, "#d9d2bd");
  px(ctx, x + 3, y + 20, 4, 1, "#7d8b94");
  px(ctx, x + 3, y + 21, 2, 1, "#7d8b94");
}

export function drawSpecimen(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#5eead4";
  shadow(ctx, x, y + 32, 16);
  px(ctx, x + 2, y + 2, 12, 28, "#40515c");
  px(ctx, x + 3, y + 3, 10, 26, "#24343f");
  for (let shelf = 0; shelf < 3; shelf += 1) {
    const sy = y + 6 + shelf * 8;
    px(ctx, x + 3, sy + 5, 10, 1, "#55707e");
    const jarColor = shelf === 0 ? "#7ee8d9" : shelf === 1 ? "#c084fc" : "#fbbf24";
    px(ctx, x + 5, sy, 4, 5, "rgba(185, 235, 240, 0.25)");
    px(ctx, x + 6, sy + 2, 2, 3, jarColor);
    px(ctx, x + 5, sy - 1, 4, 1, "#aab8c2");
    px(ctx, x + 10, sy + 2, 1, 2, "#8fa5ac");
  }
  px(ctx, x + 2, y + 2, 12, 1, accent);
}

export function drawCredenza(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#fbbf24";
  shadow(ctx, x, y + 32, 16);
  px(ctx, x + 1, y + 11, 14, 19, WOOD_DARK);
  px(ctx, x + 2, y + 12, 12, 16, WOOD);
  px(ctx, x + 3, y + 13, 10, 6, WOOD_LIGHT);
  px(ctx, x + 7, y + 15, 2, 1, accent);
  px(ctx, x + 3, y + 20, 10, 7, "#67452f");
  px(ctx, x + 6, y + 23, 4, 1, "#b68b63");
  px(ctx, x + 3, y + 7, 9, 4, "#ded5c0");
  px(ctx, x + 5, y + 5, 7, 3, "#eee6d4");
  px(ctx, x + 4, y + 3, 5, 3, "#f2ead9");
  px(ctx, x + 11, y + 8, 3, 3, "#2f5c56");
  px(ctx, x + 12, y + 9, 1, 1, accent);
}

export function drawPlantTall(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const sway = Math.round(Math.sin(t * 0.9 + item.tx) * 1.2);
  shadow(ctx, x, y + 32, 16);
  px(ctx, x + 4, y + 25, 8, 7, "#916044");
  px(ctx, x + 5, y + 25, 6, 1, "#b37b58");
  px(ctx, x + 7 + sway, y + 8, 2, 18, "#3f6b49");
  const leaves = [
    [x + 2 + sway, y + 15, 6, 3],
    [x + 9 + sway, y + 12, 5, 3],
    [x + 1 + sway, y + 8, 6, 3],
    [x + 9 + sway, y + 5, 6, 3],
    [x + 4 + sway, y + 3, 5, 3],
    [x + 7 + sway, y + 18, 6, 3],
    [x + 3 + sway, y + 20, 5, 2],
  ];
  for (let i = 0; i < leaves.length; i += 1) {
    const [lx, ly, lw, lh] = leaves[i];
    px(ctx, lx, ly, lw, lh, i % 2 ? "#5f9b66" : "#4f8659");
    px(ctx, lx + 1, ly, Math.max(1, lw - 2), 1, "rgba(210,245,210,0.15)");
  }
}

export function drawUps(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#fb923c";
  shadow(ctx, x, y + 32, 16);
  px(ctx, x + 1, y + 5, 14, 25, "#1b222b");
  px(ctx, x + 2, y + 6, 12, 22, "#303a45");
  px(ctx, x + 3, y + 8, 10, 5, "#141b22");
  px(ctx, x + 4, y + 10, 8, 1, "#4b5a67");
  const led = Math.floor(t * 2.1 + item.tx) % 3;
  px(ctx, x + 4, y + 16, 2, 2, led ? "#4ade80" : "#1f4d31");
  px(ctx, x + 8, y + 16, 2, 2, led === 2 ? "#fbbf24" : "#4d421f");
  for (let row = 0; row < 3; row += 1) px(ctx, x + 4, y + 21 + row * 2, 8, 1, "#202832");
  px(ctx, x + 6, y + 30, 4, 3, "#10151b");
  px(ctx, x + 11, y + 29, 3, 4, accent);
}

export function drawCableReel(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  shadow(ctx, x, y + 16, 16);
  px(ctx, x + 2, y + 7, 12, 8, "#4e3424");
  px(ctx, x + 1, y + 4, 3, 10, "#7b5238");
  px(ctx, x + 12, y + 4, 3, 10, "#7b5238");
  px(ctx, x + 4, y + 6, 8, 5, "#2f3b46");
  px(ctx, x + 5, y + 7, 6, 3, "#445461");
  px(ctx, x + 7, y + 8, 2, 2, "#1c242c");
  px(ctx, x + 4, y + 13, 8, 3, "#2a211d");
  const accent = item.accent ?? "#38bdf8";
  px(ctx, x + 11, y + 14, 4, 1, accent);
  px(ctx, x + 13, y + 12, 2, 2, accent);
}

export function drawCrate(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#fbbf24";
  shadow(ctx, x, y + 16, 16);
  px(ctx, x + 2, y + 4, 12, 12, "#6f4b31");
  px(ctx, x + 3, y + 5, 10, 10, "#8a603d");
  px(ctx, x + 3, y + 5, 10, 1, "#ac7b50");
  px(ctx, x + 3, y + 14, 10, 1, "#4e341f");
  px(ctx, x + 8, y + 5, 1, 10, "#6b452c");
  px(ctx, x + 3, y + 8, 10, 1, "#6b452c");
  px(ctx, x + 5, y + 10, 4, 3, "#d9d1b9");
  px(ctx, x + 6, y + 11, 2, 1, accent);
}

export function drawVending(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#f472b6";
  shadow(ctx, x, y + 32, 16);
  px(ctx, x + 1, y + 1, 14, 30, "#202a35");
  px(ctx, x + 2, y + 2, 12, 26, "#33404d");
  px(ctx, x + 3, y + 4, 8, 19, "#12222d");
  const flicker = Math.floor(t * 2.3 + item.tx) % 7;
  for (let row = 0; row < 4; row += 1) {
    px(ctx, x + 3, y + 5 + row * 5, 8, 1, "#1a3140");
    for (let col = 0; col < 3; col += 1) {
      const on = (row + col + flicker) % 5 !== 0;
      px(ctx, x + 4 + col * 2, y + 6 + row * 5, 1, 3, on ? (row === 1 ? accent : "#7dd3fc") : "#20323d");
    }
  }
  px(ctx, x + 12, y + 5, 1, 21, "#4d5c6b");
  px(ctx, x + 11, y + 9, 3, 5, "#18212a");
  px(ctx, x + 11, y + 20, 3, 2, "#7dd3fc");
  px(ctx, x + 3, y + 25, 8, 3, "#111820");
  px(ctx, x + 4, y + 26, 6, 1, "#8a9aa8");
  px(ctx, x + 12, y + 25, 1, 3, accent);
}

export function drawToolCart(ctx, item) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#38bdf8";
  shadow(ctx, x, y + 16, 16);
  px(ctx, x + 2, y + 5, 12, 9, "#8f2f35");
  px(ctx, x + 3, y + 6, 10, 7, "#c2414a");
  px(ctx, x + 3, y + 8, 10, 1, "#7f232a");
  px(ctx, x + 4, y + 9, 3, 1, "#e8d6c0");
  px(ctx, x + 7, y + 11, 5, 1, "#7f232a");
  px(ctx, x + 3, y + 14, 2, 2, "#191e24");
  px(ctx, x + 11, y + 14, 2, 2, "#191e24");
  px(ctx, x + 4, y + 2, 1, 4, "#b8c3cc");
  px(ctx, x + 6, y + 1, 1, 5, accent);
  px(ctx, x + 10, y + 1, 2, 4, "#e8b04b");
}

export function drawRecordPlayer(ctx, item, t) {
  const x = item.tx * 16;
  const y = item.ty * 16;
  const accent = item.accent ?? "#f472b6";
  shadow(ctx, x, y + 16, 32);
  px(ctx, x + 1, y + 5, 30, 10, "#4a3327");
  px(ctx, x + 2, y + 6, 28, 8, "#6f4a34");
  px(ctx, x + 3, y + 7, 28, 1, "#916345");
  // Spinning record.
  const angle = t * 3.1;
  px(ctx, x + 5, y + 4, 12, 8, "#171a20");
  px(ctx, x + 6, y + 5, 10, 6, "#262b35");
  px(ctx, x + 8, y + 6, 6, 4, "#3b4351");
  px(ctx, x + 10, y + 7, 2, 2, accent);
  px(ctx, x + 11 + Math.round(Math.cos(angle) * 2), y + 8, 1, 1, "#e8edf4");
  // Tonearm and speaker grille.
  px(ctx, x + 17, y + 5, 1, 6, "#c3ccd4");
  px(ctx, x + 18, y + 5, 3, 1, "#8c99a4");
  px(ctx, x + 22, y + 5, 8, 8, "#2b2328");
  for (let row = 0; row < 3; row += 1) px(ctx, x + 23, y + 6 + row * 2, 6, 1, "#463943");
  px(ctx, x + 2, y + 12, 28, 2, "#35251d");
}

export function drawFurniture(ctx, item, t) {
  switch (item.kind) {
    case "desk":
      drawDesk(ctx, item, t);
      break;
    case "labBench":
      drawLabBench(ctx, item, t);
      break;
    case "meetingTable":
      drawMeetingTable(ctx, item);
      break;
    case "console":
      drawConsole(ctx, item, t);
      break;
    case "testBench":
      drawTestBench(ctx, item, t);
      break;
    case "bookshelf":
      drawBookshelf(ctx, item);
      break;
    case "cabinet":
      drawCabinet(ctx, item);
      break;
    case "plant":
      drawPlant(ctx, item, t);
      break;
    case "plantTall":
      drawPlantTall(ctx, item, t);
      break;
    case "lamp":
      drawLamp(ctx, item, t);
      break;
    case "scope":
      drawScope(ctx, item);
      break;
    case "specimen":
      drawSpecimen(ctx, item);
      break;
    case "credenza":
      drawCredenza(ctx, item);
      break;
    case "ups":
      drawUps(ctx, item, t);
      break;
    case "cableReel":
      drawCableReel(ctx, item);
      break;
    case "crate":
      drawCrate(ctx, item);
      break;
    case "vending":
      drawVending(ctx, item, t);
      break;
    case "toolCart":
      drawToolCart(ctx, item);
      break;
    case "recordPlayer":
      drawRecordPlayer(ctx, item, t);
      break;
    case "beanbag":
      drawBeanbag(ctx, item);
      break;
    case "bench":
      drawBench(ctx, item);
      break;
    case "cooler":
      drawCooler(ctx, item, t);
      break;
    case "sofa":
      drawSofa(ctx, item, t);
      break;
    case "coffeeTable":
      drawCoffeeTable(ctx, item);
      break;
    case "counter":
      drawCounter(ctx, item, t);
      break;
    case "island":
      drawIsland(ctx, item);
      break;
    case "fridge":
      drawFridge(ctx, item);
      break;
    case "serverRack":
      drawServerRack(ctx, item, t);
      break;
    case "arcade":
      drawArcade(ctx, item, t);
      break;
    default:
      px(ctx, item.tx * 16, item.ty * 16, item.tw * 16, item.th * 16, "#334155");
  }
}
