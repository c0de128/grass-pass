/**
 * `POST /api/pass` behind the guards (SPEC F4, F12, §7). Order of work:
 *   1. a cheap per-IP burst limit on every request (20/min) so even cache hits can't be hammered;
 *   2. the pass cache: key `parkId|ageBand|YYYY-MM-DD (Chicago)`, latest variant; a hit returns at once
 *      with its real "generated" time;
 *   3. a new pass (cache miss or "Make a different pass", max 3 variants per key per day):
 *      - identical concurrent requests join ONE in-flight build (no extra charge);
 *      - per-IP 3 new passes/min, then per-IP 20/day + the global AI_DAILY_CAP, all checked BEFORE
 *        any upstream call (Overpass, iNaturalist, the model);
 *      - the per-IP daily slot is spent when the first upstream request is sent; each model call
 *        spends one AI_DAILY_CAP slot the moment it starts (errors, bad output and aborts included);
 *      - once the model call starts it is pinned: it finishes and is cached even if the client leaves.
 * A shared-store failure answers 503 and calls nothing upstream.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createInflight, createJsonCache, getStore, StoreError, WaiterAbortedError, type Store } from "@/lib/cache";
import { aiCapFor, hitRateLimit, limitsConfig, quotaUsage, reserveQuota, type QuotaTicket } from "@/lib/limits";
import { waitText, type ApiError } from "@/lib/http/respond";
import { log } from "@/lib/log";
import type { ModelLogger } from "@/lib/model";
import { localDay } from "@/lib/time";
import { buildPass, PASS_DEADLINE_MS, type BuildOutcome } from "@/lib/ai/build-pass";
import { isOctoberDay, OCTOBER_REASONS, type OctoberBoxData } from "@/lib/october";
import { octoberBox, type OctoberPark } from "@/lib/sources/inat-monarch";
import { parseParkId } from "@/lib/sources/overpass-features";
import type { FetchLike } from "@/lib/sources/common";
import {
  MAX_VARIANTS,
  PASS_COPY,
  PASS_ID_PATTERN,
  PassSchema,
  type AgeBand,
  type ParkData,
  type Pass,
  type PassRequest,
  type PassStep,
} from "./schema";

const DAY = 24 * 3600;
/** Saved passes stay readable (and printable) for 30 days. */
export const PASS_TTL_SEC = 30 * DAY;
/**
 * Longest we wait for the October box after the pass is ready. It starts in parallel with the model
 * call, so it is normally done long before; if not, the box says iNaturalist was too slow.
 */
export const OCTOBER_WAIT_MS = 6_000;

/** Every request, cached or not, per IP per minute. */
export const PASS_BURST_PER_MIN = 20;

const passCache = createJsonCache({ name: "pass", schema: PassSchema, ttlSec: PASS_TTL_SEC, maxEntries: 5_000 });
const latestCache = createJsonCache({ name: "pass-latest", schema: z.number().int().min(1).max(MAX_VARIANTS), ttlSec: 2 * DAY, maxEntries: 5_000 });

const BAND_SLUG: Record<AgeBand, string> = { "4-6": "4to6", "6-10": "6to10", "10-13": "10to13" };

/** w306191453-6to10-20261005-1 */
export function passId(parkId: string, band: AgeBand, day: string, variant: number): string {
  const ref = parseParkId(parkId);
  if (!ref) throw new RangeError("bad park id");
  return `${ref.type[0]}${ref.id}-${BAND_SLUG[band]}-${day.replace(/-/g, "")}-${variant}`;
}

/** The pass cache key (SPEC §7): park, age band and the Chicago calendar day. */
export function passKey(parkId: string, band: AgeBand, nowMs: number): string {
  return `${parkId}|${band}|${localDay(nowMs)}`;
}

/** Read a saved pass (the pass page; never calls upstream). */
export async function loadPass(id: string, now: number = Date.now()): Promise<Pass | null> {
  if (!PASS_ID_PATTERN.test(id)) return null;
  const hit = await passCache.get(id, now);
  return hit ? hit.value : null;
}

export type MakeDeps = {
  ip: string;
  signal?: AbortSignal;
  store?: Store;
  fetchImpl?: FetchLike;
  modelFetch?: FetchLike;
  env?: Record<string, string | undefined>;
  now?: () => number;
  onStep?: (step: { step: PassStep; text: string }) => void;
  modelLogger?: ModelLogger;
  /**
   * Server-side pre-warm of the example parks (src/lib/prewarm.ts), never set by the route: skips the
   * per-IP burst/minute limits and the per-IP daily share, but still counts against every GLOBAL cap
   * (AI_DAILY_CAP and the global new-pass share).
   */
  internal?: boolean;
  /**
   * May use the reserved slice of AI_DAILY_CAP (SEC-1-05): the route sets it for the example parks; the
   * pre-warm (internal) always may. Everyone else stops at aiCapFor(cfg, false).
   */
  reserved?: boolean;
};

export type MakeOutcome =
  | { kind: "pass"; pass: Pass; cached: boolean }
  | { kind: "empty"; parkName: string; message: string; sections: Pass["sections"] }
  | { kind: "error"; status: number; error: ApiError; parkData?: ParkData };

type Step = { step: PassStep; text: string };
type Holder = { inflight: ReturnType<typeof createInflight<BuildOutcome, Step>> };
const INFLIGHT_KEY = Symbol.for("grass-pass.pass-inflight");
function inflight() {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (g[INFLIGHT_KEY] ??= { inflight: createInflight<BuildOutcome, Step>() }).inflight;
}

/** Tests: drop in-flight builds. */
export function resetPassMaking(): void {
  inflight().clear();
}

const storeDown = (): MakeOutcome => ({
  kind: "error",
  status: 503,
  error: { code: "STORE_UNAVAILABLE", message: "Grass Pass can't check its usage limits right now, so it paused new passes. Try again in a minute.", retryAfter: 60 },
});

export async function makePass(req: PassRequest, deps: MakeDeps): Promise<MakeOutcome> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const env = deps.env ?? process.env;
  const store = deps.store ?? getStore("limits");
  const cfg = limitsConfig(env);
  const ref = parseParkId(req.parkId);
  if (!ref) return { kind: "error", status: 400, error: { code: "BAD_INPUT", message: "That park id doesn't look right." } };

  try {
    const burst = deps.internal
      ? { ok: true as const }
      : await hitRateLimit(store, { name: "pass-burst", key: deps.ip, limit: PASS_BURST_PER_MIN, windowSec: 60, now: now() });
    if (!burst.ok) {
      return {
        kind: "error",
        status: 429,
        error: { code: "RATE_LIMITED", message: `That's a lot of requests in a minute. Please wait ${waitText(burst.retryAfter)} and try again.`, retryAfter: burst.retryAfter },
      };
    }

    const day = localDay(startedAt);
    const key = passKey(req.parkId, req.ageBand, startedAt);
    const latest = (await latestCache.get(key, now()))?.value ?? 0;

    if (!req.fresh && latest > 0) {
      const id = passId(req.parkId, req.ageBand, day, latest);
      const hit = await passCache.get(id, now());
      if (hit) return { kind: "pass", pass: hit.value, cached: true };
    }
    if (req.fresh && latest >= MAX_VARIANTS) {
      return { kind: "error", status: 429, error: { code: "VARIANT_LIMIT", message: PASS_COPY.variantLimit } };
    }
    const variant = req.fresh ? latest + 1 : Math.max(1, latest);
    const id = passId(req.parkId, req.ageBand, day, variant);
    const flightKey = `${key}|${variant}`;

    // Joining an identical build that is already running costs nothing extra.
    if (!deps.internal && !inflight().has(flightKey)) {
      const rl = await hitRateLimit(store, { name: "pass", key: deps.ip, limit: cfg.passPerIpPerMin, windowSec: 60, now: now() });
      if (!rl.ok) {
        return {
          kind: "error",
          status: 429,
          error: { code: "RATE_LIMITED", message: `That's a lot of new passes in a minute. Please wait ${waitText(rl.retryAfter)} and try again.`, retryAfter: rl.retryAfter },
        };
      }
    }

    const out = await inflight().run(
      flightKey,
      (signal, emit, pin) => build({ req, ref, id, day, variant, key, signal, emit, pin, store, env, now, startedAt, cfg, deps }),
      deps.signal,
      deps.onStep,
    );
    if (out.kind === "pass") return { kind: "pass", pass: out.pass, cached: false };
    return out;
  } catch (err) {
    if (err instanceof StoreError) return storeDown();
    throw err; // includes WaiterAbortedError: the route answers 499 to a client that already left
  }
}

async function build(ctx: {
  req: PassRequest;
  ref: NonNullable<ReturnType<typeof parseParkId>>;
  id: string;
  day: string;
  variant: number;
  key: string;
  signal: AbortSignal;
  emit: (s: Step) => void;
  pin: () => void;
  store: Store;
  env: Record<string, string | undefined>;
  now: () => number;
  startedAt: number;
  cfg: ReturnType<typeof limitsConfig>;
  deps: MakeDeps;
}): Promise<BuildOutcome> {
  const { store, now, cfg } = ctx;
  if (ctx.signal.aborted) throw new WaiterAbortedError();

  // Caps BEFORE any upstream: the model budget must have room, then the per-IP daily share.
  const aiCap = aiCapFor(cfg, Boolean(ctx.deps.internal || ctx.deps.reserved));
  const ai = await quotaUsage(store, { name: "ai-calls", period: { kind: "day" }, now: now() });
  if (ai.global >= aiCap) {
    return { kind: "error", status: 429, error: { code: "DAILY_LIMIT", message: PASS_COPY.paused, retryAfter: 3600 } };
  }
  const share = await reserveQuota(store, {
    name: "pass-new",
    key: ctx.deps.ip,
    perKey: ctx.deps.internal ? Infinity : cfg.passPerIpPerDay,
    global: Math.max(cfg.aiDailyCap, 1) * 2,
    period: { kind: "day" },
    now: now(),
  });
  if (!share.ok) {
    const message =
      share.scope === "global"
        ? `${PASS_COPY.paused} It resets in ${waitText(share.retryAfter)}.`
        : `You've made a lot of new passes today. Please wait ${waitText(share.retryAfter)}; passes you already made still work.`;
    return { kind: "error", status: 429, error: { code: share.scope === "global" ? "DAILY_LIMIT" : "IP_DAILY_LIMIT", message, retryAfter: share.retryAfter } };
  }
  const ticket: QuotaTicket = share.ticket;

  // October special (S7): free iNaturalist counts, fetched while the model writes clues.
  let october: Promise<OctoberBoxData> | null = null;
  const startOctober = (park: OctoberPark) => {
    if (october || !isOctoberDay(ctx.day)) return;
    october = octoberBox(park, { store, fetchImpl: ctx.deps.fetchImpl, env: ctx.env, now, onStart: () => ticket.commit() }).catch(
      (err: unknown): OctoberBoxData => {
        log("october_box_failed", { error: err instanceof Error ? err.name : "unknown" }, "error");
        return { status: "unavailable", reason: OCTOBER_REASONS.down };
      },
    );
  };

  try {
    let out = await buildPass(
      { ref: ctx.ref, band: ctx.req.ageBand, day: ctx.day, variant: ctx.variant, id: ctx.id },
      {
        store,
        env: ctx.env,
        now,
        fetchImpl: ctx.deps.fetchImpl,
        modelFetch: ctx.deps.modelFetch,
        signal: ctx.signal,
        emit: (step, text) => ctx.emit({ step, text }),
        pin: ctx.pin,
        onUpstream: () => ticket.commit(),
        reserveAiCall: async () => {
          const r = await reserveQuota(store, {
            name: "ai-calls",
            key: "all",
            perKey: Infinity,
            global: aiCap,
            period: { kind: "day" },
            now: now(),
          });
          if (!r.ok) return null;
          ticket.commit(); // a model call is an upstream call too
          return r.ticket;
        },
        startedAt: ctx.startedAt,
        modelLogger: ctx.deps.modelLogger,
        onPoolsReady: startOctober,
      },
    );
    if (out.kind === "pass") {
      startOctober(out.pass.park);
      if (october) {
        const cap = Math.max(0, Math.min(OCTOBER_WAIT_MS, ctx.startedAt + PASS_DEADLINE_MS - now()));
        out = { ...out, pass: { ...out.pass, october: await within(october, cap) } };
      }
      await passCache.set(ctx.id, out.pass, { now: now() });
      await latestCache.set(ctx.key, ctx.variant, { now: now() });
      log("pass_made", { id: ctx.id, items: out.pass.items.length, model: out.pass.model.answered, ms: now() - ctx.startedAt });
    } else {
      log("pass_not_made", { kind: out.kind, status: out.kind === "error" ? out.status : 200, code: out.kind === "error" ? out.error.code : "EMPTY" }, "warn");
    }
    return out;
  } finally {
    if (!ticket.committed) await ticket.release();
  }
}

/** The box, or "too slow" after `ms` (the fetch keeps going and fills the cache for the next pass). */
async function within(box: Promise<OctoberBoxData>, ms: number): Promise<OctoberBoxData> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<OctoberBoxData>((resolve) => {
    timer = setTimeout(() => resolve({ status: "unavailable", reason: OCTOBER_REASONS.slow }), ms);
  });
  try {
    return await Promise.race([box, slow]);
  } finally {
    clearTimeout(timer);
  }
}
