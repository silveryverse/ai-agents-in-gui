/**
 * Provider-neutral event model.
 *
 * The bridge is deliberately not tied to one coding agent. Each integration
 * normalizes its own lifecycle stream into these events before the server
 * touches session state or SQLite. Provider-specific session IDs stay intact;
 * the server scopes them with `provider`.
 */

export const DEFAULT_PROVIDER = "opencode";
export const OPENCODE_PROVIDER = "opencode";
export const CLAUDE_CODE_PROVIDER = "claude-code";
export const CODEX_PROVIDER = "codex";

export type ProviderId = string;

/**
 * Canonical lifecycle vocabulary used internally by the server. Several
 * OpenCode event names already match these values, which keeps the existing
 * API and UI behaviour stable. Adapters map aliases and provider-specific
 * names onto this set.
 */
export type CanonicalEventType =
  | "session.created"
  | "session.metadata.updated"
  | "session.status"
  | "session.idle"
  | "session.execution.started"
  | "session.execution.succeeded"
  | "session.execution.failed"
  | "session.turn.completed"
  | "session.interrupted"
  | "session.terminated"
  | "session.error"
  | "session.retry.scheduled"
  | "session.compaction.started"
  | "session.compaction.ended"
  | "session.compaction.failed"
  | "session.skill.activated"
  | "session.tool.started"
  | "session.tool.progress"
  | "session.tool.success"
  | "session.tool.failed"
  | "file.edited"
  | "session.event";

export type CanonicalEvent = {
  provider: ProviderId;
  type: CanonicalEventType;
  /** The provider's original event name, retained for display/audit. */
  rawType: string;
  sessionId: string;
  /** Confirmed parent session, if the provider reported one. */
  parentSessionId?: string;
  name?: string;
  agent?: string;
  tool?: string;
  detail?: string;
  status?: string;
  eventId?: string;
};

export type ProviderAdapter = {
  id: ProviderId;
  displayName: string;
  /** Parse a provider-native payload. Return null for an invalid payload. */
  parse(payload: unknown): CanonicalEvent | null;
};

const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const CANONICAL_TYPES = new Set<CanonicalEventType>([
  "session.created",
  "session.metadata.updated",
  "session.status",
  "session.idle",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.turn.completed",
  "session.interrupted",
  "session.terminated",
  "session.error",
  "session.retry.scheduled",
  "session.compaction.started",
  "session.compaction.ended",
  "session.compaction.failed",
  "session.skill.activated",
  "session.tool.started",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "file.edited",
  "session.event",
]);

export function providerFrom(value: unknown): ProviderId | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return PROVIDER_PATTERN.test(clean) ? clean : null;
}

export function normalizeProviderId(
  value: unknown,
  fallback: ProviderId = DEFAULT_PROVIDER,
): ProviderId {
  return providerFrom(value) ?? fallback;
}

export function isCanonicalEventType(value: unknown): value is CanonicalEventType {
  return typeof value === "string" && CANONICAL_TYPES.has(value as CanonicalEventType);
}

export function providerDisplayName(provider: ProviderId): string {
  if (provider === OPENCODE_PROVIDER) return "OpenCode";
  if (provider === CLAUDE_CODE_PROVIDER) return "Claude Code";
  if (provider === CODEX_PROVIDER) return "Codex";
  return provider;
}
