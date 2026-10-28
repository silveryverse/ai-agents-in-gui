import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer } from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ActivityItem,
  Agent,
  AgentProvenance,
  LastOutcome,
  LifecyclePhase,
  PublicState,
  Room,
} from "./model.js";
import {
  defaultDatabasePath,
  openPersistence,
  type Persistence,
} from "./persistence.js";
import {
  sanitizeDetail,
  sanitizeName,
  sanitizeToken,
  validIdentifier,
} from "./sanitize.js";
import {
  DEFAULT_PROVIDER,
  getProviderAdapter,
  listProviders,
  OPENCODE_PROVIDER,
  type CanonicalEvent,
  type CanonicalEventType,
  type ProviderAdapter,
} from "./providers/index.js";
import {
  isCanonicalEventType,
  normalizeProviderId,
  providerDisplayName,
  providerFrom,
  type ProviderId,
} from "./providers/types.js";

const configuredPort = Number(process.env.AGENT_OFFICE_PORT ?? 4318);
const PORT =
  Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65_536
    ? configuredPort
    : 4318;
const HOST = "127.0.0.1";
const PUBLIC_DIR = path.join(process.cwd(), "public");
const DEMO_MODE = process.env.AGENT_OFFICE_DEMO === "1";
const MODE: AgentProvenance = DEMO_MODE ? "demo" : "live";

const EVENT_DEDUPE_MS = 10_000;
const ACTIVITY_LIMIT = 100;

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(express.json({ limit: "32kb", strict: true }));
app.use(
  express.static(PUBLIC_DIR, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  }),
);

const server = createServer(app);
const wss = new WebSocketServer({ server });

const databasePath = defaultDatabasePath(MODE);
const persistence: Persistence = openPersistence({
  dbPath: databasePath,
  source: MODE,
});
const restored = persistence.load();
const agents = new Map<string, Agent>(
  restored.agents.map((agent) => [agentMapKey(agent.source, agent.provider, agent.id), agent]),
);
const activity: ActivityItem[] = restored.activity;

function agentMapKey(
  source: AgentProvenance,
  provider: ProviderId,
  id: string,
): string {
  return `${source}\u0000${provider}\u0000${id}`;
}

function agentKey(agent: Agent): string {
  return agentMapKey(agent.source, agent.provider, agent.id);
}

function seenEventKey(provider: ProviderId, key: string): string {
  return `${provider}\u0000${key}`;
}

function providerAgentName(provider: ProviderId): string {
  return `${providerDisplayName(provider)} Agent`;
}
const startedAt = Date.now();

persistence.cleanup();

// The plugin is loaded once per OpenCode location, so the same public event can
// arrive several times. Event IDs make the bridge idempotent within a process;
// the SQLite `seen_events` table extends that guarantee across restarts.
const seenEvents = new Map<string, number>();

// Stable, distinct character colors. The index starts from a hash of the
// session ID and probes for a free color, so identities survive reconnects and
// bridge restarts. Historical sessions reserve their colors too.
const AGENT_COLORS = [
  "#f97316",
  "#22d3ee",
  "#a78bfa",
  "#f472b6",
  "#4ade80",
  "#facc15",
  "#fb7185",
  "#60a5fa",
  "#c084fc",
  "#34d399",
  "#e879f9",
  "#2dd4bf",
  "#f87171",
  "#84cc16",
];

function hashId(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

function colorIdentity(provider: ProviderId, id: string): string {
  // Preserve the colors of existing OpenCode history while keeping identities
  // from different providers distinct when their session IDs collide.
  return provider === OPENCODE_PROVIDER ? id : `${provider}:${id}`;
}

function pickColor(provider: ProviderId, id: string): string {
  const used = [...agents.values()].map((agent) => agent.color);
  const start = hashId(colorIdentity(provider, id)) % AGENT_COLORS.length;
  for (const minimumDistance of [110, 70, 1]) {
    for (let i = 0; i < AGENT_COLORS.length; i += 1) {
      const color = AGENT_COLORS[(start + i) % AGENT_COLORS.length];
      if (used.includes(color)) continue;
      if (used.every((other) => colorDistance(color, other) >= minimumDistance)) return color;
    }
  }
  return AGENT_COLORS[start];
}

function idleRoom(provider: ProviderId, id: string): Room {
  return hashId(colorIdentity(provider, id)) % 3 === 0 ? "kitchen" : "lounge";
}

function broadcast(data: unknown) {
  const message = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(message);
    } catch {
      /* A client can close between the state check and the write. */
    }
  }
}

function publicState(): PublicState {
  return {
    agents: [...agents.values()],
    activity,
    mode: MODE,
  };
}

/**
 * Map a tool name (plus a short description) to an approximate office room.
 * This is intentionally heuristic; it is presentation only.
 */
function roomFor(tool: string, description: string): Room {
  const name = tool.toLowerCase();
  const text = `${name} ${description}`.toLowerCase();

  if (/websearch|webfetch|fetch|browse|docs|grep|glob|find|search|read/.test(name)) {
    return "research";
  }
  if (/task|todo|plan|spec|subagent/.test(name)) {
    return "planning";
  }

  if (name === "shell" || name === "bash") {
    const command = description.toLowerCase();
    const deployCommand =
      /\b(deploy|release|publish|kubectl|terraform|vercel|netlify|flyctl|heroku|docker\s+push|git\s+push)\b/.test(
        command,
      );
    if (deployCommand) return "deployment";

    const testCommand =
      /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck)\b/.test(command) ||
      /\b(vitest|jest|pytest|playwright|cypress|cargo\s+test|go\s+test|dotnet\s+test)\b/.test(command);
    return testCommand ? "testing" : "coding";
  }

  if (/\b(deploy|release|publish)\b/.test(text)) {
    return "deployment";
  }
  if (/test|vitest|jest|playwright|pytest|build|lint|typecheck|tsc/.test(text)) {
    return "testing";
  }
  return "coding";
}

/**
 * Apply a provider-neutral event to one session. Every branch is keyed by the
 * event's own provider-scoped session; there is no shared status cursor, so
 * concurrent sessions cannot overwrite one another.
 */
function updateAgent(agent: Agent, event: CanonicalEvent, now: number): void {
  const tool = event.tool ?? "";
  const description = event.detail ?? "";
  const detailStatus = event.status ?? "";
  const type: CanonicalEventType = event.type;
  const termination = type === "session.terminated";

  if (agent.status !== "Offline" && agent.status !== "Session closed") {
    // Keep the last live status for the historical inspector. It is replaced
    // with the current status whenever the session comes back online.
    agent.lastStatus = agent.status;
  }

  agent.updatedAt = now;
  agent.lastSeenAt = now;
  agent.eventType = event.rawType;
  agent.canonicalEventType = type;
  if (tool) agent.tool = tool;
  if (description) agent.detail = description;
  if (event.parentSessionId) agent.parentID = event.parentSessionId;
  if (event.agent) agent.agent = event.agent;

  if (!termination) {
    agent.connected = true;
    agent.historical = false;
    if (agent.phase === "terminated" || agent.phase === "offline") {
      agent.phase = "running";
    }
    if (agent.terminatedAt) agent.terminatedAt = undefined;
  }

  if (type === "session.created") {
    agent.status = "Started";
    agent.phase = "running";
    agent.room = "planning";
    agent.lastOutcome = null;
    agent.lastStatus = undefined;
    agent.terminatedAt = undefined;
    return;
  }
  if (type === "session.metadata.updated") {
    return;
  }
  if (termination) {
    agent.status = "Session closed";
    agent.phase = "terminated";
    agent.connected = false;
    agent.historical = true;
    agent.terminatedAt = now;
    agent.lastOutcome = "terminated";
    agent.room = idleRoom(agent.provider, agent.id);
    return;
  }
  if (type === "session.status") {
    if (detailStatus === "busy") {
      agent.status = "Working";
      agent.phase = "running";
    } else if (detailStatus === "idle") {
      agent.status = "Idle";
      agent.phase = "idle";
      agent.room = idleRoom(agent.provider, agent.id);
    } else if (detailStatus === "retry") {
      agent.status = "Retrying";
      agent.phase = "running";
    } else if (detailStatus === "error") {
      agent.status = "Error";
      agent.phase = "failed";
      agent.lastOutcome = "failed";
    } else {
      agent.status = "Working";
      agent.phase = "running";
    }
    return;
  }
  if (type === "session.idle") {
    agent.status = "Idle";
    agent.phase = "idle";
    agent.room = idleRoom(agent.provider, agent.id);
    return;
  }

  if (type === "session.execution.started") {
    agent.status = "Working";
    agent.phase = "running";
    agent.room = "coding";
    return;
  }
  if (type === "session.execution.succeeded") {
    agent.status = "Completed";
    agent.phase = "idle";
    agent.lastOutcome = "completed";
    agent.room = idleRoom(agent.provider, agent.id);
    return;
  }
  if (type === "session.turn.completed") {
    // Claude Code's Stop event means the assistant finished its turn. It is
    // not evidence that the underlying task succeeded, so a previously
    // observed failure is retained as the last outcome.
    agent.status = "Completed";
    agent.phase = "idle";
    if (agent.lastOutcome !== "failed") agent.lastOutcome = "completed";
    agent.room = idleRoom(agent.provider, agent.id);
    return;
  }
  if (type === "session.interrupted") {
    agent.status = "Interrupted";
    agent.phase = "interrupted";
    agent.lastOutcome = "interrupted";
    agent.room = idleRoom(agent.provider, agent.id);
    return;
  }
  if (type === "session.execution.failed") {
    agent.status = "Error";
    agent.phase = "failed";
    agent.lastOutcome = "failed";
    return;
  }
  if (type === "session.retry.scheduled") {
    agent.status = "Retrying";
    agent.phase = "running";
    return;
  }
  if (type === "session.compaction.started") {
    agent.status = "Compacting";
    agent.phase = "running";
    return;
  }
  if (type === "session.compaction.ended") {
    agent.status = "Working";
    agent.phase = "running";
    return;
  }
  if (type === "session.compaction.failed") {
    agent.status = "Error";
    agent.phase = "failed";
    agent.lastOutcome = "failed";
    return;
  }
  if (type === "session.error") {
    agent.status = "Error";
    agent.phase = "failed";
    agent.lastOutcome = "failed";
    return;
  }

  if (type === "session.tool.started") {
    agent.phase = "running";
    if (tool === "execute") {
      agent.status = "Working";
      return;
    }
    agent.status = tool ? `Using ${tool}` : "Working";
    agent.room = roomFor(tool, description);
    return;
  }
  if (type === "session.tool.progress") {
    agent.phase = "running";
    return;
  }
  if (type === "session.tool.success") {
    agent.status = "Tool finished";
    agent.phase = "running";
    return;
  }
  if (type === "session.tool.failed") {
    agent.status = tool ? `${tool} failed` : "Tool failed";
    agent.phase = "failed";
    agent.lastOutcome = "failed";
    return;
  }
  if (type === "session.skill.activated") {
    agent.status = "Using skill";
    agent.phase = "running";
    return;
  }
  if (type === "file.edited") {
    agent.status = "Editing files";
    agent.phase = "running";
    agent.room = "coding";
    return;
  }

  if (type === "session.event") {
    if (event.rawType.includes("failed") || event.rawType.includes("error")) {
      agent.status = "Error";
      agent.phase = "failed";
      agent.lastOutcome = "failed";
    }
  }
}

/**
 * Provider adapters return loosely-typed fields. The server owns the final
 * validation and redaction boundary so every provider gets the same rules.
 */
function normalizeCanonicalEvent(
  event: CanonicalEvent | null,
  provider: ProviderId,
): CanonicalEvent | null {
  if (!event) return null;
  if (normalizeProviderId(event.provider) !== provider) return null;

  const sessionId = validIdentifier(event.sessionId);
  if (!sessionId) return null;
  const rawType = validIdentifier(event.rawType, 100);
  if (!rawType) return null;
  const type = isCanonicalEventType(event.type) ? event.type : "session.event";

  return {
    provider,
    type,
    rawType,
    sessionId,
    parentSessionId: validIdentifier(event.parentSessionId) ?? undefined,
    name: sanitizeName(event.name, 60) || undefined,
    agent: sanitizeToken(event.agent, 60) || undefined,
    tool: sanitizeToken(event.tool, 60) || undefined,
    detail: sanitizeDetail(event.detail, 160) || undefined,
    status: sanitizeToken(event.status, 40) || undefined,
    eventId: validIdentifier(event.eventId) ?? undefined,
  };
}

app.get("/api/state", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(publicState());
});

app.get("/health", (_req, res) => {
  const all = [...agents.values()];
  const connectedAgents = all.filter((agent) => agent.connected).length;
  const providers = Object.fromEntries(
    listProviders().map((adapter) => {
      const owned = all.filter((agent) => agent.provider === adapter.id);
      return [
        adapter.id,
        {
          displayName: adapter.displayName,
          agents: owned.length,
          connectedAgents: owned.filter((agent) => agent.connected).length,
        },
      ];
    }),
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    mode: MODE,
    agents: all.length,
    connectedAgents,
    historicalAgents: all.length - connectedAgents,
    liveAgents: all.filter((agent) => agent.source === "live").length,
    demoAgents: all.filter((agent) => agent.source === "demo").length,
    providers,
    clients: wss.clients.size,
    uptime: Math.round((Date.now() - startedAt) / 1000),
    persistence: persistence.status.mode,
    databaseOk: persistence.status.ok,
  });
});

type IngestResult = {
  status: number;
  body: Record<string, unknown>;
};

function ingestEvent(adapter: ProviderAdapter, body: unknown): IngestResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: 400, body: { ok: false, error: "JSON object body required" } };
  }
  const payload = body as Record<string, unknown>;
  const declaredProvider = payload.provider;
  if (
    declaredProvider !== undefined &&
    providerFrom(declaredProvider) !== adapter.id
  ) {
    return {
      status: 400,
      body: {
        ok: false,
        error: `payload provider does not match ${adapter.id}`,
      },
    };
  }

  const parsed = normalizeCanonicalEvent(adapter.parse(payload), adapter.id);
  if (!parsed) {
    return {
      status: 400,
      body: {
        ok: false,
        error: `${adapter.displayName} event must include a valid session identifier and event type`,
      },
    };
  }

  // Provenance is explicit and comes only from the top-level demo flag. Real
  // provider traffic never sends it, so normal traffic is always live.
  const source: AgentProvenance = payload.demo === true ? "demo" : "live";
  if (source === "demo" && !DEMO_MODE) {
    return {
      status: 403,
      body: {
        ok: false,
        error: "Demo events are disabled. Start the bridge with AGENT_OFFICE_DEMO=1.",
      },
    };
  }
  if (source === "live" && DEMO_MODE) {
    return {
      status: 403,
      body: { ok: false, error: "Live events are disabled in demo mode." },
    };
  }

  const { provider, sessionId, rawType, eventId } = parsed;
  const key = agentMapKey(source, provider, sessionId);
  const now = Date.now();

  if (eventId) {
    // Keep OpenCode's existing dedupe key shape so a restart does not replay
    // recent events. Other providers are namespaced; the SQLite primary key is
    // provider-scoped as a second line of defence.
    const dedupeKey =
      provider === OPENCODE_PROVIDER
        ? JSON.stringify([eventId, rawType])
        : JSON.stringify([provider, eventId, rawType]);
    const seenKey = seenEventKey(provider, dedupeKey);
    const seenAt = seenEvents.get(seenKey);
    if (
      (seenAt !== undefined && now - seenAt < EVENT_DEDUPE_MS) ||
      persistence.hasSeenEvent(source, provider, dedupeKey, now)
    ) {
      return { status: 200, body: { ok: true, provider, duplicate: true } };
    }
    seenEvents.set(seenKey, now);
    persistence.markEventSeen(source, provider, dedupeKey, now);
    if (seenEvents.size > 2_000) {
      const cutoff = now - 30_000;
      for (const [entry, at] of seenEvents) {
        if (at < cutoff) seenEvents.delete(entry);
      }
    }
  }

  let agent = agents.get(key);
  if (!agent) {
    agent = {
      id: sessionId,
      provider,
      name: parsed.name || providerAgentName(provider),
      status: "Working",
      phase: "running",
      room: "coding",
      x: 0.5,
      y: 0.5,
      color: pickColor(provider, sessionId),
      source,
      connected: true,
      historical: false,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    agents.set(key, agent);
  }

  if (parsed.name && parsed.name !== agent.name) {
    agent.name = parsed.name;
  } else if (
    !parsed.name &&
    parsed.type === "session.metadata.updated" &&
    parsed.detail
  ) {
    agent.name = parsed.detail;
  }

  updateAgent(agent, parsed, now);

  const item: ActivityItem = {
    time: new Date(now).toLocaleTimeString(),
    at: now,
    provider,
    sessionId,
    name: agent.name,
    type: rawType,
    canonicalType: parsed.type,
    detail: parsed.detail || parsed.tool || rawType,
    room: agent.room,
    color: agent.color,
    phase: agent.phase,
    source: agent.source,
  };

  let duplicateActivity = false;
  for (const earlier of activity) {
    if (item.at - earlier.at >= 1_500) break;
    if (
      earlier.provider === provider &&
      earlier.sessionId === sessionId &&
      earlier.type === rawType &&
      earlier.detail === item.detail
    ) {
      duplicateActivity = true;
      break;
    }
  }

  if (!duplicateActivity) {
    activity.unshift(item);
    if (activity.length > ACTIVITY_LIMIT) activity.splice(ACTIVITY_LIMIT);
  }

  // Persist the agent even when an identical-looking activity line was folded
  // into a recent one. Status changes still need to survive a restart.
  persistence.record(agent, duplicateActivity ? null : item);
  broadcast({ type: "update", ...publicState() });

  return {
    status: 200,
    body: {
      ok: true,
      provider,
      persisted: persistence.status.ok,
      ...(duplicateActivity ? { deduped: true } : {}),
    },
  };
}

app.post("/events", (req, res) => {
  const adapter = getProviderAdapter(DEFAULT_PROVIDER);
  if (!adapter) {
    return res.status(500).json({ ok: false, error: "OpenCode adapter unavailable" });
  }
  const result = ingestEvent(adapter, req.body);
  return res.status(result.status).json(result.body);
});

app.post("/events/:provider", (req, res) => {
  const adapter = getProviderAdapter(req.params.provider);
  if (!adapter) {
    return res.status(404).json({
      ok: false,
      error: `Unknown provider: ${String(req.params.provider).slice(0, 65)}`,
    });
  }
  const result = ingestEvent(adapter, req.body);
  return res.status(result.status).json(result.body);
});

app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const typed = error as { type?: string; status?: number; message?: string };
  if (typed?.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "Payload too large (32 KB maximum)" });
  }
  if (error instanceof SyntaxError) {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }
  console.error(
    `[agent-office] request failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  return res.status(500).json({ ok: false, error: "Internal server error" });
});

type LiveSocket = WebSocket & { isAlive?: boolean };

wss.on("connection", (socket) => {
  const live = socket as LiveSocket;
  live.isAlive = true;
  live.on("pong", () => {
    live.isAlive = true;
  });
  live.on("error", () => {
    /* A browser disconnect must never crash the bridge. */
  });
  try {
    live.send(JSON.stringify({ type: "update", ...publicState() }));
  } catch {
    /* The socket may have closed immediately. */
  }
});

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const live = client as LiveSocket;
    if (live.isAlive === false) {
      live.terminate();
      continue;
    }
    live.isAlive = false;
    try {
      live.ping();
    } catch {
      /* The socket closed during the heartbeat. */
    }
  }
}, 30_000);
heartbeat.unref();

server.on("error", (error) => {
  console.error(
    `[agent-office] server error: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[agent-office] ${signal}; closing bridge`);
  clearInterval(heartbeat);
  for (const client of wss.clients) {
    try {
      client.terminate();
    } catch {
      /* Already closed. */
    }
  }
  wss.close();
  server.close(() => {
    persistence.close();
    process.exit(0);
  });
  setTimeout(() => {
    persistence.close();
    process.exit(0);
  }, 2_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(PORT, HOST, () => {
  const persistenceLabel = persistence.status.ok
    ? `sqlite (${databasePath})`
    : "memory only (SQLite unavailable)";
  console.log(`Agent Office: http://${HOST}:${PORT}`);
  console.log(`Agent Office persistence: ${persistenceLabel}`);
  if (restored.agents.length || restored.activity.length) {
    console.log(
      `Agent Office restored ${restored.agents.length} historical session(s) and ${restored.activity.length} activity item(s)`,
    );
  }
});
