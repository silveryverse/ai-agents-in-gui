import { createOffice } from "./office.js";
import { ROOMS } from "./map.js";
import { describeAgent, roomLabel } from "./overlays.js";
import { drawAvatar } from "./sprites.js";
import { playCue, setSoundEnabled } from "./sound.js";
import {
  canonicalEventType,
  identityKey,
  parentIdentityKey,
  providerLabel,
  providerOf,
} from "./identity.js";

const $ = (id) => document.getElementById(id);
const els = {
  agentCount: $("agent-count"),
  eventCount: $("event-count"),
  crewCount: $("crew-count"),
  roster: $("roster"),
  inspector: $("inspector"),
  eventLog: $("event-log"),
  connDot: $("conn-dot"),
  connText: $("conn-text"),
  live: $("live"),
  modeBadge: $("mode-badge"),
  pause: $("pause"),
  pauseGlyph: $("pause-glyph"),
  pauseLabel: $("pause-label"),
  pausedBadge: $("paused-badge"),
  stageSub: $("stage-sub"),
  legend: $("legend"),
  filterAll: $("filter-all"),
  filterSelected: $("filter-selected"),
  footerUrl: $("footer-url"),
  map: $("office"),
  crewFilters: $("crew-filters"),
  zoomIn: $("zoom-in"),
  zoomOut: $("zoom-out"),
  zoomReset: $("zoom-reset"),
  zoomLabel: $("zoom-label"),
  soundToggle: $("sound-toggle"),
  soundLabel: $("sound-label"),
};

const deepLinkParams = new URLSearchParams(window.location.search);
const linkedAgent = deepLinkParams.get("agent");
const linkedProvider = deepLinkParams.get("provider");
let deepLinkApplied = false;

const state = {
  agents: [],
  activity: [],
  mode: "live",
  selected: null,
  paused: false,
  filter: "all",
  crewFilter: "all",
  sound: false,
  connection: "connecting",
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[character];
  });

function safeColor(value, fallback = "#94a3b8") {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
}

function timeAgo(at) {
  if (!at) return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function compactText(value, max = 48) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function statusTone(agent) {
  const status = String(agent.status ?? "").toLowerCase();
  const eventType = canonicalEventType(agent).toLowerCase();
  if (isStale(agent)) return "idle";
  if (agent.connected === false) {
    if (agent.lastOutcome === "failed" || /error|failed/.test(status)) return "error";
    return "idle";
  }
  if (
    agent.phase === "failed" ||
    /error|failed/.test(status) ||
    /failed|error/.test(eventType)
  ) {
    return "error";
  }
  if (/retry/.test(status) || agent.phase === "interrupted") return "warn";
  if (
    agent.phase === "idle" ||
    agent.phase === "terminated" ||
    agent.phase === "offline" ||
    /idle|closed|waiting|stopped|interrupted|started|completed|offline|terminated/.test(status)
  ) {
    return "idle";
  }
  return "work";
}

const CREW_FILTERS = {
  all: () => true,
  active: (agent) =>
    agent.connected !== false && !/closed|terminated/i.test(String(agent.status ?? "")),
  working: (agent) => agent.connected !== false && statusTone(agent) === "work",
  idle: (agent) =>
    agent.connected !== false &&
    (statusTone(agent) === "idle" || statusTone(agent) === "warn"),
  // Failed history remains discoverable, but it is still labeled offline/closed
  // in the roster and inspector and can never satisfy the Working filter.
  errored: (agent) => statusTone(agent) === "error",
};

function statusText(agent) {
  const status = String(agent.status ?? "Working");
  const text = status.replace(/^Using /, "").replace(/^Session /, "");
  return isStale(agent) ? `stale · ${text}` : text;
}

function isDemo(agent) {
  return agent?.source === "demo";
}

function isHistorical(agent) {
  return agent?.connected === false || agent?.historical === true;
}

/** Last-known data shown while the local bridge is unreachable. */
function isStale(agent) {
  return state.connection !== "live" && !isHistorical(agent);
}

function originLabel(agent) {
  return isDemo(agent) ? "Seeded demo" : `Live ${providerLabel(agent)}`;
}

function connectionLabel(agent) {
  if (!isHistorical(agent)) return "live";
  return String(agent.phase ?? "") === "terminated" ? "closed" : "historical";
}

function orderedAgents(agents) {
  const keys = new Set(agents.map((agent) => identityKey(agent)));
  const children = new Map();
  const roots = [];
  for (const agent of agents) {
    const key = identityKey(agent);
    const parentKey = parentIdentityKey(agent);
    if (parentKey && parentKey !== key && keys.has(parentKey)) {
      if (!children.has(parentKey)) children.set(parentKey, []);
      children.get(parentKey).push(agent);
    } else {
      roots.push(agent);
    }
  }
  const result = [];
  const visited = new Set();
  const walk = (agent, depth) => {
    const key = identityKey(agent);
    if (visited.has(key)) return;
    visited.add(key);
    result.push({ agent, depth });
    for (const child of children.get(key) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  for (const agent of agents) if (!visited.has(identityKey(agent))) walk(agent, 0);
  return result;
}

function agentByKey(key) {
  return state.agents.find((agent) => identityKey(agent) === key);
}

function deepLinkKey() {
  if (!linkedAgent) return null;
  const matches = state.agents.filter(
    (agent) =>
      agent.id === linkedAgent &&
      (!linkedProvider || providerOf(agent) === linkedProvider.toLowerCase()),
  );
  if (matches.length === 1) return identityKey(matches[0]);
  const openCode = matches.find((agent) => providerOf(agent) === "opencode");
  return openCode ? identityKey(openCode) : null;
}

const office = createOffice(els.map, {
  onSelect(key) {
    state.selected = key;
    if (!key && state.filter === "selected") state.filter = "all";
    renderCrew();
    renderInspector();
    renderEvents();
  },
  onCue(kind) {
    playCue(kind);
  },
  onCamera(camera) {
    if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
  },
});

function renderLegend() {
  els.legend.innerHTML = ROOMS.map(
    (room) => `
      <span class="legend-item">
        <i style="--room:${safeColor(room.trim)}"></i>${escapeHtml(room.short)}
      </span>`,
  ).join("");
}

function renderConnection() {
  const labels = { connecting: "Connecting…", live: "Live connection", offline: "Reconnecting…" };
  els.connText.textContent = labels[state.connection] ?? "Connecting…";
  els.live.dataset.state = state.connection;
  els.live.title = state.connection === "live" ? "WebSocket connected" : "Waiting for the local bridge";
  office.setBridgeLive(state.connection === "live");
  // Keep the last-known picture visible while reconnecting, but mark it stale
  // and stop presenting its old statuses as current work.
  renderCrew();
  renderStats();
  renderInspector();
}

function setConnection(next) {
  if (state.connection === next) return;
  state.connection = next;
  renderConnection();
}

function renderMode() {
  const demo = state.mode === "demo";
  els.modeBadge.hidden = !demo;
  document.body.dataset.mode = demo ? "demo" : "live";
}

function renderCrew() {
  const predicate = CREW_FILTERS[state.crewFilter] ?? CREW_FILTERS.all;
  const visible = state.agents.filter(predicate);
  const ordered = orderedAgents(visible);
  const total = state.agents.length;
  els.crewCount.textContent = visible.length === total ? String(total) : `${visible.length}/${total}`;

  if (els.crewFilters) {
    for (const button of els.crewFilters.querySelectorAll("[data-crew-filter]")) {
      const key = button.dataset.crewFilter;
      const active = key === state.crewFilter;
      const countNode = button.querySelector("span");
      const count = state.agents.filter(CREW_FILTERS[key] ?? (() => true)).length;
      if (countNode) countNode.textContent = String(count);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  if (!ordered.length) {
    els.roster.innerHTML = `
      <div class="empty-roster">
        <span class="empty-pixel" aria-hidden="true"></span>
        <strong>${total ? "No agents match this filter" : "No agents on shift"}</strong>
        <p>${
          total
            ? "Choose another filter to see the rest of the crew."
            : "Start an OpenCode session and a character will walk into the office."
        }</p>
      </div>`;
    return;
  }

  els.roster.innerHTML = ordered
    .map(({ agent, depth }) => {
      const color = safeColor(agent.color);
      const key = identityKey(agent);
      const selected = state.selected === key;
      const historical = isHistorical(agent);
      const stale = isStale(agent);
      return `
        <button class="crew-card${selected ? " is-selected" : ""}${depth ? " is-sub" : ""}${historical ? " is-historical" : ""}${stale ? " is-stale" : ""}" type="button"
          data-id="${escapeHtml(key)}" data-source="${isDemo(agent) ? "demo" : "live"}"
          data-connection="${stale ? "stale" : connectionLabel(agent)}"
          style="--agent:${color};--depth:${Math.min(depth, 2)}"
          aria-pressed="${selected}" title="${escapeHtml(`${originLabel(agent)} · ${stale ? "last known; bridge reconnecting" : connectionLabel(agent)}`)}">
          <span class="crew-avatar"><canvas width="32" height="48" data-avatar="${color}"></canvas></span>
          <span class="crew-main">
            <span class="crew-name">${escapeHtml(agent.name || `${providerLabel(agent)} Agent`)}${agent.parentID ? '<em class="sub-badge">SUB</em>' : ""}${isDemo(agent) ? '<em class="demo-badge">DEMO</em>' : ""}${historical ? '<em class="hist-badge">OFFLINE</em>' : ""}${stale ? '<em class="stale-badge">STALE</em>' : ""}</span>
            <span class="crew-meta"><i class="dot" style="--agent:${color}"></i>${escapeHtml(roomLabel(agent.room))} · ${escapeHtml(statusText(agent))}</span>
          </span>
          <span class="crew-status ${statusTone(agent)}" title="${escapeHtml(agent.status ?? "")}"></span>
        </button>`;
    })
    .join("");

  for (const canvas of els.roster.querySelectorAll("canvas[data-avatar]")) {
    drawAvatar(canvas, canvas.dataset.avatar);
  }
}

function inspectorEmpty() {
  return `
    <div class="panel-head"><h2>INSPECTOR</h2><span class="chip muted">IDLE</span></div>
    <div class="inspector-empty">
      <span class="empty-pixel large" aria-hidden="true"></span>
      <strong>No one selected</strong>
      <p>Choose a character on the map or in the crew list to see their observed activity.</p>
    </div>`;
}

function renderInspector() {
  const agent = agentByKey(state.selected);
  if (!agent) {
    els.inspector.innerHTML = inspectorEmpty();
    return;
  }
  const color = safeColor(agent.color);
  const stale = isStale(agent);
  const action = stale
    ? {
        title: "Bridge offline",
        detail: `last observed: ${compactText(agent.status, 56).toLowerCase()}`,
        tone: "muted",
      }
    : describeAgent(agent);
  const parent = agent.parentID ? agentByKey(parentIdentityKey(agent)) : null;
  const eventName = String(agent.eventType ?? "session.event").split(".").pop();
  const sourceChip = isDemo(agent) ? '<span class="chip demo">DEMO</span>' : "";
  const providerChip =
    providerLabel(agent) !== "OpenCode"
      ? `<span class="chip">${escapeHtml(providerLabel(agent).toUpperCase())}</span>`
      : "";
  const historicalChip = isHistorical(agent)
    ? `<span class="chip historical">${agent.phase === "terminated" ? "CLOSED" : "OFFLINE"}</span>`
    : "";
  const staleChip = stale ? '<span class="chip stale">STALE</span>' : "";
  const lastSeen = timeAgo(agent.lastSeenAt ?? agent.updatedAt);
  const lastStatus = compactText(agent.lastStatus, 48);
  const lastOutcome = agent.lastOutcome ? compactText(agent.lastOutcome, 32) : "—";
  const connectionDetail =
    lastStatus && (stale || isHistorical(agent)) ? ` · last ${lastStatus}` : "";
  const handoffObserved =
    agent.parentID &&
    (/^(subagent|task)$/i.test(String(parent?.tool ?? "")) ||
      state.activity.some(
        (item) =>
          identityKey(item) === parentIdentityKey(agent) &&
          /^(subagent|task)\b/i.test(String(item.detail ?? "")),
      ));

  els.inspector.innerHTML = `
    <div class="panel-head"><h2>INSPECTOR</h2><div class="head-badges"><span class="chip">${agent.parentID ? "SUBAGENT" : "AGENT"}</span>${providerChip}${historicalChip}${staleChip}${sourceChip}</div></div>
    <div class="inspector-head">
      <span class="inspector-avatar"><canvas width="32" height="48" data-avatar="${color}"></canvas></span>
      <div class="inspector-title">
        <h3>${escapeHtml(agent.name || `${providerLabel(agent)} Agent`)}</h3>
        <span class="status-pill ${statusTone(agent)}"><i></i>${escapeHtml(statusText(agent))}</span>
      </div>
    </div>
    <div class="action-card" style="--agent:${color}">
      <span class="kicker">OBSERVED ACTIVITY</span>
      <strong>${escapeHtml(action.title)}</strong>
      <p>${escapeHtml(action.detail || "No extra detail was reported.")}</p>
    </div>
    <dl class="facts">
      <div><dt>Room</dt><dd>${escapeHtml(roomLabel(agent.room))}</dd></div>
      <div><dt>Session</dt><dd class="mono" title="${escapeHtml(agent.id)}">${escapeHtml(agent.id)}</dd></div>
      <div><dt>Provider</dt><dd>${escapeHtml(providerLabel(agent))}</dd></div>
      <div><dt>Connection</dt><dd>${escapeHtml(stale ? "last known" : connectionLabel(agent))}${escapeHtml(connectionDetail)}</dd></div>
      <div><dt>Origin</dt><dd>${escapeHtml(originLabel(agent))}</dd></div>
      <div><dt>Delegation</dt><dd>${agent.parentID ? (handoffObserved ? "handoff observed" : "parent link confirmed") : "—"}</dd></div>
      <div><dt>Reports to</dt><dd>${escapeHtml(parent?.name || (agent.parentID ? "parent session (not in view)" : "—"))}</dd></div>
      <div><dt>Last seen</dt><dd>${escapeHtml(lastSeen)}</dd></div>
      <div><dt>Last outcome</dt><dd>${escapeHtml(lastOutcome)}</dd></div>
      <div><dt>Last event</dt><dd>${escapeHtml(eventName)} · ${escapeHtml(timeAgo(agent.updatedAt))}</dd></div>
    </dl>
    <button class="btn ghost full" type="button" id="clear-selection">Clear selection</button>`;

  const canvas = els.inspector.querySelector("canvas[data-avatar]");
  if (canvas) drawAvatar(canvas, color);
}

function renderEvents() {
  const selectedAgent = agentByKey(state.selected);
  const selectedKey = selectedAgent ? identityKey(selectedAgent) : null;
  const items = state.activity.filter((item) =>
    state.filter === "selected" ? selectedKey && identityKey(item) === selectedKey : true,
  );

  els.filterAll.classList.toggle("is-active", state.filter === "all");
  els.filterSelected.classList.toggle("is-active", state.filter === "selected");
  els.filterSelected.disabled = !selectedAgent;

  if (!items.length) {
    els.eventLog.innerHTML = `<div class="empty-events">${
      state.filter === "selected" && !selectedAgent
        ? "Select an agent to filter the log."
        : "Events will appear here as agents work."
    }</div>`;
    return;
  }

  els.eventLog.innerHTML = items
    .slice(0, 60)
    .map((item) => {
      const key = identityKey(item);
      const itemAgent = agentByKey(key);
      const color = safeColor(item.color || itemAgent?.color);
      const selected = key === state.selected;
      const demo = item.source === "demo";
      const historical = isHistorical(itemAgent);
      return `
        <button class="event-item${selected ? " is-selected" : ""}${demo ? " is-demo" : ""}${historical ? " is-historical" : ""}" type="button" data-id="${escapeHtml(key)}">
          <span class="event-dot" style="--agent:${color}"></span>
          <span class="event-body">
            <span class="event-top"><strong>${escapeHtml(item.name || "Agent")}${demo ? '<em class="demo-badge">DEMO</em>' : ""}${historical ? '<em class="hist-badge">HISTORY</em>' : ""}</strong><time>${escapeHtml(item.time || "")}</time></span>
            <span class="event-type">${escapeHtml(item.type || "event")}${item.room ? ` · ${escapeHtml(roomLabel(item.room))}` : ""}</span>
            <span class="event-detail">${escapeHtml(item.detail || "—")}</span>
          </span>
        </button>`;
    })
    .join("");
}

function renderStats() {
  const demo = state.agents.filter(isDemo).length;
  els.agentCount.textContent = String(state.agents.length);
  els.eventCount.textContent = String(state.activity.length);
  const connected = state.agents.filter((agent) => agent.connected !== false);
  const active = connected.filter((agent) => !/closed|terminated/i.test(agent.status ?? "")).length;
  const historical = state.agents.length - connected.length;
  const demoNote = demo ? ` · ${demo} demo` : "";
  const historyNote = historical ? ` · ${historical} historical` : "";
  const scope = state.mode === "demo" ? "Demo mode" : "Live map";
  const live = state.connection === "live";
  const running = state.paused
    ? `Animation paused · ${scope}`
    : live
      ? scope
      : `Last known · ${scope}`;
  const activeLabel = live
    ? active === 1
      ? "active session"
      : "active sessions"
    : active === 1
      ? "session last seen"
      : "sessions last seen";
  els.stageSub.textContent = `${running} · ${active} ${activeLabel}${historyNote}${demoNote}`;
}

function renderPause() {
  els.pause.classList.toggle("is-paused", state.paused);
  els.pause.setAttribute("aria-pressed", String(state.paused));
  els.pauseGlyph.className = `glyph ${state.paused ? "play" : "pause"}`;
  els.pauseLabel.textContent = state.paused ? "Resume" : "Pause";
  els.pausedBadge.hidden = !state.paused;
}

function renderAll() {
  renderMode();
  renderStats();
  renderCrew();
  renderInspector();
  renderEvents();
  renderPause();
}

function applyState(data) {
  state.mode = data?.mode === "demo" ? "demo" : "live";
  state.agents = Array.isArray(data?.agents) ? data.agents : [];
  state.activity = Array.isArray(data?.activity) ? data.activity : [];
  if (state.selected && !agentByKey(state.selected)) {
    state.selected = null;
    if (state.filter === "selected") state.filter = "all";
  }
  office.sync(state.agents, state.activity);
  if (!deepLinkApplied && linkedAgent) {
    const target = deepLinkKey();
    if (target) {
      deepLinkApplied = true;
      office.select(target);
    }
  }
  renderAll();
}

let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let loading = false;

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(10_000, 1_200 * 2 ** reconnectAttempt) + Math.random() * 350;
  reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    refresh();
  }, delay);
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(`${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}`);
  } catch {
    setConnection("offline");
    scheduleReconnect();
    return;
  }
  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    setConnection("live");
  });
  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data?.type === "update") {
        setConnection("live");
        applyState(data);
      }
    } catch {
      /* Ignore malformed bridge frames. */
    }
  });
  socket.addEventListener("close", () => {
    socket = null;
    setConnection("offline");
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    setConnection("offline");
  });
}

async function refresh() {
  if (loading) {
    scheduleReconnect();
    return;
  }
  loading = true;
  setConnection("connecting");
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    reconnectAttempt = 0;
    applyState(data);
    if (socket && socket.readyState === WebSocket.OPEN) setConnection("live");
    connect();
  } catch {
    setConnection("offline");
    scheduleReconnect();
  } finally {
    loading = false;
  }
}

function readSoundPreference() {
  try {
    return window.localStorage.getItem("agent-hq:sound") === "on";
  } catch {
    return false;
  }
}

function renderSound() {
  if (!els.soundToggle) return;
  els.soundToggle.setAttribute("aria-pressed", String(state.sound));
  els.soundToggle.title = state.sound
    ? "Quiet interface sounds are on"
    : "Quiet interface sounds are off (default)";
  if (els.soundLabel) els.soundLabel.textContent = state.sound ? "Sound on" : "Sound off";
}

function toggleSound() {
  state.sound = !state.sound;
  setSoundEnabled(state.sound);
  try {
    window.localStorage.setItem("agent-hq:sound", state.sound ? "on" : "off");
  } catch {
    /* Local storage can be unavailable in hardened browsers. */
  }
  renderSound();
  if (state.sound) playCue("select");
}

state.sound = readSoundPreference();
setSoundEnabled(state.sound);

els.pause.addEventListener("click", () => {
  state.paused = !state.paused;
  office.setPaused(state.paused);
  renderPause();
  renderStats();
});

els.soundToggle?.addEventListener("click", toggleSound);

els.crewFilters?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-crew-filter]");
  if (!button) return;
  const next = button.dataset.crewFilter;
  if (!CREW_FILTERS[next]) return;
  state.crewFilter = next;
  renderCrew();
});

els.zoomIn?.addEventListener("click", () => office.zoomIn());
els.zoomOut?.addEventListener("click", () => office.zoomOut());
els.zoomReset?.addEventListener("click", () => office.resetCamera());

els.filterAll.addEventListener("click", () => {
  state.filter = "all";
  renderEvents();
});

els.filterSelected.addEventListener("click", () => {
  if (!state.selected) return;
  state.filter = "selected";
  renderEvents();
});

els.roster.addEventListener("click", (event) => {
  const card = event.target.closest(".crew-card");
  if (card?.dataset.id) office.select(card.dataset.id);
});

els.eventLog.addEventListener("click", (event) => {
  const item = event.target.closest(".event-item");
  if (item?.dataset.id) office.select(item.dataset.id);
});

els.inspector.addEventListener("click", (event) => {
  if (event.target.closest("#clear-selection")) office.select(null);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") office.select(null);
  if (event.key === "0" && !event.target.closest("button, input, textarea, select")) {
    office.resetCamera();
  }
  if (event.code === "Space" && !event.target.closest("button, input, textarea, select")) {
    event.preventDefault();
    els.pause.click();
  }
});

window.addEventListener("online", () => {
  if (state.connection !== "live") refresh();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.connection !== "live") refresh();
});

if (office.warnings.length) {
  console.warn("[Agent HQ] map warnings:", office.warnings);
}
window.__agentHq = { office, state, CREW_FILTERS, refresh };
els.footerUrl.textContent = location.host;
if (els.zoomLabel) els.zoomLabel.textContent = "100%";
renderLegend();
renderConnection();
renderMode();
renderPause();
renderSound();
refresh();
