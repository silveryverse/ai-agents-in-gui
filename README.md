# Agent HQ - Pixel Office

**Rajat Rawat** · [Portfolio](https://rajatrawat.netlify.app/)

A local, read-only window into coding-agent sessions.

Agent HQ turns each observed session and subagent into a character in a small
pixel-art office. Characters walk to rooms that match their observed activity,
while a live event log and inspector show factual state from provider events.
It is an observer, not a control plane: it never sends prompts, approves tools,
stops sessions, or changes model/provider configuration.

![Agent HQ dashboard](dashboard.png)

*The screenshot shows explicit demo mode. Demo and live traffic use separate
databases and are never mixed.*

## Why it exists

Most agent dashboards show a spinner and a token count. Agent HQ shows what was
actually observed: which session started, which tool was used, who delegated to
whom, what room that activity maps to, and whether the last confirmed outcome
was completion, failure, interruption, or termination.

The map is decorative. The state is not invented.

## Highlights

- **Walkable pixel office** - seven connected rooms, collision, pathfinding,
  doors, furniture, plants, animated monitors, and original procedural sprites.
- **Provider-scoped identity** - sessions are keyed by
  `(source, provider, id)`. OpenCode, Claude Code, and Codex can reuse the same
  session ID without overwriting each other.
- **Confirmed parent links** - subagents are linked only when the provider
  reports explicit parent/child IDs. Similar names never create a hierarchy.
- **SQLite history** - session identity, colors, parent links, recent activity,
  and event dedupe keys survive a bridge restart.
- **Honest recovery** - unfinished sessions return as `Offline`; terminated
  sessions remain `Session closed`. History is never presented as current work.
- **Reconnect handling** - the browser keeps the last-known picture, marks it
  STALE, and reconnects with a fresh snapshot.
- **Live/demo isolation** - separate default databases, explicit provenance,
  and server-side rejection of cross-mode traffic.
- **Read-only observer** - no prompt injection, tool approval, stop control, or
  provider mutation.

## Current verification status

Last checked on **2026-10-28** with Node `v22.23.2`:

| Provider | Integration | Real-session verification |
| :- | :- | :- |
| OpenCode | Local observer plugin | **Yes.** Live sessions, tool activity, subagents, parent links, failures, and restart recovery verified. |
| Claude Code | Official command hooks | Hook adapter, real hook process, HTTP ingestion, isolation, redaction, and persistence tested. **No Claude Code CLI was available for a live turn.** |
| Codex | Stable command hooks | Exact hook registration and real unauthenticated `SessionStart`/`SessionEnd` lifecycle verified. **Authenticated tool, subagent, and compaction activity remains outstanding because Codex is not logged in.** |

Automated checks:

```text
npm run typecheck  -> passed
npm test           -> 12 passed, 0 failed
```

The test suite starts real server processes on temporary ports and temporary
SQLite files. It does not touch the live bridge or the live database.

## Requirements

- Windows 10 or 11 (PowerShell examples below)
- Node.js 22.13 or newer with the built-in `node:sqlite` module
  - Verified with Node `v22.23.2`
- A modern browser
- Optional: OpenCode with the local observer plugin
- Optional: Claude Code with command hooks
- Optional: Codex 0.162 or newer with stable command hooks

`node:sqlite` is still experimental, so Node prints an `ExperimentalWarning` at
startup. That warning is expected.

## Quick start

```powershell
cd D:\opencode\agents-gui
npm install
npm start
```

Open:

```text
http://127.0.0.1:4318/
```

For development with automatic restart:

```powershell
npm run dev
```

### Run detached in the background

```powershell
New-Item -ItemType Directory -Force data | Out-Null
Start-Process cmd.exe `
  -ArgumentList '/c', 'npm start > data\bridge.log 2>&1' `
  -WorkingDirectory 'D:\opencode\agents-gui' `
  -WindowStyle Hidden
```

Check the bridge:

```powershell
Invoke-RestMethod http://127.0.0.1:4318/health | ConvertTo-Json -Depth 5
Get-Content D:\opencode\agents-gui\data\bridge.log -Tail 20
```

### Demo mode

Demo mode uses a separate database and rejects live traffic. Use another port so
a live bridge can keep running:

```powershell
$env:AGENT_OFFICE_DEMO = "1"
$env:AGENT_OFFICE_PORT = "4319"
cd D:\opencode\agents-gui
npm start
```

Open `http://127.0.0.1:4319/`.

Clear the variables to return to live mode:

```powershell
Remove-Item Env:AGENT_OFFICE_DEMO -ErrorAction SilentlyContinue
Remove-Item Env:AGENT_OFFICE_PORT -ErrorAction SilentlyContinue
```

## Provider setup

Agent HQ supports three providers. Each has a separate adapter and its own
read-only observer.

### OpenCode

The observer lives outside this repository:

```text
%USERPROFILE%\.config\opencode\plugins\agent-office.ts
```

It posts curated session metadata and allow-listed tool details to:

```text
http://127.0.0.1:4318/events
```

Restart OpenCode after installing or changing the plugin. If the bridge is
closed, the plugin drops observations rather than interrupting work.

### Claude Code

Files:

```text
integrations\claude-code\agent-office-hook.mjs
integrations\claude-code\settings.example.json
```

1. Merge the `hooks` object from `settings.example.json` into
   `%USERPROFILE%\.claude\settings.json` or project `.claude\settings.json`.
   Do not replace unrelated settings.
2. In Claude Code, run `/hooks`, review the new handlers, and trust them.
3. Restart Claude Code.

The hook reads JSON from stdin, forwards only allow-listed metadata, prints
nothing, and exits 0. It cannot prompt, approve, block, stop, or change a model.
The example uses absolute paths for this checkout; update them if the repository
moves. If your Claude Code version lacks exec-form support, use the equivalent
shell-form command.

### Codex

Files:

```text
integrations\codex\agent-office-hook.mjs
integrations\codex\hooks.example.json
```

1. Confirm Codex is signed in:

   ```powershell
   codex login status
   ```

2. Merge the `hooks` object from `hooks.example.json` into
   `%USERPROFILE%\.codex\hooks.json` or `%CODEX_HOME%\hooks.json`.
3. In Codex, run `/hooks`, review the ten handlers, and trust them.
4. Restart Codex.

Codex command hooks are shell command strings, not Claude-style `args` arrays.
The example config includes both `command` and `commandWindows` using this
checkout's absolute path; update both if the repository moves.

Normal setup should trust hooks through `/hooks`. The
`--dangerously-bypass-hook-trust` flag is intended for vetted automation, not
routine use.

Codex `PostToolUse` means the tool call **finished**, not that it succeeded.
Agent HQ labels it `Tool finished`. Codex 0.162 has no dedicated tool-failure or
turn-error hook, so the bridge does not invent one.

### Custom bridge URL or port

The bridge binds only to `127.0.0.1` and defaults to port `4318`.

```powershell
$env:AGENT_OFFICE_PORT = "4320"
$env:AGENT_OFFICE_URL = "http://127.0.0.1:4320/events"
cd D:\opencode\agents-gui
npm start
```

Set `AGENT_OFFICE_URL` in the environment each provider inherits, then restart
that provider. The hooks accept a base URL, `/events`, a trailing slash, or the
full provider endpoint.

## How it works

```text
OpenCode plugin  ─┐
Claude Code hook ─┼─> POST /events/:provider
Codex hook       ─┘         |
                            v
                     provider adapter
                            |
                            v
              provider-scoped in-memory state
                     |              |
                     v              v
                  SQLite        WebSocket
                                    |
                                    v
                             browser dashboard
```

Each adapter converts provider-specific payloads into a small canonical event
model. The server owns session lifecycle, dedupe, persistence, and WebSocket
broadcasts. The browser only renders the state it receives.

### Provider identity

Every agent and activity item carries an additive `provider` field. Internal
identity is:

```text
(source, provider, id)
```

These are different sessions:

```text
(live, opencode,    ses_shared)
(live, claude-code, ses_shared)
(live, codex,       ses_shared)
```

Session IDs stay exactly as reported. Missing `provider` defaults to `opencode`
for backward compatibility with older OpenCode clients.

### Parent links

A parent/child relationship requires an explicit provider-reported pair:

- Claude Code: `session_id` + `agent_id`
- Codex: `session_id` + `agent_id`
- OpenCode: explicit `parentID`

Names, agent types, timestamps, and visual proximity are never used to infer
parentage.

## Dashboard behavior

- **Crew filters**: All includes history. Active, Working, Idle, and Errored
  describe current connectivity; historical sessions do not count as active.
- **Badges**: `DEMO`, `SUB`, `OFFLINE`, and `STALE` are distinct. Terminated
  sessions show `CLOSED` in the inspector.
- **Inspector**: session ID, provider, connection state, last status, last
  outcome, parent link, last seen time, and last observed event.
- **Map**: restored sessions are dimmed and idle. Success/error reactions and
  delegation huddles require current, confirmed events.
- **Camera**: drag to pan, wheel or `+`/`-` to zoom, `0` to reset, `Esc` to clear
  selection.
- **Event log**: safe activity details with a HISTORY badge for restored items.
- **Reconnect**: while the bridge is unreachable, the last-known roster stays
  visible but is marked STALE and the connection label shows `Reconnecting...`.

The dashboard is intentionally read-only. It cannot approve tools, answer
prompts, stop agents, or change configuration.

## API and WebSocket

### `GET /health`

Returns mode, agent counts, connected/historical counts, live/demo counts,
per-provider counts, WebSocket clients, uptime, persistence mode, and database
health. It does not return database contents or file paths.

### `GET /api/state`

```json
{
  "mode": "live",
  "agents": [],
  "activity": []
}
```

Agent fields include:

```text
id, provider, name, status, room, x, y, color, source, parentID, agent, tool,
detail, eventType, canonicalEventType, createdAt, updatedAt, lastSeenAt,
connected, historical, phase, lastStatus, lastOutcome, terminatedAt
```

Activity items add `provider` and `canonicalType`.

### `POST /events/:provider`

Registered endpoints:

```text
POST /events/opencode
POST /events/claude-code
POST /events/codex
```

`POST /events` remains the backward-compatible OpenCode endpoint. The provider
field defaults to `opencode`. A provider mismatch returns HTTP 400; an unknown
provider returns HTTP 404. Request bodies are limited to 32 KB.

### WebSocket

Connect to `ws://127.0.0.1:4318/`. The server immediately sends:

```json
{ "type": "update", "mode": "live", "agents": [], "activity": [] }
```

Subsequent updates use the same shape. The server sends heartbeats and
terminates dead sockets.

### Live/demo isolation

Live mode rejects `demo: true` payloads with HTTP 403. Demo mode rejects live
payloads. The default databases are separate:

```text
data\agent-office-live.sqlite
data\agent-office-demo.sqlite
```

SQLite creates `-wal` and `-shm` sidecars. They are runtime files and are
ignored by version control. Override the path with:

```powershell
$env:AGENT_OFFICE_DB = "D:\agent-hq\office.sqlite"
npm start
```

Even when a single file is shared, every query and write is filtered by
`source` (`live` or `demo`).

## Persistence and recovery

SQLite stores provider, session IDs, names, colors, agent names, confirmed parent
IDs, last room/status/event metadata, recent activity, and dedupe keys.

On startup, sessions that were not terminated are restored as:

```text
status: Offline
phase: offline
connected: false
historical: true
lastStatus: the last observed status before shutdown
```

A new event revives only that session and reuses its original color. Other
sessions stay historical.

Retention defaults:

- Public activity feed: 100 items
- Persisted activity: approximately 500 rows
- Restored sessions: approximately 100
- Disconnected session/activity age limit: 30 days
- Event dedupe keys: 10,000 rows or 1 hour, whichever is smaller
- Cleanup: after every 100 writes, with parent sessions protected while children
  still reference them

The bridge migrates the original OpenCode-only schema in place. Existing
sessions, activity, colors, parent links, and dedupe keys become provider-scoped
OpenCode rows. A failed migration rolls back and the bridge falls back to memory
instead of serving a half-migrated database.

If SQLite cannot open or a write fails, `/health` reports
`persistence: "memory"` and `databaseOk: false`. The dashboard keeps working, but
history will not survive a restart.

Back up the database and its sidecars before a major upgrade if you want an
extra rollback point. Do not delete a corrupt database if you may want to recover
it; move it aside and start with a fresh file.

## Security and privacy

- The server binds to `127.0.0.1` only. Do not expose the port publicly.
- There is no authentication. Any local process or user that can reach the port
  can read the dashboard and post events. This is a single-user local tool.
- The OpenCode observer uses an allow-list and never sends prompts, message
  text, reasoning, diffs, or file contents.
- The Claude Code hook drops prompts, assistant messages, transcript paths,
  cwd, tool responses, raw input bodies, and `Agent`/`Task` descriptions/prompts.
  It forwards only the first line of an error, bounded and scrubbed for secrets.
- The Codex hook drops prompts, assistant messages, transcript paths, cwd,
  model/permission state, tool responses, patch/file bodies, and raw MCP/tool
  input. It forwards only a redacted shell command for the Bash tool.
- The bridge never writes prompts, file contents, diffs, or environment values
  to SQLite. Activity can still contain commands and paths, so treat the local
  dashboard and `data` directory as sensitive.
- Request bodies are limited to 32 KB. Activity details are length-bounded and
  scrubbed for common secrets, bearer tokens, URL credentials, environment-style
  assignments, and CLI secret flags.
- `/health` exposes counts and status, not database contents or file paths.

The hooks are observational: they print nothing, exit 0, and never return an
approval or control decision. If the bridge is down, they drop the observation.

## Testing

```powershell
cd D:\opencode\agents-gui
npm run typecheck
npm test
```

Coverage includes:

- API contract, validation, initial WebSocket snapshot, and updates
- Session lifecycle, tool activity, completion, interruption, failure, and
  termination
- Concurrent sessions and provider isolation with identical session IDs
- Stable colors and parent links across restart
- Duplicate event replay across restart
- SQLite migration, restoration, retention, and memory fallback
- Live/demo isolation
- Secret redaction and hook-boundary payload checks
- Claude Code and Codex documented hook payloads, registration, dedupe, and
  malformed input handling
- Multiple simultaneous Claude Code/Codex sessions with identical tool IDs

See [README.full.md](README.full.md) for the complete verification record,
measured results, and detailed troubleshooting.

## Troubleshooting

| Symptom | Check |
| :- | :- |
| Dashboard says `Reconnecting...` | Start the bridge and check `/health`. |
| No OpenCode agents | Confirm the plugin path, bridge URL, and that OpenCode was restarted. |
| No Claude Code sessions | Confirm settings JSON, absolute hook path, and `/hooks` trust. |
| No Codex sessions | Confirm `hooks.json`, absolute hook path, `/hooks` trust, and `codex login status`. |
| `EADDRINUSE` | Another bridge is using port 4318; stop it or set `AGENT_OFFICE_PORT`. |
| `persistence: memory` | Check Node version and database path permissions. |
| All sessions became Offline | Expected after restart until a new event arrives. |
| SQLite experimental warning | Expected with Node's built-in `node:sqlite`. |
| Live events return 403 | The bridge is in the wrong mode; live and demo payloads cannot mix. |

## Limitations

- This is an event observer, not a process monitor. If a provider exits without
  a termination event, the bridge keeps the last observed state until the next
  event or restart.
- Disconnect detection is based on the bridge/WebSocket state, not a per-session
  heartbeat.
- Tool descriptions and room mapping are heuristic presentation, not execution
  proof.
- Event names and payload shapes vary by provider version.
- Claude Code live CLI verification is outstanding in this environment.
- Authenticated Codex model turns, tool calls, subagents, and compaction have
  not been observed. The registration, lifecycle path, hook process, and
  documented payloads are tested; no signed-in Codex account is available.
- Codex `PostToolUse` means finished, not successful. `Stop` and `SubagentStop`
  mean a turn ended, not that the task succeeded.
- Codex tool, subagent, and compaction hooks are asynchronous. A hard process
  kill can drop an in-flight observation; `SessionEnd` is synchronous.
- IDE/app-server-hosted Codex threads were not verified end-to-end as a hook
  source. The verified path is the Codex CLI/exec hook interface.
- Observers drop events while the bridge is down. History is not a complete
  audit log.
- SQLite uses Node's experimental `node:sqlite` module.
- The dashboard cannot approve tools, answer prompts, stop agents, or change
  configuration.

## Project layout

```text
src/server.ts             HTTP/WebSocket bridge, ingest, lifecycle
src/model.ts              Shared Agent, ActivityItem, and PublicState types
src/persistence.ts        SQLite schema/migration, restore, dedupe, retention
src/sanitize.ts           Payload validation and secret redaction
src/providers/            Canonical event model and provider adapters
public/                   Dashboard, map, sprites, overlays, styles
integrations/claude-code/ Claude Code hook script and example settings
integrations/codex/       Codex hook script and example hooks.json
tests/integration.test.ts Spawned-server, provider, migration, hook tests
data/                     Runtime SQLite databases and logs (ignored)
dashboard.png             Demo-mode screenshot
README.full.md            Detailed engineering reference and verification log
```

## Related documentation

- [README.full.md](README.full.md) - full setup, event mappings, measured
  verification results, and troubleshooting
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Codex app-server protocol](https://developers.openai.com/codex/app-server) -
  used only to inspect hook registration, not as a runtime control channel

## License

`package.json` declares the ISC license, but no `LICENSE` file is included.
Confirm the intended licensing before redistributing this repository.
