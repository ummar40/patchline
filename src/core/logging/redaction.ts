export const REDACTED = "[REDACTED]";

const MIN_REGISTERED_SECRET_LENGTH = 8;
const MAX_DEPTH = 8;

// "token" only counts at the end of a key so usage counters such as inputTokens stay readable.
const SENSITIVE_KEY =
  /secret|password|passwd|credential|private[-_]?key|api[-_]?key|authorization|cookie|(?:^|[-_a-z])token$/i;

type Pattern = { expression: RegExp; replacement: string };

const PATTERNS: readonly Pattern[] = [
  {
    expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: REDACTED,
  },
  { expression: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: REDACTED },
  { expression: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replacement: REDACTED },
  { expression: /\bsk-[A-Za-z0-9_-]{20,}/g, replacement: REDACTED },
  { expression: /\bAKIA[0-9A-Z]{16}\b/g, replacement: REDACTED },
  { expression: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replacement: REDACTED },
  {
    expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: REDACTED,
  },
  {
    expression: /\b(authorization\s*[:=]\s*(?:basic|bearer|token)\s+)[A-Za-z0-9._~+/=-]+/gi,
    replacement: `$1${REDACTED}`,
  },
  { expression: /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]*:[^/\s@]+@/gi, replacement: `$1${REDACTED}@` },
];

const registeredSecrets = new Set<string>();

// Exact values loaded from configuration are scrubbed wherever they appear, which covers
// secrets whose format no pattern recognises.
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= MIN_REGISTERED_SECRET_LENGTH) {
    registeredSecrets.add(value);
  }
}

// Short-lived credentials are dropped again once they can no longer appear in output.
export function unregisterSecret(value: string): void {
  registeredSecrets.delete(value);
}

export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

export function redactText(text: string): string {
  let result = text;
  for (const secret of registeredSecrets) {
    if (result.includes(secret)) {
      result = result.split(secret).join(REDACTED);
    }
  }
  for (const { expression, replacement } of PATTERNS) {
    result = result.replace(expression, replacement);
  }
  return result;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }
  if (value instanceof Date) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) && item != null ? REDACTED : redactValue(item, depth + 1);
  }
  return output;
}
