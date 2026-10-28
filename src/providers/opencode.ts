import {
  OPENCODE_PROVIDER,
  type CanonicalEventType,
  type ProviderAdapter,
} from "./types.js";

/**
 * The existing OpenCode plugin payload is now one adapter among several. The
 * top-level shape is unchanged: `type`, `sessionId`, `agentName`, `eventId`,
 * and `detail` are still accepted exactly as before.
 */
const CANONICAL_TYPES: Record<string, CanonicalEventType> = {
  "session.created": "session.created",
  "session.renamed": "session.metadata.updated",
  "session.updated": "session.metadata.updated",
  "session.metadata.updated": "session.metadata.updated",
  "session.agent.selected": "session.metadata.updated",
  "session.status": "session.status",
  "session.idle": "session.idle",
  "session.execution.started": "session.execution.started",
  "session.execution.succeeded": "session.execution.succeeded",
  "session.execution.failed": "session.execution.failed",
  "session.execution.interrupted": "session.interrupted",
  "session.interrupted": "session.interrupted",
  "session.deleted": "session.terminated",
  "session.closed": "session.terminated",
  "session.closing": "session.terminated",
  "session.destroyed": "session.terminated",
  "session.error": "session.error",
  "session.retry.scheduled": "session.retry.scheduled",
  "session.compaction.started": "session.compaction.started",
  "session.compaction.ended": "session.compaction.ended",
  "session.compaction.failed": "session.compaction.failed",
  "session.skill.activated": "session.skill.activated",
  "session.tool.started": "session.tool.started",
  "session.tool.called": "session.tool.started",
  "session.tool.progress": "session.tool.progress",
  "session.tool.success": "session.tool.success",
  "session.tool.failed": "session.tool.failed",
  "tool.execute.before": "session.tool.started",
  "tool.execute.after": "session.tool.success",
  "file.edited": "file.edited",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const openCodeAdapter: ProviderAdapter = {
  id: OPENCODE_PROVIDER,
  displayName: "OpenCode",
  parse(payload) {
    const body = record(payload);
    const type = text(body.type);
    const sessionId = text(body.sessionId);
    if (!type || !sessionId) return null;

    const detail = record(body.detail);
    return {
      provider: OPENCODE_PROVIDER,
      type: CANONICAL_TYPES[type] ?? "session.event",
      rawType: type,
      sessionId,
      parentSessionId: text(detail.parentID) || undefined,
      name: text(body.agentName) || undefined,
      agent: text(detail.agent) || undefined,
      tool: text(detail.tool) || undefined,
      detail: text(detail.description) || undefined,
      status: text(detail.status) || undefined,
      eventId: text(body.eventId) || undefined,
    };
  },
};
