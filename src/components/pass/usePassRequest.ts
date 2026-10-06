"use client";

/**
 * Calls POST /api/pass and reads its NDJSON answer line by line, so the page can show the server's
 * real progress steps ("Reading the park map...", "Writing clues with <model>..."). Every line and
 * every error body is validated with the shared zod schemas.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PassErrorResponseSchema,
  PassLineSchema,
  type ParkData,
  type Pass,
  type PassRequest,
  type PassStep,
} from "@/lib/pass/schema";

/**
 * The page stops waiting after 45 s (R1 UX M2): a new pass usually takes 10-30 s. The server keeps
 * going and caches a pass whose model call started, so "Try again" often opens it at once.
 */
export const CLIENT_TIMEOUT_MS = 45_000;

export const CLIENT_COPY = {
  offline: "We couldn't reach Grass Pass. Check your internet connection and try again.",
  badAnswer: "Something went wrong reading the answer. Please try again.",
  timeout:
    "This is taking much longer than usual (over 45 seconds), so we stopped waiting. The free map and wildlife servers can be slow at busy times. Try again: if your pass got made in the meantime, it opens right away.",
} as const;

/** Codes for failures the page itself detects (server failures carry the server's code). */
export const CLIENT_CODES = { offline: "OFFLINE", badAnswer: "BAD_ANSWER", timeout: "CLIENT_TIMEOUT" } as const;

/** Module-level clock (react-hooks/purity flags Date.now() inside components). */
export const clientNow = () => Date.now();

export type PassState =
  | { kind: "idle" }
  | { kind: "working"; steps: { step: PassStep; text: string }[]; startedAt: number }
  | { kind: "done"; pass: Pass; cached: boolean }
  | { kind: "empty"; parkName: string; message: string; sections: Pass["sections"] }
  | { kind: "failed"; message: string; code: string; parkData?: ParkData };

export function usePassRequest() {
  const [state, setState] = useState<PassState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const run = useCallback(async (body: PassRequest): Promise<PassState> => {
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
    const finish = (s: PassState) => {
      clearTimeout(timer);
      if (abortRef.current === ac) setState(s);
      return s;
    };

    let res: Response;
    try {
      res = await fetch("/api/pass", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch {
      return finish(lost());
    }

    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => null);
      const err = PassErrorResponseSchema.safeParse(json);
      if (!err.success) return finish(bad);
      return finish({ kind: "failed", message: err.data.error.message, code: err.data.error.code, parkData: err.data.parkData });
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
          return finish({ kind: "failed", message: l.error.message, code: l.error.code, parkData: l.parkData });
        }
        if (done) break;
      }
    } catch {
      return finish(lost());
    }
    return finish(bad);
  }, []);

  return { state, run, reset };
}
