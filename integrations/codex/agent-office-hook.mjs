#!/usr/bin/env node
/**
 * Agent HQ observer hook for Codex command hooks.
 *
 * Codex 0.162.0-alpha.17.2 reports `hooks` as a stable feature. Install this
 * command handler for the events in `hooks.example.json`. It is strictly
 * observational:
 *   - reads the hook payload from stdin
 *   - forwards only allowlisted metadata to the local Agent HQ bridge
 *   - prints nothing, returns exit code 0, and never asks Codex to continue,
 *     block, approve, or change a tool call
 *
 * Prompts, assistant messages, transcript paths, cwd, model/permission state,
 * tool responses, and raw tool input bodies are deliberately not forwarded.
 * The one tool input value forwarded is a redacted shell command for the Bash
 * tool, so the dashboard can show the observed tool activity.
 */

import process from "node:process";

const DEFAULT_BRIDGE = "http://127.0.0.1:4318";
const REQUEST_TIMEOUT_MS = 800;
const MAX_INPUT_BYTES = 8_000_000;
const MAX_DETAIL_CHARS = 160;

function text(value) {
  return typeof value === "string" ? value : "";
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Scrub free-form text at the hook boundary. The bridge repeats this before
 * persistence, but credentials must not leave Codex in the first place.
 */
function cleanText(value, max = MAX_DETAIL_CHARS) {
  let clean = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  clean = clean.replace(
    /(--(?:password|passwd|token|api[_-]?key|secret|auth[_-]?token)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1[redacted]",
  );
  clean = clean.replace(
    /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|private[_-]?key|client[_-]?secret|secret|password|passwd|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1[redacted]",
  );
  clean = clean.replace(/(bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, "$1[redacted]");
  clean = clean.replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[redacted]@");
  clean = clean.replace(
    /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s,;]+)/g,
    "$1=[redacted]",
  );
  clean = clean.replace(
    /\$(?:env:)?([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)/g,
    "[env]",
  );
  clean = clean.replace(
    /\b(?:ghp_|gho_|ghu_|ghs_|ghr_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g,
    "[redacted]",
  );

  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function toolInput(toolName, raw) {
  const input = record(raw);
  const name = toolName.toLowerCase();
  const picked = {};

  // A shell command is the only tool argument needed for room/activity display.
  // apply_patch and MCP/tool arguments can contain file contents, diffs, or
  // user prompt text, so they are intentionally dropped.
  if (name === "bash" || name === "shell" || name === "exec_command") {
    for (const key of ["command", "cmd"]) {
      const value = cleanText(text(input[key]));
      if (value) picked[key] = value;
    }
  }

  return picked;
}

function safePayload(raw) {
  const event = record(raw);
  const hookEventName = text(event.hook_event_name);
  const toolName = text(event.tool_name);
  const payload = {
    hook_event_name: hookEventName,
    session_id: text(event.session_id),
    turn_id: text(event.turn_id),
    agent_id: text(event.agent_id),
    agent_type: cleanText(text(event.agent_type), 60),
    tool_name: cleanText(toolName, 60),
    tool_use_id: text(event.tool_use_id),
    source: text(event.source),
    reason: text(event.reason),
    trigger: text(event.trigger),
    tool_input: toolInput(toolName, event.tool_input),
  };

  for (const key of Object.keys(payload)) {
    if (payload[key] === "" || payload[key] === undefined) delete payload[key];
  }
  if (Object.keys(payload.tool_input).length === 0) delete payload.tool_input;
  return payload;
}

async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > MAX_INPUT_BYTES) break;
  }
  return input;
}

function endpoint() {
  const configured = (process.env.AGENT_OFFICE_URL || DEFAULT_BRIDGE)
    .trim()
    .replace(/\/+$/, "");
  if (!configured) return `${DEFAULT_BRIDGE}/events/codex`;
  if (configured.endsWith("/events/codex")) return configured;
  // Accept the same base or /events URL documented for the other providers.
  if (configured.endsWith("/events")) return `${configured}/codex`;
  return `${configured}/events/codex`;
}

async function main() {
  const input = await readStdin();
  if (!input.trim()) return;

  let raw;
  try {
    raw = JSON.parse(input);
  } catch {
    return;
  }

  const payload = safePayload(raw);
  if (!payload.hook_event_name || !payload.session_id) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // The bridge may be closed. Observation must never affect Codex.
  } finally {
    clearTimeout(timer);
  }
}

try {
  await main();
} catch {
  // Observation must never affect Codex, even on an unexpected error.
}
process.exitCode = 0;
