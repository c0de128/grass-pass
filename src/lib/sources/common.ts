/**
 * Shared plumbing for the free public data sources (OpenStreetMap Nominatim + Overpass now,
 * iNaturalist later): one honest User-Agent, a fetch with a hard timeout, and one error type
 * that says whether an upstream request was actually sent (so callers charge the right budget).
 */
import "server-only";

/** Public repo URL, named in the User-Agent (Nominatim/Overpass/iNat usage policies ask for contact info). */
export const DEFAULT_CONTACT_URL = "https://github.com/c0de128/grass-pass";
export const APP_UA_NAME = "GrassPass/0.1";

type Env = Record<string, string | undefined>;

/**
 * APP_CONTACT_URL when it is a plain https URL (no user:pass, no "@" anywhere so a
 * personal email can never end up in our User-Agent); otherwise the repo URL.
 */
export function contactUrl(env: Env = process.env): string {
  const raw = env.APP_CONTACT_URL?.trim();
  if (!raw || raw.length > 200 || raw.includes("@") || /\s/.test(raw)) return DEFAULT_CONTACT_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return DEFAULT_CONTACT_URL;
    return u.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_CONTACT_URL;
  }
}

/** e.g. `GrassPass/0.1 (+https://github.com/c0de128/grass-pass)`. */
export function userAgent(env: Env = process.env): string {
  return `${APP_UA_NAME} (+${contactUrl(env)})`;
}

export type SourceErrorCode =
  /** No answer within our timeout. */
  | "timeout"
  /** DNS, TLS, connection reset, redirect refused. */
  | "network"
  /** 429 / 403 from the upstream: its quota for us is used up for now. */
  | "rate_limited"
  /** 5xx, or the upstream said it is too busy. */
  | "busy"
  /** 200 but not the shape we expect. */
  | "bad_output"
  /** We did not call: the upstream's circuit breaker is open, or its shared budget is used up. */
  | "not_called"
  /** We did not call: OUR OWN per-process politeness queue had no free slot in time (not the upstream's fault). */
  | "queue_full"
  /** Our own signal stopped it (the pass deadline, or every client left). Never the upstream's fault. */
  | "aborted"
  /** The upstream said THIS query was too heavy (Overpass "Query timed out" / "out of memory"). Not a server outage. */
  | "too_heavy";

export class SourceError extends Error {
  /**
   * Matched by name, not by class identity: Next bundles instrumentation.ts (the S8b example warm-up)
   * separately from pages and routes, and the globalThis singletons (queues, stores, in-flight builds)
   * throw the class of whichever bundle created them first.
   */
  static [Symbol.hasInstance](x: unknown): boolean {
    return x instanceof Error && x.name === "SourceError";
  }

  readonly source: string;
  readonly code: SourceErrorCode;
  readonly status?: number;
  /** Seconds until it is worth trying again, when known. */
  readonly retryAfter?: number;
  /** True when at least one request reached the network (it counts against our budgets). */
  readonly started: boolean;

  constructor(
    source: string,
    code: SourceErrorCode,
    opts: { status?: number; retryAfter?: number; started: boolean; cause?: unknown; message?: string },
  ) {
    super(opts.message ?? `${source}: ${code}${opts.status ? ` (HTTP ${opts.status})` : ""}`, { cause: opts.cause });
    this.name = "SourceError";
    this.source = source;
    this.code = code;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
    this.started = opts.started;
  }
}

/** Parse a Retry-After header (seconds or HTTP date) into seconds, clamped to 1 s..1 h. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  let sec: number;
  if (/^\d+$/.test(v)) sec = Number(v);
  else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return undefined;
    sec = Math.ceil((at - now) / 1000);
  }
  return Math.min(3600, Math.max(1, sec));
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type UpstreamResponse = { status: number; headers: Headers; text: string; latencyMs: number };

/** Thrown inside fetchText when a body is bigger than the caller allows. */
class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`body larger than ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** Read a body as UTF-8 text, stopping (and cancelling the stream) once it passes `maxBytes`. */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(maxBytes);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * One request with a hard timeout (covers headers AND body). Throws SourceError
 * "timeout", "network", "aborted" (the caller's own signal fired: deadline or client gone) or
 * "bad_output" (body over `maxBytes`), all with started: true. Never follows a redirect: our
 * upstream URLs are fixed, so a redirect means something is wrong.
 */
export async function fetchText(
  source: string,
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; fetchImpl?: FetchLike; signal?: AbortSignal; maxBytes?: number },
): Promise<UpstreamResponse> {
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { ...init, signal, redirect: "error", cache: "no-store" });
    const text = opts.maxBytes ? await readTextCapped(res, opts.maxBytes) : await res.text();
    return { status: res.status, headers: res.headers, text, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      throw new SourceError(source, "bad_output", { started: true, cause: err, message: `${source}: answer larger than ${err.limit} bytes` });
    }
    const code: SourceErrorCode = timeout.aborted ? "timeout" : opts.signal?.aborted ? "aborted" : "network";
    throw new SourceError(source, code, { started: true, cause: err });
  }
}
