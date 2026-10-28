import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ActivityItem,
  Agent,
  AgentProvenance,
  LastOutcome,
  LifecyclePhase,
  Room,
} from "./model.js";
import {
  DEFAULT_PROVIDER,
  normalizeProviderId,
  providerDisplayName,
  type ProviderId,
} from "./providers/types.js";

const PUBLIC_ACTIVITY_LIMIT = 100;
const ACTIVITY_RETENTION_ROWS = 500;
const SESSION_RETENTION_ROWS = 100;
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SEEN_EVENT_RETENTION_MS = 60 * 60 * 1000;
const SEEN_EVENT_RETENTION_ROWS = 10_000;
const CLEANUP_EVERY_WRITES = 100;

const ROOMS = new Set<Room>([
  "research",
  "planning",
  "coding",
  "testing",
  "deployment",
  "kitchen",
  "lounge",
]);

const PHASES = new Set<LifecyclePhase>([
  "running",
  "idle",
  "failed",
  "interrupted",
  "terminated",
  "offline",
]);

const OUTCOMES = new Set<Exclude<LastOutcome, null>>([
  "completed",
  "failed",
  "interrupted",
  "terminated",
]);

export type PersistenceStatus = {
  mode: "sqlite" | "memory";
  ok: boolean;
  error?: string;
};

export type Persistence = {
  readonly status: PersistenceStatus;
  load(): { agents: Agent[]; activity: ActivityItem[] };
  hasSeenEvent(
    source: AgentProvenance,
    provider: ProviderId,
    key: string,
    now: number,
  ): boolean;
  markEventSeen(
    source: AgentProvenance,
    provider: ProviderId,
    key: string,
    now: number,
  ): void;
  record(agent: Agent, item: ActivityItem | null): void;
  cleanup(): void;
  close(): void;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function roomValue(value: unknown): Room {
  return ROOMS.has(value as Room) ? (value as Room) : "coding";
}

function phaseValue(value: unknown): LifecyclePhase {
  return PHASES.has(value as LifecyclePhase) ? (value as LifecyclePhase) : "offline";
}

function outcomeValue(value: unknown): LastOutcome {
  return OUTCOMES.has(value as Exclude<LastOutcome, null>)
    ? (value as Exclude<LastOutcome, null>)
    : null;
}

function rowToAgent(row: Record<string, unknown>): Agent | null {
  const id = stringValue(row.id);
  const source = stringValue(row.source);
  if (!id || (source !== "live" && source !== "demo")) return null;
  const provider = normalizeProviderId(row.provider);

  const storedPhase = phaseValue(row.phase);
  const terminated = storedPhase === "terminated" || Boolean(numberValue(row.terminated_at));
  const phase: LifecyclePhase = terminated ? "terminated" : "offline";
  const storedStatus = stringValue(row.status);
  const storedLastStatus = stringValue(row.last_status);
  const wasOffline = storedPhase === "offline" || storedStatus === "Offline";
  const lastStatus = terminated
    ? storedLastStatus ||
      (storedStatus && storedStatus !== "Session closed" ? storedStatus : undefined)
    : wasOffline
      ? storedLastStatus || undefined
      : storedStatus || undefined;
  const lastOutcome = terminated ? "terminated" : outcomeValue(row.last_outcome);

  return {
    id,
    provider,
    name: stringValue(row.name) || `${providerDisplayName(provider)} Agent`,
    status: terminated ? "Session closed" : "Offline",
    phase,
    room: roomValue(row.room),
    x: 0.5,
    y: 0.5,
    parentID: optionalString(row.parent_id),
    tool: optionalString(row.tool),
    detail: optionalString(row.detail),
    eventType: optionalString(row.event_type),
    canonicalEventType: optionalString(row.canonical_event_type) as
      | Agent["canonicalEventType"]
      | undefined,
    agent: optionalString(row.agent),
    color: stringValue(row.color) || "#94a3b8",
    source,
    connected: false,
    historical: true,
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
    lastSeenAt: numberValue(row.last_seen_at, numberValue(row.updated_at)),
    lastStatus,
    lastOutcome,
    terminatedAt: numberValue(row.terminated_at) || undefined,
  };
}

function rowToActivity(row: Record<string, unknown>): ActivityItem | null {
  const source = stringValue(row.source);
  const sessionId = stringValue(row.session_id);
  if (!sessionId || (source !== "live" && source !== "demo")) return null;
  const provider = normalizeProviderId(row.provider);
  const room = ROOMS.has(row.room as Room) ? (row.room as Room) : undefined;
  const phase = PHASES.has(row.phase as LifecyclePhase)
    ? (row.phase as LifecyclePhase)
    : undefined;
  return {
    time: stringValue(row.time),
    at: numberValue(row.at),
    provider,
    sessionId,
    name: stringValue(row.name) || `${providerDisplayName(provider)} Agent`,
    type: stringValue(row.type) || "session.event",
    canonicalType: optionalString(row.canonical_type) as
      | ActivityItem["canonicalType"]
      | undefined,
    detail: stringValue(row.detail),
    room,
    color: optionalString(row.color),
    phase,
    source,
  };
}

function openFailure(message: string): Persistence {
  return {
    status: { mode: "memory", ok: false, error: message },
    load: () => ({ agents: [], activity: [] }),
    hasSeenEvent: () => false,
    markEventSeen: () => {},
    record: () => {},
    cleanup: () => {},
    close: () => {},
  };
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function tableColumns(db: DatabaseSync, name: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{
    name?: unknown;
  }>;
  return new Set(
    rows
      .map((row) => (typeof row.name === "string" ? row.name : ""))
      .filter(Boolean),
  );
}

function createV2Tables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      agent TEXT,
      color TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      last_status TEXT,
      last_outcome TEXT,
      room TEXT NOT NULL,
      parent_id TEXT,
      tool TEXT,
      detail TEXT,
      event_type TEXT,
      canonical_event_type TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      connected INTEGER NOT NULL,
      terminated_at INTEGER,
      PRIMARY KEY (source, provider, id)
    );

    CREATE TABLE IF NOT EXISTS activity (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      canonical_type TEXT,
      detail TEXT NOT NULL,
      room TEXT,
      color TEXT,
      phase TEXT,
      at INTEGER NOT NULL,
      time TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seen_events (
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      key TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (source, provider, key)
    );
  `);
}

function createIndexes(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS sessions_recent
      ON sessions (source, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS activity_recent
      ON activity (source, at DESC, seq DESC);
    CREATE INDEX IF NOT EXISTS seen_events_recent
      ON seen_events (source, seen_at DESC);
  `);
}

/**
 * Upgrade the original OpenCode-only schema in place. Existing rows become
 * `provider = 'opencode'`, preserving their IDs, colors, parent links, and
 * activity history. The composite primary key is what keeps two providers with
 * the same session ID from overwriting each other.
 */
function migrateV1ToV2(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const sessionColumns = tableColumns(db, "sessions");
    db.exec("DROP TABLE IF EXISTS sessions_migrated;");
    db.exec(`
      CREATE TABLE sessions_migrated (
        source TEXT NOT NULL,
        provider TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        agent TEXT,
        color TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        last_status TEXT,
        last_outcome TEXT,
        room TEXT NOT NULL,
        parent_id TEXT,
        tool TEXT,
        detail TEXT,
        event_type TEXT,
        canonical_event_type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        connected INTEGER NOT NULL,
        terminated_at INTEGER,
        PRIMARY KEY (source, provider, id)
      );
    `);
    const providerExpression = sessionColumns.has("provider") ? "provider" : "'opencode'";
    const canonicalExpression = sessionColumns.has("canonical_event_type")
      ? "canonical_event_type"
      : "NULL";
    db.exec(`
      INSERT INTO sessions_migrated (
        source, provider, id, name, agent, color, status, phase, last_status,
        last_outcome, room, parent_id, tool, detail, event_type,
        canonical_event_type, created_at, updated_at, last_seen_at, connected,
        terminated_at
      )
      SELECT
        source, ${providerExpression}, id, name, agent, color, status, phase,
        last_status, last_outcome, room, parent_id, tool, detail, event_type,
        ${canonicalExpression}, created_at, updated_at, last_seen_at, connected,
        terminated_at
      FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_migrated RENAME TO sessions;
    `);

    if (tableExists(db, "activity")) {
      const activityColumns = tableColumns(db, "activity");
      if (!activityColumns.has("provider")) {
        db.exec(
          "ALTER TABLE activity ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode';",
        );
      }
      if (!activityColumns.has("canonical_type")) {
        db.exec("ALTER TABLE activity ADD COLUMN canonical_type TEXT;");
      }
    } else {
      createV2Tables(db);
    }

    if (tableExists(db, "seen_events")) {
      const seenColumns = tableColumns(db, "seen_events");
      if (!seenColumns.has("provider")) {
        db.exec(`
          DROP TABLE IF EXISTS seen_events_migrated;
          CREATE TABLE seen_events_migrated (
            source TEXT NOT NULL,
            provider TEXT NOT NULL,
            key TEXT NOT NULL,
            seen_at INTEGER NOT NULL,
            PRIMARY KEY (source, provider, key)
          );
          INSERT INTO seen_events_migrated (source, provider, key, seen_at)
            SELECT source, 'opencode', key, seen_at FROM seen_events;
          DROP TABLE seen_events;
          ALTER TABLE seen_events_migrated RENAME TO seen_events;
        `);
      }
    } else {
      createV2Tables(db);
    }

    createIndexes(db);
    db.exec("PRAGMA user_version = 2;");
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      /* The transaction may not have started. */
    }
    throw error;
  }
}

function ensureSchema(db: DatabaseSync): void {
  if (!tableExists(db, "sessions")) {
    db.exec("BEGIN IMMEDIATE;");
    try {
      createV2Tables(db);
      // A partial old database can have activity/seen_events without sessions.
      // `CREATE TABLE IF NOT EXISTS` leaves those old shapes alone, so upgrade
      // their columns and provider-scoped identity explicitly.
      const activityColumns = tableExists(db, "activity")
        ? tableColumns(db, "activity")
        : new Set<string>();
      if (activityColumns.size && !activityColumns.has("provider")) {
        db.exec(
          "ALTER TABLE activity ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode';",
        );
      }
      if (activityColumns.size && !activityColumns.has("canonical_type")) {
        db.exec("ALTER TABLE activity ADD COLUMN canonical_type TEXT;");
      }
      const seenColumns = tableExists(db, "seen_events")
        ? tableColumns(db, "seen_events")
        : new Set<string>();
      if (seenColumns.size && !seenColumns.has("provider")) {
        db.exec(`
          DROP TABLE IF EXISTS seen_events_migrated;
          CREATE TABLE seen_events_migrated (
            source TEXT NOT NULL,
            provider TEXT NOT NULL,
            key TEXT NOT NULL,
            seen_at INTEGER NOT NULL,
            PRIMARY KEY (source, provider, key)
          );
          INSERT INTO seen_events_migrated (source, provider, key, seen_at)
            SELECT source, 'opencode', key, seen_at FROM seen_events;
          DROP TABLE seen_events;
          ALTER TABLE seen_events_migrated RENAME TO seen_events;
        `);
      }
      createIndexes(db);
      db.exec("PRAGMA user_version = 2;");
      db.exec("COMMIT;");
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        /* The transaction may not have started. */
      }
      throw error;
    }
    return;
  }

  const versionRow = db.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  const version = numberValue(versionRow?.user_version);
  const sessionColumns = tableColumns(db, "sessions");
  if (
    version < 2 ||
    !sessionColumns.has("provider") ||
    !sessionColumns.has("canonical_event_type")
  ) {
    migrateV1ToV2(db);
  } else {
    createV2Tables(db);
    const activityColumns = tableExists(db, "activity")
      ? tableColumns(db, "activity")
      : new Set<string>();
    if (activityColumns.size && !activityColumns.has("provider")) {
      db.exec(
        "ALTER TABLE activity ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode';",
      );
    }
    if (activityColumns.size && !activityColumns.has("canonical_type")) {
      db.exec("ALTER TABLE activity ADD COLUMN canonical_type TEXT;");
    }
    const seenColumns = tableExists(db, "seen_events")
      ? tableColumns(db, "seen_events")
      : new Set<string>();
    if (seenColumns.size && !seenColumns.has("provider")) {
      migrateV1ToV2(db);
      return;
    }
    createIndexes(db);
  }
}

/**
 * Open the SQLite archive. A database failure must never take the live bridge
 * down: in that case the returned persistence object is a no-op and the server
 * continues with its in-memory state.
 */
export function openPersistence(options: {
  dbPath: string;
  source: AgentProvenance;
}): Persistence {
  const { dbPath, source } = options;
  let opened: DatabaseSync | null = null;
  try {
    if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
    opened = new DatabaseSync(dbPath);
    opened.exec("PRAGMA journal_mode = WAL;");
    opened.exec("PRAGMA synchronous = NORMAL;");
    opened.exec("PRAGMA busy_timeout = 2000;");
    ensureSchema(opened);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      opened?.close();
    } catch {
      /* The connection may not have opened. */
    }
    console.error(`[agent-office] SQLite unavailable (${dbPath}): ${message}`);
    return openFailure(message);
  }

  if (!opened) return openFailure("SQLite did not open");
  const db = opened;
  const status: PersistenceStatus = { mode: "sqlite", ok: true };
  let writesSinceCleanup = 0;
  let closed = false;

  const saveAgentStatement = db.prepare(`
    INSERT INTO sessions (
      source, provider, id, name, agent, color, status, phase, last_status,
      last_outcome, room, parent_id, tool, detail, event_type,
      canonical_event_type, created_at, updated_at, last_seen_at, connected,
      terminated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, provider, id) DO UPDATE SET
      name = excluded.name,
      agent = excluded.agent,
      color = excluded.color,
      status = excluded.status,
      phase = excluded.phase,
      last_status = excluded.last_status,
      last_outcome = excluded.last_outcome,
      room = excluded.room,
      parent_id = excluded.parent_id,
      tool = excluded.tool,
      detail = excluded.detail,
      event_type = excluded.event_type,
      canonical_event_type = excluded.canonical_event_type,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at,
      connected = excluded.connected,
      terminated_at = excluded.terminated_at
  `);

  const saveActivityStatement = db.prepare(`
    INSERT INTO activity (
      source, provider, session_id, name, type, canonical_type, detail, room,
      color, phase, at, time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seenEventStatement = db.prepare(`
    SELECT seen_at FROM seen_events
    WHERE source = ? AND provider = ? AND key = ?
  `);

  const markSeenStatement = db.prepare(`
    INSERT INTO seen_events (source, provider, key, seen_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(source, provider, key) DO UPDATE SET seen_at = excluded.seen_at
  `);

  function markFailure(error: unknown) {
    if (!status.ok) return;
    status.ok = false;
    status.error = error instanceof Error ? error.message : String(error);
    console.error(`[agent-office] SQLite write failed: ${status.error}`);
  }

  function saveAgent(agent: Agent) {
    saveAgentStatement.run(
      agent.source,
      agent.provider,
      agent.id,
      agent.name,
      agent.agent ?? null,
      agent.color,
      agent.status,
      agent.phase,
      agent.lastStatus ?? null,
      agent.lastOutcome ?? null,
      agent.room,
      agent.parentID ?? null,
      agent.tool ?? null,
      agent.detail ?? null,
      agent.eventType ?? null,
      agent.canonicalEventType ?? null,
      agent.createdAt,
      agent.updatedAt,
      agent.lastSeenAt,
      agent.connected ? 1 : 0,
      agent.terminatedAt ?? null,
    );
  }

  function cleanup() {
    if (!status.ok || closed) return;
    const now = Date.now();
    const cutoff = now - HISTORY_RETENTION_MS;
    try {
      db.exec("BEGIN IMMEDIATE;");
      db.prepare("DELETE FROM activity WHERE source = ? AND at < ?").run(source, cutoff);
      db.prepare(`
        DELETE FROM activity
        WHERE source = ?
          AND seq NOT IN (
            SELECT seq FROM activity WHERE source = ? ORDER BY at DESC, seq DESC LIMIT ?
          )
      `).run(source, source, ACTIVITY_RETENTION_ROWS);

      db.prepare(`
        DELETE FROM sessions
        WHERE rowid IN (
          SELECT child.rowid FROM sessions AS child
          WHERE child.source = ?
            AND child.connected = 0
            AND child.last_seen_at < ?
            AND NOT EXISTS (
              SELECT 1 FROM sessions AS parent
              WHERE parent.source = child.source
                AND parent.provider = child.provider
                AND parent.id = child.parent_id
            )
        )
      `).run(source, cutoff);
      db.prepare(`
        DELETE FROM sessions
        WHERE rowid IN (
          SELECT child.rowid FROM sessions AS child
          WHERE child.source = ?
            AND child.connected = 0
            AND NOT EXISTS (
              SELECT 1 FROM sessions AS parent
              WHERE parent.source = child.source
                AND parent.provider = child.provider
                AND parent.id = child.parent_id
            )
            AND child.rowid NOT IN (
              SELECT rowid FROM sessions
              WHERE source = ?
              ORDER BY last_seen_at DESC, updated_at DESC
              LIMIT ?
            )
        )
      `).run(source, source, SESSION_RETENTION_ROWS);

      db.prepare("DELETE FROM seen_events WHERE source = ? AND seen_at < ?").run(
        source,
        now - SEEN_EVENT_RETENTION_MS,
      );
      db.prepare(`
        DELETE FROM seen_events
        WHERE source = ?
          AND key NOT IN (
            SELECT key FROM seen_events WHERE source = ? ORDER BY seen_at DESC LIMIT ?
          )
      `).run(source, source, SEEN_EVENT_RETENTION_ROWS);
      db.exec("COMMIT;");
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        /* The transaction may not have started. */
      }
      markFailure(error);
    }
  }

  return {
    status,
    load() {
      try {
        const rows = db
          .prepare(`
            SELECT * FROM sessions
            WHERE source = ?
            ORDER BY last_seen_at DESC, updated_at DESC
            LIMIT ?
          `)
          .all(source, SESSION_RETENTION_ROWS);
        const restored: Agent[] = [];
        for (const row of rows) {
          const agent = rowToAgent(row);
          if (!agent) continue;
          restored.push(agent);
          // The process that wrote this row is gone. Persist the derived
          // offline/terminated state so a second restart cannot resurrect a
          // working status. A read-only/broken archive still yields useful
          // history even if this refresh cannot be written back.
          if (status.ok) {
            try {
              saveAgent(agent);
            } catch (error) {
              markFailure(error);
            }
          }
        }
        const activityRows = db
          .prepare(`
            SELECT * FROM activity
            WHERE source = ?
            ORDER BY at DESC, seq DESC
            LIMIT ?
          `)
          .all(source, PUBLIC_ACTIVITY_LIMIT);
        const activity = activityRows
          .map(rowToActivity)
          .filter((item): item is ActivityItem => item !== null);
        return { agents: restored, activity };
      } catch (error) {
        markFailure(error);
        return { agents: [], activity: [] };
      }
    },
    hasSeenEvent(owner, provider, key, now) {
      if (!status.ok) return false;
      try {
        const row = seenEventStatement.get(owner, provider, key) as
          | Record<string, unknown>
          | undefined;
        if (!row) return false;
        return now - numberValue(row.seen_at) < SEEN_EVENT_RETENTION_MS;
      } catch (error) {
        markFailure(error);
        return false;
      }
    },
    markEventSeen(owner, provider, key, now) {
      if (!status.ok) return;
      try {
        markSeenStatement.run(owner, provider, key, now);
      } catch (error) {
        markFailure(error);
      }
    },
    record(agent, item) {
      if (!status.ok || closed) return;
      try {
        db.exec("BEGIN IMMEDIATE;");
        saveAgent(agent);
        if (item) {
          saveActivityStatement.run(
            item.source,
            item.provider,
            item.sessionId,
            item.name,
            item.type,
            item.canonicalType ?? null,
            item.detail,
            item.room ?? null,
            item.color ?? null,
            item.phase ?? null,
            item.at,
            item.time,
          );
        }
        db.exec("COMMIT;");
        writesSinceCleanup += 1;
        if (writesSinceCleanup >= CLEANUP_EVERY_WRITES) {
          writesSinceCleanup = 0;
          cleanup();
        }
      } catch (error) {
        try {
          db.exec("ROLLBACK;");
        } catch {
          /* The transaction may not have started. */
        }
        markFailure(error);
      }
    },
    cleanup,
    close() {
      if (closed) return;
      closed = true;
      try {
        db.close();
      } catch (error) {
        console.error(
          `[agent-office] SQLite close failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  };
}

export function defaultDatabasePath(source: AgentProvenance): string {
  const configured = process.env.AGENT_OFFICE_DB?.trim();
  if (configured === ":memory:") return ":memory:";
  if (configured) return path.resolve(configured);
  return path.join(
    process.cwd(),
    "data",
    source === "demo" ? "agent-office-demo.sqlite" : "agent-office-live.sqlite",
  );
}
