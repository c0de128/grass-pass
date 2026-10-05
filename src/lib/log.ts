/**
 * One-line JSON logs for the server. Rules (SPEC §7, starter kit):
 * - never log keys, tokens or user text (place text, prompts, model output);
 * - field names that look secret are redacted as a second line of defence;
 * - long strings are cut so an accidental dump stays small.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogSink = (level: LogLevel, line: string) => void;

// Field names ending in key/token (apiKey, token, accessToken) or containing a secret word.
// Counts such as promptTokens / completionTokens are allowed (plural, not a credential).
const SECRET_FIELD = /((key|token)$|api_?key|secret|password|passwd|authorization|cookie|bearer|credential)/i;
const MAX_STRING = 200;

const consoleSink: LogSink = (level, line) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

let sink: LogSink = consoleSink;

/** Tests swap the sink to capture lines. Returns a function that restores the previous sink. */
export function setLogSink(next: LogSink): () => void {
  const prev = sink;
  sink = next;
  return () => {
    sink = prev;
  };
}

function clean(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= 3) return "[object]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => clean(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_FIELD.test(k) ? "[redacted]" : clean(v, depth + 1);
  return out;
}

/** Build the JSON line (exported for tests). */
export function formatLogLine(event: string, fields: LogFields = {}, now: number = Date.now()): string {
  const body = clean(fields, 0) as Record<string, unknown>;
  return JSON.stringify({ ts: new Date(now).toISOString(), event, ...body });
}

export function log(event: string, fields: LogFields = {}, level: LogLevel = "info"): void {
  try {
    sink(level, formatLogLine(event, fields));
  } catch {
    // Logging must never break a request.
  }
}

/** Log a problem once per process (e.g. a config warning on every request would flood the logs). */
const onceKeys = new Set<string>();
export function logOnce(id: string, event: string, fields: LogFields = {}, level: LogLevel = "warn"): void {
  if (onceKeys.has(id)) return;
  onceKeys.add(id);
  log(event, fields, level);
}
