const MAX_IDENTIFIER = 200;

/** Collapse whitespace, remove control characters, and bound the output. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return "…".slice(0, max);
  return `${value.slice(0, max - 1)}…`;
}

/**
 * Activity detail is intentionally short and scrubbed. The observer plugin
 * never sends prompts or file contents, but the bridge also defends against a
 * malformed or older plugin by redacting common credential shapes.
 */
export function sanitizeDetail(value: unknown, max = 160): string {
  if (typeof value !== "string") return "";
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
  text = text.replace(
    /(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    "$1[redacted]@",
  );
  text = text.replace(
    /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s,;]+)/g,
    "$1=[redacted]",
  );
  text = text.replace(
    /\$(?:env:)?([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)/g,
    "[env]",
  );
  text = text.replace(/\b(?:ghp_|gho_|ghu_|ghs_|ghr_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g, "[redacted]");

  return truncate(text, max);
}

/** Human-facing session/agent names pass through the same redaction. */
export function sanitizeName(value: unknown, max = 60): string {
  return sanitizeDetail(value, max);
}

/**
 * Accept identifiers without whitespace/control characters. OpenCode session
 * IDs are opaque, so this deliberately does not require a particular prefix.
 */
export function validIdentifier(value: unknown, max = MAX_IDENTIFIER): string | null {
  if (typeof value !== "string") return null;
  if (!value || value.length > max) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** Tool and agent labels are compact tokens, scrubbed like other detail. */
export function sanitizeToken(value: unknown, max = 60): string {
  const text = sanitizeDetail(value, max);
  return text.replace(/\s+/g, "");
}
