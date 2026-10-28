import {
  MAP_W,
  MAP_H,
  ROOMS,
  ROOM_BY_ID,
  DOORS,
  SPAWN,
  furniture,
  spots,
  findPath,
  nearestWalkable,
  tileAtPixel,
  centerOf,
  mapWarnings,
} from "./map.js";
import { buildStaticLayer, buildLightLayer, buildVignetteLayer, drawClockHands } from "./scenery.js";
import { drawFurniture } from "./furniture.js";
import {
  drawAgent,
  drawNameplate,
  drawBubble,
  drawSelection,
  drawTether,
  describeAgent,
} from "./overlays.js";
import { hashString } from "./sprites.js";
import { clamp, px } from "./pixels.js";
import {
  canonicalEventType,
  identityKey,
  parentIdentityKey,
  providerOf,
} from "./identity.js";

const SPEED = 58; // pixels per second
const ROUTE_DEBOUNCE = 0.22; // seconds
const TURN_TIME = 0.16; // seconds
const HANDOFF_TIME = 8.5; // seconds of confirmed parent -> child handoff
const SUCCESS_TIME = 2.6; // seconds of confirmed execution-success sparkle
const ERROR_TIME = 2.0; // seconds of observed failure reaction
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.2;

function desiredState(sim) {
  if (sim.moving) return "walk";
  if (sim.connected === false || sim.stale) return "idle";
  const status = String(sim.status ?? "").toLowerCase();
  if (
    /idle|closed|waiting|stopped|interrupted|started|retry|completed|offline|terminated/.test(
      status,
    )
  ) {
    return "idle";
  }
  return "work";
}

/**
 * Choose a pose from observed tool/status data. This never claims a result;
 * it only selects a body language for the current event.
 */
function activityVariant(agent) {
  const status = String(agent?.status ?? "").toLowerCase();
  const eventType = canonicalEventType(agent).toLowerCase();
  const tool = String(agent?.tool ?? "").toLowerCase();

  if (agent?.connected === false) return "wait";
  if (/error|failed/.test(status) || /failed|error/.test(eventType)) return "error";
  if (eventType === "session.execution.succeeded") return "cheer";
  if (eventType === "session.turn.completed") return "wait";
  if (/tool finished|finished/.test(status)) return "think";
  if (/^(read|grep|glob|search|find|webfetch|websearch|fetch|browse)$/.test(tool)) return "read";
  if (/^(edit|write|patch|multiedit|apply_patch)$/.test(tool)) return "type";
  if (/^(todo|todowrite|task|subagent|skill|question|plan|spec)$/.test(tool)) return "think";
  if (/^(shell|bash|execute|test|build|lint|deploy|release|publish)$/.test(tool)) return "use";
  if (/idle|waiting|retry|closed|stopped|interrupted|started|completed|offline|terminated/.test(status)) {
    return "wait";
  }
  return "type";
}

const MOTES = Array.from({ length: 22 }, (_, index) => {
  const seed = hashString(`ambient-mote-${index}`);
  return {
    x: (seed % 997) / 997,
    y: ((seed >>> 10) % 991) / 991,
    speed: 0.15 + ((seed >>> 19) % 70) / 100,
    phase: ((seed >>> 4) % 628) / 100,
    alpha: 0.05 + ((seed >>> 23) % 10) / 160,
  };
});

function confirmedDelegation(parent, activity) {
  if (!parent || parent.connected === false) return false;
  const cutoff = Date.now() - 30_000;
  // A tool name restored from history is not new evidence. Only a recently
  // observed parent event can start a live handoff.
  if (Number(parent.updatedAt ?? 0) < cutoff) return false;
  if (/^(subagent|task)$/i.test(String(parent.tool ?? ""))) return true;
  return (activity ?? []).some(
    (item) =>
      identityKey(item) === identityKey(parent) &&
      item.at >= cutoff &&
      /^(subagent|task)\b/i.test(String(item.detail ?? "")),
  );
}

export function createOffice(canvas, options = {}) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const staticLayer = buildStaticLayer();
  const lightLayer = buildLightLayer();
  const vignetteLayer = buildVignetteLayer();
  const sims = new Map();

  let selectedKey = null;
  let hoveredKey = null;
  let paused = false;
  let bridgeLive = true;
  let hydrated = false;
  let simTime = 0;
  let lastFrame = performance.now();
  let lastDraw = 0;
  let animationFrame = 0;
  let destroyed = false;
  let needsDraw = true;

  const camera = { zoom: 1, x: 0, y: 0 };
  const cameraGoal = { zoom: 1, x: 0, y: 0 };
  let drag = null;

  const onSelect = options.onSelect ?? (() => {});
  const onCue = options.onCue ?? (() => {});
  const onCamera = options.onCamera ?? (() => {});

  function clampView(view) {
    const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
    const viewW = MAP_W / zoom;
    const viewH = MAP_H / zoom;
    return {
      zoom,
      x: clamp(view.x, 0, MAP_W - viewW),
      y: clamp(view.y, 0, MAP_H - viewH),
    };
  }

  function setCameraGoal(next) {
    const clamped = clampView(next);
    cameraGoal.zoom = clamped.zoom;
    cameraGoal.x = clamped.x;
    cameraGoal.y = clamped.y;
    needsDraw = true;
    onCamera({ ...cameraGoal });
  }

  function focusOn(sim, requestedZoom) {
    if (!sim) return;
    const zoom = clamp(Math.max(1.5, requestedZoom ?? cameraGoal.zoom), MIN_ZOOM, MAX_ZOOM);
    const viewW = MAP_W / zoom;
    const viewH = MAP_H / zoom;
    setCameraGoal({
      zoom,
      x: sim.x - viewW / 2,
      y: sim.y - viewH / 2,
    });
  }

  function zoomAt(factor, canvasX = MAP_W / 2, canvasY = MAP_H / 2) {
    const nextZoom = clamp(cameraGoal.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const worldX = cameraGoal.x + canvasX / cameraGoal.zoom;
    const worldY = cameraGoal.y + canvasY / cameraGoal.zoom;
    setCameraGoal({
      zoom: nextZoom,
      x: worldX - canvasX / nextZoom,
      y: worldY - canvasY / nextZoom,
    });
  }

  function updateCamera(dt) {
    const ease = 1 - Math.exp(-dt * 11);
    let changed = false;
    for (const key of ["zoom", "x", "y"]) {
      const difference = cameraGoal[key] - camera[key];
      if (Math.abs(difference) < 0.0015) {
        if (difference !== 0) {
          camera[key] = cameraGoal[key];
          changed = true;
        }
      } else {
        camera[key] += difference * ease;
        changed = true;
      }
    }
    if (changed) {
      const clamped = clampView(camera);
      camera.zoom = clamped.zoom;
      camera.x = clamped.x;
      camera.y = clamped.y;
      needsDraw = true;
      onCamera({ ...camera });
    }
  }

  function spawnFor(agent, index) {
    const doors = DOORS.filter((door) => door.room === agent.room);
    const door = doors[hashString(identityKey(agent)) % Math.max(1, doors.length)] ?? {
      x: SPAWN.x,
      y: SPAWN.y - 1,
      w: 1,
    };
    const offset = (index % 5) - 2;
    const y = 15 + (index % 4);
    const safe =
      nearestWalkable(door.x + Math.floor(door.w / 2) + offset, y) ??
      nearestWalkable(SPAWN.x, SPAWN.y);
    return centerOf(safe.x, safe.y);
  }

  function claimedBy(spot, exceptKey) {
    for (const sim of sims.values()) {
      if (sim.key === exceptKey || !sim.spot) continue;
      if (sim.spot.x === spot.x && sim.spot.y === spot.y && sim.spot.room === spot.room) return true;
    }
    return false;
  }

  function spotOrder(roomId, sim) {
    const list = spots.get(roomId) ?? spots.get("lounge") ?? [];
    if (!list.length) return [];
    const start = hashString(sim.key) % list.length;
    return list.map((_, index) => list[(start + index) % list.length]);
  }

  function routeSim(sim, roomId, options = {}) {
    const targetRoom = ROOM_BY_ID.has(roomId) ? roomId : "lounge";
    const start = tileAtPixel(sim.x, sim.y);
    let order = spotOrder(targetRoom, sim);
    if (options.nearest) {
      const distance = (spot) => Math.abs(spot.x - start.x) + Math.abs(spot.y - start.y);
      order = [...order].sort((a, b) => distance(a) - distance(b));
    }
    if (!order.length) return;
    const preferred =
      sim.spot && sim.spot.room === targetRoom && !claimedBy(sim.spot, sim.key) ? sim.spot : null;
    const candidates = preferred ? [preferred, ...order.filter((spot) => spot !== preferred)] : order;

    for (const spot of candidates) {
      if (claimedBy(spot, sim.key) && spot !== preferred) continue;
      const path = findPath(start, spot);
      if (path === null) continue;
      sim.spot = spot;
      sim.targetRoom = targetRoom;
      sim.path = path;
      sim.pathIndex = 0;
      sim.moving = path.length > 0;
      sim.face = spot.face;
      if (!sim.moving) sim.dir = spot.face;
      return;
    }
  }

  function beginHandoff(child, parent) {
    if (!child || !parent || child.delegationSeen) return;
    if (child.connected === false || parent.connected === false) return;
    child.delegationSeen = true;
    const until = simTime + HANDOFF_TIME;
    child.handoffUntil = until;
    child.meetingUntil = until;
    parent.meetingUntil = until;

    // A confirmed delegation is the one workflow that earns a short huddle in
    // the planning room. Both agents return to their observed room afterwards.
    child.pendingRoom = null;
    parent.pendingRoom = null;
    routeSim(child, "planning", { nearest: true });
    routeSim(parent, "planning", { nearest: true });
    onCue("handoff");
  }

  function createSim(agent, index, activity) {
    const position = spawnFor(agent, index);
    const key = identityKey(agent);
    const parentKey = parentIdentityKey(agent);
    const parent = parentKey ? sims.get(parentKey) : null;
    return {
      key,
      id: agent.id,
      provider: providerOf(agent),
      name: agent.name,
      color: agent.color || "#94a3b8",
      source: agent.source === "demo" ? "demo" : "live",
      status: agent.status || "Working",
      phase: agent.phase,
      connected: agent.connected !== false,
      historical: agent.historical === true || agent.connected === false,
      stale: false,
      lastStatus: agent.lastStatus,
      lastOutcome: agent.lastOutcome,
      lastSeenAt: agent.lastSeenAt,
      room: agent.room || "lounge",
      tool: agent.tool,
      detail: agent.detail,
      eventType: agent.eventType,
      canonicalEventType: canonicalEventType(agent),
      parentID: agent.parentID,
      parentKey,
      updatedAt: agent.updatedAt,
      x: position.x,
      y: position.y,
      dir: "down",
      face: "down",
      state: "idle",
      frame: 0,
      animTime: 0,
      turn: 0,
      turnFrom: "down",
      turnSide: "right",
      path: [],
      pathIndex: 0,
      moving: false,
      spot: null,
      targetRoom: null,
      pendingRoom: null,
      pendingAt: 0,
      variant: activityVariant(agent),
      seated: false,
      successUntil: 0,
      errorUntil: 0,
      meetingUntil: 0,
      delegationSeen: false,
      handoffUntil: 0,
      action: describeAgent(agent),
      // Existing sessions are already on the map at load; don't pop a bubble
      // for every character at once. Live changes still get a speech bubble.
      bubbleUntil: hydrated ? simTime + 12 : 0,
    };
  }

  function updateSim(sim, agent, activity) {
    const eventChanged = sim.updatedAt !== agent.updatedAt;
    const roomChanged = sim.room !== agent.room;
    const nextStatus = agent.status || sim.status;
    const nextEvent = canonicalEventType(agent) || sim.canonicalEventType;

    sim.name = agent.name || sim.name;
    sim.color = agent.color || sim.color;
    sim.provider = providerOf(agent);
    sim.source = agent.source === "demo" ? "demo" : "live";
    sim.status = nextStatus;
    sim.phase = agent.phase ?? sim.phase;
    sim.connected = agent.connected !== false;
    sim.historical = agent.historical === true || agent.connected === false;
    sim.stale = !bridgeLive && sim.connected;
    sim.lastStatus = agent.lastStatus;
    sim.lastOutcome = agent.lastOutcome;
    sim.lastSeenAt = agent.lastSeenAt ?? sim.lastSeenAt;
    sim.tool = agent.tool ?? sim.tool;
    sim.detail = agent.detail ?? sim.detail;
    sim.eventType = agent.eventType ?? sim.eventType;
    sim.canonicalEventType = nextEvent;
    sim.parentID = agent.parentID;
    sim.parentKey = parentIdentityKey(agent);
    sim.updatedAt = agent.updatedAt;
    sim.room = agent.room || sim.room;
    sim.variant = sim.stale ? "wait" : activityVariant(agent);

    if (!sim.connected) {
      sim.meetingUntil = 0;
      sim.handoffUntil = 0;
      sim.pendingRoom = null;
    }

    if (eventChanged) {
      sim.action = describeAgent(agent);
      sim.bubbleUntil = simTime + 12;

      if (String(nextEvent ?? "").toLowerCase() === "session.execution.succeeded") {
        sim.successUntil = simTime + SUCCESS_TIME;
        sim.errorUntil = 0;
        onCue("success");
      } else if (
        /failed|error/i.test(String(nextEvent ?? "")) ||
        /error|failed/i.test(String(nextStatus ?? ""))
      ) {
        sim.errorUntil = simTime + ERROR_TIME;
        onCue("error");
      }

      if (sim.connected && sim.parentKey && !sim.delegationSeen) {
        const parent = sims.get(sim.parentKey);
        if (parent && parent.connected !== false && confirmedDelegation(parent, activity)) {
          beginHandoff(sim, parent);
        }
      }
    }

    if (roomChanged) {
      sim.pendingRoom = agent.room;
      sim.pendingAt = simTime + ROUTE_DEBOUNCE;
    }
    if (!sim.spot && !sim.pendingRoom && !(sim.meetingUntil > simTime)) routeSim(sim, agent.room);
  }

  function sync(agents, activity = []) {
    if (!Array.isArray(agents)) return;
    const seen = new Set();
    agents.forEach((agent, index) => {
      if (!agent?.id) return;
      const key = identityKey(agent);
      seen.add(key);
      let sim = sims.get(key);
      if (!sim) {
        sim = createSim(agent, index, activity);
        sims.set(key, sim);
      }
      updateSim(sim, agent, activity);
    });
    // Sessions may arrive child-first. Re-check confirmed delegation once both
    // the parent and child exist in the office. Historical sessions never
    // re-enact an old handoff.
    for (const sim of sims.values()) {
      if (!sim.connected || !sim.parentKey || sim.delegationSeen) continue;
      const parent = sims.get(sim.parentKey);
      if (parent?.connected !== false && confirmedDelegation(parent, activity)) {
        beginHandoff(sim, parent);
      }
    }
    for (const key of [...sims.keys()]) {
      if (!seen.has(key)) sims.delete(key);
    }
    if (selectedKey && !seen.has(selectedKey)) {
      selectedKey = null;
      onSelect(null);
    }
    if (hoveredKey && !seen.has(hoveredKey)) hoveredKey = null;
    hydrated = true;
    needsDraw = true;
  }

  function faceDirection(sim, next) {
    if (!next || next === sim.dir) return;
    sim.turnFrom = sim.dir;
    sim.turnSide =
      next === "left" || next === "right"
        ? next
        : sim.dir === "left" || sim.dir === "right"
          ? sim.dir
          : "right";
    sim.turn = TURN_TIME;
    sim.dir = next;
  }

  function step(sim, dt) {
    let budget = SPEED * dt;
    while (budget > 0 && sim.pathIndex < sim.path.length) {
      const waypoint = sim.path[sim.pathIndex];
      const dx = waypoint.x - sim.x;
      const dy = waypoint.y - sim.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.01) {
        sim.pathIndex += 1;
        continue;
      }
      faceDirection(sim, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
      if (distance <= budget) {
        sim.x = waypoint.x;
        sim.y = waypoint.y;
        budget -= distance;
        sim.pathIndex += 1;
      } else {
        sim.x += (dx / distance) * budget;
        sim.y += (dy / distance) * budget;
        budget = 0;
      }
    }
    if (sim.pathIndex >= sim.path.length) {
      sim.moving = false;
      sim.path = [];
      sim.pathIndex = 0;
      if (sim.spot) {
        sim.face = sim.spot.face;
        faceDirection(sim, sim.face);
      }
    }
  }

  function update(dt) {
    for (const sim of sims.values()) {
      const meeting = sim.meetingUntil > simTime;
      if (meeting) {
        // Hold observed room changes until the delegation huddle is over.
        if (sim.pendingRoom) sim.pendingAt = Math.max(sim.pendingAt, sim.meetingUntil);
      } else if (sim.meetingUntil) {
        sim.meetingUntil = 0;
        sim.pendingRoom = null;
        routeSim(sim, sim.room);
      }
      if (!meeting && sim.pendingRoom && simTime >= sim.pendingAt) {
        const room = sim.pendingRoom;
        sim.pendingRoom = null;
        routeSim(sim, room);
      }
      if (sim.moving) step(sim, dt);
      if (sim.turn > 0) sim.turn = Math.max(0, sim.turn - dt);
      sim.animTime += dt;
      sim.state = desiredState(sim);
      sim.seated =
        Boolean(sim.spot?.seated) && !sim.moving && (sim.state === "work" || sim.state === "idle");
      if (sim.state === "walk") sim.frame = Math.floor(sim.animTime * 9) % 4;
      else if (sim.state === "work") sim.frame = Math.floor(sim.animTime * 3.4) % 4;
      else sim.frame = Math.floor(sim.animTime * 1.05) % 6;
    }
  }

  function drawAmbientDust() {
    for (const mote of MOTES) {
      const x = mote.x * MAP_W + Math.sin(simTime * mote.speed + mote.phase) * 6;
      const y = ((mote.y * MAP_H - simTime * mote.speed * 4) % MAP_H + MAP_H) % MAP_H;
      px(ctx, x, y, 1, 1, `rgba(214, 229, 249, ${mote.alpha})`);
    }
  }

  function drawEmptySign() {
    if (sims.size) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '600 11px "Cascadia Mono", "Consolas", monospace';
    ctx.fillStyle = "rgba(226, 232, 240, 0.72)";
    ctx.fillText("OFFICE QUIET", MAP_W / 2, 258);
    ctx.font = '400 8px "Cascadia Mono", "Consolas", monospace';
    ctx.fillStyle = "rgba(148, 163, 184, 0.66)";
    ctx.fillText("Start an OpenCode or Claude Code session to send someone to work.", MAP_W / 2, 274);
    ctx.restore();
  }

  function drawMeetingMarker() {
    const meeting = [...sims.values()].some((sim) => sim.meetingUntil > simTime);
    if (!meeting) return;
    const room = ROOM_BY_ID.get("planning");
    if (!room) return;
    const cx = (room.x + room.w / 2) * 16;
    const cy = (room.y + room.h / 2) * 16;
    const pulse = 0.45 + Math.sin(simTime * 2.4) * 0.16;
    for (let i = 0; i < 8; i += 1) {
      const angle = simTime * 0.7 + (i / 8) * Math.PI * 2;
      px(
        ctx,
        cx + Math.cos(angle) * 25,
        cy + Math.sin(angle) * 14,
        1,
        1,
        `rgba(251, 191, 36, ${pulse})`,
      );
    }
    const w = 66;
    const tagY = room.y * 16 + 14;
    px(ctx, cx - w / 2, tagY, w, 11, "rgba(7, 11, 19, 0.84)");
    px(ctx, cx - w / 2, tagY, w, 1, `rgba(251, 191, 36, ${0.35 + pulse * 0.45})`);
    px(ctx, cx - w / 2, tagY + 10, w, 1, "rgba(251, 191, 36, 0.24)");
    px(ctx, cx + w / 2 - 7, tagY + 4, 2, 2, `rgba(251, 191, 36, ${0.55 + pulse * 0.4})`);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '700 7px "Cascadia Mono", "Consolas", monospace';
    ctx.fillStyle = "#f6d58a";
    ctx.fillText("DELEGATION", cx - 4, tagY + 5.5);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = "#070b13";
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    ctx.save();
    ctx.setTransform(
      camera.zoom,
      0,
      0,
      camera.zoom,
      -camera.x * camera.zoom,
      -camera.y * camera.zoom,
    );
    ctx.drawImage(staticLayer, 0, 0);

    const rareFlicker =
      !paused && (Math.sin(simTime * 13.1) > 0.996 || Math.sin(simTime * 7.7 + 2) > 0.997)
        ? -0.14
        : 0;
    const lightPulse = paused ? 0.9 : 0.88 + Math.sin(simTime * 0.8) * 0.04 + rareFlicker;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp(lightPulse, 0.52, 1);
    ctx.drawImage(lightLayer, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    drawClockHands(ctx, simTime);

    for (const sim of sims.values()) {
      if (!sim.parentKey) continue;
      const parent = sims.get(sim.parentKey);
      if (!parent) continue;
      const handoff = simTime < sim.handoffUntil;
      if (handoff || parent.room === sim.room) {
        drawTether(ctx, sim, parent, simTime, handoff);
      }
    }

    const drawables = [];
    for (const item of furniture) {
      drawables.push({ baseline: (item.ty + item.th) * 16, item });
    }
    for (const sim of sims.values()) {
      drawables.push({ baseline: sim.y, sim });
    }
    drawables.sort((a, b) => a.baseline - b.baseline);

    for (const entry of drawables) {
      if (entry.item) {
        drawFurniture(ctx, entry.item, simTime);
      } else {
        const sim = entry.sim;
        if (sim.key === selectedKey) drawSelection(ctx, sim, "selected");
        else if (sim.key === hoveredKey) drawSelection(ctx, sim, "hover");
        drawAgent(ctx, sim, simTime);
      }
    }

    drawMeetingMarker();
    drawAmbientDust();
    ctx.restore();

    // The vignette stays in screen space so exploring the map does not reveal
    // harsh canvas edges.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(vignetteLayer, 0, 0);

    ctx.save();
    ctx.setTransform(
      camera.zoom,
      0,
      0,
      camera.zoom,
      -camera.x * camera.zoom,
      -camera.y * camera.zoom,
    );
    for (const sim of sims.values()) {
      drawNameplate(ctx, sim, sim.key === selectedKey);
    }
    const selectedSim = selectedKey ? sims.get(selectedKey) : null;
    const recentBubbles = [...sims.values()]
      .filter((sim) => sim.action && sim.key !== selectedKey && simTime < sim.bubbleUntil)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 4);
    const bubbles = [...recentBubbles, ...(selectedSim?.action ? [selectedSim] : [])].sort((a, b) => {
      if (a.key === selectedKey) return 1;
      if (b.key === selectedKey) return -1;
      return a.x - b.x;
    });
    const placedBubbles = [];
    for (const sim of bubbles) {
      let lift = 0;
      let offsetX = 0;
      const maxLift = Math.max(0, sim.y - 64);
      if (sim.key === selectedKey) {
        const bubbleY = sim.y - 56 - (sim.action.detail ? 4 : 0);
        const blockers = [...sims.values()].filter(
          (other) =>
            other.key !== sim.key &&
            Math.abs(other.x - sim.x) < 95 &&
            Math.abs(other.y + 10 - bubbleY) < 24,
        );
        if (blockers.length) {
          const nearest = blockers.reduce((a, b) =>
            Math.abs(a.x - sim.x) <= Math.abs(b.x - sim.x) ? a : b,
          );
          offsetX = nearest.x < sim.x ? 72 : -72;
        }
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const bubbleY = sim.y - 56 - lift;
        const collision = placedBubbles.some(
          (other) => Math.abs(other.x - (sim.x + offsetX)) < 125 && Math.abs(other.y - bubbleY) < 32,
        );
        if (!collision) break;
        lift = Math.min(maxLift, lift + 30);
      }
      drawBubble(ctx, sim, sim.action, sim.key === selectedKey, lift, offsetX);
      placedBubbles.push({ x: sim.x + offsetX, y: sim.y - 56 - lift });
    }
    drawEmptySign();
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function loop(now) {
    if (destroyed) return;
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (!paused) {
      simTime += dt;
      update(dt);
      needsDraw = true;
    }
    updateCamera(dt);
    const cameraMoving =
      Math.abs(cameraGoal.zoom - camera.zoom) > 0.002 ||
      Math.abs(cameraGoal.x - camera.x) > 0.1 ||
      Math.abs(cameraGoal.y - camera.y) > 0.1;
    // Ambient pixel animation reads well at 30 fps and roughly halves canvas
    // cost. Camera motion, dragging and hover feedback still render at 60 fps.
    const drawNow = cameraMoving || Boolean(drag) || now - lastDraw >= 1000 / 30;
    if (needsDraw && drawNow) {
      draw();
      lastDraw = now;
      needsDraw = false;
    }
    animationFrame = requestAnimationFrame(loop);
  }

  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * MAP_W,
      y: ((clientY - rect.top) / rect.height) * MAP_H,
    };
  }

  function toMap(clientX, clientY) {
    const point = canvasPoint(clientX, clientY);
    return {
      x: point.x / camera.zoom + camera.x,
      y: point.y / camera.zoom + camera.y,
    };
  }

  function hitTest(clientX, clientY) {
    const point = toMap(clientX, clientY);
    let best = null;
    let bestDistance = Infinity;
    for (const sim of sims.values()) {
      if (Math.abs(point.x - sim.x) > 18) continue;
      if (point.y < sim.y - 46 || point.y > sim.y + 12) continue;
      const distance = Math.hypot(point.x - sim.x, point.y - (sim.y - 18));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = sim.key;
      }
    }
    return best;
  }

  function select(id, focus = true) {
    const next = id && sims.has(id) ? id : null;
    const changed = selectedKey !== next;
    selectedKey = next;
    if (next && focus) focusOn(sims.get(next));
    if (changed) {
      onSelect(next);
      onCue("select");
    }
    needsDraw = true;
  }

  function setHover(id) {
    if (id === hoveredKey) return;
    hoveredKey = id;
    if (!drag) canvas.style.cursor = id ? "pointer" : cameraGoal.zoom > 1 ? "grab" : "default";
    needsDraw = true;
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const id = hitTest(event.clientX, event.clientY);
    if (id) {
      select(id, true);
      event.preventDefault();
      return;
    }
    drag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
      moved: false,
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = "grabbing";
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (drag && event.pointerId === drag.pointerId) {
      const rect = canvas.getBoundingClientRect();
      const dx = ((event.clientX - drag.clientX) / rect.width) * (MAP_W / camera.zoom);
      const dy = ((event.clientY - drag.clientY) / rect.height) * (MAP_H / camera.zoom);
      if (Math.abs(event.clientX - drag.clientX) + Math.abs(event.clientY - drag.clientY) > 2) {
        drag.moved = true;
      }
      const next = clampView({
        zoom: camera.zoom,
        x: drag.cameraX - dx,
        y: drag.cameraY - dy,
      });
      camera.x = next.x;
      camera.y = next.y;
      cameraGoal.zoom = camera.zoom;
      cameraGoal.x = next.x;
      cameraGoal.y = next.y;
      onCamera({ ...cameraGoal });
      needsDraw = true;
      event.preventDefault();
      return;
    }
    setHover(hitTest(event.clientX, event.clientY));
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    canvas.releasePointerCapture?.(event.pointerId);
    const moved = drag.moved;
    drag = null;
    if (!moved) select(null, false);
    canvas.style.cursor = hoveredKey ? "pointer" : cameraGoal.zoom > 1 ? "grab" : "default";
    needsDraw = true;
  }

  function onPointerCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    canvas.style.cursor = cameraGoal.zoom > 1 ? "grab" : "default";
    needsDraw = true;
  }

  function onPointerLeave() {
    if (drag) return;
    hoveredKey = null;
    canvas.style.cursor = cameraGoal.zoom > 1 ? "grab" : "default";
    needsDraw = true;
  }

  function onWheel(event) {
    event.preventDefault();
    const point = canvasPoint(event.clientX, event.clientY);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomAt(Math.exp(-delta * 0.0014), point.x, point.y);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  animationFrame = requestAnimationFrame(loop);

  return {
    sync,
    select,
    setPaused(value) {
      paused = Boolean(value);
      lastFrame = performance.now();
      needsDraw = true;
    },
    setBridgeLive(value) {
      const next = Boolean(value);
      if (bridgeLive === next) return;
      bridgeLive = next;
      for (const sim of sims.values()) {
        sim.stale = !bridgeLive && sim.connected;
        if (sim.stale) {
          sim.variant = "wait";
          sim.meetingUntil = 0;
          sim.handoffUntil = 0;
          sim.pendingRoom = null;
          sim.successUntil = 0;
          sim.errorUntil = 0;
        }
      }
      needsDraw = true;
    },
    getPaused: () => paused,
    getSelected: () => selectedKey,
    getAgents: () =>
      [...sims.values()].map((sim) => ({
        key: sim.key,
        id: sim.id,
        provider: sim.provider,
        x: sim.x,
        y: sim.y,
        room: sim.room,
        targetRoom: sim.targetRoom,
        source: sim.source,
        status: sim.status,
        phase: sim.phase,
        connected: sim.connected,
        historical: sim.historical,
        stale: sim.stale,
        lastStatus: sim.lastStatus,
        lastOutcome: sim.lastOutcome,
        state: sim.state,
        variant: sim.variant,
        seated: sim.seated,
        frame: sim.frame,
        moving: sim.moving,
        turning: sim.turn > 0,
        pathLength: sim.path.length,
        path: sim.path.map((point) => tileAtPixel(point.x, point.y)),
        spot: sim.spot,
        handoff: simTime < sim.handoffUntil,
        meeting: simTime < sim.meetingUntil,
        success: simTime < sim.successUntil,
        error: simTime < sim.errorUntil,
      })),
    getCamera: () => ({ ...camera }),
    getCameraGoal: () => ({ ...cameraGoal }),
    zoomIn: () => zoomAt(1.22),
    zoomOut: () => zoomAt(1 / 1.22),
    resetCamera: () => {
      setCameraGoal({ zoom: 1, x: 0, y: 0 });
      canvas.style.cursor = "default";
    },
    focusSelected: () => {
      const sim = selectedKey ? sims.get(selectedKey) : null;
      if (sim) focusOn(sim, Math.max(1.55, cameraGoal.zoom));
    },
    getSimTime: () => simTime,
    warnings: mapWarnings,
    rooms: ROOMS,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(animationFrame);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}
