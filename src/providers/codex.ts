import {
  CODEX_PROVIDER,
  type CanonicalEvent,
  type CanonicalEventType,
  type ProviderAdapter,
} from "./types.js";

/**
 * Adapter for Codex lifecycle command-hook payloads.
 *
 * Codex 0.162.0-alpha.17.2 exposes these stable hook events:
 *   SessionStart, SubagentStart, PreToolUse, PostToolUse, PreCompact,
 *   PostCompact, Stop, SubagentStop, Interrupt, SessionEnd.
 *
 * The hook script forwards only allowlisted metadata. This parser is defensive
 * when handed a full native payload too: prompts, assistant messages, transcript
 * paths, cwd, tool responses, and raw input bodies are never copied into the
 * canonical event. Codex reports tool hooks from a subagent with the parent
 * `session_id` plus an explicit `agent_id`; only that reported ID creates a
 * confirmed parent link.
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstText(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = text(value[key]);
    if (candidate) return candidate;
  }
  return "";
}

function toolDetail(tool: string, input: unknown): string {
  const value = record(input);
  const name = tool.toLowerCase();

  if (name === "bash" || name === "shell" || name === "exec_command") {
    return firstText(value, ["command", "cmd"]);
  }
  if (
    name === "read" ||
    name === "read_file" ||
    name === "write" ||
    name === "write_file" ||
    name === "edit" ||
    name === "edit_file" ||
    name === "apply_patch"
  ) {
    return firstText(value, ["file_path", "filePath", "path"]);
  }
  if (name === "glob" || name === "grep") {
    const pattern = firstText(value, ["pattern", "glob"]);
    const location = firstText(value, ["path", "file_path"]);
    return pattern && location ? `${pattern} in ${location}` : pattern || location;
  }
  if (name === "webfetch" || name === "fetch") {
    return firstText(value, ["url"]);
  }
  if (name === "websearch" || name === "search") {
    return firstText(value, ["query"]);
  }
  if (name === "spawn_agent" || name === "agent" || name === "task") {
    return firstText(value, ["agent_type", "subagent_type"]) || "subagent";
  }
  return "";
}

function event(
  partial: Omit<CanonicalEvent, "provider">,
): CanonicalEvent {
  return { provider: CODEX_PROVIDER, ...partial };
}

const SUPPORTED_EVENTS = new Set([
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
]);

const CANONICAL_TYPES: Record<string, CanonicalEventType> = {
  SessionStart: "session.created",
  SubagentStart: "session.created",
  PreToolUse: "session.tool.started",
  PostToolUse: "session.tool.success",
  PreCompact: "session.compaction.started",
  PostCompact: "session.compaction.ended",
  Stop: "session.turn.completed",
  SubagentStop: "session.turn.completed",
  Interrupt: "session.interrupted",
  SessionEnd: "session.terminated",
};

function eventIdFor(
  body: Record<string, unknown>,
  rawType: string,
  sessionId: string,
): string | undefined {
  // SessionStart/SessionEnd can recur for the same session (resume, clear,
  // restart) with the same source/reason. They deliberately have no synthetic
  // event ID, so a genuine new lifecycle event is not mistaken for a duplicate.
  if (rawType === "SessionStart" || rawType === "SessionEnd") return undefined;

  const turnId = text(body.turn_id);
  const agentId = text(body.agent_id);

  if (rawType === "SubagentStart" || rawType === "SubagentStop") {
    if (agentId) {
      return `${sessionId}:${rawType}:${agentId}:${turnId || "no-turn"}`;
    }
  }
  if (rawType === "PreToolUse" || rawType === "PostToolUse") {
    const useId = text(body.tool_use_id);
    if (useId) return `${sessionId}:${rawType}:${useId}`;
  }
  if (rawType === "PreCompact" || rawType === "PostCompact") {
    if (turnId) return `${sessionId}:${rawType}:${turnId}:${text(body.trigger) || "auto"}`;
  }
  if (rawType === "Stop" || rawType === "Interrupt") {
    if (turnId) return `${sessionId}:${rawType}:${turnId}`;
  }
  return undefined;
}

export const codexAdapter: ProviderAdapter = {
  id: CODEX_PROVIDER,
  displayName: "Codex",
  parse(payload) {
    const body = record(payload);
    const rawType = text(body.hook_event_name);
    const mainSessionId = text(body.session_id);
    if (!rawType || !mainSessionId || !SUPPORTED_EVENTS.has(rawType)) return null;

    const agentId = text(body.agent_id);
    const agentType = text(body.agent_type);
    const isSubagentLifecycle = rawType === "SubagentStart" || rawType === "SubagentStop";
    const isSubagentEvent = isSubagentLifecycle || Boolean(agentId);
    if (isSubagentLifecycle && !agentId) return null;

    const sessionId = isSubagentEvent ? agentId : mainSessionId;
    if (!sessionId) return null;
    const parentSessionId =
      isSubagentEvent && mainSessionId !== sessionId ? mainSessionId : undefined;

    const toolName = text(body.tool_name);
    const toolInput = record(body.tool_input);
    const trigger = text(body.trigger);
    const canonicalType = CANONICAL_TYPES[rawType] ?? "session.event";

    const detail =
      rawType === "SessionStart"
        ? text(body.source) || "startup"
        : rawType === "SubagentStart"
          ? `${agentType || "Codex"} subagent`
          : rawType === "PreCompact" || rawType === "PostCompact"
            ? `compaction ${trigger || "auto"}`
            : rawType === "Stop" || rawType === "SubagentStop"
              ? "turn completed"
              : rawType === "Interrupt"
                ? "turn interrupted"
                : rawType === "SessionEnd"
                  ? `Session ended (${text(body.reason) || "other"})`
                  : toolName
                    ? toolDetail(toolName, toolInput) || toolName
                    : undefined;

    return event({
      type: canonicalType,
      rawType,
      sessionId,
      parentSessionId,
      name:
        rawType === "SubagentStart"
          ? `${agentType || "Codex"} subagent`
          : undefined,
      agent: agentType || undefined,
      tool: toolName || undefined,
      detail,
      eventId: eventIdFor(body, rawType, sessionId),
    });
  },
};
