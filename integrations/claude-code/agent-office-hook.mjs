#!/usr/bin/env node
/**
 * Agent HQ observer hook for Claude Code.
 *
 * Install this as a command hook for the lifecycle events listed in
 * `settings.example.json`. It is strictly observational:
 *   - reads the hook payload from stdin
 *   - forwards only allowlisted metadata to the local Agent HQ bridge
 *   - prints nothing, returns exit code 0, and never asks Claude to continue,
 *     block, approve, or change a tool call
 *
 * Prompts, assistant messages, transcript paths, cwd, and tool result bodies
 * are deliberately not forwarded.
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
 * persistence, but credentials must not leave Claude Code in the first place.
 */
function cleanText(value, max = MAX_DETAIL_CHARS) {
  let text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(
    /(--(?:password|passwd|token|api[_-]?key|secret|auth[_-]?token)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1[redacted]",
  );
  text = text.replace(
    /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|private[_-]?key|client[_-]?secret|secret|password|passwd|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1[redacted]",
  );
  text = text.replace(/(bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, "$1[redacted]");
  text = text.replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[redacted]@");
  text = text.replace(
    /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s,;]+)/g,
    "$1=[redacted]",
  );
  text = text.replace(
    /\$(?:env:)?([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)/g,
    "[env]",
  );
  text = text.replace(
    /\b(?:ghp_|gho_|ghu_|ghs_|ghr_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g,
    "[redacted]",
  );

  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Tool failures can include command output. Only the first line is useful for
 * the office, and dropping the rest avoids forwarding file contents or diffs
 * that a failed command may have printed.
 */
function errorSummary(value) {
  return cleanText(text(value).split(/\r?\n/, 1)[0] || "");
}

function toolInput(toolName, raw) {
  const input = record(raw);
  const name = toolName.toLowerCase();
  const picked = {};

  const copy = (key) => {
    const value = cleanText(text(input[key]));
    if (value) picked[key] = value;
  };

  if (name === "bash" || name === "powershell" || name === "shell") {
    copy("command");
    copy("description");
  } else if (name === "read" || name === "write" || name === "edit" || name === "multiedit") {
    copy("file_path");
    copy("filePath");
    copy("path");
  } else if (name === "glob" || name === "grep") {
    copy("pattern");
    copy("glob");
    copy("path");
  } else if (name === "webfetch" || name === "fetch") {
    copy("url");
  } else if (name === "websearch" || name === "search") {
    copy("query");
  } else if (name === "agent" || name === "task" || name === "subagent") {
    // The Agent/Task description can carry task text. The subagent type is
    // enough for the dashboard and cannot be mistaken for a prompt.
    copy("subagent_type");
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
    prompt_id: text(event.prompt_id),
    agent_id: text(event.agent_id),
    agent_type: cleanText(text(event.agent_type), 60),
    tool_name: cleanText(toolName, 60),
    tool_use_id: text(event.tool_use_id),
    source: text(event.source),
    reason: text(event.reason),
    session_title: cleanText(text(event.session_title), 60),
    error: errorSummary(event.error),
    error_details: errorSummary(event.error_details),
    is_interrupt: event.is_interrupt === true,
    duration_ms: Number.isFinite(event.duration_ms) ? event.duration_ms : undefined,
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
  if (!configured) return `${DEFAULT_BRIDGE}/events/claude-code`;
  if (configured.endsWith("/events/claude-code")) return configured;
  // Accept the same base or /events URL documented for the OpenCode plugin.
  if (configured.endsWith("/events")) return `${configured}/claude-code`;
  return `${configured}/events/claude-code`;
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
    // The bridge may be closed. Observation must never affect Claude Code.
  } finally {
    clearTimeout(timer);
  }
}

try {
  await main();
} catch {
  // Observation must never affect Claude Code, even on an unexpected error.
}
process.exitCode = 0;
