"use client";

/**
 * Calls POST /api/pass and reads its NDJSON answer line by line, so the page can show the server's
 * real progress steps ("Reading the park map...", "Writing clues with <model>..."). Every line and
 * every error body is validated with the shared zod schemas.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExampleLink } from "@/lib/parks/schema";
import { AUTO_RETRY_CODES } from "@/lib/pass/constants";
import type { ParkData, Pass, PassRequest, PassStep } from "@/lib/pass/schema";

/** UX-4-02: the answer's schemas (and zod) load on demand, with the request, not on first paint. */
const loadSchemas = () => import("@/lib/pass/schema");

/**
 * R2-M2 (Q-2-02): the page waits longer than the server's whole pass deadline (85 s, PASS_DEADLINE_MS)
 * plus a margin, so it never gives up on a pass the server is still allowed to finish. Measured
 * 2026-10-06: most new passes take 10-30 s, but 58-67 s when the public map servers are slow. The
 * server keeps going and caches a pass whose model call started, so "Try again" often opens it at once.
 */
export const CLIENT_TIMEOUT_MS = 95_000;

/** Shown under the progress steps (measured reality, R2-M2). */
export const PASS_WAIT_COPY = "A new pass usually takes 10-30 seconds, and up to a minute and a half if the free map websites are slow.";

export const CLIENT_COPY = {
  offline: "We couldn't reach Grass Pass. Check your internet connection and try again.",
  badAnswer: "Something went wrong reading the answer. Please try again.",
  timeout:
    "This is taking longer than a minute and a half, so we stopped waiting. Free map and wildlife sites can be slow when they're busy. Try again; if your pass is ready, it will open now.",
} as const;

/** Codes for failures the page itself detects (server failures carry the server's code). */
export const CLIENT_CODES = { offline: "OFFLINE", badAnswer: "BAD_ANSWER", timeout: "CLIENT_TIMEOUT" } as const;

/** Module-level clock (react-hooks/purity flags Date.now() inside components). */
export const clientNow = () => Date.now();

/**
 * R2-M3: when the map data was busy or slow, the page tries ONE more time by itself after the server's
 * Retry-After (at least 10 s so a busy server gets a breather, at most 60 s), with a visible countdown.
 */
export const AUTO_RETRY_MIN_MS = 10_000;
export const AUTO_RETRY_MAX_MS = 60_000;
/**
 * Audit Q-3-01: the wait before the one automatic retry, or null for none: only for the map-data codes,
 * and never when the server's Retry-After is longer than AUTO_RETRY_MAX_MS (a park in the 15-min slow
 * cache would just fail again at once; the copy then says the real wait).
 */
export function plannedAutoRetryMs(code: string, retryAfterSec: number | undefined): number | null {
  if (!AUTO_RETRY_CODES.includes(code)) return null;
  if (retryAfterSec !== undefined && retryAfterSec * 1000 > AUTO_RETRY_MAX_MS) return null;
  return autoRetryWaitMs(retryAfterSec);
}

/**
 * Audit Q-3-01: a map-data failure whose Retry-After is longer than an auto-retry would wait (a park in
 * the slow cache): pressing "Try again" before then fails at once, so the page offers no such button.
 */
export function retryFailsNow(code: string, retryAfterSec: number | undefined): boolean {
  return AUTO_RETRY_CODES.includes(code) && retryAfterSec !== undefined && retryAfterSec * 1000 > AUTO_RETRY_MAX_MS;
}

export function autoRetryWaitMs(retryAfterSec: number | undefined): number {
  const ms = Math.round((retryAfterSec ?? 15) * 1000);
  return Math.min(AUTO_RETRY_MAX_MS, Math.max(AUTO_RETRY_MIN_MS, Number.isFinite(ms) ? ms : AUTO_RETRY_MIN_MS));
}

export type PassState =
  | { kind: "idle" }
  | { kind: "working"; steps: { step: PassStep; text: string }[]; startedAt: number }
  | { kind: "done"; pass: Pass; cached: boolean }
  | { kind: "empty"; parkName: string; message: string; sections: Pass["sections"] }
  | {
      kind: "failed";
      message: string;
      code: string;
      parkData?: ParkData;
      /** A ready example pass to open instead (map data busy or slow). */
      example?: ExampleLink;
      retryAfter?: number;
      /** When the one automatic retry starts (client clock ms), if one is planned. */
      autoRetryAt?: number;
    };

export type RunOptions = {
  /** Try once more by itself after a busy/slow map-data failure (the page's main "Make my pass"). */
  autoRetry?: boolean;
};

type TimerRef = { current: ReturnType<typeof setTimeout> | null };
function clearRetry(ref: TimerRef): void {
  if (ref.current) clearTimeout(ref.current);
  ref.current = null;
}

export function usePassRequest() {
  const [state, setState] = useState<PassState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<(body: PassRequest, opts?: RunOptions) => Promise<PassState>>(async () => ({ kind: "idle" }));

  useEffect(
    () => () => {
      abortRef.current?.abort();
      clearRetry(retryRef);
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearRetry(retryRef);
    setState({ kind: "idle" });
  }, []);

  const run = useCallback(async (body: PassRequest, opts: RunOptions = {}): Promise<PassState> => {
    clearRetry(retryRef);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);
    const steps: { step: PassStep; text: string }[] = [];
    const startedAt = clientNow();
    setState({ kind: "working", steps: [], startedAt });
    const lost = (): PassState =>
      ac.signal.aborted
        ? { kind: "failed", message: CLIENT_COPY.timeout, code: CLIENT_CODES.timeout }
        : { kind: "failed", message: CLIENT_COPY.offline, code: CLIENT_CODES.offline };
    const bad: PassState = { kind: "failed", message: CLIENT_COPY.badAnswer, code: CLIENT_CODES.badAnswer };
    const finish = (result: PassState) => {
      clearTimeout(timer);
      let s = result;
      const wait = s.kind === "failed" ? plannedAutoRetryMs(s.code, s.retryAfter) : null;
      if (abortRef.current === ac && opts.autoRetry && s.kind === "failed" && wait !== null) {
        s = { ...s, autoRetryAt: clientNow() + wait };
        // One retry only: the second run doesn't ask for another.
        retryRef.current = setTimeout(() => void runRef.current(body), wait);
      }
      if (abortRef.current === ac) setState(s);
      return s;
    };

    let res: Response;
    let schemas: Awaited<ReturnType<typeof loadSchemas>>;
    try {
      [res, schemas] = await Promise.all([
        fetch("/api/pass", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        }),
        loadSchemas(),
      ]);
    } catch {
      return finish(lost());
    }
    const { PassErrorResponseSchema, PassLineSchema } = schemas;

    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => null);
      const err = PassErrorResponseSchema.safeParse(json);
      if (!err.success) return finish(bad);
      const e = err.data.error;
      return finish({ kind: "failed", message: e.message, code: e.code, parkData: err.data.parkData, example: e.example, retryAfter: e.retryAfter });
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        if (done) buf += dec.decode();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return finish(bad);
          }
          const line = PassLineSchema.safeParse(parsed);
          if (!line.success) return finish(bad);
          const l = line.data;
          if (l.type === "step") {
            steps.push({ step: l.step, text: l.text });
            if (abortRef.current === ac) setState({ kind: "working", steps: [...steps], startedAt });
            continue;
          }
          if (l.type === "result") return finish({ kind: "done", pass: l.pass, cached: l.cached });
          if (l.type === "empty") return finish({ kind: "empty", parkName: l.parkName, message: l.message, sections: l.sections });
          return finish({ kind: "failed", message: l.error.message, code: l.error.code, parkData: l.parkData, example: l.error.example, retryAfter: l.error.retryAfter });
        }
        if (done) break;
      }
    } catch {
      return finish(lost());
    }
    return finish(bad);
  }, []);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  return { state, run, reset };
}
