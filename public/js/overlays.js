import { makeCharacterSprite, shade } from "./sprites.js";
import { px, rounded } from "./pixels.js";
import { MAP_W, ROOM_BY_ID } from "./map.js";
import { canonicalEventType } from "./identity.js";

export function roomLabel(roomId) {
  return ROOM_BY_ID.get(roomId)?.short ?? (roomId ? roomId[0].toUpperCase() + roomId.slice(1) : "Office");
}

function compact(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Translate observed tool/status data into short, factual UI language.
 * No progress percentages or invented accomplishments.
 */
export function describeAgent(agent) {
  const tool = String(agent?.tool ?? "").toLowerCase();
  const detail = compact(agent?.detail ?? "", 64);
  const lowerDetail = detail.toLowerCase();
  const status = String(agent?.status ?? "").toLowerCase();

  // Restored/closed sessions keep their last observed facts, but they must
  // never read as a current task. This check deliberately precedes every
  // event-specific success/error wording.
  if (agent?.connected === false) {
    if (agent?.phase === "terminated" || status.includes("closed")) {
      return { title: "Session closed", detail: "off the clock", tone: "muted" };
    }
    if (agent?.lastOutcome === "failed") {
      return { title: "Offline", detail: "last observed run failed", tone: "error" };
    }
    const lastStatus = compact(agent?.lastStatus ?? "", 40);
    return {
      title: "Offline",
      detail: lastStatus ? `last observed: ${lastStatus.toLowerCase()}` : "no live events",
      tone: "muted",
    };
  }

  const canonicalType = canonicalEventType(agent);
  if (canonicalType === "session.execution.succeeded") {
    return { title: "Task complete", detail: "execution succeeded", tone: "success" };
  }
  if (canonicalType === "session.turn.completed") {
    return { title: "Turn completed", detail: "assistant finished responding", tone: "success" };
  }
  if (canonicalType === "session.execution.failed") {
    return { title: "Hit a snag", detail: detail || "execution failed", tone: "error" };
  }
  if (status.includes("closed")) return { title: "Session closed", detail: "off the clock", tone: "muted" };
  if (status.includes("completed")) {
    return { title: "Run completed", detail: "waiting for the next prompt", tone: "success" };
  }
  if (status.includes("started")) return { title: "Session started", detail: detail || "joining the office", tone: "idle" };
  if (status.includes("stopped") || status.includes("interrupted")) {
    return { title: "Stopped", detail: detail || "session interrupted", tone: "muted" };
  }
  if (status.includes("error") || status.includes("failed")) {
    return { title: "Hit a snag", detail: detail || "tool reported an error", tone: "error" };
  }
  if (status.includes("retry")) return { title: "Retrying", detail: detail || "waiting on a response", tone: "warn" };
  if (status.includes("compacting")) return { title: "Tidying context", detail: "context compaction", tone: "work" };
  if (status.includes("finished")) return { title: "Thinking it through", detail: "last tool finished", tone: "work" };
  if (status.includes("idle") || status.includes("waiting")) {
    return { title: "Waiting for work", detail: "no active tool", tone: "idle" };
  }
  if (status.includes("skill")) return { title: "Loading a skill", detail, tone: "work" };

  if (tool === "read") return { title: "Reading files", detail, tone: "work" };
  if (tool === "grep" || tool === "glob" || tool === "search" || tool === "find") {
    return { title: "Searching code", detail, tone: "work" };
  }
  if (tool === "webfetch" || tool === "websearch" || tool === "fetch") {
    return { title: "Researching", detail, tone: "work" };
  }
  if (tool === "edit" || tool === "patch" || tool === "multiedit" || tool === "apply_patch") {
    return { title: "Editing code", detail, tone: "work" };
  }
  if (tool === "write") return { title: "Writing a file", detail, tone: "work" };
  if (tool === "task" || tool === "subagent") return { title: "Delegating a task", detail, tone: "work" };
  if (tool === "todo" || tool === "todowrite" || tool === "todo_read" || tool === "todo_write") {
    return { title: "Planning next steps", detail, tone: "work" };
  }
  if (tool === "skill") return { title: "Loading a skill", detail, tone: "work" };
  if (tool === "question") return { title: "Asking a question", detail, tone: "work" };
  if (tool === "execute") return { title: "Working in Code Mode", detail, tone: "work" };
  if (tool === "shell" || tool === "bash") {
    if (/\b(test|vitest|jest|pytest|playwright|cypress)\b/.test(lowerDetail)) {
      return { title: "Running tests", detail, tone: "work" };
    }
    if (/\b(build|compile|tsc|bundle)\b/.test(lowerDetail)) {
      return { title: "Building", detail, tone: "work" };
    }
    if (/\b(lint|typecheck|check)\b/.test(lowerDetail)) {
      return { title: "Checking code", detail, tone: "work" };
    }
    if (/\b(deploy|release|publish|vercel|netlify|kubectl|terraform|git\s+push)\b/.test(lowerDetail)) {
      return { title: "Deploying", detail, tone: "work" };
    }
    return { title: "Running a command", detail, tone: "work" };
  }
  if (tool) {
    return { title: `Using ${tool}`, detail, tone: "work" };
  }
  if (status.includes("thinking")) return { title: "Thinking", detail, tone: "work" };
  return { title: "Working", detail, tone: "work" };
}

export function drawSelection(ctx, sim, kind) {
  if (!sim) return;
  const color = kind === "selected" ? shade(sim.color, 0.2) : "rgba(255,255,255,0.35)";
  ctx.save();
  ctx.globalAlpha = kind === "selected" ? 0.9 : 0.4;
  px(ctx, sim.x - 10, sim.y - 2, 20, 2, color);
  px(ctx, sim.x - 7, sim.y + 0, 14, 2, color);
  px(ctx, sim.x - 12, sim.y - 4, 3, 2, color);
  px(ctx, sim.x + 9, sim.y - 4, 3, 2, color);
  ctx.restore();
}

export function drawAgent(ctx, sim, time = 0) {
  const turning = sim.turn > 0;
  const renderDir = turning
    ? "side"
    : sim.dir === "left" || sim.dir === "right"
      ? "side"
      : sim.dir === "up"
        ? "up"
        : "down";
  const reactingError = sim.errorUntil > time;
  const reactingSuccess = sim.successUntil > time;
  let state = turning
    ? "turn"
    : sim.state === "walk"
      ? "walk"
      : sim.state === "work"
        ? sim.seated
          ? "sit"
          : "work"
        : sim.seated
          ? "sit"
          : "idle";
  let variant = sim.variant ?? "type";
  if (state === "sit" && sim.state !== "work") variant = "relax";

  if (!turning && state !== "walk" && reactingError) {
    state = sim.seated ? "sit" : "work";
    variant = "error";
  } else if (!turning && state !== "walk" && reactingSuccess) {
    state = "cheer";
    variant = "cheer";
  }

  const frame =
    state === "turn"
      ? sim.turn > 0.08
        ? 0
        : 1
      : state === "walk" || state === "work"
        ? sim.frame % 4
        : state === "sit"
          ? sim.state === "work"
            ? sim.frame % 4
            : sim.frame % 6
          : sim.frame % 6;
  const sprite = makeCharacterSprite(sim.color, renderDir, state, frame, variant);
  const flip = turning ? sim.turnSide === "left" : sim.dir === "left";
  const walking = state === "walk";
  const shake = reactingError && !turning && state !== "walk" ? Math.round(Math.sin(time * 34 + sim.x) * 1.4) : 0;

  // Contact shadow, made from pixel rows so it matches the art.
  px(ctx, sim.x - 8, sim.y - 3, 16, 3, "rgba(0,0,0,0.2)");
  px(ctx, sim.x - 5, sim.y + 0, 10, 2, "rgba(0,0,0,0.22)");
  px(ctx, sim.x - 3, sim.y + 2, 6, 1, "rgba(0,0,0,0.16)");

  // Two small footstep puffs on alternate walking frames. Deterministic and
  // cheap; they never imply progress, only that a character is moving.
  if (walking && sim.frame % 4 === 1) {
    const back = sim.dir === "left" ? 4 : sim.dir === "right" ? -4 : 0;
    px(ctx, sim.x - 4 + back, sim.y - 1, 2, 1, "rgba(214, 200, 178, 0.2)");
    px(ctx, sim.x + 2 + back, sim.y + 1, 1, 1, "rgba(214, 200, 178, 0.14)");
  }

  const sx = Math.round(sim.x) + shake;
  const sy = Math.round(sim.y) - 44;
  const ghosted = sim.connected === false || sim.stale === true;
  if (ghosted) {
    ctx.save();
    ctx.globalAlpha = 0.55;
  }
  if (flip) {
    ctx.save();
    ctx.translate(sx, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, -16, sy);
    ctx.restore();
  } else {
    ctx.drawImage(sprite, sx - 16, sy);
  }
  if (ghosted) ctx.restore();

  // Small, explicit reactions. Thought dots are a thinking pose, the "!" only
  // appears for an observed failure, and the check only for a succeeded run.
  if (!walking && variant === "think") {
    const phase = Math.floor(time * 2.2) % 3;
    for (let i = 0; i < 3; i += 1) {
      const alpha = i <= phase ? 0.7 : 0.22;
      px(ctx, sim.x + 9 + i * 3, sim.y - 50 - i * 2, 2, 2, `rgba(226, 232, 240, ${alpha})`);
    }
  }
  if (reactingError && !walking) {
    px(ctx, sim.x + 10, sim.y - 57, 2, 6, "#fb7185");
    px(ctx, sim.x + 10, sim.y - 50, 2, 2, "#fb7185");
    px(ctx, sim.x + 9, sim.y - 58, 4, 1, "rgba(251, 113, 133, 0.35)");
  }
  if (reactingSuccess) {
    const sparkle = Math.floor(time * 6) % 4;
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2 + time * 1.3;
      const radius = 16 + (i % 2) * 6;
      const x = sim.x + Math.cos(angle) * radius;
      const y = sim.y - 25 + Math.sin(angle) * (radius * 0.55);
      const alpha = 0.35 + ((i + sparkle) % 3) * 0.18;
      px(ctx, x, y, 2, 2, i % 2 ? `rgba(250, 204, 21, ${alpha})` : `rgba(255, 246, 214, ${alpha})`);
    }
    const checkX = Math.round(sim.x + 10);
    const checkY = Math.round(sim.y - 58);
    px(ctx, checkX - 3, checkY + 3, 2, 2, "#4ade80");
    px(ctx, checkX - 1, checkY + 5, 2, 2, "#4ade80");
    px(ctx, checkX + 1, checkY + 3, 2, 2, "#4ade80");
    px(ctx, checkX + 3, checkY + 1, 2, 2, "#4ade80");
  }
}

export function drawNameplate(ctx, sim, selected) {
  const offline = sim.connected === false || sim.stale === true;
  const prefix = `${sim.parentID ? "↳ " : ""}${sim.source === "demo" ? "◇ " : ""}${offline ? "○ " : ""}`;
  const name = compact(`${prefix}${sim.name}`, 24);
  ctx.font = '600 8px "Cascadia Mono", "Consolas", monospace';
  const width = Math.min(132, Math.ceil(ctx.measureText(name).width) + 12);
  const x = Math.round(Math.max(4, Math.min(MAP_W - width - 4, sim.x - width / 2)));
  const y = Math.round(sim.y + 5);
  rounded(ctx, x, y, width, 11, "rgba(10, 15, 24, 0.82)", 2);
  px(
    ctx,
    x + 2,
    y + 2,
    2,
    7,
    offline ? "#64748b" : selected ? shade(sim.color, 0.15) : sim.color,
  );
  ctx.fillStyle = selected ? "#fff6e3" : offline ? "#8f9dad" : "#d9e0ea";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x + 7, y + 6);
  if (selected) {
    ctx.strokeStyle = offline ? "#64748b" : shade(sim.color, 0.15);
    ctx.globalAlpha = 0.55;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 10);
    ctx.globalAlpha = 1;
  }
}

export function drawBubble(ctx, sim, action, selected, offsetY = 0, offsetX = 0) {
  const title = compact(action.title, 24);
  const detail = compact(action.detail, 30);
  ctx.font = '600 8px "Cascadia Mono", "Consolas", monospace';
  const titleWidth = ctx.measureText(title).width;
  ctx.font = '400 7px "Cascadia Mono", "Consolas", monospace';
  const detailWidth = detail ? ctx.measureText(detail).width : 0;
  const width = Math.round(Math.min(164, Math.max(44, Math.max(titleWidth, detailWidth) + 16)));
  const height = detail ? 26 : 17;
  const x = Math.round(Math.max(4, Math.min(MAP_W - width - 4, sim.x - width / 2 + offsetX)));
  const y = Math.max(6, Math.round(sim.y - 56 - (detail ? 4 : 0) - offsetY));
  const accent =
    action.tone === "error"
      ? "#fb7185"
      : action.tone === "success"
        ? "#4ade80"
        : action.tone === "idle"
          ? "#94a3b8"
          : sim.color;

  // A tiny shadow and the pixel bubble.
  px(ctx, x + 2, y + 2, width, height, "rgba(0,0,0,0.22)");
  rounded(ctx, x, y, width, height, "rgba(15, 21, 32, 0.97)", 3);
  ctx.strokeStyle = selected ? shade(accent, 0.2) : "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  px(ctx, x + 4, y + 4, 2, height - 8, accent);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = '600 8px "Cascadia Mono", "Consolas", monospace';
  ctx.fillStyle = "#f2f5f9";
  ctx.fillText(title, x + 9, y + (detail ? 8 : height / 2));
  if (detail) {
    ctx.font = '400 7px "Cascadia Mono", "Consolas", monospace';
    ctx.fillStyle = "#93a3b8";
    ctx.fillText(detail, x + 9, y + 18);
  }

  // Tail.
  const tailX = Math.round(Math.max(x + 8, Math.min(x + width - 8, sim.x)));
  px(ctx, tailX - 3, y + height, 6, 2, "rgba(15, 21, 32, 0.97)");
  px(ctx, tailX - 1, y + height + 2, 3, 2, "rgba(15, 21, 32, 0.97)");
}

export function drawTether(ctx, child, parent, time = 0, active = false) {
  if (!child || !parent) return;
  const color = shade(child.color, 0.1);
  const x1 = Math.round(child.x);
  const y1 = Math.round(child.y - 24);
  const x2 = Math.round(parent.x);
  const y2 = Math.round(parent.y - 24);
  const offline = child.connected === false || parent.connected === false || child.stale === true || parent.stale === true;
  ctx.save();
  ctx.globalAlpha = offline ? 0.14 : active ? 0.62 : 0.3;
  ctx.strokeStyle = color;
  ctx.lineWidth = active ? 1.5 : 1;
  ctx.setLineDash(active ? [3, 3] : [2, 4]);
  ctx.lineDashOffset = active ? -Math.floor(time * 18) : 0;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  const mx = Math.round((x1 + x2) / 2);
  const my = Math.round((y1 + y2) / 2);
  px(ctx, mx - 1, my - 1, 3, 3, color);

  if (active) {
    // A single pulse travels from parent to child for the observed handoff.
    const progress = (time * 1.3) % 1;
    const px1 = Math.round(x2 + (x1 - x2) * progress);
    const py1 = Math.round(y2 + (y1 - y2) * progress);
    px(ctx, px1 - 2, py1 - 2, 4, 4, "rgba(255,255,255,0.18)");
    px(ctx, px1 - 1, py1 - 1, 2, 2, shade(child.color, 0.35));
  }
  ctx.restore();
}
