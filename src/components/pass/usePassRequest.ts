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

/** A bit over the route's maxDuration (90 s). */
const CLIENT_TIMEOUT_MS = 95_000;

export const CLIENT_COPY = {
  offline: "We couldn't reach Grass Pass. Check your internet connection and try again.",
  badAnswer: "Something went wrong reading the answer. Please try again.",
  timeout: "This is taking too long (over 90 seconds). Please try again in a minute.",
} as const;

export type PassState =
  | { kind: "idle" }
  | { kind: "working"; steps: { step: PassStep; text: string }[] }
  | { kind: "done"; pass: Pass; cached: boolean }
  | { kind: "empty"; parkName: string; message: string; sections: Pass["sections"] }
  | { kind: "failed"; message: string; parkData?: ParkData };

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
    setState({ kind: "working", steps: [] });
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
      return finish({ kind: "failed", message: ac.signal.aborted ? CLIENT_COPY.timeout : CLIENT_COPY.offline });
    }

    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => null);
      const err = PassErrorResponseSchema.safeParse(json);
      return finish({
        kind: "failed",
        message: err.success ? err.data.error.message : CLIENT_COPY.badAnswer,
        parkData: err.success ? err.data.parkData : undefined,
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
            return finish({ kind: "failed", message: CLIENT_COPY.badAnswer });
          }
          const line = PassLineSchema.safeParse(parsed);
          if (!line.success) return finish({ kind: "failed", message: CLIENT_COPY.badAnswer });
          const l = line.data;
          if (l.type === "step") {
            steps.push({ step: l.step, text: l.text });
            if (abortRef.current === ac) setState({ kind: "working", steps: [...steps] });
            continue;
          }
          if (l.type === "result") return finish({ kind: "done", pass: l.pass, cached: l.cached });
          if (l.type === "empty") return finish({ kind: "empty", parkName: l.parkName, message: l.message, sections: l.sections });
          return finish({ kind: "failed", message: l.error.message, parkData: l.parkData });
        }
        if (done) break;
      }
    } catch {
      return finish({ kind: "failed", message: ac.signal.aborted ? CLIENT_COPY.timeout : CLIENT_COPY.offline });
    }
    return finish({ kind: "failed", message: CLIENT_COPY.badAnswer });
  }, []);

  return { state, run, reset };
}
