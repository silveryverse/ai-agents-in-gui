import {
  TILE,
  COLS,
  ROWS,
  MAP_W,
  MAP_H,
  ROOMS,
  DOORS,
} from "./map.js";
import { RUGS, WALL_DECOR, LIGHTS } from "./props.js";
import { shade } from "./sprites.js";

const W = TILE;

function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rounded(ctx, x, y, w, h, fill, radius = 2) {
  px(ctx, x + radius, y, w - radius * 2, h, fill);
  px(ctx, x, y + radius, w, h - radius * 2, fill);
}

function drawBackground(ctx) {
  px(ctx, 0, 0, MAP_W, MAP_H, "#080d17");
  const gradient = ctx.createRadialGradient(MAP_W / 2, MAP_H / 2, 80, MAP_W / 2, MAP_H / 2, MAP_W * 0.7);
  gradient.addColorStop(0, "rgba(31, 44, 67, 0.5)");
  gradient.addColorStop(1, "rgba(4, 7, 13, 0.9)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  for (let i = 0; i < 190; i += 1) {
    const x = Math.floor(hash2(i, 3) * MAP_W);
    const y = Math.floor(hash2(i, 9) * MAP_H);
    const alpha = 0.06 + hash2(i, 17) * 0.16;
    px(ctx, x, y, 1, 1, `rgba(201, 220, 255, ${alpha})`);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.025)";
  ctx.lineWidth = 1;
  for (let x = 0; x < MAP_W; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, MAP_H);
    ctx.stroke();
  }
  for (let y = 0; y < MAP_H; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(MAP_W, y + 0.5);
    ctx.stroke();
  }
}

function drawCorridorFloor(ctx) {
  for (let ty = 14; ty < 20; ty += 1) {
    for (let tx = 2; tx < 58; tx += 1) {
      const x = tx * W;
      const y = ty * W;
      const base = (ty % 2 === 0 ? "#4b3729" : "#503b2c");
      px(ctx, x, y, W, W, base);
      px(ctx, x, y, W, 1, "rgba(255,220,170,0.06)");
      px(ctx, x, y + W - 1, W, 1, "rgba(0,0,0,0.22)");
      if (hash2(tx, ty) > 0.72) px(ctx, x + 4, y + 6, 6, 1, "rgba(255,255,255,0.035)");
    }
  }
  // Floor runner.
  px(ctx, 2 * W, 16 * W, 56 * W, 2 * W, "rgba(37, 25, 27, 0.28)");
}

function drawRoomFloor(ctx, room) {
  const startX = room.x + 1;
  const startY = room.y + 1;
  for (let ty = startY; ty < room.y + room.h - 1; ty += 1) {
    for (let tx = startX; tx < room.x + room.w - 1; tx += 1) {
      const x = tx * W;
      const y = ty * W;
      const n = hash2(tx, ty);
      let base = "#2b3b45";
      if (room.floor === "wood") base = ty % 2 ? "#5b4030" : "#634635";
      else if (room.floor === "carpet") base = n > 0.5 ? "#28344b" : "#2b3851";
      else if (room.floor === "server") base = n > 0.5 ? "#293340" : "#2c3744";
      else if (room.floor === "kitchen") base = (tx + ty) % 2 ? "#b39a74" : "#a58c68";
      else if (room.floor === "test") base = n > 0.5 ? "#323f49" : "#35434e";
      else if (room.floor === "lounge") base = n > 0.5 ? "#3d3244" : "#413549";
      else if (room.floor === "lab") base = n > 0.5 ? "#2b3d49" : "#2e4350";
      px(ctx, x, y, W, W, base);

      if (room.floor === "wood") {
        px(ctx, x, y, W, 1, "rgba(255,214,160,0.09)");
        px(ctx, x, y + W - 1, W, 1, "rgba(0,0,0,0.24)");
        if (hash2(tx, ty + 9) > 0.8) px(ctx, x + 3, y + 7, 5, 1, "rgba(0,0,0,0.18)");
      } else if (room.floor === "kitchen") {
        px(ctx, x, y, W, 1, "rgba(60,40,20,0.14)");
        px(ctx, x, y, 1, W, "rgba(60,40,20,0.14)");
      } else if (room.floor === "lounge") {
        if (n > 0.82) px(ctx, x + 3, y + 4, 2, 1, "rgba(255,220,255,0.06)");
      } else {
        px(ctx, x, y, W, 1, "rgba(0,0,0,0.1)");
        px(ctx, x, y, 1, W, "rgba(0,0,0,0.1)");
        if (n > 0.85) px(ctx, x + 5, y + 8, 1, 1, "rgba(255,255,255,0.12)");
      }
    }
  }
  // Inner floor shadow along the walls.
  const left = (room.x + 1) * W;
  const top = (room.y + 1) * W;
  const right = (room.x + room.w - 1) * W;
  const bottom = (room.y + room.h - 1) * W;
  px(ctx, left, top, right - left, 2, "rgba(0,0,0,0.18)");
  px(ctx, left, top, 2, bottom - top, "rgba(0,0,0,0.16)");
  px(ctx, left, bottom - 2, right - left, 2, "rgba(255,255,255,0.03)");
  px(ctx, right - 2, top, 2, bottom - top, "rgba(255,255,255,0.025)");
}

function drawRug(ctx, [tx, ty, tw, th, style, color]) {
  const x = tx * W;
  const y = ty * W;
  const w = tw * W;
  const h = th * W;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (style === "runner") {
    px(ctx, x, y, w, h, color);
    px(ctx, x, y + 2, w, 1, "rgba(255,225,180,0.25)");
    px(ctx, x, y + h - 3, w, 1, "rgba(255,225,180,0.25)");
    for (let i = x + 8; i < x + w - 6; i += 24) {
      px(ctx, i, y + h / 2 - 2, 4, 4, "rgba(255,210,150,0.18)");
      px(ctx, i + 1, y + h / 2 - 1, 2, 2, "rgba(30,20,20,0.25)");
    }
  } else if (style === "lounge") {
    px(ctx, x, y, w, h, color);
    px(ctx, x + 4, y + 4, w - 8, h - 8, shade(color, -0.12));
    px(ctx, x + 8, y + 8, w - 16, h - 16, shade(color, 0.06));
    ctx.strokeStyle = "rgba(255,220,225,0.14)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
    for (let i = x + 22; i < x + w - 12; i += 30) {
      px(ctx, i, y + h / 2 - 4, 8, 8, "rgba(255,210,220,0.09)");
      px(ctx, i + 2, y + h / 2 - 2, 4, 4, "rgba(40,20,40,0.22)");
    }
  } else if (style === "checker") {
    for (let row = 0; row < th; row += 1) {
      for (let col = 0; col < tw; col += 1) {
        px(ctx, x + col * W, y + row * W, W, W, (row + col) % 2 ? color : shade(color, -0.16));
      }
    }
    ctx.strokeStyle = "rgba(80,55,30,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  } else if (style === "hazard") {
    px(ctx, x, y, w, h, "#2b2418");
    ctx.fillStyle = color;
    for (let i = -h; i < w + h; i += 18) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + 9, y);
      ctx.lineTo(x + i + 17, y);
      ctx.lineTo(x + i + 8, y + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255, 214, 120, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  } else {
    px(ctx, x, y, w, h, color);
    px(ctx, x + 3, y + 3, w - 6, h - 6, shade(color, 0.08));
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 5.5, y + 5.5, w - 11, h - 11);
  }
  ctx.restore();
}

function drawWallTile(ctx, tx, ty, color, trim) {
  const x = tx * W;
  const y = ty * W;
  px(ctx, x, y, W, W, color);
  px(ctx, x, y, W, 2, shade(color, 0.13));
  px(ctx, x, y + W - 2, W, 2, shade(color, -0.24));
  px(ctx, x + W - 1, y, 1, W, "rgba(0,0,0,0.25)");
  px(ctx, x, y, 1, W, "rgba(255,255,255,0.04)");
  if (hash2(tx, ty) > 0.8) px(ctx, x + 4, y + 6, 5, 1, "rgba(0,0,0,0.12)");
  px(ctx, x + 4, y + W - 5, W - 8, 1, trim);
  ctx.globalAlpha = 0.16;
  px(ctx, x + 4, y + W - 4, W - 8, 1, trim);
  ctx.globalAlpha = 1;
}

function drawStructuralColumn(ctx, tx, top, height) {
  for (let ty = top; ty < top + height; ty += 1) {
    const x = tx * W;
    const y = ty * W;
    px(ctx, x, y, W, W, "#1a2230");
    px(ctx, x, y, 2, W, "rgba(255,255,255,0.035)");
    px(ctx, x + W - 2, y, 2, W, "rgba(0,0,0,0.24)");
    px(ctx, x + 5, y + 5, 6, 6, "#202b3b");
  }
}

function wallTileSet(room) {
  return new Set(
    DOORS.filter((door) => door.room === room.id).flatMap((door) => {
      const keys = [];
      for (let x = door.x; x < door.x + door.w; x += 1) keys.push(`${x},${door.y}`);
      return keys;
    }),
  );
}

function drawWalls(ctx) {
  for (const room of ROOMS) {
    const doors = wallTileSet(room);
    const draw = (tx, ty) => {
      if (doors.has(`${tx},${ty}`)) return;
      drawWallTile(ctx, tx, ty, room.wall, room.trim);
    };
    for (let tx = room.x; tx < room.x + room.w; tx += 1) {
      draw(tx, room.y);
      draw(tx, room.y + room.h - 1);
    }
    for (let ty = room.y + 1; ty < room.y + room.h - 1; ty += 1) {
      draw(room.x, ty);
      draw(room.x + room.w - 1, ty);
    }
  }

  // Structural columns in the one-tile gaps between rooms.
  drawStructuralColumn(ctx, 15, 2, 12);
  drawStructuralColumn(ctx, 29, 2, 12);
  drawStructuralColumn(ctx, 43, 2, 12);
  drawStructuralColumn(ctx, 15, 20, 12);
  drawStructuralColumn(ctx, 29, 20, 12);
  // Corridor end caps.
  for (let ty = 13; ty < 21; ty += 1) {
    drawWallTile(ctx, 1, ty, "#1a2230", "#7c8ba1");
    drawWallTile(ctx, 58, ty, "#1a2230", "#7c8ba1");
  }
}

function drawDoors(ctx) {
  for (const door of DOORS) {
    const room = ROOMS.find((candidate) => candidate.id === door.room);
    if (!room) continue;
    const x = door.x * W;
    const y = door.y * W;
    px(ctx, x, y + 3, door.w * W, W - 3, "#241b18");
    px(ctx, x + 2, y + 4, door.w * W - 4, W - 5, "#3a2b23");
    px(ctx, x + 3, y + 5, door.w * W - 6, 2, room.trim);
    ctx.globalAlpha = 0.35;
    px(ctx, x + 3, y + 7, door.w * W - 6, 1, room.trim);
    ctx.globalAlpha = 1;
    // Door posts.
    px(ctx, x - 2, y + 1, 2, W - 1, shade(room.trim, -0.35));
    px(ctx, x + door.w * W, y + 1, 2, W - 1, shade(room.trim, -0.35));
    // A little mat with a soft welcome stripe.
    px(ctx, x + 4, y + W - 4, door.w * W - 8, 3, "rgba(0,0,0,0.22)");
  }
}

function drawWindow(ctx, tx, ty, tw) {
  const x = tx * W + 2;
  const y = ty * W + 3;
  const w = tw * W - 4;
  const h = W - 6;
  px(ctx, x - 1, y - 1, w + 2, h + 2, "#2b211d");
  px(ctx, x, y, w, h, "#0d1c33");
  px(ctx, x + 1, y + 1, w - 2, h - 2, "#122642");
  px(ctx, x + 1, y + h - 3, w - 2, 2, "rgba(85, 130, 179, 0.16)");
  px(ctx, x + w / 2, y, 2, h, "#2b211d");
  px(ctx, x, y + h / 2, w, 2, "#2b211d");
  for (let i = 0; i < 5; i += 1) {
    const sx = x + 3 + Math.floor(hash2(tx + i, ty) * (w - 6));
    const sy = y + 2 + Math.floor(hash2(tx, ty + i) * (h - 5));
    px(ctx, sx, sy, 1, 1, "rgba(220,235,255,0.7)");
  }
  px(ctx, x + w - 9, y + 2, 4, 4, "#f4e3b2");
  px(ctx, x + w - 7, y + 2, 2, 4, "#122642");
  px(ctx, x - 1, y + h, w + 2, 2, "#4a372b");
}

function drawScreen(ctx, tx, ty, tw) {
  const x = tx * W + 3;
  const y = ty * W + 2;
  const w = tw * W - 6;
  const h = W - 5;
  px(ctx, x - 1, y - 1, w + 2, h + 2, "#0e131c");
  px(ctx, x, y, w, h, "#101826");
  px(ctx, x, y, w, 2, "#fb923c");
  for (let row = 0; row < 6; row += 1) {
    const lineWidth = 6 + Math.floor(hash2(tx + row, ty) * (w - 12));
    px(ctx, x + 3, y + 4 + row * 2, lineWidth, 1, row % 3 === 0 ? "#fb923c" : "#5b718c");
  }
}

function drawWhiteboard(ctx, tx, ty, tw) {
  const x = tx * W + 2;
  const y = ty * W + 2;
  const w = tw * W - 4;
  const h = W - 4;
  px(ctx, x - 1, y - 1, w + 2, h + 2, "#5d6774");
  px(ctx, x, y, w, h, "#e9edf0");
  px(ctx, x + 1, y + 1, w - 2, h - 2, "#f4f7f8");
  px(ctx, x + 2, y + h - 2, w - 4, 2, "#c1cad1");
  // Diagram and sticky notes.
  px(ctx, x + 4, y + 4, 12, 1, "#6e87a0");
  px(ctx, x + 4, y + 7, 9, 1, "#9aa9b8");
  px(ctx, x + 4, y + 10, 14, 1, "#9aa9b8");
  px(ctx, x + w - 11, y + 3, 6, 6, "#f2d477");
  px(ctx, x + w - 10, y + 4, 4, 1, "#9c8341");
  px(ctx, x + w - 10, y + 6, 3, 1, "#9c8341");
  px(ctx, x + w - 19, y + 6, 6, 5, "#f39b9b");
  px(ctx, x + w - 7, y + 9, 2, 2, "#3b82f6");
  px(ctx, x + 5, y + 8, 1, 3, "#d35f5f");
  px(ctx, x + 7, y + 7, 3, 2, "#4f8f78");
  // Marker tray.
  px(ctx, x + 2, y + h, 9, 2, "#3d4652");
  px(ctx, x + 4, y + h - 1, 2, 1, "#d35f5f");
  px(ctx, x + 7, y + h - 1, 2, 1, "#3b82f6");
}

function drawPoster(ctx, tx, ty, tw) {
  const x = tx * W + 3;
  const y = ty * W + 2;
  const w = tw * W - 6;
  const h = W - 4;
  px(ctx, x - 1, y - 1, w + 2, h + 2, "#211a20");
  px(ctx, x, y, w, h, "#432f45");
  px(ctx, x + 2, y + 2, w - 4, 3, "#c084fc");
  px(ctx, x + 2, y + 7, w - 4, 1, "#f0abfc");
  px(ctx, x + 2, y + 9, w - 8, 1, "#8b5a9c");
  px(ctx, x + 2, y + 11, w - 5, 1, "#8b5a9c");
  px(ctx, x + w - 7, y + 8, 4, 4, "#fbbf24");
  px(ctx, x + w - 6, y + 9, 2, 2, "#4a2b19");
}

function drawStatusBoard(ctx, tx, ty, tw) {
  const x = tx * W + 2;
  const y = ty * W + 2;
  const w = tw * W - 4;
  const h = W - 4;
  px(ctx, x - 1, y - 1, w + 2, h + 2, "#1c232c");
  px(ctx, x, y, w, h, "#111a24");
  px(ctx, x, y, w, 2, "#fb923c");
  for (let row = 0; row < 3; row += 1) {
    const ry = y + 4 + row * 3;
    px(ctx, x + 3, ry, 3, 1, row === 2 ? "#fbbf24" : "#4ade80");
    px(ctx, x + 7, ry, 6 + Math.floor(hash2(tx + row, ty) * (w - 15)), 1, "#536d85");
  }
  px(ctx, x + w - 5, y + 4, 2, 2, "#4ade80");
  px(ctx, x + w - 5, y + 7, 2, 2, "#fb923c");
}

function drawClock(ctx, tx, ty) {
  const x = tx * W + 3;
  const y = ty * W + 2;
  px(ctx, x, y, 10, 10, "#1b232d");
  px(ctx, x + 1, y + 1, 8, 8, "#e8e0cf");
  px(ctx, x + 2, y + 2, 6, 6, "#f4ecda");
  px(ctx, x + 5, y + 3, 1, 4, "#2a3440");
  px(ctx, x + 6, y + 6, 3, 1, "#2a3440");
  px(ctx, x + 5, y + 7, 1, 1, "#b84a42");
  px(ctx, x + 4, y + 12, 3, 1, "rgba(0,0,0,0.35)");
}

function drawMenu(ctx, tx, ty, tw) {
  const x = tx * W + 2;
  const y = ty * W + 2;
  const w = tw * W - 4;
  const h = W - 4;
  px(ctx, x - 1, y - 1, w + 2, h + 2, "#4a3526");
  px(ctx, x, y, w, h, "#24332c");
  px(ctx, x + 1, y + 1, w - 2, h - 2, "#2c3d34");
  px(ctx, x + 3, y + 3, w - 18, 1, "#e8ddc5");
  px(ctx, x + 3, y + 6, w - 24, 1, "#b9c8b2");
  px(ctx, x + 3, y + 9, w - 20, 1, "#b9c8b2");
  px(ctx, x + w - 14, y + 3, 3, 3, "#f2d477");
  px(ctx, x + 3, y + 12, w - 6, 1, "#d7b46a");
}

function drawWallDecor(ctx) {
  for (const [kind, tx, ty, tw] of WALL_DECOR) {
    if (kind === "window") drawWindow(ctx, tx, ty, tw);
    else if (kind === "screen") drawScreen(ctx, tx, ty, tw);
    else if (kind === "whiteboard") drawWhiteboard(ctx, tx, ty, tw);
    else if (kind === "poster") drawPoster(ctx, tx, ty, tw);
    else if (kind === "statusBoard") drawStatusBoard(ctx, tx, ty, tw);
    else if (kind === "clock") drawClock(ctx, tx, ty);
    else if (kind === "menu") drawMenu(ctx, tx, ty, tw);
  }
}

function drawLabel(ctx, room) {
  const isBottom = room.y > 13;
  const wallY = isBottom ? room.y + room.h - 1 : room.y;
  const centerX = (room.x + room.w / 2) * W;
  const y = wallY * W + 1;
  const text = room.label;
  ctx.font = '600 8px "Cascadia Mono", "Consolas", monospace';
  const textWidth = Math.ceil(ctx.measureText(text).width);
  const w = textWidth + 20;
  const x = Math.round(centerX - w / 2);
  rounded(ctx, x, y, w, 13, "rgba(12, 18, 28, 0.94)", 2);
  ctx.strokeStyle = room.trim;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 12);
  ctx.globalAlpha = 1;
  px(ctx, x + 5, y + 5, 2, 3, room.trim);
  ctx.fillStyle = "#e8edf4";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 10, y + 7);
}

function drawLabels(ctx) {
  for (const room of ROOMS) drawLabel(ctx, room);
}

function drawLights(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const light of lightsWithRooms()) {
    const gradient = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.radius);
    gradient.addColorStop(0, `rgba(${light.color}, ${light.alpha})`);
    gradient.addColorStop(0.55, `rgba(${light.color}, ${light.alpha * 0.45})`);
    gradient.addColorStop(1, `rgba(${light.color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
  }
  ctx.restore();
}

function lightsWithRooms() {
  const list = [...LIGHTS.map(([x, y, radius, color, alpha]) => ({ x, y, radius, color, alpha }))];
  for (const room of ROOMS) {
    list.push({
      x: (room.x + room.w / 2) * W,
      y: (room.y + room.h / 2) * W,
      radius: 125,
      color: "255, 208, 150",
      alpha: 0.035,
    });
  }
  return list;
}

export function buildStaticLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  drawBackground(ctx);
  drawCorridorFloor(ctx);
  for (const room of ROOMS) drawRoomFloor(ctx, room);
  for (const rug of RUGS) drawRug(ctx, rug);
  drawWalls(ctx);
  drawDoors(ctx);
  drawWallDecor(ctx);
  drawLabels(ctx);
  return canvas;
}

/**
 * Pre-render the warm pools of light. Drawing one cached layer with a tiny
 * alpha pulse is much cheaper than rebuilding radial gradients every frame.
 */
export function buildLightLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  drawLights(ctx);
  return canvas;
}

export function buildVignetteLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    MAP_W / 2,
    MAP_H / 2,
    MAP_W * 0.18,
    MAP_W / 2,
    MAP_H / 2,
    MAP_W * 0.72,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.72, "rgba(3, 6, 12, 0.12)");
  gradient.addColorStop(1, "rgba(3, 6, 12, 0.52)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  return canvas;
}

const clockStart = new Date();

/** Animate the minute/hour hands over the static wall clocks. */
export function drawClockHands(ctx, t = 0) {
  const startMinutes =
    clockStart.getHours() * 60 + clockStart.getMinutes() + clockStart.getSeconds() / 60;
  const minutes = startMinutes + t / 60;
  const minuteAngle = ((minutes % 60) / 60) * Math.PI * 2 - Math.PI / 2;
  const hourAngle = ((minutes / 60) % 12 / 12) * Math.PI * 2 - Math.PI / 2;

  for (const [kind, tx, ty] of WALL_DECOR) {
    if (kind !== "clock") continue;
    const cx = tx * W + 8;
    const cy = ty * W + 7;
    ctx.save();
    ctx.strokeStyle = "#2a3440";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(hourAngle) * 2.5, cy + Math.sin(hourAngle) * 2.5);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(minuteAngle) * 4, cy + Math.sin(minuteAngle) * 4);
    ctx.stroke();
    px(ctx, cx, cy, 1, 1, "#b84a42");
    ctx.restore();
  }
}

export { W as ART_TILE };
