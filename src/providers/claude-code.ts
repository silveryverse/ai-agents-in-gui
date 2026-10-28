import {
  CLAUDE_CODE_PROVIDER,
  type CanonicalEvent,
  type CanonicalEventType,
  type ProviderAdapter,
} from "./types.js";

/**
 * Adapter for Claude Code command-hook payloads.
 *
 * Documented lifecycle hooks used by the integration:
 *   SessionStart, SubagentStart, PreToolUse, PostToolUse, PostToolUseFailure,
 *   Stop, SubagentStop, StopFailure, SessionEnd.
 *
 * The hook script sends only the fields needed here. This parser is also
 * defensive when handed a full native payload: prompts, assistant text,
 * transcript paths, cwd, and tool result bodies are never copied into the
 * canonical event.
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

  if (name === "bash" || name === "powershell" || name === "shell") {
    return firstText(value, ["command"]);
  }
  if (name === "read" || name === "write" || name === "edit" || name === "multiedit") {
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
  if (name === "agent" || name === "task" || name === "subagent") {
    return firstText(value, ["subagent_type"]) || "subagent";
  }
  return "";
}

function toolEventId(
  payload: Record<string, unknown>,
  rawType: string,
  sessionId: string,
): string | undefined {
  const useId = text(payload.tool_use_id);
  if (useId) return `${sessionId}:${rawType}:${useId}`;
  const promptId = text(payload.prompt_id);
  return promptId ? `${sessionId}:${rawType}:prompt:${promptId}` : undefined;
}

function eventIdFor(
  payload: Record<string, unknown>,
  rawType: string,
  sessionId: string,
): string | undefined {
  // SessionStart/SessionEnd can recur for the same session (resume, restart,
  // clear) with the same source/reason. They deliberately have no synthetic
  // event ID, so a genuine new lifecycle event is not mistaken for a duplicate.
  if (rawType === "SessionStart" || rawType === "SessionEnd") {
    return undefined;
  }
  if (rawType === "SubagentStart" || rawType === "SubagentStop") {
    const agentId = text(payload.agent_id);
    if (agentId) return `${sessionId}:${rawType}:${agentId}`;
  }
  if (
    rawType === "PreToolUse" ||
    rawType === "PostToolUse" ||
    rawType === "PostToolUseFailure"
  ) {
    return toolEventId(payload, rawType, sessionId);
  }
  if (rawType === "Stop" || rawType === "StopFailure") {
    const promptId = text(payload.prompt_id);
    return promptId ? `${sessionId}:${rawType}:${promptId}` : undefined;
  }
  return undefined;
}

function event(
  partial: Omit<CanonicalEvent, "provider">,
): CanonicalEvent {
  return { provider: CLAUDE_CODE_PROVIDER, ...partial };
}

const SUPPORTED_EVENTS = new Set([
  "SessionStart",
  "SubagentStart",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SubagentStop",
  "StopFailure",
  "SessionEnd",
]);

export const claudeCodeAdapter: ProviderAdapter = {
  id: CLAUDE_CODE_PROVIDER,
  displayName: "Claude Code",
  parse(payload) {
    const body = record(payload);
    const rawType = text(body.hook_event_name);
    const mainSessionId = text(body.session_id);
    if (!rawType || !mainSessionId || !SUPPORTED_EVENTS.has(rawType)) return null;

    const agentId = text(body.agent_id);
    const agentType = text(body.agent_type);
    const isSubagentEvent = rawType === "SubagentStart" || rawType === "SubagentStop";
    const sessionId = isSubagentEvent || agentId ? agentId : mainSessionId;
    if (!sessionId) return null;

    const parentSessionId = agentId && !isSubagentEvent ? mainSessionId : undefined;
    const eventId = eventIdFor(body, rawType, sessionId);
    const toolName = text(body.tool_name);
    const toolInput = record(body.tool_input);
    const canonicalType: CanonicalEventType =
      rawType === "SessionStart" || rawType === "SubagentStart"
        ? "session.created"
        : rawType === "PreToolUse"
          ? "session.tool.started"
          : rawType === "PostToolUse"
            ? "session.tool.success"
            : rawType === "PostToolUseFailure"
              ? "session.tool.failed"
              : rawType === "Stop" || rawType === "SubagentStop"
                ? "session.turn.completed"
                : rawType === "StopFailure"
                  ? "session.error"
                  : rawType === "SessionEnd"
                    ? "session.terminated"
                    : "session.event";

    const detail =
      rawType === "SessionStart"
        ? text(body.source) || "startup"
        : rawType === "SubagentStart"
          ? `${agentType || "Claude Code"} subagent`
          : rawType === "PostToolUseFailure" || rawType === "StopFailure"
            ? text(body.error_details) || text(body.error) || "Tool failed"
            : rawType === "Stop" || rawType === "SubagentStop"
              ? "turn completed"
              : rawType === "SessionEnd"
                ? `Session ended (${text(body.reason) || "other"})`
                : toolName
                  ? toolDetail(toolName, toolInput) || toolName
                  : undefined;

    return event({
      type: canonicalType,
      rawType,
      sessionId,
      parentSessionId: isSubagentEvent ? mainSessionId : parentSessionId,
      name:
        rawType === "SessionStart"
          ? text(body.session_title) || undefined
          : rawType === "SubagentStart"
            ? `${agentType || "Claude Code"} subagent`
            : undefined,
      agent: agentType || undefined,
      tool: toolName || undefined,
      detail,
      eventId,
    });
  },
};
