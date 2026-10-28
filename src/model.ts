import type { CanonicalEventType, ProviderId } from "./providers/types.js";

export type Room =
  | "research"
  | "planning"
  | "coding"
  | "testing"
  | "deployment"
  | "kitchen"
  | "lounge";

export type AgentProvenance = "live" | "demo";

/**
 * Current lifecycle state. `offline` is only used for a session restored from
 * SQLite after the bridge restarted; it must never read as actively working.
 * `terminated` means OpenCode reported that the session ended.
 */
export type LifecyclePhase =
  | "running"
  | "idle"
  | "failed"
  | "interrupted"
  | "terminated"
  | "offline";

export type LastOutcome =
  | "completed"
  | "failed"
  | "interrupted"
  | "terminated"
  | null;

export type Agent = {
  /** Provider-specific session identifier. Use `provider` to scope it. */
  id: string;
  /** Coding-agent provider that owns this session (for example `opencode`). */
  provider: ProviderId;
  name: string;
  status: string;
  phase: LifecyclePhase;
  room: Room;
  x: number;
  y: number;
  parentID?: string;
  tool?: string;
  detail?: string;
  /** Provider-specific event name, retained for display. */
  eventType?: string;
  /** Provider-neutral event used for lifecycle/UI behaviour. */
  canonicalEventType?: CanonicalEventType;
  /** Agent name reported by the provider (build, plan, general, explore, ...). */
  agent?: string;
  color: string;
  /** Live bridge traffic or explicitly seeded demo traffic. */
  source: AgentProvenance;
  /** True only while this bridge process has current evidence for the session. */
  connected: boolean;
  /** Explicit API convenience flag: `!connected`. */
  historical: boolean;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  /** Status immediately before the session went offline or was terminated. */
  lastStatus?: string;
  lastOutcome?: LastOutcome;
  terminatedAt?: number;
};

export type ActivityItem = {
  time: string;
  at: number;
  provider: ProviderId;
  sessionId: string;
  name: string;
  /** Provider-specific event name, retained for display/audit. */
  type: string;
  canonicalType?: CanonicalEventType;
  detail: string;
  room?: Room;
  color?: string;
  phase?: LifecyclePhase;
  source: AgentProvenance;
};

export type PublicState = {
  agents: Agent[];
  activity: ActivityItem[];
  mode: AgentProvenance;
};
