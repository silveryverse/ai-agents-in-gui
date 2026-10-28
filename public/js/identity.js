export const DEFAULT_PROVIDER = "opencode";

/**
 * Providers own their session identifiers, so the client must never use an ID
 * alone as a map key. This key is URL/DOM safe (unlike a raw NUL separator) and
 * keeps colliding IDs from different providers distinct.
 */
export function providerOf(entity) {
  const raw = typeof entity?.provider === "string" ? entity.provider.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(raw) ? raw : DEFAULT_PROVIDER;
}

export function identityKey(entity) {
  const provider = providerOf(entity);
  const id = entity?.id ?? entity?.sessionId ?? "";
  return `${encodeURIComponent(provider)}:${encodeURIComponent(String(id))}`;
}

export function parentIdentityKey(entity) {
  const parentId = entity?.parentID;
  if (!parentId) return null;
  return `${encodeURIComponent(providerOf(entity))}:${encodeURIComponent(String(parentId))}`;
}

export function providerLabel(entity) {
  const provider = providerOf(entity);
  if (provider === "opencode") return "OpenCode";
  if (provider === "claude-code") return "Claude Code";
  if (provider === "codex") return "Codex";
  return provider;
}

export function canonicalEventType(entity) {
  return String(entity?.canonicalEventType ?? entity?.canonicalType ?? entity?.eventType ?? "");
}
