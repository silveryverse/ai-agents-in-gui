import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { openCodeAdapter } from "./opencode.js";
import {
  CLAUDE_CODE_PROVIDER,
  CODEX_PROVIDER,
  DEFAULT_PROVIDER,
  OPENCODE_PROVIDER,
  providerFrom,
  type ProviderAdapter,
  type ProviderId,
} from "./types.js";

const ADAPTERS = new Map<ProviderId, ProviderAdapter>([
  [OPENCODE_PROVIDER, openCodeAdapter],
  [CLAUDE_CODE_PROVIDER, claudeCodeAdapter],
  [CODEX_PROVIDER, codexAdapter],
]);

export function getProviderAdapter(value: unknown): ProviderAdapter | null {
  const provider = providerFrom(value);
  return provider ? ADAPTERS.get(provider) ?? null : null;
}

export function listProviders(): ProviderAdapter[] {
  return [...ADAPTERS.values()];
}

export {
  DEFAULT_PROVIDER,
  OPENCODE_PROVIDER,
  CLAUDE_CODE_PROVIDER,
  CODEX_PROVIDER,
};
export { openCodeAdapter } from "./opencode.js";
export { claudeCodeAdapter } from "./claude-code.js";
export { codexAdapter } from "./codex.js";
export type {
  CanonicalEvent,
  CanonicalEventType,
  ProviderAdapter,
  ProviderId,
} from "./types.js";
