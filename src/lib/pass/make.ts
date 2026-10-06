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
import { dailyPaceState, restingError } from "@/lib/limits/budget";
import { forgetPassRead, memoPassRead, plausiblePassId, resetPassReads } from "@/lib/limits/pass-read";
import { waitText, type ApiError } from "@/lib/http/respond";
import { log } from "@/lib/log";
import type { ModelLogger } from "@/lib/model";
import { localDay } from "@/lib/time";
import { buildPass, PASS_DEADLINE_MS, type BuildOutcome } from "@/lib/ai/build-pass";
import { isOctoberDay, OCTOBER_REASONS, type OctoberBoxData } from "@/lib/october";
import { octoberBox, type OctoberPark } from "@/lib/sources/inat-monarch";
import { SPOT_DEGRADED_MESSAGES } from "@/lib/spot/load";
import { ACCOUNT_COPY, ACCOUNT_PASSES_PER_DAY, judgeDailyCap, judgeLimitMessage, JUDGE_PASSES_PER_IP_PER_DAY } from "@/lib/accounts/config";
import { JUDGE_QUOTA } from "@/lib/accounts/judge-passes";
import type { Account } from "@/lib/accounts/session";
import { excludedRefs, parkReportStats } from "@/lib/reports";
import { createDeadline, eitherSignal } from "./deadline";
import { peekFeatures } from "./park-data";
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

/**
 * R1-m2 (Q-1-05): a pass made while a source was down or slow (Wild Finds unavailable, the plant season
 * check unavailable, no Find This Spot because OpenStreetMap was busy/slow, October box down/slow) is
 * "degraded". It is still saved and shown, and a later request may try to make a better one with the
 * same id (the degraded one stays if that fails). The example warm-up treats it the same way.
 *
 * R2-M1 (Q-2-01) caps that, because each rebuild is a model call: at most once per DEGRADED_RETRY_SEC
 * per pass key, at most MAX_DEGRADED_REBUILDS per key per day, after REPEAT_RETRY_SEC when the last
 * rebuild failed for the very same reasons, and never for a reason that will just repeat (our side
 * couldn't read an answer: `badOutput` is not a "degraded" reason at all).
 */
export const DEGRADED_RETRY_SEC = 60 * 60;
export const REPEAT_RETRY_SEC = 3 * 60 * 60;
export const MAX_DEGRADED_REBUILDS = 3;

/** October reasons a later try can fix (iNaturalist down, slow, or our polite share used up). */
const RETRYABLE_OCTOBER: readonly string[] = [OCTOBER_REASONS.down, OCTOBER_REASONS.slow, OCTOBER_REASONS.rateLimited];

export type DegradedReason = "wild" | "season" | "spot" | "october";

/** Why this pass is degraded (a source that was down or slow and may answer later); [] = not degraded. */
export function degradedReasons(pass: Pass): DegradedReason[] {
  const out: DegradedReason[] = [];
  if (pass.sections.wild.status === "unavailable") out.push("wild");
  // R1 follow-up: the plant season check could not run (iNaturalist phenology failed or was too slow).
  if (pass.seasonUnknown === true) out.push("season");
  if (pass.spot?.status === "none" && SPOT_DEGRADED_MESSAGES.includes(pass.spot.message)) out.push("spot");
  if (pass.october?.status === "unavailable" && RETRYABLE_OCTOBER.includes(pass.october.reason)) out.push("october");
  return out;
}

/** True when a source was down or slow when this pass was made (see DEGRADED_RETRY_SEC). */
export function isDegraded(pass: Pass): boolean {
  return degradedReasons(pass).length > 0;
}

const RebuildSchema = z.object({
  tries: z.number().int().min(0),
  lastAt: z.number(),
  /** The reasons of the pass the last rebuild replaced. */
  reasons: z.array(z.enum(["wild", "season", "spot", "october"])),
});
const rebuildCache = createJsonCache({ name: "pass-rebuild", schema: RebuildSchema, ttlSec: 2 * DAY, maxEntries: 5_000 });

const sameReasons = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((r) => b.includes(r));

/**
 * May this degraded pass (saved `ageSec` ago under pass key `key`) be rebuilt now? False for a pass
 * that isn't degraded, is younger than DEGRADED_RETRY_SEC, already had MAX_DEGRADED_REBUILDS today,
 * or was rebuilt within the wait (REPEAT_RETRY_SEC when the last rebuild hit the same reasons again).
 */
export async function mayRebuildDegraded(key: string, pass: Pass, ageSec: number, nowMs: number): Promise<boolean> {
  const reasons = degradedReasons(pass);
  if (reasons.length === 0 || ageSec < DEGRADED_RETRY_SEC) return false;
  const last = (await rebuildCache.get(key, nowMs))?.value;
  if (!last) return true;
  if (last.tries >= MAX_DEGRADED_REBUILDS) return false;
  const waitSec = sameReasons(last.reasons, reasons) ? REPEAT_RETRY_SEC : DEGRADED_RETRY_SEC;
  return nowMs - last.lastAt >= waitSec * 1000;
}

/**
 * Count one rebuild of this degraded pass, right when it starts (Q-3-03: after every per-IP and global
 * limit said yes, so a refused request never uses up a rebuild). The count is an atomic store counter,
 * so two instances can't both take the last rebuild; false = the day's MAX_DEGRADED_REBUILDS are used.
 */
async function noteRebuild(store: Store, key: string, pass: Pass, nowMs: number): Promise<boolean> {
  const tries = await store.incr(`pass-rebuild-n:${key}`, 1, 2 * DAY);
  if (tries > MAX_DEGRADED_REBUILDS) return false;
  await rebuildCache.set(key, { tries, lastAt: nowMs, reasons: degradedReasons(pass) }, { now: nowMs });
  return true;
}

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

/**
 * Read a saved pass (the pass page; never calls upstream). SEC-2-01: an id that can't exist (bad shape,
 * a day outside the 30-day TTL, a variant above MAX_VARIANTS) costs no store read, and reads are memoized
 * in process (src/lib/limits/pass-read.ts; a normal pass for 30 min, a degraded one or a miss for 15 s).
 */
export async function loadPass(id: string, now: number = Date.now()): Promise<Pass | null> {
  if (!PASS_ID_PATTERN.test(id) || !plausiblePassId(id, now)) return null;
  return memoPassRead(
    id,
    now,
    async () => (await passCache.get(id, now))?.value ?? null,
    (p) => !isDegraded(p),
  );
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
  /**
   * Accounts (Kevin, 2026-10-06): the route sets `requireAccount`, so a NEW pass (a cache miss, "Make a
   * different pass", or a rebuild of a degraded pass) needs a signed-in `account`; a saved pass for today
   * is still served to anyone (it costs nothing). Each account may start ACCOUNT_PASSES_PER_DAY new passes
   * per Chicago day; the judge demo shares JUDGE_DEMO_DAILY_CAP, at most JUDGE_PASSES_PER_IP_PER_DAY per
   * connection (SEC-4-02). Counted only when a build really starts. Q-4-03: a rebuild of today's degraded
   * pass is NOT counted against the account (the per-IP share, AI_DAILY_CAP and MAX_DEGRADED_REBUILDS bound it).
   */
  requireAccount?: boolean;
  account?: Account | null;
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
  resetPassReads();
}

/** New passes counted per account (and the judge demo) in the shared store: never a cap for everyone. */
const NO_GLOBAL_CAP = 1_000_000_000;

const signInRequired = (): MakeOutcome => ({
  kind: "error",
  status: 401,
  error: { code: "SIGN_IN_REQUIRED", message: ACCOUNT_COPY.signInToMake },
});

/**
 * Accounts: reserve this account's share of today's new passes (the judge demo: its per-connection share of
 * the shared demo cap, SEC-4-02). null = nothing to count (the server's own warm-up, no account required, or
 * a rebuild of a degraded pass: Q-4-03).
 */
async function reserveAccountShare(
  store: Store,
  deps: MakeDeps,
  env: Record<string, string | undefined>,
  now: number,
  rebuild: boolean,
): Promise<null | { ok: true; ticket: QuotaTicket } | { ok: false; outcome: MakeOutcome }> {
  if (deps.internal || !deps.account || rebuild) return null;
  const judge = deps.account.judge;
  const r = await reserveQuota(store, {
    name: judge ? JUDGE_QUOTA : "acct-new",
    key: judge ? deps.ip : deps.account.key,
    perKey: judge ? JUDGE_PASSES_PER_IP_PER_DAY : ACCOUNT_PASSES_PER_DAY,
    global: judge ? judgeDailyCap(env) : NO_GLOBAL_CAP,
    period: { kind: "day" },
    now,
  });
  if (r.ok) return { ok: true, ticket: r.ticket };
  log(judge ? "judge_daily_limit" : "account_daily_limit", judge ? { scope: r.scope } : {}, "warn");
  return {
    ok: false,
    outcome: {
      kind: "error",
      status: 429,
      error: judge
        ? { code: "JUDGE_DAILY_LIMIT", message: judgeLimitMessage(r.scope, env), retryAfter: r.retryAfter }
        : { code: "ACCOUNT_DAILY_LIMIT", message: ACCOUNT_COPY.accountLimit, retryAfter: r.retryAfter },
    },
  };
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
  // SEC-3-04: a new instance learns the shared command counters first (1 command, once per process).
  await store.prime?.();
  // SEC-2-01: the store's monthly command budget is nearly used up: read-only until it resets.
  const resting = restingError(startedAt);
  if (resting) return { kind: "error", status: 503, error: resting };

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

    /** A degraded cached pass: shown again if the new try fails (R1-m2). */
    let fallback: Pass | null = null;
    if (!req.fresh && latest > 0) {
      const id = passId(req.parkId, req.ageBand, day, latest);
      const hit = await passCache.get(id, now());
      if (hit && !(await mayRebuildDegraded(key, hit.value, hit.ageSec, now()))) return { kind: "pass", pass: hit.value, cached: true };
      if (hit) {
        // Q-3-03: the rebuild is counted in build(), once every limit has said yes.
        fallback = hit.value;
        log("pass_rebuild_degraded", { id, reasons: degradedReasons(hit.value), ageSec: Math.round(hit.ageSec) });
      }
    }
    const orFallback = (out: MakeOutcome): MakeOutcome => (fallback && out.kind !== "pass" ? { kind: "pass", pass: fallback, cached: true } : out);
    if (req.fresh && latest >= MAX_VARIANTS) {
      return { kind: "error", status: 429, error: { code: "VARIANT_LIMIT", message: PASS_COPY.variantLimit } };
    }
    // Accounts: a new pass needs a signed-in grown-up. A saved degraded pass is shown again instead.
    if (deps.requireAccount && !deps.internal && !deps.account) return fallback ? { kind: "pass", pass: fallback, cached: true } : signInRequired();
    const variant = req.fresh ? latest + 1 : Math.max(1, latest);
    const id = passId(req.parkId, req.ageBand, day, variant);
    const flightKey = `${key}|${variant}`;

    // Joining an identical build that is already running costs nothing extra.
    if (!deps.internal && !inflight().has(flightKey)) {
      const rl = await hitRateLimit(store, { name: "pass", key: deps.ip, limit: cfg.passPerIpPerMin, windowSec: 60, now: now() });
      if (!rl.ok) {
        return orFallback({
          kind: "error",
          status: 429,
          error: { code: "RATE_LIMITED", message: `That's a lot of new passes in a minute. Please wait ${waitText(rl.retryAfter)} and try again.`, retryAfter: rl.retryAfter },
        });
      }
    }

    const out = await inflight().run(
      flightKey,
      (signal, emit, pin) => build({ req, ref, id, day, variant, key, signal, emit, pin, store, env, now, startedAt, cfg, deps, rebuildOf: fallback }),
      deps.signal,
      deps.onStep,
    );
    if (out.kind === "pass") return { kind: "pass", pass: out.pass, cached: false };
    return orFallback(out);
  } catch (err) {
    if (err instanceof StoreError) return storeDown();
    throw err; // includes WaiterAbortedError: the route answers 499 to a client that already left
  }
}

type BuildCtx = Parameters<typeof buildCounted>[0];

/**
 * Accounts: the account's (or judge demo's) daily share is taken before the per-IP and global caps (auth ->
 * account count -> the existing limits), right after the free checks (daily pace, a cached failure: those
 * answer without touching the account's count), and given back unless an upstream call really started
 * (Q-3-03 pattern).
 */
async function build(ctx: BuildCtx): Promise<BuildOutcome> {
  const held: AccountHold = { ticket: null };
  try {
    return await buildCounted(ctx, held);
  } finally {
    if (held.ticket && !held.ticket.committed) await held.ticket.release();
  }
}

type AccountHold = { ticket: QuotaTicket | null };

async function buildCounted(ctx: {
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
  /** The degraded pass this build would replace (R1-m2), or null for a new pass. */
  rebuildOf: Pass | null;
}, held: AccountHold = { ticket: null }): Promise<BuildOutcome> {
  const { store, now, cfg } = ctx;
  if (ctx.signal.aborted) throw new WaiterAbortedError();
  const reservedSlice = Boolean(ctx.deps.internal || ctx.deps.reserved);

  // SEC-3-03: today's share of the month's store commands is used: no new visitor passes until Chicago
  // midnight (0 commands). The example parks and their warm-up keep working; saved passes always do.
  const paced = reservedSlice ? null : dailyPaceState(now());
  if (paced?.paced) {
    log("pass_paused_daily_pace", { used: paced.used, pace: paced.pace }, "warn");
    return { kind: "error", status: 429, error: { code: "DAILY_LIMIT", message: `${PASS_COPY.paused} It resets in ${waitText(paced.retryAfter)}.`, retryAfter: paced.retryAfter } };
  }

  // SEC-3-02: a cached failure (not a park, too heavy, too slow, every Overpass mirror resting) answers
  // here after ONE store command, before anything is reserved.
  const featuresPlan = await peekFeatures(ctx.ref, { store, env: ctx.env, now });
  if (featuresPlan.kind === "fail") {
    log("pass_not_made", { kind: "error", status: featuresPlan.outcome.status, code: featuresPlan.outcome.error.code, cached: true }, "warn");
    return featuresPlan.outcome;
  }

  // Accounts: this account's share of today's new passes (2; the judge demo: 3 per connection inside its
  // shared cap). Q-4-03: a rebuild of today's degraded pass doesn't count against the account.
  const acct = await reserveAccountShare(store, ctx.deps, ctx.env, now(), ctx.rebuildOf !== null);
  if (acct && !acct.ok) return acct.outcome as BuildOutcome;
  held.ticket = acct?.ticket ?? null;
  const accountTicket = held.ticket;

  // Caps BEFORE any upstream: the model budget must have room, then the per-IP daily share.
  const aiCap = aiCapFor(cfg, reservedSlice);
  const ai = await quotaUsage(store, { name: "ai-calls", period: { kind: "day" }, now: now() });
  if (ai.global >= aiCap) {
    return { kind: "error", status: 429, error: { code: "DAILY_LIMIT", message: PASS_COPY.paused, retryAfter: 3600 } };
  }
  const share = await reserveQuota(store, {
    name: "pass-new",
    key: ctx.deps.ip,
    perKey: ctx.deps.internal ? Infinity : cfg.passPerIpPerDay,
    // SEC-2-02: the AI reserve applies here too, or cheap no-AI requests could fill this share for everyone.
    global: Math.max(aiCap, 1) * 2,
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
  const ipTicket: QuotaTicket = share.ticket;
  // Every upstream start spends the per-IP share and the account's share together.
  const ticket = {
    commit() {
      ipTicket.commit();
      accountTicket?.commit();
    },
    release: () => ipTicket.release(),
    get committed() {
      return ipTicket.committed;
    },
  };
  // Q-3-03: a rebuild is counted only now that it really starts (the finally below gives the share back
  // when the day's rebuilds are used up; makePass then shows the degraded pass again).
  if (ctx.rebuildOf && !(await noteRebuild(store, ctx.key, ctx.rebuildOf, now()))) {
    await ticket.release();
    return { kind: "error", status: 429, error: { code: "REBUILD_LIMIT", message: "This pass was already remade the most times allowed today." } };
  }

  // Accounts: items visitors reported as not findable or not safe here stay out of the pool (1 command).
  let exclude: Set<string>;
  try {
    const why = excludedRefs(await parkReportStats(store, ctx.req.parkId, now()));
    exclude = new Set(why.keys());
    if (exclude.size > 0) log("pool_reported_out", { park: ctx.req.parkId, notFound: [...why.values()].filter((w) => w === "not_found").length, notSafe: [...why.values()].filter((w) => w === "not_safe").length });
  } catch (err) {
    await ticket.release();
    throw err;
  }

  // October special (S7): free iNaturalist counts, fetched while the model writes clues.
  let october: Promise<OctoberBoxData> | null = null;
  // R1-M1: the October box's iNaturalist calls stop at the pass deadline too (never after the answer).
  const octoberDeadline = createDeadline(ctx.startedAt + PASS_DEADLINE_MS - now());
  // Audit Q-3-05: once the pass has failed (no model key, model down, quota), the box's iNaturalist
  // requests that haven't been sent yet are not sent (the box would never be shown).
  const octoberStop = new AbortController();
  const startOctober = (park: OctoberPark) => {
    if (october || !isOctoberDay(ctx.day)) return;
    const signal = eitherSignal(octoberDeadline.signal, octoberStop.signal);
    october = octoberBox(park, { store, fetchImpl: ctx.deps.fetchImpl, env: ctx.env, now, signal, onStart: () => ticket.commit() }).catch(
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
        featuresPlan,
        exclude,
      },
    );
    if (out.kind === "pass") {
      startOctober(out.pass.park);
      if (october) {
        const cap = Math.max(0, Math.min(OCTOBER_WAIT_MS, ctx.startedAt + PASS_DEADLINE_MS - now()));
        out = { ...out, pass: { ...out.pass, october: await within(october, cap) } };
      }
      await passCache.set(ctx.id, out.pass, { now: now() });
      forgetPassRead(ctx.id);
      await latestCache.set(ctx.key, ctx.variant, { now: now() });
      log("pass_made", { id: ctx.id, items: out.pass.items.length, model: out.pass.model.answered, ms: now() - ctx.startedAt, degraded: isDegraded(out.pass) });
    } else {
      octoberStop.abort(new Error("pass not made"));
      log("pass_not_made", { kind: out.kind, status: out.kind === "error" ? out.status : 200, code: out.kind === "error" ? out.error.code : "EMPTY" }, "warn");
    }
    return out;
  } finally {
    octoberDeadline.clear();
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
