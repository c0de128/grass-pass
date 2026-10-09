"use client";

/**
 * Calls POST /api/pass and reads its NDJSON answer line by line, so the page can show the server's
 * real progress steps ("Reading the park map...", "Writing clues with <model>..."). Every line and
 * every error body is validated with the shared zod schemas.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExampleLink } from "@/lib/parks/schema";
import { AUTO_RETRY_CODES } from "@/lib/pass/constants";
import type { FreeCharge, ParkData, Pass, PassRequest, PassStep } from "@/lib/pass/schema";

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

/**
 * G2: when the server runs the model on its own computer with the longer clock (LOCAL_MODEL_TIMEOUT_MS), its first
 * line says so and how long to wait; the page then waits that long and says why it is slow.
 */
export const LOCAL_WAIT_COPY = "A model on this computer can take a few minutes. This page waits for it.";

/** The timeout line for a local model, with the real wait (whole minutes). */
export function localTimeoutCopy(waitMs: number): string {
  const min = Math.max(1, Math.round(waitMs / 60_000));
  return `This is taking longer than ${min} ${min === 1 ? "minute" : "minutes"}, so we stopped waiting. A model on this computer can be slow; the server keeps going and saves the pass. Try again; if your pass is ready, it will open now.`;
}

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

/**
 * Kevin 2026-10-08: this request used the visitor's free pass. The server's signed receipt is posted to
 * POST /api/free-pass (it sets the httpOnly cookie; the page can't), and the free passes left are returned. A failed
 * post changes nothing here: the server still counts this connection's signed-out passes.
 */
export async function settleFreePass(free: FreeCharge | undefined): Promise<number | undefined> {
  if (!free) return undefined;
  if (free.receipt) {
    await fetch("/api/free-pass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ receipt: free.receipt }),
    }).catch(() => undefined);
  }
  return free.left;
}

export type PassState =
  | { kind: "idle" }
  | { kind: "working"; steps: { step: PassStep; text: string }[]; startedAt: number; local?: { waitMs: number } }
  /** `freeLeft`: set when THIS request used a free pass (signed out): the free passes left today. */
  | { kind: "done"; pass: Pass; cached: boolean; freeLeft?: number }
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
      /** Set when this request used a free pass anyway (the paid call started, then failed). */
      freeLeft?: number;
      /** Q-11-01: the message (and example) are the previous real failure's; this answer only said no free pass is left. */
      earlier?: boolean;
    };

/** Answers that only mean "no free pass left" (or "sign in"): they never replace a real failure's message. */
export const FREE_GONE_RESULT_CODES: readonly string[] = ["FREE_PASS_USED", "SIGN_IN_REQUIRED", "ANON_IP_DAILY_LIMIT"];

type Failed = Extract<PassState, { kind: "failed" }>;

/** The wait before the one automatic retry, or null. Q-11-01: never once this answer used the last free pass. */
export function autoRetryFor(s: Failed): number | null {
  if (s.freeLeft === 0) return null;
  return plannedAutoRetryMs(s.code, s.retryAfter);
}

/**
 * Q-11-01: a "no free pass left" answer right after a real failure for the same park and age keeps that failure's
 * honest message, example link and park data (the page then shows the sign-in step), instead of replacing them.
 */
export function keepEarlierFailure(s: Failed, prev: Failed | null): Failed {
  if (!prev || !FREE_GONE_RESULT_CODES.includes(s.code) || FREE_GONE_RESULT_CODES.includes(prev.code)) return s;
  const example = s.example ?? prev.example;
  return { ...s, message: prev.message, earlier: true, ...(example ? { example } : {}), ...(prev.parkData ? { parkData: prev.parkData } : {}) };
}

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
  /** The last real failure and the request it answered (Q-11-01). */
  const lastFailRef = useRef<{ key: string; state: Extract<PassState, { kind: "failed" }> } | null>(null);
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
    lastFailRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const run = useCallback(async (body: PassRequest, opts: RunOptions = {}): Promise<PassState> => {
    clearRetry(retryRef);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    let timer = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);
    const steps: { step: PassStep; text: string }[] = [];
    const startedAt = clientNow();
    let local: { waitMs: number } | undefined;
    setState({ kind: "working", steps: [], startedAt });
    const lost = (): PassState =>
      ac.signal.aborted
        ? { kind: "failed", message: local ? localTimeoutCopy(local.waitMs) : CLIENT_COPY.timeout, code: CLIENT_CODES.timeout }
        : { kind: "failed", message: CLIENT_COPY.offline, code: CLIENT_CODES.offline };
    const bad: PassState = { kind: "failed", message: CLIENT_COPY.badAnswer, code: CLIENT_CODES.badAnswer };
    const finish = (result: PassState) => {
      clearTimeout(timer);
      let s = result;
      const wait = s.kind === "failed" ? autoRetryFor(s) : null;
      const key = `${body.parkId}|${body.ageBand}`;
      const prev = lastFailRef.current?.key === key ? lastFailRef.current.state : null;
      if (s.kind === "failed") s = keepEarlierFailure(s, prev);
      if (abortRef.current === ac) lastFailRef.current = s.kind === "failed" ? { key, state: s.earlier && prev ? prev : s } : null;
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
      const freeLeft = await settleFreePass(err.data.free);
      return finish({
        kind: "failed",
        message: e.message,
        code: e.code,
        parkData: err.data.parkData,
        example: e.example,
        retryAfter: e.retryAfter,
        ...(freeLeft !== undefined ? { freeLeft } : {}),
      });
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
          if (l.type === "clock") {
            // G2: the server's longer clock for a model on its own computer: wait that long instead (from the start).
            local = { waitMs: l.waitMs };
            clearTimeout(timer);
            timer = setTimeout(() => ac.abort(), Math.max(0, l.waitMs - (clientNow() - startedAt)));
            if (abortRef.current === ac) setState({ kind: "working", steps: [...steps], startedAt, local });
            continue;
          }
          if (l.type === "step") {
            steps.push({ step: l.step, text: l.text });
            if (abortRef.current === ac) setState({ kind: "working", steps: [...steps], startedAt, ...(local ? { local } : {}) });
            continue;
          }
          if (l.type === "empty") return finish({ kind: "empty", parkName: l.parkName, message: l.message, sections: l.sections });
          const freeLeft = await settleFreePass(l.free);
          const f = freeLeft !== undefined ? { freeLeft } : {};
          if (l.type === "result") return finish({ kind: "done", pass: l.pass, cached: l.cached, ...f });
          return finish({ kind: "failed", message: l.error.message, code: l.error.code, parkData: l.parkData, example: l.error.example, retryAfter: l.error.retryAfter, ...f });
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
