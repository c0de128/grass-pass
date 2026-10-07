/**
 * The time budget for the model calls of one pass (slow-provider fix after eval run 2026-10-06-8).
 *
 * Run -8 (DigitalOcean at 28.1 answer tokens/s instead of 47.3) lost 4 passes because the first call AND its retry hit
 * the fixed 30 s limit, and 2 passes came out short because a refill hit the fixed 20 s limit. The fixed limits came
 * from fast evenings (first call 9.3 s at worst on 2026-10-05). This module sizes each call from what it asks for.
 *
 * The model of a call, fitted on the recorded calls (not guessed):
 * - Answer size: 920 answered Gemma 4 31B calls of runs 2026-10-05 .. 2026-10-06-8 used 58 answer tokens per item
 *   (median; p95 63), and never more than 70 per item + 120 (the riddle and JSON around it). Budgeted:
 *   ANSWER_TOKENS_BASE + ANSWER_TOKENS_PER_ITEM x items (+ ANSWER_TOKENS_SPOT with the Find This Spot riddle):
 *   8 items + riddle = 620 tokens (the slowest 8-item answer on record was 696; the p95 606).
 * - Speed: latency is the answer, not the prompt (run -8 fit: about 1 s + 34 ms per answer token on first calls).
 *   The slowest 5% of answered calls in run -8 ran at 17.6 (first calls) and 14.6 (refills) answer tokens/s, so a
 *   first call or a refill is budgeted at SLOW_TOKENS_PER_S (15 for Gemma; 10 for others such as Llama 4 Maverick,
 *   measured 10.7-17.5).
 * - A slow first call is more often a stuck call than a slow provider: of the 13 retries after a 30 s first-call
 *   timeout in runs -6 to -8, 9 answered (the same whole request) in 10-22 s at 22.5-52 answer tokens/s (3 timed
 *   out again, 1 got a 403). So the first call does not wait much longer than any answered one did (29.6 s at most, run -8), and
 *   the retry is budgeted at RETRY_TOKENS_PER_S (20 for Gemma, under the slowest of those 9).
 * - callNeedMs = CALL_OVERHEAD_MS + answer tokens / speed: 8 items + riddle = 42.8 s at 15/s, 32.5 s at 20/s; a
 *   4-item refill 21.5 s.
 *
 * The rules (PASS_DEADLINE_MS = 85 s for everything, under the route's maxDuration of 90 s):
 * 1. First call: callNeedMs of what it asks, at least FIRST_CALL_MIN_MS (30 s, the old limit) and at most
 *    FIRST_CALL_MAX_MS (40 s), and it leaves room for a minimal retry (MIN_PASS_ITEMS items at the retry speed,
 *    about 13 s) plus CALL_MARGIN_MS. When that room would push the first call under 30 s, the first call gets all
 *    the time left instead (a retry could not fit anyway).
 * 2. A failed first call (timeout, 403/5xx, unusable answer) gets ONE whole retry SIZED TO THE TIME LEFT: as many items
 *    as an answer at the retry speed can carry in the time left (`itemsThatFit`), never fewer than MIN_PASS_ITEMS
 *    (no retry then). The riddle is only asked again when it costs no item. With the data steps done in a few
 *    seconds the retry is the whole request (about 40 s left); after slow data it is shorter, which makes a short
 *    but honest pass that a refill may top up if time is left.
 * 3. A refill: callNeedMs of what it asks (slow speed), between REFILL_MIN_MS (15 s) and REFILL_MAX_MS (30 s).
 * 4. Every call stops CALL_MARGIN_MS (3 s) before the pass deadline. MODEL_TIMEOUT_MS, when set (e.g. 60000 for
 *    Llama 4 Maverick), is the first call's limit instead of the sized one, and caps every later call.
 * 5. max_tokens is sized too (`maxTokensFor`): 1.5x the budgeted answer, at least 400, at most PASS_MAX_TOKENS
 *    (1,200), so a runaway answer stops sooner. It never cuts a normal answer (1.5x is above every recorded one).
 */
import { MIN_PASS_ITEMS } from "@/lib/ai/schema";

/** Whole pass must finish inside the route's maxDuration (90 s) with room to answer. */
export const PASS_DEADLINE_MS = 85_000;

export const ANSWER_TOKENS_PER_ITEM = 65;
export const ANSWER_TOKENS_BASE = 40;
export const ANSWER_TOKENS_SPOT = 60;
/** Request + queue time before the first answer token (run -8 fit: 0.6-1.1 s; budgeted with room). */
export const CALL_OVERHEAD_MS = 1_500;
/** Budgeted answer speed (answer tokens/s): below the slowest 5% of answered calls on record. */
export const SLOW_TOKENS_PER_S_GEMMA = 15;
export const SLOW_TOKENS_PER_S_OTHER = 10;
/** Budgeted answer speed of the whole retry (see the note on stuck calls above). */
export const RETRY_TOKENS_PER_S_GEMMA = 20;
export const FIRST_CALL_MIN_MS = 30_000;
export const FIRST_CALL_MAX_MS = 40_000;
export const REFILL_MIN_MS = 15_000;
export const REFILL_MAX_MS = 30_000;
/** Kept free after every call: checks, the late map and the answer itself. */
export const CALL_MARGIN_MS = 3_000;
export const MAX_TOKENS_FLOOR = 400;
export const MAX_TOKENS_HEADROOM = 1.5;

/** The budgeted answer speed for a model id. */
export function slowTokensPerS(modelId: string): number {
  return modelId.toLowerCase().startsWith("gemma") ? SLOW_TOKENS_PER_S_GEMMA : SLOW_TOKENS_PER_S_OTHER;
}

/** The budgeted answer speed of the whole retry for a model id. */
export function retryTokensPerS(modelId: string): number {
  return modelId.toLowerCase().startsWith("gemma") ? RETRY_TOKENS_PER_S_GEMMA : SLOW_TOKENS_PER_S_OTHER;
}

/** Budgeted answer tokens for `items` clues (plus the riddle when `spot`). */
export function answerTokens(items: number, spot: boolean): number {
  return ANSWER_TOKENS_BASE + ANSWER_TOKENS_PER_ITEM * Math.max(0, items) + (spot ? ANSWER_TOKENS_SPOT : 0);
}

/** How long a call asking for `items` clues needs at the slow speed `tps`. */
export function callNeedMs(items: number, spot: boolean, tps: number): number {
  return Math.ceil(CALL_OVERHEAD_MS + (answerTokens(items, spot) / tps) * 1000);
}

/** max_tokens for a call asking for `items` clues, never above `ceiling`. */
export function maxTokensFor(items: number, spot: boolean, ceiling: number): number {
  return Math.min(ceiling, Math.max(MAX_TOKENS_FLOOR, Math.ceil(answerTokens(items, spot) * MAX_TOKENS_HEADROOM)));
}

/** The least time left for a whole retry: MIN_PASS_ITEMS clues at the retry speed `tps`, plus the margin. */
export function wholeRetryMinLeftMs(tps: number): number {
  return callNeedMs(MIN_PASS_ITEMS, false, tps) + CALL_MARGIN_MS;
}

export type FirstCallInput = {
  /** Time left before the pass deadline. */
  leftMs: number;
  /** Items the first call asks for (spares included). */
  items: number;
  spot: boolean;
  tps: number;
  /** The whole retry's budgeted speed (its room is kept free). */
  retryTps: number;
  /** MODEL_TIMEOUT_MS when it is set (it replaces the sized limit); null = sized, at most FIRST_CALL_MAX_MS. */
  capMs: number | null;
};

/** Rule 1: the first call's timeout. */
export function firstCallTimeoutMs(o: FirstCallInput): number {
  const want = o.capMs ?? Math.min(FIRST_CALL_MAX_MS, Math.max(FIRST_CALL_MIN_MS, callNeedMs(o.items, o.spot, o.tps)));
  const usable = o.leftMs - CALL_MARGIN_MS;
  const withRetry = usable - callNeedMs(MIN_PASS_ITEMS, false, o.retryTps);
  return Math.max(0, Math.min(want, withRetry >= Math.min(FIRST_CALL_MIN_MS, want) ? withRetry : usable));
}

/**
 * Rule 2: how many clues (at most `maxItems`) an answer at speed `tps` can carry in `leftMs`; 0 when fewer than
 * MIN_PASS_ITEMS fit (no retry).
 */
export function itemsThatFit(leftMs: number, maxItems: number, spot: boolean, tps: number): number {
  for (let k = maxItems; k >= MIN_PASS_ITEMS; k--) {
    if (callNeedMs(k, spot, tps) + CALL_MARGIN_MS <= leftMs) return k;
  }
  return 0;
}

/** Rule 2: the whole retry's size, and whether it asks for the riddle again (only when that costs no item). */
export function wholeRetrySize(leftMs: number, maxItems: number, spotWanted: boolean, tps: number): { items: number; spot: boolean } {
  const without = itemsThatFit(leftMs, maxItems, false, tps);
  if (!spotWanted || without === 0) return { items: without, spot: false };
  const withSpot = itemsThatFit(leftMs, maxItems, true, tps);
  return withSpot === without ? { items: without, spot: true } : { items: without, spot: false };
}

/** Rule 2/4: the whole retry's timeout (all the time left, under the cap). */
export function wholeRetryTimeoutMs(leftMs: number, capMs: number | null): number {
  return Math.max(0, Math.min(capMs ?? FIRST_CALL_MAX_MS, leftMs - CALL_MARGIN_MS));
}

/** Rule 3/4: a refill's timeout. */
export function refillTimeoutMs(leftMs: number, items: number, spot: boolean, tps: number, capMs: number | null): number {
  const want = Math.min(REFILL_MAX_MS, Math.max(REFILL_MIN_MS, callNeedMs(items, spot, tps)));
  return Math.max(0, Math.min(capMs ?? Number.POSITIVE_INFINITY, want, leftMs - CALL_MARGIN_MS));
}
