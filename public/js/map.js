import { ROOMS, ROOM_BY_ID, DOORS, SPAWN } from "./rooms.js";
import { FURNITURE, SPOTS, LIGHTS } from "./props.js";

export const TILE = 16;
export const COLS = 60;
export const ROWS = 34;
export const MAP_W = COLS * TILE;
export const MAP_H = ROWS * TILE;

export { ROOMS, ROOM_BY_ID, DOORS, SPAWN };

const cellCount = COLS * ROWS;
const walk = new Uint8Array(cellCount);
const indexOf = (x, y) => y * COLS + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;

export function isWalkable(x, y) {
  return inside(x, y) && walk[indexOf(x, y)] === 1;
}

export function centerOf(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

export function tileAtPixel(px, py) {
  return { x: Math.floor(px / TILE), y: Math.floor(py / TILE) };
}

function fillWalk(x, y, w, h) {
  for (let ty = y; ty < y + h; ty += 1) {
    for (let tx = x; tx < x + w; tx += 1) {
      if (inside(tx, ty)) walk[indexOf(tx, ty)] = 1;
    }
  }
}

function blockRect(x, y, w, h) {
  for (let ty = y; ty < y + h; ty += 1) {
    for (let tx = x; tx < x + w; tx += 1) {
      if (inside(tx, ty)) walk[indexOf(tx, ty)] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Build the collision map
// ---------------------------------------------------------------------------

fillWalk(2, 14, 56, 6); // continuous central corridor
for (const room of ROOMS) fillWalk(room.x + 1, room.y + 1, room.w - 2, room.h - 2);
for (const door of DOORS) fillWalk(door.x, door.y, door.w, 1);

export const furniture = FURNITURE.map(([kind, tx, ty, tw, th, options = {}]) => {
  const item = { kind, tx, ty, tw, th, solid: options.solid !== false, ...options };
  if (item.solid) blockRect(tx, ty, tw, th);
  return item;
});

export const lights = LIGHTS.map(([x, y, radius, color, alpha]) => ({
  x,
  y,
  radius,
  color,
  alpha,
}));

export const mapWarnings = [];

export const spots = new Map();
for (const room of ROOMS) {
  const candidates = (SPOTS[room.id] ?? []).map(([x, y, face, seated]) => ({
    x,
    y,
    face,
    seated: Boolean(seated),
    room: room.id,
  }));
  const valid = [];
  for (const spot of candidates) {
    if (!isWalkable(spot.x, spot.y)) {
      mapWarnings.push(`Blocked spot ${room.id} (${spot.x},${spot.y})`);
    } else {
      valid.push(spot);
    }
  }
  spots.set(room.id, valid);
}

// Flood fill from the corridor: every work spot must be reachable.
const reachable = new Uint8Array(cellCount);
{
  const queue = [indexOf(SPAWN.x, SPAWN.y)];
  reachable[queue[0]] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const cx = current % COLS;
    const cy = Math.floor(current / COLS);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(nx, ny)) continue;
      const next = indexOf(nx, ny);
      if (reachable[next]) continue;
      reachable[next] = 1;
      queue.push(next);
    }
  }
}

for (const [roomId, list] of spots) {
  const reachableSpots = list.filter((spot) => reachable[indexOf(spot.x, spot.y)]);
  for (const spot of list) {
    if (!reachableSpots.includes(spot)) {
      mapWarnings.push(`Unreachable spot ${roomId} (${spot.x},${spot.y})`);
    }
  }
  if (!reachableSpots.length) {
    const room = ROOM_BY_ID.get(roomId);
    const fallback = centerOf(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    mapWarnings.push(`No reachable spots in ${roomId}; using fallback`);
    const tx = tileAtPixel(fallback.x, fallback.y);
    reachableSpots.push({ ...tx, face: "down", room: roomId });
  }
  spots.set(roomId, reachableSpots);
}

for (const door of DOORS) {
  const opened = [];
  for (let x = door.x; x < door.x + door.w; x += 1) {
    opened.push(reachable[indexOf(x, door.y)] === 1);
  }
  if (!opened.every(Boolean)) mapWarnings.push(`Door not reachable: ${door.room} at y=${door.y}`);
}

// ---------------------------------------------------------------------------
// BFS pathfinding (all corridors have equal cost, so BFS is optimal)
// ---------------------------------------------------------------------------

export function nearestWalkable(tx, ty, maxRadius = 8) {
  if (isWalkable(tx, ty)) return { x: tx, y: ty };
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
        if (isWalkable(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
      }
    }
  }
  return null;
}

/**
 * Shortest path between two tiles. Returns pixel-center waypoints after the
 * starting tile, or an empty array when already there.
 */
export function findPath(start, goal) {
  if (!goal || !isWalkable(goal.x, goal.y)) return null;
  const safeStart = nearestWalkable(start.x, start.y);
  if (!safeStart) return null;
  if (safeStart.x === goal.x && safeStart.y === goal.y) return [];

  const startIndex = indexOf(safeStart.x, safeStart.y);
  const goalIndex = indexOf(goal.x, goal.y);
  const previous = new Int32Array(cellCount).fill(-1);
  const seen = new Uint8Array(cellCount);
  const queue = new Int32Array(cellCount);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIndex;
  seen[startIndex] = 1;

  while (head < tail) {
    const current = queue[head++];
    if (current === goalIndex) break;
    const cx = current % COLS;
    const cy = Math.floor(current / COLS);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(nx, ny)) continue;
      const next = indexOf(nx, ny);
      if (seen[next]) continue;
      seen[next] = 1;
      previous[next] = current;
      queue[tail++] = next;
    }
  }

  if (!seen[goalIndex]) return null;
  const tiles = [];
  let current = goalIndex;
  while (current !== startIndex && current !== -1) {
    tiles.push({ x: current % COLS, y: Math.floor(current / COLS) });
    current = previous[current];
  }
  tiles.reverse();
  return tiles.map((tile) => centerOf(tile.x, tile.y));
}

export function pointInRoom(room, x, y) {
  return x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
}
