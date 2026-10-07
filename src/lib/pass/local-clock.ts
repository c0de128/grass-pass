/**
 * Judge G2 (round 6): a model on your own computer (Ollama, CPU only) needs minutes, not seconds. The app's normal
 * clock (calls sized by src/lib/pass/budget.ts, a first call 30-40 s; at most 70 s a call with MODEL_TIMEOUT_MS; 85 s
 * per pass; the page gives up at 95 s) exists because the hosted route runs on Vercel with a 90 s limit; even at 70 s a
 * call, a laptop CPU made 0 of 5 complete passes (evals/results/2026-10-06-selfhost-notes.md).
 *
 * LOCAL_MODEL_TIMEOUT_MS switches on a longer clock, and ONLY when all of these hold:
 * - MODEL_BASE_URL points to this computer (localhost, 127.0.0.1 or [::1]; plain http is only allowed there anyway);
 * - LOCAL_MODEL_TIMEOUT_MS is set to a number above the 70 s most-allowed call limit (it is not set by default);
 * - the server is not a Vercel deploy (VERCEL unset), so production can never get it.
 * Then a model call may take up to LOCAL_MODEL_TIMEOUT_MS (at most 10 minutes), a refill two thirds of that, the
 * whole pass LOCAL_PASS_DEADLINE_MS (default twice the call limit plus a minute, at most 20 minutes), and the page
 * waits 10 s longer than the pass (the server tells it in the first NDJSON line, `{"type":"clock"}`).
 */
import type { PassClock } from "@/lib/ai/build-pass";
import { MAX_MODEL_TIMEOUT_MS, modelEndpoint } from "@/lib/model";

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Longest model call the local clock allows (10 min). */
export const LOCAL_MODEL_TIMEOUT_MAX_MS = 600_000;
/** Longest pass the local clock allows (20 min). */
export const LOCAL_PASS_DEADLINE_MAX_MS = 1_200_000;
/** The page waits this much longer than the server's pass deadline (as with the normal 85 s / 95 s). */
export const LOCAL_CLIENT_MARGIN_MS = 10_000;

export type LocalClock = PassClock & { clientWaitMs: number };

/** True when MODEL_BASE_URL is a valid address on this computer. */
export function isLocalModel(env: Env = process.env): boolean {
  if (!env.MODEL_BASE_URL?.trim()) return false;
  const ep = modelEndpoint(env);
  if (ep.error) return false;
  try {
    return LOCAL_HOSTS.has(new URL(ep.baseUrl).hostname);
  } catch {
    return false;
  }
}

const num = (v: string | undefined): number | null => {
  const n = Number(v?.trim());
  return v?.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** The longer clock for a model on this computer, or null (the normal clock): see the file comment. */
export function localModelClock(env: Env = process.env): LocalClock | null {
  if (env.VERCEL?.trim()) return null;
  if (!isLocalModel(env)) return null;
  const asked = num(env.LOCAL_MODEL_TIMEOUT_MS);
  if (asked === null || asked <= MAX_MODEL_TIMEOUT_MS) return null;
  const modelTimeoutMs = Math.min(LOCAL_MODEL_TIMEOUT_MAX_MS, asked);
  const passDeadlineMs = Math.min(
    LOCAL_PASS_DEADLINE_MAX_MS,
    Math.max(modelTimeoutMs + 30_000, num(env.LOCAL_PASS_DEADLINE_MS) ?? modelTimeoutMs * 2 + 60_000),
  );
  const refillTimeoutMs = Math.round((modelTimeoutMs * 2) / 3);
  return { modelTimeoutMs, passDeadlineMs, refillTimeoutMs, clientWaitMs: passDeadlineMs + LOCAL_CLIENT_MARGIN_MS };
}
