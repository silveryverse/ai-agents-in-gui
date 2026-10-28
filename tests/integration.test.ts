import test from "node:test";
import assert from "node:assert/strict";
import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net, { type AddressInfo } from "node:net";
import { createServer as createHttpServer } from "node:http";
import type { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import {
  claudeCodeAdapter,
  codexAdapter,
  openCodeAdapter,
} from "../src/providers/index.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");

type RunningServer = {
  base: string;
  port: number;
  child: ChildProcessByStdio<null, Readable, Readable>;
  output: () => string;
  stop: () => Promise<void>;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function startServer(options: {
  dbPath: string;
  mode?: "live" | "demo";
  port?: number;
}): Promise<RunningServer> {
  const port = options.port ?? (await freePort());
  const mode = options.mode ?? "live";
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      AGENT_OFFICE_PORT: String(port),
      AGENT_OFFICE_DB: options.dbPath,
      AGENT_OFFICE_DEMO: mode === "demo" ? "1" : "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (${child.exitCode})\n${log}`);
    }
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) {
        let stopped = false;
        return {
          base,
          port,
          child,
          output: () => log,
          async stop() {
            if (stopped) return;
            stopped = true;
            if (child.exitCode !== null) return;
            const exited = once(child, "exit");
            child.kill();
            await Promise.race([exited, delay(3_000)]);
            if (child.exitCode === null) {
              try {
                child.kill("SIGKILL");
              } catch {
                /* Already gone. */
              }
              await Promise.race([once(child, "exit"), delay(1_000)]);
            }
          },
        };
      }
    } catch {
      /* The listener is not ready yet. */
    }
    await delay(100);
  }
  await new Promise<void>((resolve) => child.kill());
  throw new Error(`server did not become healthy\n${log}`);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  assert.equal(response.status, 200);
  return (await response.json()) as T;
}

async function post(base: string, payload: unknown): Promise<Response> {
  return fetch(`${base}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function postProvider(
  base: string,
  provider: string,
  payload: unknown,
): Promise<Response> {
  return fetch(`${base}/events/${encodeURIComponent(provider)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function runHookProcess(
  command: string,
  args: string[],
  bridgeUrl: string,
  input: string,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(command, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, AGENT_OFFICE_URL: bridgeUrl },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(input);
  const [code] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  return { code, stdout, stderr };
}

async function runShellHookCommand(
  command: string,
  bridgeUrl: string,
  input: string,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(command, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, AGENT_OFFICE_URL: bridgeUrl },
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(input);
  const [code] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  return { code, stdout, stderr };
}

async function runClaudeHookRaw(
  bridgeUrl: string,
  input: string,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return runHookProcess(
    process.execPath,
    [path.join(PROJECT_ROOT, "integrations", "claude-code", "agent-office-hook.mjs")],
    bridgeUrl,
    input,
  );
}

async function runClaudeHook(
  base: string,
  payload: unknown,
  bridgeUrl = base,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return runClaudeHookRaw(bridgeUrl, JSON.stringify(payload));
}

async function runCodexHookRaw(
  bridgeUrl: string,
  input: string,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return runHookProcess(
    process.execPath,
    [path.join(PROJECT_ROOT, "integrations", "codex", "agent-office-hook.mjs")],
    bridgeUrl,
    input,
  );
}

async function runCodexHook(
  base: string,
  payload: unknown,
  bridgeUrl = base,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return runCodexHookRaw(bridgeUrl, JSON.stringify(payload));
}

type HookCapture = {
  path: string;
  body: Record<string, any>;
};

async function startHookCapture(): Promise<{
  base: string;
  wait: () => Promise<HookCapture>;
  close: () => Promise<void>;
}> {
  let resolveCapture!: (value: HookCapture) => void;
  let rejectCapture!: (error: unknown) => void;
  const captured = new Promise<HookCapture>((resolve, reject) => {
    resolveCapture = resolve;
    rejectCapture = reject;
  });
  const server = createHttpServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolveCapture({
          path: request.url ?? "",
          body: JSON.parse(raw) as Record<string, any>,
        });
      } catch (error) {
        rejectCapture(error);
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      response.end("{}");
    });
  });
  server.on("error", rejectCapture);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    wait: () => captured,
    async close() {
      server.close();
      await Promise.race([once(server, "close"), delay(1_000)]);
    },
  };
}

type OfficeState = {
  mode: "live" | "demo";
  agents: Array<Record<string, any>>;
  activity: Array<Record<string, any>>;
};

type Health = {
  ok: boolean;
  mode: "live" | "demo";
  agents: number;
  connectedAgents: number;
  historicalAgents: number;
  liveAgents: number;
  demoAgents: number;
  clients: number;
  uptime: number;
  persistence: "sqlite" | "memory";
  databaseOk: boolean;
  providers?: Record<
    string,
    { displayName: string; agents: number; connectedAgents: number }
  >;
};

async function openSocket(base: string): Promise<{
  ws: WebSocket;
  snapshot: Record<string, any>;
}> {
  const ws = new WebSocket(base.replace(/^http/, "ws"));
  const firstMessage = new Promise<Record<string, any>>((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(String(data)));
      } catch (error) {
        reject(error);
      }
    });
    ws.once("error", reject);
  });
  await once(ws, "open");
  const snapshot = await firstMessage;
  return { ws, snapshot };
}

function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  const closed = once(ws, "close");
  ws.close();
  return closed.then(() => undefined);
}

async function postMany(base: string, payloads: unknown[]): Promise<void> {
  for (let index = 0; index < payloads.length; index += 25) {
    const batch = payloads.slice(index, index + 25);
    const responses = await Promise.all(batch.map((payload) => post(base, payload)));
    for (const response of responses) assert.equal(response.status, 200);
  }
}

test("Agent HQ integration", { timeout: 180_000 }, async (t) => {
  await t.test("API, validation, lifecycle, concurrency, WebSocket, redaction, limits", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-api-"));
    const dbPath = path.join(dir, "office.sqlite");
    const server = await startServer({ dbPath });
    try {
      const health = await getJson<Health>(`${server.base}/health`);
      assert.equal(health.mode, "live");
      assert.equal(health.persistence, "sqlite");
      assert.equal(health.databaseOk, true);
      assert.equal(health.agents, 0);
      assert.equal(health.connectedAgents, 0);
      assert.equal(health.historicalAgents, 0);

      const { ws, snapshot } = await openSocket(server.base);
      assert.equal(snapshot.type, "update");
      assert.equal(snapshot.mode, "live");
      assert.deepEqual(snapshot.agents, []);

      const parentCreate = {
        type: "session.created",
        sessionId: "ses_parent",
        agentName: "Parent Agent",
        eventId: "evt-parent-created",
        detail: { description: "Parent Agent", agent: "build" },
      };
      let response = await post(server.base, parentCreate);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).persisted, true);

      let state = await getJson<OfficeState>(`${server.base}/api/state`);
      let parent = state.agents.find((agent) => agent.id === "ses_parent");
      assert.ok(parent);
      assert.equal(parent.connected, true);
      assert.equal(parent.historical, false);
      assert.equal(parent.phase, "running");
      assert.equal(parent.status, "Started");
      assert.equal(parent.source, "live");
      assert.match(parent.color, /^#[0-9a-f]{6}$/i);
      const parentColor = parent.color;

      const childCreate = {
        type: "session.created",
        sessionId: "ses_child",
        agentName: "Scout Child",
        eventId: "evt-child-created",
        detail: { description: "Scout Child", agent: "explore", parentID: "ses_parent" },
      };
      assert.equal((await post(server.base, childCreate)).status, 200);
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const child = state.agents.find((agent) => agent.id === "ses_child");
      assert.ok(child);
      assert.equal(child.parentID, "ses_parent");
      assert.notEqual(child.color, parentColor);

      assert.equal(
        (
          await post(server.base, {
            type: "session.tool.called",
            sessionId: "ses_parent",
            agentName: "Parent Agent",
            eventId: "evt-parent-task",
            detail: { tool: "task", description: "subagent" },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await post(server.base, {
            type: "session.tool.called",
            sessionId: "ses_child",
            agentName: "Scout Child",
            eventId: "evt-child-read",
            detail: { tool: "read", description: "src/server.ts" },
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      parent = state.agents.find((agent) => agent.id === "ses_parent");
      assert.equal(parent?.status, "Using task");
      assert.equal(parent?.room, "planning");
      assert.equal(state.agents.find((agent) => agent.id === "ses_child")?.room, "research");

      assert.equal(
        (
          await post(server.base, {
            type: "session.tool.called",
            sessionId: "ses_parent",
            agentName: "Parent Agent",
            eventId: "evt-parent-shell",
            detail: { tool: "shell", description: "npm test" },
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.agents.find((agent) => agent.id === "ses_parent")?.room, "testing");

      assert.equal(
        (
          await post(server.base, {
            type: "session.execution.succeeded",
            sessionId: "ses_child",
            agentName: "Scout Child",
            eventId: "evt-child-success",
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      let childState = state.agents.find((agent) => agent.id === "ses_child");
      assert.equal(childState?.status, "Completed");
      assert.equal(childState?.phase, "idle");
      assert.equal(childState?.lastOutcome, "completed");

      assert.equal(
        (
          await post(server.base, {
            type: "session.idle",
            sessionId: "ses_child",
            agentName: "Scout Child",
            eventId: "evt-child-idle",
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      childState = state.agents.find((agent) => agent.id === "ses_child");
      assert.equal(childState?.status, "Idle");
      assert.equal(childState?.phase, "idle");
      assert.equal(childState?.lastOutcome, "completed");

      // An unrelated top-level session must not overwrite the parent's status.
      assert.equal(
        (
          await post(server.base, {
            type: "session.created",
            sessionId: "ses_other",
            agentName: "Other Top Level",
            eventId: "evt-other-created",
            detail: { description: "Other Top Level" },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await post(server.base, {
            type: "session.execution.failed",
            sessionId: "ses_parent",
            agentName: "Parent Agent",
            eventId: "evt-parent-failed",
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.agents.find((agent) => agent.id === "ses_parent")?.phase, "failed");
      assert.equal(state.agents.find((agent) => agent.id === "ses_other")?.status, "Started");
      assert.equal(state.agents.find((agent) => agent.id === "ses_other")?.phase, "running");

      assert.equal(
        (
          await post(server.base, {
            type: "session.execution.interrupted",
            sessionId: "ses_parent",
            agentName: "Parent Agent",
            eventId: "evt-parent-interrupted",
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.agents.find((agent) => agent.id === "ses_parent")?.status, "Interrupted");
      assert.equal(state.agents.find((agent) => agent.id === "ses_parent")?.phase, "interrupted");

      assert.equal(
        (
          await post(server.base, {
            type: "session.created",
            sessionId: "ses_closed",
            agentName: "Closed Agent",
            eventId: "evt-closed-created",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await post(server.base, {
            type: "session.deleted",
            sessionId: "ses_closed",
            agentName: "Closed Agent",
            eventId: "evt-closed-deleted",
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const closed = state.agents.find((agent) => agent.id === "ses_closed");
      assert.equal(closed?.connected, false);
      assert.equal(closed?.historical, true);
      assert.equal(closed?.phase, "terminated");
      assert.equal(closed?.status, "Session closed");
      assert.equal(closed?.lastStatus, "Started");

      // WebSocket update after a new event.
      const nextUpdate = new Promise<Record<string, any>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket update timed out")), 5_000);
        ws.once("message", (data) => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(String(data)));
          } catch (error) {
            reject(error);
          }
        });
      });
      assert.equal(
        (
          await post(server.base, {
            type: "session.tool.called",
            sessionId: "ses_ws",
            agentName: "Socket Agent",
            eventId: "evt-ws",
            detail: { tool: "grep", description: "find me" },
          })
        ).status,
        200,
      );
      const update = await nextUpdate;
      assert.equal(update.type, "update");
      assert.ok(update.agents.some((agent: Record<string, any>) => agent.id === "ses_ws"));
      await closeSocket(ws);

      // Payload validation and request size limit.
      assert.equal((await post(server.base, {})).status, 400);
      assert.equal(
        (
          await post(server.base, {
            type: "session.created",
            sessionId: "bad id",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await post(server.base, {
            type: "session.created",
            sessionId: "x".repeat(201),
          })
        ).status,
        400,
      );
      const malformed = await fetch(`${server.base}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      assert.equal(malformed.status, 400);
      const oversized = await fetch(`${server.base}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "session.created",
          sessionId: "ses_big",
          padding: "x".repeat(40_000),
        }),
      });
      assert.equal(oversized.status, 413);

      // Provenance cannot be mixed.
      assert.equal(
        (
          await post(server.base, {
            type: "session.created",
            sessionId: "ses_demo_attempt",
            demo: true,
          })
        ).status,
        403,
      );

      // Credentials and environment values are scrubbed before storage.
      assert.equal(
        (
          await post(server.base, {
            type: "session.tool.called",
            sessionId: "ses_secret",
            agentName: "Secret Agent",
            eventId: "evt-secret",
            detail: {
              tool: "shell",
              description:
                "deploy --token=supersecret --password spacedsecret --api-key keysecret password=hunter2 OPENAI_API_KEY=sk-abcdefghijklmnop",
            },
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const secretAgent = state.agents.find((agent) => agent.id === "ses_secret");
      const secretActivity = state.activity.find((item) => item.sessionId === "ses_secret");
      assert.ok(secretAgent);
      for (const text of [secretAgent.detail, secretActivity?.detail]) {
        assert.ok(typeof text === "string");
        assert.doesNotMatch(
          text,
          /supersecret|spacedsecret|keysecret|hunter2|sk-abcdefghijklmnop/,
        );
        assert.match(text, /redacted/i);
      }

      // Activity is bounded at 100 items in the public contract.
      const uploads = Array.from({ length: 520 }, (_, index) => ({
        type: "session.tool.success",
        sessionId: "ses_cap",
        agentName: "Cap Agent",
        eventId: `evt-cap-${index}`,
        detail: { tool: "read", description: `evidence-${index}.txt` },
      }));
      await postMany(server.base, uploads);
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, 100);

      const db = new DatabaseSync(dbPath);
      try {
        const row = db
          .prepare("SELECT COUNT(*) AS count FROM activity WHERE source = 'live'")
          .get() as { count: number };
        assert.ok(row.count <= 550, `activity retention should stay bounded, got ${row.count}`);
      } finally {
        db.close();
      }

      const finalHealth = await getJson<Health>(`${server.base}/health`);
      assert.equal(finalHealth.mode, "live");
      assert.equal(finalHealth.liveAgents, finalHealth.agents);
      assert.equal(finalHealth.demoAgents, 0);
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("SQLite restores history, preserves identity, and separates provenance", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-persist-"));
    const dbPath = path.join(dir, "office.sqlite");
    let server: RunningServer | null = await startServer({ dbPath });
    try {
      const originalEvents = [
        {
          type: "session.created",
          sessionId: "ses_history_parent",
          agentName: "History Parent",
          eventId: "evt-history-parent",
          detail: { description: "History Parent", agent: "build" },
        },
        {
          type: "session.created",
          sessionId: "ses_history_child",
          agentName: "History Child",
          eventId: "evt-history-child",
          detail: {
            description: "History Child",
            agent: "explore",
            parentID: "ses_history_parent",
          },
        },
        {
          type: "session.tool.called",
          sessionId: "ses_history_parent",
          agentName: "History Parent",
          eventId: "evt-history-parent-shell",
          detail: { tool: "shell", description: "npm run typecheck" },
        },
        {
          type: "session.tool.called",
          sessionId: "ses_history_child",
          agentName: "History Child",
          eventId: "evt-history-child-read",
          detail: { tool: "read", description: "src/server.ts" },
        },
        {
          type: "session.created",
          sessionId: "ses_history_child_two",
          agentName: "History Child Two",
          eventId: "evt-history-child-two",
          detail: {
            description: "History Child Two",
            agent: "explore",
            parentID: "ses_history_parent",
          },
        },
        {
          type: "session.tool.called",
          sessionId: "ses_history_child_two",
          agentName: "History Child Two",
          eventId: "evt-history-child-two-read",
          detail: { tool: "read", description: "src/persistence.ts" },
        },
        {
          type: "session.created",
          sessionId: "ses_history_closed",
          agentName: "Closed History",
          eventId: "evt-history-closed-created",
        },
        {
          type: "session.deleted",
          sessionId: "ses_history_closed",
          agentName: "Closed History",
          eventId: "evt-history-closed-deleted",
        },
      ];
      for (const event of originalEvents) {
        assert.equal((await post(server.base, event)).status, 200);
      }
      let state = await getJson<OfficeState>(`${server.base}/api/state`);
      const parent = state.agents.find((agent) => agent.id === "ses_history_parent");
      const child = state.agents.find((agent) => agent.id === "ses_history_child");
      const childTwo = state.agents.find((agent) => agent.id === "ses_history_child_two");
      assert.ok(parent && child && childTwo);
      assert.equal(parent.connected, true);
      assert.equal(child.parentID, "ses_history_parent");
      assert.equal(childTwo.parentID, "ses_history_parent");
      const parentColor = parent.color;
      const childColor = child.color;
      const childTwoColor = childTwo.color;
      const activityCount = state.activity.length;
      assert.ok(activityCount >= 8);

      await server.stop();
      server = null;

      const db = new DatabaseSync(dbPath);
      try {
        const sessions = db
          .prepare("SELECT COUNT(*) AS count FROM sessions WHERE source = 'live'")
          .get() as { count: number };
        assert.equal(sessions.count, 4);
        const events = db
          .prepare("SELECT COUNT(*) AS count FROM activity WHERE source = 'live'")
          .get() as { count: number };
        assert.equal(events.count, activityCount);
      } finally {
        db.close();
      }

      server = await startServer({ dbPath });
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.deepEqual(
        state.agents.map((agent) => agent.id).sort(),
        [
          "ses_history_child",
          "ses_history_child_two",
          "ses_history_closed",
          "ses_history_parent",
        ],
      );
      const restoredParent = state.agents.find((agent) => agent.id === "ses_history_parent");
      const restoredChild = state.agents.find((agent) => agent.id === "ses_history_child");
      const restoredChildTwo = state.agents.find(
        (agent) => agent.id === "ses_history_child_two",
      );
      const restoredClosed = state.agents.find((agent) => agent.id === "ses_history_closed");
      assert.ok(restoredParent && restoredChild && restoredChildTwo && restoredClosed);
      assert.equal(restoredParent.connected, false);
      assert.equal(restoredParent.historical, true);
      assert.equal(restoredParent.phase, "offline");
      assert.equal(restoredParent.status, "Offline");
      assert.equal(restoredParent.lastStatus, "Using shell");
      assert.equal(restoredParent.color, parentColor);
      assert.equal(restoredChild.color, childColor);
      assert.equal(restoredChild.parentID, "ses_history_parent");
      assert.equal(restoredChild.connected, false);
      assert.equal(restoredChild.phase, "offline");
      assert.equal(restoredChildTwo.color, childTwoColor);
      assert.equal(restoredChildTwo.parentID, "ses_history_parent");
      assert.equal(restoredChildTwo.connected, false);
      assert.equal(restoredChildTwo.phase, "offline");
      assert.equal(restoredClosed.connected, false);
      assert.equal(restoredClosed.phase, "terminated");
      assert.equal(restoredClosed.status, "Session closed");
      assert.equal(state.activity.length, activityCount);
      assert.equal(state.mode, "live");

      const restoredHealth = await getJson<Health>(`${server.base}/health`);
      assert.equal(restoredHealth.agents, 4);
      assert.equal(restoredHealth.connectedAgents, 0);
      assert.equal(restoredHealth.historicalAgents, 4);

      const { ws, snapshot } = await openSocket(server.base);
      assert.equal(snapshot.mode, "live");
      assert.equal(snapshot.agents.length, 4);
      assert.deepEqual(
        snapshot.agents.map((agent: Record<string, any>) => agent.id).sort(),
        [
          "ses_history_child",
          "ses_history_child_two",
          "ses_history_closed",
          "ses_history_parent",
        ],
      );
      await closeSocket(ws);

      // A durably replayed event must not append a duplicate activity line or
      // revive an offline session.
      const replay = await post(server.base, originalEvents[2]);
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).duplicate, true);
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, activityCount);
      assert.equal(state.agents.find((agent) => agent.id === "ses_history_parent")?.connected, false);

      // New evidence revives only that session.
      assert.equal(
        (
          await post(server.base, {
            type: "session.tool.called",
            sessionId: "ses_history_parent",
            agentName: "History Parent",
            eventId: "evt-history-parent-revived",
            detail: { tool: "shell", description: "npm test" },
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const revived = state.agents.find((agent) => agent.id === "ses_history_parent");
      assert.equal(revived?.connected, true);
      assert.equal(revived?.historical, false);
      assert.equal(revived?.status, "Using shell");
      assert.equal(revived?.phase, "running");
      assert.equal(revived?.room, "testing");
      assert.equal(revived?.color, parentColor);
      assert.equal(state.agents.find((agent) => agent.id === "ses_history_child")?.connected, false);
      assert.equal(
        state.agents.find((agent) => agent.id === "ses_history_child_two")?.connected,
        false,
      );

      assert.equal(
        (
          await post(server.base, {
            type: "session.deleted",
            sessionId: "ses_history_child",
            agentName: "History Child",
            eventId: "evt-history-child-deleted",
          })
        ).status,
        200,
      );

      // An active session at shutdown becomes Offline on the next start; a
      // terminated session stays terminated and cannot be mistaken for idle.
      await server.stop();
      server = null;
      server = await startServer({ dbPath });
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const offlineParent = state.agents.find((agent) => agent.id === "ses_history_parent");
      const terminatedChild = state.agents.find((agent) => agent.id === "ses_history_child");
      const offlineChildTwo = state.agents.find((agent) => agent.id === "ses_history_child_two");
      assert.equal(offlineParent?.connected, false);
      assert.equal(offlineParent?.status, "Offline");
      assert.equal(offlineParent?.lastStatus, "Using shell");
      assert.equal(offlineParent?.phase, "offline");
      assert.equal(terminatedChild?.phase, "terminated");
      assert.equal(terminatedChild?.status, "Session closed");
      assert.equal(terminatedChild?.connected, false);
      assert.equal(offlineChildTwo?.connected, false);
      assert.equal(offlineChildTwo?.phase, "offline");

      await server.stop();
      server = null;

      // A demo bridge pointed at the same file must see only demo rows.
      let demo = await startServer({ dbPath, mode: "demo" });
      try {
        let demoState = await getJson<OfficeState>(`${demo.base}/api/state`);
        assert.equal(demoState.mode, "demo");
        assert.equal(demoState.agents.length, 0);
        assert.equal((await post(demo.base, originalEvents[0])).status, 403);
        assert.equal(
          (
            await post(demo.base, {
              type: "session.created",
              sessionId: "ses_demo_only",
              agentName: "Demo Only",
              demo: true,
              eventId: "evt-demo-only",
            })
          ).status,
          200,
        );
        demoState = await getJson<OfficeState>(`${demo.base}/api/state`);
        assert.equal(demoState.agents.length, 1);
        assert.equal(demoState.agents[0].source, "demo");
        assert.equal(demoState.agents[0].id, "ses_demo_only");
      } finally {
        await demo.stop();
      }

      server = await startServer({ dbPath });
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.mode, "live");
      assert.ok(state.agents.every((agent) => agent.source === "live"));
      assert.ok(!state.agents.some((agent) => agent.id === "ses_demo_only"));
    } finally {
      if (server) await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("retention bounds disconnected sessions and activity", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-retention-"));
    const dbPath = path.join(dir, "retention.sqlite");
    const server = await startServer({ dbPath });
    try {
      const events: unknown[] = [];
      for (let index = 0; index < 160; index += 1) {
        events.push({
          type: "session.created",
          sessionId: `ses_retention_${index}`,
          agentName: `Retention ${index}`,
          eventId: `evt-retention-create-${index}`,
        });
        events.push({
          type: "session.deleted",
          sessionId: `ses_retention_${index}`,
          agentName: `Retention ${index}`,
          eventId: `evt-retention-delete-${index}`,
        });
      }
      await postMany(server.base, events);

      const state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, 100);
      assert.ok(state.agents.every((agent) => agent.connected === false));
      assert.ok(state.agents.every((agent) => agent.phase === "terminated"));

      const db = new DatabaseSync(dbPath);
      try {
        const sessions = db
          .prepare(
            "SELECT COUNT(*) AS count FROM sessions WHERE source = 'live' AND connected = 0",
          )
          .get() as { count: number };
        assert.ok(
          sessions.count <= 120,
          `disconnected sessions should stay bounded, got ${sessions.count}`,
        );
        const activity = db
          .prepare("SELECT COUNT(*) AS count FROM activity WHERE source = 'live'")
          .get() as { count: number };
        assert.ok(
          activity.count <= 550,
          `persisted activity should stay bounded, got ${activity.count}`,
        );
      } finally {
        db.close();
      }
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("database failure falls back to an in-memory bridge", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-memory-"));
    const brokenPath = path.join(dir, "not-a-database");
    await mkdir(brokenPath);
    const server = await startServer({ dbPath: brokenPath });
    try {
      const health = await getJson<Health>(`${server.base}/health`);
      assert.equal(health.persistence, "memory");
      assert.equal(health.databaseOk, false);
      assert.equal(
        (
          await post(server.base, {
            type: "session.created",
            sessionId: "ses_memory",
            agentName: "Memory Agent",
            eventId: "evt-memory",
          })
        ).status,
        200,
      );
      const state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.agents.length, 1);
      assert.equal(state.agents[0].connected, true);
      assert.equal(state.agents[0].status, "Started");
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("provider adapters normalize documented payloads", () => {
    const openCode = openCodeAdapter.parse({
      provider: "opencode",
      type: "session.tool.called",
      sessionId: "ses_adapter",
      agentName: "Adapter Agent",
      eventId: "evt-adapter",
      detail: { tool: "read", description: "src/model.ts", agent: "explore" },
    });
    assert.ok(openCode);
    assert.equal(openCode.provider, "opencode");
    assert.equal(openCode.type, "session.tool.started");
    assert.equal(openCode.rawType, "session.tool.called");
    assert.equal(openCode.sessionId, "ses_adapter");
    assert.equal(openCode.tool, "read");
    assert.equal(openCode.agent, "explore");

    const claudeStart = claudeCodeAdapter.parse({
      hook_event_name: "SessionStart",
      session_id: "claude-session",
      source: "startup",
      session_title: "Refactor bridge",
      cwd: "/Users/example/private",
      transcript_path: "/Users/example/private/transcript.jsonl",
    });
    assert.ok(claudeStart);
    assert.equal(claudeStart.provider, "claude-code");
    assert.equal(claudeStart.type, "session.created");
    assert.equal(claudeStart.name, "Refactor bridge");
    assert.equal(claudeStart.detail, "startup");
    assert.equal("prompt" in claudeStart, false);
    assert.equal("cwd" in claudeStart, false);
    assert.equal("transcript_path" in claudeStart, false);

    const preTool = claudeCodeAdapter.parse({
      hook_event_name: "PreToolUse",
      session_id: "claude-session",
      agent_id: "claude-child",
      agent_type: "Explore",
      prompt_id: "prompt-1",
      tool_name: "Bash",
      tool_use_id: "toolu_1",
      tool_input: { command: "npm test --token=supersecret", description: "Run tests" },
    });
    assert.ok(preTool);
    assert.equal(preTool.type, "session.tool.started");
    assert.equal(preTool.sessionId, "claude-child");
    assert.equal(preTool.parentSessionId, "claude-session");
    assert.equal(preTool.tool, "Bash");
    assert.equal(preTool.detail, "npm test --token=supersecret");
    assert.equal(preTool.eventId, "claude-child:PreToolUse:toolu_1");

    const success = claudeCodeAdapter.parse({
      hook_event_name: "PostToolUse",
      session_id: "claude-session",
      tool_name: "Read",
      tool_use_id: "toolu_1",
      tool_input: { file_path: "src/server.ts" },
      tool_response: { content: "private file content" },
    });
    assert.ok(success);
    assert.equal(success.type, "session.tool.success");
    assert.equal(success.detail, "src/server.ts");
    assert.equal("tool_response" in success, false);

    const failure = claudeCodeAdapter.parse({
      hook_event_name: "PostToolUseFailure",
      session_id: "claude-session",
      tool_name: "Bash",
      tool_use_id: "toolu_1",
      tool_input: { command: "npm test", description: "Run tests" },
      error: "Exit code 1\nError: expected 1",
      duration_ms: 100,
    });
    assert.ok(failure);
    assert.equal(failure.type, "session.tool.failed");
    assert.equal(failure.detail, "Exit code 1\nError: expected 1");

    const subagent = claudeCodeAdapter.parse({
      hook_event_name: "SubagentStart",
      session_id: "claude-session",
      agent_id: "claude-child",
      agent_type: "Explore",
    });
    assert.ok(subagent);
    assert.equal(subagent.type, "session.created");
    assert.equal(subagent.parentSessionId, "claude-session");
    assert.equal(subagent.sessionId, "claude-child");

    const subagentStop = claudeCodeAdapter.parse({
      hook_event_name: "SubagentStop",
      session_id: "claude-session",
      agent_id: "claude-child",
      agent_type: "Explore",
      last_assistant_message: "private subagent response",
    });
    assert.ok(subagentStop);
    assert.equal(subagentStop.type, "session.turn.completed");
    assert.equal(subagentStop.sessionId, "claude-child");
    assert.equal(subagentStop.parentSessionId, "claude-session");
    assert.equal("last_assistant_message" in subagentStop, false);

    const agentTool = claudeCodeAdapter.parse({
      hook_event_name: "PreToolUse",
      session_id: "claude-session",
      tool_name: "Agent",
      tool_use_id: "toolu_agent",
      tool_input: {
        subagent_type: "Explore",
        description: "private task details",
        prompt: "private prompt",
      },
    });
    assert.ok(agentTool);
    assert.equal(agentTool.detail, "Explore");
    assert.equal(agentTool.parentSessionId, undefined);

    // Identical agent names are not parent evidence. Only agent_id can create
    // a confirmed parent link.
    const sameNameTopLevel = claudeCodeAdapter.parse({
      hook_event_name: "SessionStart",
      session_id: "claude-other",
      source: "startup",
      agent_type: "Explore",
      session_title: "Another Explore",
    });
    assert.ok(sameNameTopLevel);
    assert.equal(sameNameTopLevel.parentSessionId, undefined);
    assert.equal(sameNameTopLevel.agent, "Explore");

    const stop = claudeCodeAdapter.parse({
      hook_event_name: "Stop",
      session_id: "claude-session",
      prompt_id: "prompt-1",
      last_assistant_message: "private response",
    });
    assert.ok(stop);
    assert.equal(stop.type, "session.turn.completed");
    assert.equal("last_assistant_message" in stop, false);

    const stopFailure = claudeCodeAdapter.parse({
      hook_event_name: "StopFailure",
      session_id: "claude-session",
      prompt_id: "prompt-1",
      error: "rate_limit",
      error_details: "429 Too Many Requests",
      last_assistant_message: "API Error: Rate limit reached",
    });
    assert.ok(stopFailure);
    assert.equal(stopFailure.type, "session.error");
    assert.equal(stopFailure.detail, "429 Too Many Requests");
    assert.equal("last_assistant_message" in stopFailure, false);

    const end = claudeCodeAdapter.parse({
      hook_event_name: "SessionEnd",
      session_id: "claude-session",
      reason: "other",
    });
    assert.ok(end);
    assert.equal(end.type, "session.terminated");

    assert.equal(
      claudeCodeAdapter.parse({
        hook_event_name: "UserPromptSubmit",
        session_id: "claude-session",
        prompt: "private prompt",
      }),
      null,
    );

    const codexStart = codexAdapter.parse({
      hook_event_name: "SessionStart",
      session_id: "codex-session",
      source: "startup",
      cwd: "C:\\private\\project",
      model: "gpt-6.1-sol",
      permission_mode: "default",
      transcript_path: "C:\\private\\rollout.jsonl",
      prompt: "PRIVATE PROMPT",
    });
    assert.ok(codexStart);
    assert.equal(codexStart.provider, "codex");
    assert.equal(codexStart.type, "session.created");
    assert.equal(codexStart.detail, "startup");
    assert.equal("prompt" in codexStart, false);
    assert.equal("cwd" in codexStart, false);
    assert.equal("transcript_path" in codexStart, false);
    assert.equal("model" in codexStart, false);

    const codexTool = codexAdapter.parse({
      hook_event_name: "PreToolUse",
      session_id: "codex-session",
      turn_id: "turn-1",
      agent_id: "codex-child",
      agent_type: "worker",
      tool_name: "Bash",
      tool_use_id: "call-1",
      tool_input: {
        command: "npm test --token=supersecret",
        content: "PRIVATE FILE CONTENT",
      },
      tool_response: { content: "PRIVATE TOOL RESPONSE" },
      last_assistant_message: "PRIVATE ASSISTANT",
    });
    assert.ok(codexTool);
    assert.equal(codexTool.type, "session.tool.started");
    assert.equal(codexTool.sessionId, "codex-child");
    assert.equal(codexTool.parentSessionId, "codex-session");
    assert.equal(codexTool.tool, "Bash");
    assert.equal(codexTool.detail, "npm test --token=supersecret");
    assert.equal(codexTool.eventId, "codex-child:PreToolUse:call-1");
    assert.equal("tool_response" in codexTool, false);

    const codexSubagent = codexAdapter.parse({
      hook_event_name: "SubagentStart",
      session_id: "codex-session",
      turn_id: "turn-1",
      agent_id: "codex-child",
      agent_type: "worker",
    });
    assert.ok(codexSubagent);
    assert.equal(codexSubagent.type, "session.created");
    assert.equal(codexSubagent.sessionId, "codex-child");
    assert.equal(codexSubagent.parentSessionId, "codex-session");
    assert.equal(codexSubagent.name, "worker subagent");

    const codexSubagentStop = codexAdapter.parse({
      hook_event_name: "SubagentStop",
      session_id: "codex-session",
      turn_id: "turn-1",
      agent_id: "codex-child",
      agent_type: "worker",
      last_assistant_message: "PRIVATE SUBAGENT RESPONSE",
    });
    assert.ok(codexSubagentStop);
    assert.equal(codexSubagentStop.type, "session.turn.completed");
    assert.equal(codexSubagentStop.parentSessionId, "codex-session");
    assert.equal("last_assistant_message" in codexSubagentStop, false);

    const codexStop = codexAdapter.parse({
      hook_event_name: "Stop",
      session_id: "codex-session",
      turn_id: "turn-1",
      last_assistant_message: "PRIVATE ASSISTANT",
    });
    assert.ok(codexStop);
    assert.equal(codexStop.type, "session.turn.completed");
    assert.equal(codexStop.eventId, "codex-session:Stop:turn-1");
    assert.equal("last_assistant_message" in codexStop, false);

    const codexInterrupt = codexAdapter.parse({
      hook_event_name: "Interrupt",
      session_id: "codex-session",
      turn_id: "turn-2",
    });
    assert.ok(codexInterrupt);
    assert.equal(codexInterrupt.type, "session.interrupted");
    assert.equal(codexInterrupt.eventId, "codex-session:Interrupt:turn-2");

    for (const [eventName, type] of [
      ["PreCompact", "session.compaction.started"],
      ["PostCompact", "session.compaction.ended"],
    ] as const) {
      const parsed = codexAdapter.parse({
        hook_event_name: eventName,
        session_id: "codex-session",
        turn_id: "turn-3",
        trigger: "auto",
      });
      assert.ok(parsed);
      assert.equal(parsed.type, type);
      assert.equal(parsed.detail, "compaction auto");
    }

    const codexEnd = codexAdapter.parse({
      hook_event_name: "SessionEnd",
      session_id: "codex-session",
      reason: "other",
      transcript_path: "C:\\private\\rollout.jsonl",
    });
    assert.ok(codexEnd);
    assert.equal(codexEnd.type, "session.terminated");
    assert.equal("reason" in codexEnd, false);

    assert.equal(
      codexAdapter.parse({
        hook_event_name: "UserPromptSubmit",
        session_id: "codex-session",
        prompt: "private prompt",
      }),
      null,
    );
    assert.equal(
      codexAdapter.parse({
        hook_event_name: "SubagentStart",
        session_id: "codex-session",
        agent_type: "worker",
      }),
      null,
    );
  });

  await t.test("providers are isolated and the Claude Code hook is read-only", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-provider-"));
    const dbPath = path.join(dir, "providers.sqlite");
    let server: RunningServer | null = await startServer({ dbPath });
    try {
      const openCodeCreate = {
        provider: "opencode",
        type: "session.created",
        sessionId: "ses_shared",
        agentName: "OpenCode Shared",
        eventId: "evt-open-shared",
        detail: { description: "OpenCode Shared", agent: "build" },
      };
      assert.equal((await post(server.base, openCodeCreate)).status, 200);

      const claudeStart = {
        hook_event_name: "SessionStart",
        session_id: "ses_shared",
        source: "startup",
        session_title: "Claude Shared",
      };
      const startResult = await runClaudeHook(server.base, claudeStart);
      assert.equal(startResult.code, 0);
      assert.equal(startResult.stdout, "");
      assert.equal(startResult.stderr, "");

      let state = await getJson<OfficeState>(`${server.base}/api/state`);
      const sameId = state.agents.filter((agent) => agent.id === "ses_shared");
      assert.equal(sameId.length, 2);
      const openCodeParent = sameId.find((agent) => agent.provider === "opencode");
      const claudeParent = sameId.find((agent) => agent.provider === "claude-code");
      assert.ok(openCodeParent && claudeParent);
      assert.notEqual(openCodeParent.color, claudeParent.color);
      assert.equal(openCodeParent.name, "OpenCode Shared");
      assert.equal(claudeParent.name, "Claude Shared");
      assert.equal(openCodeParent.status, "Started");
      assert.equal(claudeParent.status, "Started");

      const health = await getJson<Health>(`${server.base}/health`);
      assert.equal(health.providers?.["opencode"]?.agents, 1);
      assert.equal(health.providers?.["claude-code"]?.agents, 1);
      assert.equal(health.providers?.["claude-code"]?.displayName, "Claude Code");

      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "SubagentStart",
            session_id: "ses_shared",
            agent_id: "agent_child",
            agent_type: "Explore",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "PreToolUse",
            session_id: "ses_shared",
            agent_id: "agent_child",
            agent_type: "Explore",
            prompt_id: "prompt-1",
            tool_name: "Bash",
            tool_use_id: "toolu_1",
            tool_input: {
              command: "npm test --token=supersecret --password hunter2",
              description: "Run the test suite",
            },
          })
        ).code,
        0,
      );

      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const child = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === "agent_child",
      );
      assert.ok(child);
      assert.equal(child.parentID, "ses_shared");
      assert.equal(child.name, "Explore subagent");
      assert.equal(child.status, "Using Bash");
      assert.equal(child.room, "testing");
      assert.equal(child.canonicalEventType, "session.tool.started");
      assert.match(String(child.detail), /redacted/i);
      assert.doesNotMatch(String(child.detail), /supersecret|hunter2/);
      assert.equal(
        state.agents.find(
          (agent) => agent.provider === "opencode" && agent.id === "ses_shared",
        )?.status,
        "Started",
      );

      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "PostToolUseFailure",
            session_id: "ses_shared",
            agent_id: "agent_child",
            agent_type: "Explore",
            prompt_id: "prompt-1",
            tool_name: "Bash",
            tool_use_id: "toolu_1",
            tool_input: { command: "npm test", description: "Run the test suite" },
            error: "Exit code 1\nError: OPENAI_API_KEY=sk-abcdefghijklmnop",
            duration_ms: 1200,
          })
        ).code,
        0,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const failedChild = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === "agent_child",
      );
      assert.equal(failedChild?.phase, "failed");
      assert.equal(failedChild?.lastOutcome, "failed");
      assert.equal(failedChild?.detail, "Exit code 1");
      assert.doesNotMatch(String(failedChild?.detail), /sk-abcdefghijklmnop/);

      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "SubagentStop",
            session_id: "ses_shared",
            agent_id: "agent_child",
            agent_type: "Explore",
            last_assistant_message: "Private subagent output.",
          })
        ).code,
        0,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const stoppedChild = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === "agent_child",
      );
      assert.equal(stoppedChild?.status, "Completed");
      assert.equal(stoppedChild?.lastOutcome, "failed");

      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "Stop",
            session_id: "ses_shared",
            prompt_id: "prompt-1",
            last_assistant_message: "This must never be persisted.",
          })
        ).code,
        0,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const completedParent = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === "ses_shared",
      );
      assert.equal(completedParent?.status, "Completed");
      assert.equal(completedParent?.lastOutcome, "completed");
      assert.equal(
        state.agents.find(
          (agent) => agent.provider === "opencode" && agent.id === "ses_shared",
        )?.status,
        "Started",
      );
      assert.ok(
        !state.activity.some((item) =>
          String(item.detail).includes("This must never be persisted"),
        ),
      );

      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "SessionEnd",
            session_id: "ses_shared",
            reason: "other",
          })
        ).code,
        0,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(
        state.agents.find(
          (agent) => agent.provider === "claude-code" && agent.id === "ses_shared",
        )?.phase,
        "terminated",
      );

      assert.equal(
        (await postProvider(server.base, "unknown-provider", {})).status,
        404,
      );
      assert.equal(
        (await postProvider(server.base, "claude-code", { hook_event_name: "PreToolUse" })).status,
        400,
      );
      assert.equal(
        (
          await postProvider(server.base, "claude-code", {
            hook_event_name: "SessionStart",
            session_id: "ses_wrong_provider",
            provider: "opencode",
          })
        ).status,
        400,
      );

      await server.stop();
      server = null;
      server = await startServer({ dbPath });
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const restoredSameId = state.agents.filter((agent) => agent.id === "ses_shared");
      assert.equal(restoredSameId.length, 2);
      const restoredOpenCode = restoredSameId.find((agent) => agent.provider === "opencode");
      const restoredClaude = restoredSameId.find((agent) => agent.provider === "claude-code");
      assert.equal(restoredOpenCode?.phase, "offline");
      assert.equal(restoredClaude?.phase, "terminated");
      assert.equal(restoredOpenCode?.color, openCodeParent.color);
      assert.equal(restoredClaude?.color, claudeParent.color);
      const restoredChild = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === "agent_child",
      );
      assert.equal(restoredChild?.parentID, "ses_shared");
      assert.equal(restoredChild?.lastOutcome, "failed");

      const db = new DatabaseSync(dbPath);
      try {
        const version = db.prepare("PRAGMA user_version").get() as {
          user_version: number;
        };
        assert.equal(version.user_version, 2);
        const providers = (
          db
            .prepare(
              "SELECT provider, COUNT(*) AS count FROM sessions GROUP BY provider ORDER BY provider",
            )
            .all() as Array<{ provider: string; count: number }>
        ).map((row) => ({ provider: row.provider, count: row.count }));
        assert.deepEqual(providers, [
          { provider: "claude-code", count: 2 },
          { provider: "opencode", count: 1 },
        ]);
        const childRow = db
          .prepare("SELECT provider, parent_id FROM sessions WHERE id = 'agent_child'")
          .get() as { provider: string; parent_id: string };
        assert.equal(childRow.provider, "claude-code");
        assert.equal(childRow.parent_id, "ses_shared");
      } finally {
        db.close();
      }
    } finally {
      if (server) await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("Claude Code hooks: documented lifecycle, isolation, dedupe, and boundary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-claude-"));
    const dbPath = path.join(dir, "claude.sqlite");
    let server: RunningServer | null = await startServer({ dbPath });
    try {
      const settingsPath = path.join(
        PROJECT_ROOT,
        "integrations",
        "claude-code",
        "settings.example.json",
      );
      const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
        hooks: Record<string, Array<{ hooks: Array<Record<string, any>> }>>;
      };
      const expectedHooks = [
        "SessionStart",
        "SubagentStart",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "Stop",
        "SubagentStop",
        "StopFailure",
        "SessionEnd",
      ];
      assert.deepEqual(Object.keys(settings.hooks).sort(), expectedHooks.sort());
      for (const event of expectedHooks) {
        const groups = settings.hooks[event];
        assert.equal(groups.length, 1, `${event} should have one matcher group`);
        const handler = groups[0].hooks[0];
        assert.ok(handler);
        assert.equal(handler.type, "command");
        assert.equal(handler.command, "node");
        assert.deepEqual(handler.args, [
          path.join(PROJECT_ROOT, "integrations", "claude-code", "agent-office-hook.mjs"),
        ]);
        assert.equal(handler.timeout, 5);
      }

      // Run the exact exec-form command from settings.example.json, not a
      // hand-built substitute for the registration.
      const configured = settings.hooks.SessionStart[0].hooks[0];
      const configuredRun = await runHookProcess(
        String(configured.command),
        configured.args as string[],
        server.base,
        JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: "ses_claude_config",
          source: "startup",
          session_title: "Configured Hook",
        }),
      );
      assert.equal(configuredRun.code, 0);
      assert.equal(configuredRun.stdout, "");
      assert.equal(configuredRun.stderr, "");

      const parentA = "claude-parent-a";
      const parentB = "claude-parent-b";
      const childA = "agent-child-a";
      const childB = "agent-child-b";

      const realisticStart = {
        hook_event_name: "SessionStart",
        session_id: parentA,
        source: "startup",
        session_title: "Claude Alpha",
        agent_type: "Explore",
        cwd: "C:\\private\\project",
        transcript_path: "C:\\private\\transcript.jsonl",
        model: "claude-opus-5",
        prompt: "PRIVATE PROMPT",
        last_assistant_message: "PRIVATE ASSISTANT",
      };
      assert.equal((await runClaudeHook(server.base, realisticStart)).code, 0);
      assert.equal(
        (
          await runClaudeHook(server.base, {
            ...realisticStart,
            session_id: parentB,
            session_title: "Claude Beta",
          })
        ).code,
        0,
      );

      for (const [child, parent, type] of [
        [childA, parentA, "Explore"],
        [childB, parentB, "Plan"],
      ] as const) {
        const run = await runClaudeHook(server.base, {
          hook_event_name: "SubagentStart",
          session_id: parent,
          agent_id: child,
          agent_type: type,
        });
        assert.equal(run.code, 0);
        assert.equal(run.stdout, "");
        assert.equal(run.stderr, "");
      }

      const { ws, snapshot } = await openSocket(server.base);
      assert.equal(snapshot.type, "update");
      const nextUpdate = new Promise<Record<string, any>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket update timed out")), 5_000);
        ws.once("message", (data) => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(String(data)));
          } catch (error) {
            reject(error);
          }
        });
      });

      const toolPayloadA = {
        hook_event_name: "PreToolUse",
        session_id: parentA,
        agent_id: childA,
        agent_type: "Explore",
        prompt_id: "prompt-a",
        tool_name: "Bash",
        tool_use_id: "toolu_shared",
        tool_input: {
          command: "npm test --token=supersecret --password hunter2",
          description: "Run the test suite",
          content: "PRIVATE FILE CONTENT",
          old_string: "PRIVATE OLD",
          new_string: "PRIVATE NEW",
        },
      };
      const firstTool = await runClaudeHook(server.base, toolPayloadA);
      assert.equal(firstTool.code, 0);
      assert.equal(firstTool.stdout, "");
      assert.equal(firstTool.stderr, "");

      const update = await nextUpdate;
      assert.equal(update.type, "update");
      assert.ok(
        update.agents.some(
          (agent: Record<string, any>) =>
            agent.provider === "claude-code" && agent.id === childA,
        ),
      );
      await closeSocket(ws);

      // A second simultaneous Claude session may use the same tool_use_id.
      // Event IDs are session-scoped, so both sessions must retain activity.
      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "PreToolUse",
            session_id: parentB,
            agent_id: childB,
            agent_type: "Plan",
            prompt_id: "prompt-b",
            tool_name: "Bash",
            tool_use_id: "toolu_shared",
            tool_input: { command: "npm run build", description: "Build" },
          })
        ).code,
        0,
      );

      let state = await getJson<OfficeState>(`${server.base}/api/state`);
      const alphaTool = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === childA,
      );
      const betaTool = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === childB,
      );
      assert.ok(alphaTool && betaTool);
      assert.equal(alphaTool.parentID, parentA);
      assert.equal(betaTool.parentID, parentB);
      assert.match(String(alphaTool.detail), /redacted/i);
      assert.doesNotMatch(String(alphaTool.detail), /supersecret|hunter2|PRIVATE/);
      assert.equal(betaTool.status, "Using Bash");

      const activityBeforeReplay = state.activity.length;
      const replay = await runClaudeHook(server.base, toolPayloadA);
      assert.equal(replay.code, 0);
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, activityBeforeReplay);
      assert.equal(
        state.activity.filter(
          (item) =>
            item.provider === "claude-code" &&
            item.sessionId === childA &&
            item.type === "PreToolUse" &&
            item.detail === alphaTool.detail,
        ).length,
        1,
      );

      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "PostToolUse",
            session_id: parentA,
            agent_id: childA,
            agent_type: "Explore",
            prompt_id: "prompt-a",
            tool_name: "Edit",
            tool_use_id: "toolu_shared",
            tool_input: {
              file_path: "src/server.ts",
              content: "PRIVATE FILE CONTENT",
              old_string: "PRIVATE OLD",
              new_string: "PRIVATE NEW",
            },
            tool_response: { content: "PRIVATE TOOL RESPONSE" },
            last_assistant_message: "PRIVATE ASSISTANT",
          })
        ).code,
        0,
      );

      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "PostToolUseFailure",
            session_id: parentA,
            agent_id: childA,
            agent_type: "Explore",
            prompt_id: "prompt-a",
            tool_name: "Bash",
            tool_use_id: "toolu_failed",
            tool_input: { command: "npm test", description: "Run tests" },
            error: "Exit code 1\nPRIVATE FILE CONTENT\nOPENAI_API_KEY=sk-abcdefghijklmnop",
            is_interrupt: false,
            duration_ms: 1200,
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "SubagentStop",
            session_id: parentA,
            agent_id: childA,
            agent_type: "Explore",
            last_assistant_message: "PRIVATE SUBAGENT RESPONSE",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "Stop",
            session_id: parentA,
            prompt_id: "prompt-a",
            last_assistant_message: "PRIVATE ASSISTANT",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "StopFailure",
            session_id: parentB,
            prompt_id: "prompt-b",
            error: "rate_limit",
            error_details: "429 Too Many Requests",
            last_assistant_message: "PRIVATE FAILURE TEXT",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runClaudeHook(server.base, {
            hook_event_name: "SessionEnd",
            session_id: parentB,
            reason: "prompt_input_exit",
          })
        ).code,
        0,
      );

      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const alpha = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === parentA,
      );
      const beta = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === parentB,
      );
      const stoppedChild = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === childA,
      );
      assert.equal(alpha?.status, "Completed");
      assert.equal(alpha?.lastOutcome, "completed");
      assert.equal(beta?.phase, "terminated");
      assert.equal(beta?.status, "Session closed");
      assert.equal(stoppedChild?.status, "Completed");
      assert.equal(stoppedChild?.lastOutcome, "failed");
      assert.equal(stoppedChild?.parentID, parentA);
      assert.equal(
        state.agents.find(
          (agent) => agent.provider === "claude-code" && agent.id === childB,
        )?.parentID,
        parentB,
      );

      // Capture the exact POST body at the hook boundary. Forbidden payload
      // fields must never leave Claude Code, even though the native input has
      // them.
      let capture = await startHookCapture();
      try {
        const result = await runClaudeHook(capture.base, {
          hook_event_name: "PostToolUse",
          session_id: "ses_capture",
          tool_name: "Edit",
          tool_use_id: "toolu_capture",
          tool_input: {
            file_path: "src/server.ts",
            content: "PRIVATE FILE CONTENT",
            old_string: "PRIVATE OLD",
            new_string: "PRIVATE NEW",
          },
          tool_response: { content: "PRIVATE TOOL RESPONSE" },
          prompt: "PRIVATE PROMPT",
          last_assistant_message: "PRIVATE ASSISTANT",
          transcript_path: "C:\\private\\transcript.jsonl",
          cwd: "C:\\private\\project",
          duration_ms: 12,
        });
        assert.equal(result.code, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        const captured = await Promise.race([
          capture.wait(),
          delay(3_000).then(() => {
            throw new Error("hook did not POST");
          }),
        ]);
        assert.equal(captured.path, "/events/claude-code");
        assert.deepEqual(captured.body.tool_input, { file_path: "src/server.ts" });
        assert.equal(captured.body.duration_ms, 12);
        for (const field of [
          "prompt",
          "last_assistant_message",
          "transcript_path",
          "cwd",
          "tool_response",
        ]) {
          assert.equal(field in captured.body, false, `${field} must not be transmitted`);
        }
        assert.doesNotMatch(JSON.stringify(captured.body), /PRIVATE/);
      } finally {
        await capture.close();
      }

      capture = await startHookCapture();
      try {
        assert.equal(
          (
            await runClaudeHook(capture.base, {
              hook_event_name: "PostToolUseFailure",
              session_id: "ses_capture_failure",
              tool_name: "Bash",
              tool_use_id: "toolu_capture_failure",
              tool_input: {
                command: "npm test --token=supersecret",
                description: "Run tests",
              },
              error: "Exit code 1\nPRIVATE FILE CONTENT\nOPENAI_API_KEY=sk-abcdefghijklmnop",
            })
          ).code,
          0,
        );
        const captured = await capture.wait();
        assert.equal(captured.body.error, "Exit code 1");
        assert.equal(captured.body.tool_input.command, "npm test --token=[redacted]");
        assert.doesNotMatch(JSON.stringify(captured.body), /PRIVATE|supersecret|sk-abcdefghijklmnop/);
      } finally {
        await capture.close();
      }

      capture = await startHookCapture();
      try {
        assert.equal(
          (
            await runClaudeHook(capture.base, {
              hook_event_name: "PreToolUse",
              session_id: "ses_capture_agent",
              tool_name: "Agent",
              tool_use_id: "toolu_capture_agent",
              tool_input: {
                subagent_type: "Explore",
                description: "PRIVATE TASK DESCRIPTION",
                prompt: "PRIVATE TASK PROMPT",
              },
            })
          ).code,
          0,
        );
        const captured = await capture.wait();
        assert.deepEqual(captured.body.tool_input, { subagent_type: "Explore" });
        assert.doesNotMatch(JSON.stringify(captured.body), /PRIVATE/);
      } finally {
        await capture.close();
      }

      for (const suffix of ["", "/events", "/events/", "/events/claude-code"]) {
        capture = await startHookCapture();
        try {
          const result = await runClaudeHook(
            capture.base,
            {
              hook_event_name: "SessionStart",
              session_id: `ses_url_${suffix.replace(/\W/g, "_") || "base"}`,
              source: "startup",
            },
            `${capture.base}${suffix}`,
          );
          assert.equal(result.code, 0);
          const captured = await capture.wait();
          assert.equal(captured.path, "/events/claude-code");
        } finally {
          await capture.close();
        }
      }

      capture = await startHookCapture();
      try {
        const large = await runClaudeHook(capture.base, {
          hook_event_name: "PostToolUse",
          session_id: "ses_large_payload",
          tool_name: "Read",
          tool_use_id: "toolu_large",
          tool_input: { file_path: "large.txt" },
          tool_response: { content: "x".repeat(1_500_000) },
        });
        assert.equal(large.code, 0);
        const captured = await capture.wait();
        assert.deepEqual(captured.body.tool_input, { file_path: "large.txt" });
        assert.equal("tool_response" in captured.body, false);
      } finally {
        await capture.close();
      }

      const beforeMalformed = (
        await getJson<OfficeState>(`${server.base}/api/state`)
      ).activity.length;
      for (const raw of [
        "{not json",
        JSON.stringify({ hook_event_name: "SessionStart" }),
        JSON.stringify({ session_id: "ses_missing_event" }),
        "",
      ]) {
        const result = await runClaudeHookRaw(server.base, raw);
        assert.equal(result.code, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
      const unsupported = await runClaudeHook(server.base, {
        hook_event_name: "UserPromptSubmit",
        session_id: "claude-unsupported",
        prompt: "PRIVATE PROMPT",
      });
      assert.equal(unsupported.code, 0);
      const invalidId = await runClaudeHook(server.base, {
        hook_event_name: "SessionStart",
        session_id: "not a valid id",
        source: "startup",
      });
      assert.equal(invalidId.code, 0);
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, beforeMalformed);
      assert.ok(
        !state.agents.some(
          (agent) =>
            agent.id === "claude-unsupported" || agent.id === "not a valid id",
        ),
      );
      assert.equal((await postProvider(server.base, "claude-code", {})).status, 400);

      const activityCount = state.activity.length;
      const agentCount = state.agents.length;
      const alphaColor = alpha?.color;
      const childColor = stoppedChild?.color;

      await server.stop();
      server = null;
      server = await startServer({ dbPath });
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, activityCount);
      assert.equal(state.agents.length, agentCount);
      const restoredAlpha = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === parentA,
      );
      const restoredBeta = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === parentB,
      );
      const restoredChild = state.agents.find(
        (agent) => agent.provider === "claude-code" && agent.id === childA,
      );
      assert.equal(restoredAlpha?.phase, "offline");
      assert.equal(restoredAlpha?.color, alphaColor);
      assert.equal(restoredBeta?.phase, "terminated");
      assert.equal(restoredChild?.phase, "offline");
      assert.equal(restoredChild?.lastOutcome, "failed");
      assert.equal(restoredChild?.parentID, parentA);
      assert.equal(restoredChild?.color, childColor);
      assert.equal(
        state.agents.find(
          (agent) => agent.provider === "claude-code" && agent.id === childB,
        )?.parentID,
        parentB,
      );

      const db = new DatabaseSync(dbPath);
      try {
        const rows = JSON.stringify({
          sessions: db.prepare("SELECT * FROM sessions WHERE source = 'live'").all(),
          activity: db.prepare("SELECT * FROM activity WHERE source = 'live'").all(),
        });
        assert.doesNotMatch(
          rows,
          /PRIVATE|supersecret|hunter2|sk-abcdefghijklmnop|must not leave/i,
        );
        const claudeSessions = db
          .prepare(
            "SELECT COUNT(*) AS count FROM sessions WHERE source = 'live' AND provider = 'claude-code'",
          )
          .get() as { count: number };
        assert.equal(claudeSessions.count, 5);
      } finally {
        db.close();
      }
    } finally {
      if (server) await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("Codex hooks: stable lifecycle, isolation, dedupe, and boundary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-codex-"));
    const dbPath = path.join(dir, "codex.sqlite");
    let server: RunningServer | null = await startServer({ dbPath });
    try {
      const settingsPath = path.join(
        PROJECT_ROOT,
        "integrations",
        "codex",
        "hooks.example.json",
      );
      const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
        hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, any>> }>>;
      };
      const expectedHooks = [
        "SessionStart",
        "SubagentStart",
        "PreToolUse",
        "PostToolUse",
        "PreCompact",
        "PostCompact",
        "Stop",
        "SubagentStop",
        "Interrupt",
        "SessionEnd",
      ];
      const hookScript = path.join(
        PROJECT_ROOT,
        "integrations",
        "codex",
        "agent-office-hook.mjs",
      );
      assert.deepEqual(Object.keys(settings.hooks).sort(), expectedHooks.sort());
      for (const event of expectedHooks) {
        const groups = settings.hooks[event];
        assert.equal(groups.length, 1, `${event} should have one matcher group`);
        const handler = groups[0].hooks[0];
        assert.ok(handler);
        assert.equal(handler.type, "command");
        assert.match(String(handler.command), /agent-office-hook\.mjs/);
        assert.match(String(handler.commandWindows), /agent-office-hook\.mjs/);
        assert.equal("args" in handler, false);
        assert.equal(handler.timeout, event === "Interrupt" || event === "SessionEnd" ? 3 : 5);
        assert.equal(handler.async, event !== "SessionEnd");
        if (event === "SessionStart") assert.equal(groups[0].matcher, "startup|resume|clear|fork");
        else assert.equal(groups[0].matcher, undefined);
      }
      assert.match(String(settings.hooks.SessionStart[0].hooks[0].command), /integrations\\codex/);

      // Exercise the exact configured command string through the same Windows
      // shell Codex uses for command hooks. This is a real hook process and a
      // real POST, not a hand-built substitute for the registration.
      if (process.platform === "win32") {
        const configured = settings.hooks.SessionStart[0].hooks[0];
        const configuredRun = await runShellHookCommand(
          String(configured.command),
          server.base,
          JSON.stringify({
            hook_event_name: "SessionStart",
            session_id: "codex-configured",
            source: "startup",
          }),
        );
        assert.equal(configuredRun.code, 0);
        assert.equal(configuredRun.stdout, "");
        assert.equal(configuredRun.stderr, "");
      }

      const parentA = "codex-parent-a";
      const parentB = "codex-parent-b";
      const childA = "codex-child-a";
      const childB = "codex-child-b";

      const realisticStart = {
        hook_event_name: "SessionStart",
        session_id: parentA,
        source: "startup",
        cwd: "C:\\private\\project",
        model: "gpt-6.1-sol",
        permission_mode: "default",
        transcript_path: "C:\\private\\rollout.jsonl",
        prompt: "PRIVATE PROMPT",
        last_assistant_message: "PRIVATE ASSISTANT",
      };
      assert.equal((await runCodexHook(server.base, realisticStart)).code, 0);
      assert.equal(
        (
          await runCodexHook(server.base, {
            ...realisticStart,
            session_id: parentB,
            source: "resume",
          })
        ).code,
        0,
      );

      for (const [child, parent, type] of [
        [childA, parentA, "worker"],
        [childB, parentB, "reviewer"],
      ] as const) {
        const run = await runCodexHook(server.base, {
          hook_event_name: "SubagentStart",
          session_id: parent,
          turn_id: `turn-${child}`,
          agent_id: child,
          agent_type: type,
          cwd: "C:\\private\\project",
          model: "gpt-6.1-sol",
          permission_mode: "default",
          transcript_path: "C:\\private\\rollout.jsonl",
          prompt: "PRIVATE SUBAGENT PROMPT",
        });
        assert.equal(run.code, 0);
        assert.equal(run.stdout, "");
        assert.equal(run.stderr, "");
      }

      const { ws, snapshot } = await openSocket(server.base);
      assert.equal(snapshot.type, "update");
      const nextUpdate = new Promise<Record<string, any>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket update timed out")), 5_000);
        ws.once("message", (data) => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(String(data)));
          } catch (error) {
            reject(error);
          }
        });
      });

      const toolPayloadA = {
        hook_event_name: "PreToolUse",
        session_id: parentA,
        turn_id: "turn-a",
        agent_id: childA,
        agent_type: "worker",
        tool_name: "Bash",
        tool_use_id: "call_shared",
        tool_input: {
          command: "npm test --token=supersecret --password hunter2",
          content: "PRIVATE FILE CONTENT",
          old_string: "PRIVATE OLD",
          new_string: "PRIVATE NEW",
          prompt: "PRIVATE PROMPT",
        },
        tool_response: { content: "PRIVATE TOOL RESPONSE" },
        cwd: "C:\\private\\project",
        model: "gpt-6.1-sol",
        permission_mode: "default",
        transcript_path: "C:\\private\\rollout.jsonl",
        last_assistant_message: "PRIVATE ASSISTANT",
      };
      const firstTool = await runCodexHook(server.base, toolPayloadA);
      assert.equal(firstTool.code, 0);
      assert.equal(firstTool.stdout, "");
      assert.equal(firstTool.stderr, "");

      const update = await nextUpdate;
      assert.equal(update.type, "update");
      assert.ok(
        update.agents.some(
          (agent: Record<string, any>) =>
            agent.provider === "codex" && agent.id === childA,
        ),
      );
      await closeSocket(ws);

      // A second simultaneous Codex session may use the same tool_use_id.
      // Event IDs are session-scoped, so both sessions must retain activity.
      assert.equal(
        (
          await runCodexHook(server.base, {
            hook_event_name: "PreToolUse",
            session_id: parentB,
            turn_id: "turn-b",
            agent_id: childB,
            agent_type: "reviewer",
            tool_name: "Bash",
            tool_use_id: "call_shared",
            tool_input: { command: "npm run build" },
          })
        ).code,
        0,
      );

      let state = await getJson<OfficeState>(`${server.base}/api/state`);
      const alphaTool = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === childA,
      );
      const betaTool = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === childB,
      );
      assert.ok(alphaTool && betaTool);
      assert.equal(alphaTool.parentID, parentA);
      assert.equal(betaTool.parentID, parentB);
      assert.match(String(alphaTool.detail), /redacted/i);
      assert.doesNotMatch(String(alphaTool.detail), /supersecret|hunter2|PRIVATE/);
      assert.equal(betaTool.status, "Using Bash");
      assert.equal(
        state.activity.filter(
          (item) =>
            item.provider === "codex" &&
            item.sessionId === childA &&
            item.type === "PreToolUse" &&
            item.canonicalType === "session.tool.started",
        ).length,
        1,
      );

      const activityBeforeReplay = state.activity.length;
      const replay = await runCodexHook(server.base, toolPayloadA);
      assert.equal(replay.code, 0);
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, activityBeforeReplay);

      assert.equal(
        (
          await runCodexHook(server.base, {
            hook_event_name: "PostToolUse",
            session_id: parentA,
            turn_id: "turn-a",
            agent_id: childA,
            agent_type: "worker",
            tool_name: "Bash",
            tool_use_id: "call_shared",
            tool_input: { command: "npm test --token=supersecret" },
            tool_response: { content: "PRIVATE TOOL RESPONSE" },
            last_assistant_message: "PRIVATE ASSISTANT",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runCodexHook(server.base, {
            hook_event_name: "PreCompact",
            session_id: parentA,
            turn_id: "turn-a",
            trigger: "auto",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runCodexHook(server.base, {
            hook_event_name: "PostCompact",
            session_id: parentA,
            turn_id: "turn-a",
            trigger: "auto",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runCodexHook(server.base, {
            hook_event_name: "SubagentStop",
            session_id: parentA,
            turn_id: "turn-a",
            agent_id: childA,
            agent_type: "worker",
            last_assistant_message: "PRIVATE SUBAGENT RESPONSE",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runCodexHook(server.base, {
            hook_event_name: "Stop",
            session_id: parentA,
            turn_id: "turn-a",
            last_assistant_message: "PRIVATE ASSISTANT",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runCodexHook(server.base, {
            hook_event_name: "Interrupt",
            session_id: parentB,
            turn_id: "turn-b",
          })
        ).code,
        0,
      );
      assert.equal(
        (
          await runCodexHook(server.base, {
            hook_event_name: "SessionEnd",
            session_id: parentB,
            reason: "other",
            transcript_path: "C:\\private\\rollout.jsonl",
          })
        ).code,
        0,
      );

      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const alpha = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === parentA,
      );
      const beta = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === parentB,
      );
      const stoppedChild = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === childA,
      );
      const openChild = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === childB,
      );
      assert.equal(alpha?.status, "Completed");
      assert.equal(alpha?.lastOutcome, "completed");
      assert.equal(beta?.phase, "terminated");
      assert.equal(beta?.status, "Session closed");
      assert.equal(stoppedChild?.status, "Completed");
      assert.equal(stoppedChild?.lastOutcome, "completed");
      assert.equal(stoppedChild?.parentID, parentA);
      assert.equal(openChild?.parentID, parentB);
      assert.equal(openChild?.status, "Using Bash");

      const health = await getJson<Health>(`${server.base}/health`);
      assert.equal(health.providers?.codex?.displayName, "Codex");
      assert.equal(health.providers?.codex?.agents, 5);

      // Capture the exact POST body at the hook boundary. The native Codex
      // payload contains prompts, transcript paths, cwd, model state, tool
      // responses, and raw tool input; only the allowlisted metadata may leave.
      let capture = await startHookCapture();
      try {
        const result = await runCodexHook(capture.base, {
          hook_event_name: "PreToolUse",
          session_id: "codex-capture",
          turn_id: "turn-capture",
          agent_id: "codex-capture-child",
          agent_type: "worker",
          tool_name: "Bash",
          tool_use_id: "call-capture",
          tool_input: {
            command: "npm test --token=supersecret",
            content: "PRIVATE FILE CONTENT",
            old_string: "PRIVATE OLD",
            new_string: "PRIVATE NEW",
          },
          tool_response: { content: "PRIVATE TOOL RESPONSE" },
          prompt: "PRIVATE PROMPT",
          last_assistant_message: "PRIVATE ASSISTANT",
          transcript_path: "C:\\private\\rollout.jsonl",
          cwd: "C:\\private\\project",
          model: "gpt-6.1-sol",
          permission_mode: "default",
        });
        assert.equal(result.code, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        const captured = await Promise.race([
          capture.wait(),
          delay(3_000).then(() => {
            throw new Error("Codex hook did not POST");
          }),
        ]);
        assert.equal(captured.path, "/events/codex");
        assert.deepEqual(captured.body.tool_input, {
          command: "npm test --token=[redacted]",
        });
        for (const field of [
          "prompt",
          "last_assistant_message",
          "transcript_path",
          "cwd",
          "model",
          "permission_mode",
          "tool_response",
          "content",
          "old_string",
          "new_string",
        ]) {
          assert.equal(field in captured.body, false, `${field} must not be transmitted`);
        }
        assert.doesNotMatch(JSON.stringify(captured.body), /PRIVATE|supersecret/);
      } finally {
        await capture.close();
      }

      capture = await startHookCapture();
      try {
        assert.equal(
          (
            await runCodexHook(capture.base, {
              hook_event_name: "PostToolUse",
              session_id: "codex-capture-patch",
              turn_id: "turn-capture-patch",
              tool_name: "apply_patch",
              tool_use_id: "call-capture-patch",
              tool_input: {
                command: "*** Begin Patch\n*** Update File: src/server.ts\nPRIVATE PATCH CONTENT\n*** End Patch",
              },
              tool_response: "PRIVATE PATCH RESULT",
              prompt: "PRIVATE PROMPT",
              last_assistant_message: "PRIVATE ASSISTANT",
            })
          ).code,
          0,
        );
        const captured = await capture.wait();
        assert.equal(captured.body.tool_name, "apply_patch");
        assert.equal("tool_input" in captured.body, false);
        assert.equal("tool_response" in captured.body, false);
        assert.doesNotMatch(JSON.stringify(captured.body), /PRIVATE|Begin Patch/);
      } finally {
        await capture.close();
      }

      for (const suffix of ["", "/events", "/events/", "/events/codex"]) {
        capture = await startHookCapture();
        try {
          const result = await runCodexHook(
            capture.base,
            {
              hook_event_name: "SessionStart",
              session_id: `codex_url_${suffix.replace(/\W/g, "_") || "base"}`,
              source: "startup",
            },
            `${capture.base}${suffix}`,
          );
          assert.equal(result.code, 0);
          const captured = await capture.wait();
          assert.equal(captured.path, "/events/codex");
        } finally {
          await capture.close();
        }
      }

      capture = await startHookCapture();
      try {
        const large = await runCodexHook(capture.base, {
          hook_event_name: "PostToolUse",
          session_id: "codex-large",
          turn_id: "turn-large",
          tool_name: "Bash",
          tool_use_id: "call-large",
          tool_input: { command: "npm test" },
          tool_response: { content: "x".repeat(1_500_000) },
        });
        assert.equal(large.code, 0);
        const captured = await capture.wait();
        assert.deepEqual(captured.body.tool_input, { command: "npm test" });
        assert.equal("tool_response" in captured.body, false);
      } finally {
        await capture.close();
      }

      const beforeMalformed = (
        await getJson<OfficeState>(`${server.base}/api/state`)
      ).activity.length;
      for (const raw of [
        "{not json",
        JSON.stringify({ hook_event_name: "SessionStart" }),
        JSON.stringify({ session_id: "codex-missing-event" }),
        "",
      ]) {
        const result = await runCodexHookRaw(server.base, raw);
        assert.equal(result.code, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
      const unsupported = await runCodexHook(server.base, {
        hook_event_name: "UserPromptSubmit",
        session_id: "codex-unsupported",
        prompt: "PRIVATE PROMPT",
      });
      assert.equal(unsupported.code, 0);
      const invalidId = await runCodexHook(server.base, {
        hook_event_name: "SessionStart",
        session_id: "not a valid id",
        source: "startup",
      });
      assert.equal(invalidId.code, 0);
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, beforeMalformed);
      assert.ok(
        !state.agents.some(
          (agent) =>
            agent.id === "codex-unsupported" || agent.id === "not a valid id",
        ),
      );
      assert.equal((await postProvider(server.base, "codex", {})).status, 400);
      assert.equal(
        (
          await postProvider(server.base, "codex", {
            hook_event_name: "SessionStart",
            session_id: "codex-wrong-provider",
            source: "startup",
            provider: "opencode",
          })
        ).status,
        400,
      );

      const activityCount = state.activity.length;
      const agentCount = state.agents.length;
      const alphaColor = alpha?.color;
      const childColor = stoppedChild?.color;

      await server.stop();
      server = null;
      server = await startServer({ dbPath });
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, activityCount);
      assert.equal(state.agents.length, agentCount);
      const restoredAlpha = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === parentA,
      );
      const restoredBeta = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === parentB,
      );
      const restoredChild = state.agents.find(
        (agent) => agent.provider === "codex" && agent.id === childA,
      );
      assert.equal(restoredAlpha?.phase, "offline");
      assert.equal(restoredAlpha?.color, alphaColor);
      assert.equal(restoredBeta?.phase, "terminated");
      assert.equal(restoredChild?.phase, "offline");
      assert.equal(restoredChild?.lastOutcome, "completed");
      assert.equal(restoredChild?.parentID, parentA);
      assert.equal(restoredChild?.color, childColor);
      assert.equal(
        state.agents.find(
          (agent) => agent.provider === "codex" && agent.id === childB,
        )?.parentID,
        parentB,
      );

      // The durable dedupe key must suppress a replay after a bridge restart.
      const activityAfterRestart = state.activity.length;
      assert.equal((await runCodexHook(server.base, toolPayloadA)).code, 0);
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.activity.length, activityAfterRestart);

      const db = new DatabaseSync(dbPath);
      try {
        const rows = JSON.stringify({
          sessions: db.prepare("SELECT * FROM sessions WHERE source = 'live'").all(),
          activity: db.prepare("SELECT * FROM activity WHERE source = 'live'").all(),
        });
        assert.doesNotMatch(
          rows,
          /PRIVATE|supersecret|hunter2|must not leave/i,
        );
        const codexSessions = db
          .prepare(
            "SELECT COUNT(*) AS count FROM sessions WHERE source = 'live' AND provider = 'codex'",
          )
          .get() as { count: number };
        assert.equal(codexSessions.count, 5);
        const childRow = db
          .prepare(
            "SELECT provider, parent_id FROM sessions WHERE provider = 'codex' AND id = ?",
          )
          .get(childA) as { provider: string; parent_id: string };
        assert.equal(childRow.provider, "codex");
        assert.equal(childRow.parent_id, parentA);
      } finally {
        db.close();
      }
    } finally {
      if (server) await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("v1 OpenCode databases migrate without losing history", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-migrate-"));
    const dbPath = path.join(dir, "legacy.sqlite");
    const now = Date.now();
    const legacy = new DatabaseSync(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE sessions (
          source TEXT NOT NULL,
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
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          connected INTEGER NOT NULL,
          terminated_at INTEGER,
          PRIMARY KEY (source, id)
        );
        CREATE INDEX sessions_recent ON sessions (source, last_seen_at DESC);
        CREATE TABLE activity (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          session_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          detail TEXT NOT NULL,
          room TEXT,
          color TEXT,
          phase TEXT,
          at INTEGER NOT NULL,
          time TEXT NOT NULL
        );
        CREATE INDEX activity_recent ON activity (source, at DESC, seq DESC);
        CREATE TABLE seen_events (
          source TEXT NOT NULL,
          key TEXT NOT NULL,
          seen_at INTEGER NOT NULL,
          PRIMARY KEY (source, key)
        );
        CREATE INDEX seen_events_recent ON seen_events (source, seen_at DESC);
        PRAGMA user_version = 1;
      `);
      legacy
        .prepare(`
          INSERT INTO sessions (
            source, id, name, agent, color, status, phase, last_status,
            last_outcome, room, parent_id, tool, detail, event_type, created_at,
            updated_at, last_seen_at, connected, terminated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          "live",
          "ses_legacy",
          "Legacy OpenCode",
          "build",
          "#123456",
          "Using shell",
          "running",
          "Thinking",
          null,
          "testing",
          null,
          "shell",
          "npm test",
          "session.tool.called",
          now - 10_000,
          now - 5_000,
          now - 5_000,
          1,
          null,
        );
      legacy
        .prepare(`
          INSERT INTO activity (
            source, session_id, name, type, detail, room, color, phase, at, time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          "live",
          "ses_legacy",
          "Legacy OpenCode",
          "session.tool.called",
          "npm test",
          "testing",
          "#123456",
          "running",
          now - 5_000,
          "10:00:00 AM",
        );
      legacy
        .prepare("INSERT INTO seen_events (source, key, seen_at) VALUES (?, ?, ?)")
        .run("live", JSON.stringify(["evt-legacy", "session.tool.called"]), now - 5_000);
    } finally {
      legacy.close();
    }

    let server = await startServer({ dbPath });
    try {
      let state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.agents.length, 1);
      const restored = state.agents[0];
      assert.equal(restored.id, "ses_legacy");
      assert.equal(restored.provider, "opencode");
      assert.equal(restored.name, "Legacy OpenCode");
      assert.equal(restored.color, "#123456");
      assert.equal(restored.phase, "offline");
      assert.equal(state.activity.length, 1);
      assert.equal(state.activity[0].provider, "opencode");
      assert.equal(state.activity[0].detail, "npm test");

      assert.equal(
        (
          await postProvider(server.base, "claude-code", {
            hook_event_name: "SessionStart",
            session_id: "ses_legacy",
            source: "startup",
            session_title: "Claude Legacy Collision",
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      const legacyPair = state.agents.filter((agent) => agent.id === "ses_legacy");
      assert.equal(legacyPair.length, 2);
      assert.equal(legacyPair.find((agent) => agent.provider === "opencode")?.color, "#123456");

      const db = new DatabaseSync(dbPath);
      try {
        const version = db.prepare("PRAGMA user_version").get() as {
          user_version: number;
        };
        assert.equal(version.user_version, 2);
        const rows = (
          db
            .prepare(
              "SELECT provider, id, color FROM sessions WHERE id = 'ses_legacy' ORDER BY provider",
            )
            .all() as Array<{ provider: string; id: string; color: string }>
        ).map((row) => ({ provider: row.provider, id: row.id, color: row.color }));
        const claudeRow = rows.find((row) => row.provider === "claude-code");
        assert.equal(claudeRow?.id, "ses_legacy");
        assert.notEqual(claudeRow?.color, "#123456");
        assert.deepEqual(
          rows.map((row) => ({
            provider: row.provider,
            id: row.id,
            color: row.provider === "opencode" ? row.color : "<distinct>",
          })),
          [
            { provider: "claude-code", id: "ses_legacy", color: "<distinct>" },
            { provider: "opencode", id: "ses_legacy", color: "#123456" },
          ],
        );
        const activity = db
          .prepare("SELECT COUNT(*) AS count FROM activity WHERE source = 'live'")
          .get() as { count: number };
        assert.ok(activity.count >= 2);
        const seen = db
          .prepare("SELECT provider FROM seen_events WHERE key = ?")
          .get(JSON.stringify(["evt-legacy", "session.tool.called"])) as
          | { provider: string }
          | undefined;
        assert.equal(seen?.provider, "opencode");
      } finally {
        db.close();
      }
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("partial v1 databases upgrade auxiliary tables", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-partial-migrate-"));
    const dbPath = path.join(dir, "partial.sqlite");
    const now = Date.now();
    const legacy = new DatabaseSync(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE activity (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          session_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          detail TEXT NOT NULL,
          room TEXT,
          color TEXT,
          phase TEXT,
          at INTEGER NOT NULL,
          time TEXT NOT NULL
        );
        CREATE TABLE seen_events (
          source TEXT NOT NULL,
          key TEXT NOT NULL,
          seen_at INTEGER NOT NULL,
          PRIMARY KEY (source, key)
        );
        PRAGMA user_version = 1;
      `);
      legacy
        .prepare(`
          INSERT INTO activity (
            source, session_id, name, type, detail, room, color, phase, at, time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          "live",
          "ses_partial",
          "Partial OpenCode",
          "session.tool.called",
          "partial activity",
          "coding",
          "#abcdef",
          "running",
          now,
          "10:00:00 AM",
        );
      legacy
        .prepare("INSERT INTO seen_events (source, key, seen_at) VALUES (?, ?, ?)")
        .run("live", JSON.stringify(["evt-partial", "session.tool.called"]), now);
    } finally {
      legacy.close();
    }

    const server = await startServer({ dbPath });
    try {
      const state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.agents.length, 0);
      assert.equal(state.activity.length, 1);
      assert.equal(state.activity[0].provider, "opencode");
      assert.equal(state.activity[0].detail, "partial activity");

      const db = new DatabaseSync(dbPath);
      try {
        const version = db.prepare("PRAGMA user_version").get() as {
          user_version: number;
        };
        assert.equal(version.user_version, 2);
        const activityColumns = (
          db.prepare("PRAGMA table_info(activity)").all() as Array<{ name: string }>
        ).map((row) => row.name);
        assert.ok(activityColumns.includes("provider"));
        assert.ok(activityColumns.includes("canonical_type"));
        const seenColumns = (
          db.prepare("PRAGMA table_info(seen_events)").all() as Array<{ name: string }>
        ).map((row) => row.name);
        assert.ok(seenColumns.includes("provider"));
        const seen = db
          .prepare("SELECT provider FROM seen_events WHERE key = ?")
          .get(JSON.stringify(["evt-partial", "session.tool.called"])) as
          | { provider: string }
          | undefined;
        assert.equal(seen?.provider, "opencode");
      } finally {
        db.close();
      }
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  await t.test("demo mode rejects live payloads and restores demo history", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-hq-demo-"));
    const dbPath = path.join(dir, "demo.sqlite");
    let server = await startServer({ dbPath, mode: "demo" });
    try {
      assert.equal(
        (
          await post(server.base, {
            type: "session.created",
            sessionId: "ses_live_attempt",
            agentName: "Live Attempt",
          })
        ).status,
        403,
      );
      let state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.agents.length, 0);
      assert.equal(
        (
          await post(server.base, {
            type: "session.created",
            sessionId: "ses_demo_history",
            agentName: "Demo History",
            demo: true,
            eventId: "evt-demo-history",
          })
        ).status,
        200,
      );
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.mode, "demo");
      assert.equal(state.agents[0].source, "demo");
      const color = state.agents[0].color;
      await server.stop();
      server = await startServer({ dbPath, mode: "demo" });
      state = await getJson<OfficeState>(`${server.base}/api/state`);
      assert.equal(state.agents.length, 1);
      assert.equal(state.agents[0].id, "ses_demo_history");
      assert.equal(state.agents[0].source, "demo");
      assert.equal(state.agents[0].connected, false);
      assert.equal(state.agents[0].status, "Offline");
      assert.equal(state.agents[0].color, color);
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
