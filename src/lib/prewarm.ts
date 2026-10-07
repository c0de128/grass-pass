/**
 * Pre-warmed example parks (SPEC S8, starter kit "pre-warmed example parks kept warm (SWR) with real
 * times"; pattern prewarmed-examples-stale-while-revalidate). A judge clicks an example and sees a real
 * pass in well under 3 s, because the pass was made earlier by the normal builder from live data.
 *
 * - The last good pass per example is remembered (`example-pass`, 60 days) and its page link shown with
 *   the time it was really generated. Nothing is invented: no pass yet means the home page says so.
 * - A pass belongs to one Chicago day. When the saved one is from an earlier day, the page still links it
 *   (with its real date and time) and starts at most ONE background refresh per example per
 *   REFRESH_LOCK_SEC across all instances (an atomic store counter), so visitors never wait for it.
 * - Refreshes go through makePass({ internal: true }): the same builder, cache and in-flight dedup as a
 *   visitor, never charged to a visitor and not subject to per-IP limits, but counted against every
 *   global cap (AI_DAILY_CAP). A failed refresh keeps the old pass. No retry loop.
 * - A pass made while a source was down ("degraded", R1-m2) gets a rebuild only when makePass's cap
 *   allows it (R2-M1: once an hour per key at most, 3 a day, longer after the same failure, never
 *   for a reason that would just repeat), so examples can't spend a model call every 15 minutes.
 * - The example parks' OpenStreetMap data is saved (src/data/osm, R1-B1), so a refresh needs no live
 *   Overpass; only iNaturalist and the model are live.
 * - PREWARM_EXAMPLES=0 (or off/false/no) switches it off; the home page then says so.
 * - In-process state lives on globalThis (Next bundles instrumentation.ts separately from pages;
 *   pattern next-instrumentation-singletons-on-globalthis).
 *
 * Serverless (pre-prod fixes 2026-10-07, reports/preview-deploy-2026-10-07b.md in the factory repo): on the first
 * Vercel preview the boot warm-up ran outside any request, the instance was paused between requests, and the store's
 * 3 s timers fired after 4-105 s. On Vercel (VERCEL set) nothing runs outside a request:
 *   - instrumentation.ts starts no warm-up there;
 *   - a home-page render starts at most ONE example (and none while one is still running in this instance), kept
 *     alive by after() (Vercel waitUntil) with a time budget (WARMUP_BUDGET_MS) below the page's maxDuration; a
 *     later request resumes with the next example;
 *   - a daily Vercel cron (/api/cron/warm-examples, early morning Dallas time) warms the examples one after another
 *     while its own budget (CRON_BUDGET_MS, below that route's maxDuration) still fits a whole pass.
 * Second try (same report): an example whose only pass today came out short, with no complete pass saved, gets ONE
 * more full attempt that day (a new variant, like "Make a different pass"), inside the daily AI cap. A short pass is
 * still never shown.
 * Store trouble during a warm-up is never fatal: the warm-up stops for this round and says so in the logs once
 * (prewarm_store_unavailable, at most once per STORE_WARN_EVERY_MS per instance).
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createJsonCache, getStore, type Store } from "@/lib/cache";
import { memoize } from "@/lib/cache/memo";
import { log } from "@/lib/log";
import { localDay } from "@/lib/time";
import type { FetchLike } from "@/lib/sources/common";
import { DEGRADED_RETRY_SEC, isDegraded, loadPass, makePass, mayRebuildDegraded, passKey } from "@/lib/pass/make";
import { PASS_DEADLINE_MS } from "@/lib/pass/budget";
import { osmRefreshIdle } from "@/lib/sources/osm-refresh";
import type { ExampleLink } from "@/lib/parks/schema";
import { DEFAULT_AGE_BAND, type AgeBand, type Pass } from "@/lib/pass/schema";
import { completeness, isCompletePass, type Completeness } from "@/lib/pass/complete";
import { pinnedPass } from "@/lib/pinned";

export type ExamplePark = {
  slug: string;
  /** OpenStreetMap id, confirmed in evals/cases.json (recorded 2026-10-05). */
  parkId: string;
  name: string;
  place: string;
  /** Why it is a good example (shown under the link). */
  blurb: string;
};

/**
 * Parks with good real data in the 2026-10-05 eval recordings (evals/cases.json). R2-m9: shown (and
 * offered as "a ready example") in this order, a COMPLETE pass first (exampleStatuses also puts parks with a
 * complete pass ahead of the rest).
 *
 * Judge R7 T1: Connemara Meadow Preserve was the 4th example, but its pass was 5 of 8 in every run of eval -8
 * (1 mapped feature kind; its iNaturalist species have thin Wikipedia summaries, so clues failed the generic
 * check). Oak Point Park and Nature Preserve (Plano) replaced it: in the same recordings 67 species nearby (23 of 25
 * with a full summary), 6 mapped feature kinds with one picnic shelter for Find This Spot, and eval -8 passes of
 * 8, 8 and 7 of 8. The home page's "two parks" band still shows Connemara's Oct 5 measurement (a measurement,
 * not an example pass). Details: reports/examples-curation-2026-10-06.md in the factory repo.
 */
export const EXAMPLE_PARKS: readonly ExamplePark[] = [
  { slug: "arbor-hills", parkId: "way/38113837", name: "Arbor Hills Nature Preserve", place: "Plano TX", blurb: "trails, a creek, wildlife and a Find This Spot map" },
  { slug: "white-rock", parkId: "way/460905359", name: "White Rock Lake Park", place: "Dallas TX", blurb: "a big lake park" },
  { slug: "celebration", parkId: "way/188145317", name: "Celebration Park", place: "Allen TX", blurb: "playgrounds, courts and a Find This Spot map" },
  { slug: "oak-point", parkId: "way/556800335", name: "Oak Point Park and Nature Preserve", place: "Plano TX", blurb: "a creek preserve: lots of plants, birds and bugs" },
];

export const EXAMPLE_BAND: AgeBand = DEFAULT_AGE_BAND;
/** At most one refresh attempt per example in this window, across instances. */
export const REFRESH_LOCK_SEC = 2 * 3600;
/**
 * After a failure that never reached the model (OpenStreetMap busy, data too slow), the next try may
 * come sooner: it costs no model call, and a short Overpass outage should not hide an example for 2 h.
 */
export const RETRY_NO_MODEL_SEC = 10 * 60;
const NO_MODEL_CODES = new Set(["OSM_UNAVAILABLE", "BUSY_HERE", "PARK_TOO_BIG", "DATA_TOO_SLOW", "NOT_A_PARK", "STORE_UNAVAILABLE", "RATE_LIMITED"]);
const SAVED_TTL_SEC = 60 * 24 * 3600;
/** The second try's cross-instance slot: one per example per Chicago day (the key lives a bit longer than a day). */
const RETRY_KEY_TTL_SEC = 26 * 3600;

/**
 * Time budgets (serverless). A refresh is one pass: at most PASS_DEADLINE_MS (85 s) plus a few store writes. The home
 * page exports maxDuration 120 (HOME_MAX_DURATION_SEC), so its after() waits at most WARMUP_BUDGET_MS; the cron route
 * exports maxDuration 300 (CRON_MAX_DURATION_SEC, the Vercel Hobby maximum with Fluid compute, docs checked
 * 2026-10-07) and starts another example only while CRON_BUDGET_MS still fits a whole pass (REFRESH_WORST_MS).
 */
export const HOME_MAX_DURATION_SEC = 120;
export const WARMUP_BUDGET_MS = 105_000;
export const CRON_MAX_DURATION_SEC = 300;
export const CRON_BUDGET_MS = 280_000;
/** A new example (or its second try) is started only when this much of a budget is left. */
export const REFRESH_WORST_MS = PASS_DEADLINE_MS + 10_000;
/** "The store didn't answer during a warm-up" is logged at most this often per instance. */
export const STORE_WARN_EVERY_MS = 10 * 60_000;

const SavedSchema = z.object({ passId: z.string(), day: z.string(), generatedAt: z.string() });
type Saved = z.infer<typeof SavedSchema>;
/**
 * One store key per example (SEC-3-02: the home page and the search fallback read 1 GET per example): the last pass
 * made, plus (judge R7 T1) the last COMPLETE pass (src/lib/pass/complete.ts), kept with it for 60 days (the pass itself
 * stays readable 30 days). When today's re-made pass is short, the home page keeps showing the complete one with its
 * real date.
 */
const EntrySchema = SavedSchema.extend({ complete: SavedSchema.optional() });
type Entry = z.infer<typeof EntrySchema>;
const savedCache = createJsonCache({ name: "example-pass", schema: EntrySchema, ttlSec: SAVED_TTL_SEC, maxEntries: 50 });
const savedOf = (e: Entry): Saved => ({ passId: e.passId, day: e.day, generatedAt: e.generatedAt });

type Env = Record<string, string | undefined>;

export function prewarmEnabled(env: Env = process.env): boolean {
  const v = env.PREWARM_EXAMPLES?.trim().toLowerCase();
  return !(v === "0" || v === "off" || v === "false" || v === "no");
}

/** True on Vercel (serverless): no warm-up outside a request, and at most one example per page request. */
export function serverlessWarmup(env: Env = process.env): boolean {
  return Boolean(env.VERCEL?.trim());
}

export type WarmDeps = {
  env?: Env;
  now?: () => number;
  store?: Store;
  fetchImpl?: FetchLike;
  modelFetch?: FetchLike;
  examples?: readonly ExamplePark[];
  /** Wall clock for time budgets and log throttling (tests move it; `now` is the app clock, often frozen in tests). */
  clock?: () => number;
};

type Holder = {
  /** Refreshes running in this process. */
  running: Map<string, Promise<void>>;
  /** Lock decisions in progress (so concurrent page renders share one decision). */
  deciding: Map<string, Promise<boolean>>;
  lastError: Map<string, { at: number; code: string }>;
  /** Refreshes run one after another in a process (polite to Overpass: one park's queries at a time). */
  chain: Promise<void>;
  /** `${slug}:${day}` whose second try was already decided in this process (saves a store command per check). */
  retried: Set<string>;
  /** When "store unavailable during warm-up" was last logged here (0 = never). */
  storeWarnAt: number;
  /** Store failures seen by the warm-up in this process (a warm-up round stops when it grows). */
  storeFailures: number;
};
const HOLDER = Symbol.for("grass-pass.prewarm");
function holder(): Holder {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  const h = (g[HOLDER] ??= { running: new Map(), deciding: new Map(), lastError: new Map(), chain: Promise.resolve(), retried: new Set(), storeWarnAt: 0, storeFailures: 0 });
  // A holder made by an older copy of this module (dev hot reload) lacks the newer fields.
  h.retried ??= new Set();
  h.storeWarnAt ??= 0;
  h.storeFailures ??= 0;
  return h;
}

/** Tests: forget in-process refresh state. */
export function resetPrewarm(): void {
  const h = holder();
  h.running.clear();
  h.deciding.clear();
  h.lastError.clear();
  h.chain = Promise.resolve();
  h.retried.clear();
  h.storeWarnAt = 0;
  h.storeFailures = 0;
}

/** The store didn't answer during a warm-up: never fatal; logged at most once per STORE_WARN_EVERY_MS per instance. */
function storeTrouble(where: string, deps: WarmDeps): void {
  const h = holder();
  h.storeFailures++;
  const t = (deps.clock ?? Date.now)();
  if (h.storeWarnAt !== 0 && t - h.storeWarnAt < STORE_WARN_EVERY_MS) return;
  h.storeWarnAt = t;
  log("prewarm_store_unavailable", { where, nextLogInMin: STORE_WARN_EVERY_MS / 60_000 }, "warn");
}

/**
 * Wait for every background refresh started so far (examples, then saved-map refreshes). With `budgetMs` (the home
 * page's after(), serverless) it stops waiting after that long, so the invocation ends inside its maxDuration (a
 * refresh is only started when a whole pass fits, so this is a safety net). Never throws.
 */
export async function prewarmIdle(opts: { budgetMs?: number } = {}): Promise<void> {
  const h = holder();
  const all = (async () => {
    while (h.running.size > 0 || h.deciding.size > 0) await Promise.allSettled([...h.running.values(), ...h.deciding.values()]);
    await osmRefreshIdle();
  })().catch(() => undefined);
  if (opts.budgetMs === undefined) return all;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), Math.max(0, opts.budgetMs ?? 0));
  });
  try {
    const r = await Promise.race([all.then(() => "done" as const), late]);
    if (r === "late") log("prewarm_budget_reached", { budgetMs: opts.budgetMs, running: [...h.running.keys()] }, "warn");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Q-1-10: a short, code-written reason per failure code (never the nested user message), finishing
 * the sentence "No data available yet: the last try didn't work because ...".
 */
export function failureReason(code: string): string {
  switch (code) {
    case "OSM_UNAVAILABLE":
      return "OpenStreetMap was busy";
    case "BUSY_HERE":
      return "Grass Pass was busy with other passes";
    case "DATA_TOO_SLOW":
      return "the park data was too slow";
    case "PARK_TOO_BIG":
    case "NOT_A_PARK":
      return "OpenStreetMap couldn't read this park";
    case "MODEL_NOT_CONFIGURED":
      return "this server has no AI model set up";
    case "DAILY_LIMIT":
      return "today's free limit for new passes is used up";
    case "STORE_UNAVAILABLE":
      return "the usage-limit store didn't answer";
    case "VARIANT_LIMIT":
      return "today's new passes for this park are used up";
    case "EMPTY":
      return "there wasn't enough real park data";
    case "EXCEPTION":
      return "the pass builder stopped with an error";
    default:
      return code.startsWith("MODEL_") ? "the AI model didn't write clues" : "something went wrong";
  }
}

export type ExampleStatus = {
  example: ExamplePark;
  /**
   * The pass the home page shows (link target): today's when it is complete, else the last complete one (judge R7
   * T1, with its real date), or null when no complete pass was made yet. Never a short pass.
   */
  pass: Saved | null;
  /** The last pass made for this example (today's or older), complete or not (logs, refresh logic, tests). */
  latest: Saved | null;
  /**
   * That pass itself (already read for the link check, so no extra store read): the home page shows its real
   * park facts, sections and first finds. Absent when there is no pass.
   */
  passData?: Pass | null;
  /**
   * True when today's pass (Chicago day) was made and is not a degraded one that may be rebuilt now (so no refresh
   * is due), whether or not it is the one shown.
   */
  fresh: boolean;
  /** True when the pass shown is today's (false: an older complete pass, shown with its real date). */
  today: boolean;
  /** Today's pass when it came out short and is NOT shown (judge R7 T1): its finds, its target, and whether its map lost the riddle. */
  short: { items: number; target: number; riddle: "model" | "code" | "none" } | null;
  /** True when this server is making a new one right now. */
  refreshing: boolean;
  /**
   * Only when pass is null: ONE complete sentence saying why (starts "No data available yet:", never
   * nested, Q-1-10). `retry` says whether a reload can help soon.
   */
  missing: string | null;
};

const lockStore = (deps: WarmDeps) => deps.store ?? getStore("prewarm");

/** Take the cross-instance refresh slot for one example (true = this caller may refresh now). */
const lockKey = (slug: string, day: string) => `prewarm-lock:${slug}:${day}`;

/** Shorten the lock after a failure that cost no model call (see RETRY_NO_MODEL_SEC) or a degraded pass. */
async function shortenLock(slug: string, day: string, deps: WarmDeps, sec: number = RETRY_NO_MODEL_SEC): Promise<void> {
  try {
    const store = lockStore(deps);
    await store.del(lockKey(slug, day));
    await store.incr(lockKey(slug, day), 1, sec);
  } catch {
    // Store down: the long lock stays, which only means fewer retries.
    storeTrouble("shorten_lock", deps);
  }
}

async function takeLock(slug: string, day: string, deps: WarmDeps): Promise<boolean> {
  try {
    const n = await lockStore(deps).incr(lockKey(slug, day), 1, REFRESH_LOCK_SEC);
    return n === 1;
  } catch {
    storeTrouble("lock", deps);
    return false; // store down: never refresh blind
  }
}

/** The one second try per example per day, across instances (true = this caller makes it). */
const retryKey = (slug: string, day: string) => `prewarm-retry:${slug}:${day}`;
async function takeRetry(slug: string, day: string, deps: WarmDeps): Promise<boolean> {
  const h = holder();
  const id = `${slug}:${day}`;
  if (h.retried.has(id)) return false;
  try {
    const n = await lockStore(deps).incr(retryKey(slug, day), 1, RETRY_KEY_TTL_SEC);
    h.retried.add(id);
    return n === 1;
  } catch {
    storeTrouble("retry_lock", deps);
    return false;
  }
}

/** What an example needs now: nothing, today's pass (or a rebuild of a degraded one), or the one second try. */
type Need = "none" | "refresh" | "retry";

/** Make (or reuse) today's pass for one example, or make the second try, and remember it. Never throws. */
async function refreshOne(ex: ExamplePark, day: string, deps: WarmDeps, need: Exclude<Need, "none">): Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const retry = need === "retry";
  try {
    const out = await makePass(
      // The second try is a NEW variant (the model writes a new pass); a refresh reuses today's pass when there is one.
      { parkId: ex.parkId, ageBand: EXAMPLE_BAND, ...(retry ? { fresh: true } : {}) },
      { ip: "server-prewarm", internal: true, env: deps.env, now, fetchImpl: deps.fetchImpl, modelFetch: deps.modelFetch },
    );
    if (out.kind === "pass") {
      const saved = { passId: out.pass.id, day: out.pass.day, generatedAt: out.pass.generatedAt };
      // Judge R7 T1: only a complete pass replaces the one the home page shows; a short one keeps the old complete one.
      const c = completeness(out.pass);
      const before = c.complete ? null : await savedCache.get(ex.slug, now());
      // An entry saved before this record existed: its own pass, when complete, is the last complete one.
      const oldPass = before && !before.value.complete && before.value.passId !== saved.passId ? await loadPass(before.value.passId, now()) : null;
      const complete = c.complete ? saved : (before?.value.complete ?? (before && oldPass && isCompletePass(oldPass) ? savedOf(before.value) : undefined));
      await savedCache.set(ex.slug, { ...saved, ...(complete ? { complete } : {}) }, { now: now() });
      holder().lastError.delete(ex.slug);
      const degraded = isDegraded(out.pass);
      // R1-m2: a pass made while a source was down gets another try after DEGRADED_RETRY_SEC, not 2 h.
      if (degraded && !retry) await shortenLock(ex.slug, day, deps, DEGRADED_RETRY_SEC);
      log("prewarm_ok", { example: ex.slug, id: out.pass.id, items: c.items, target: c.target, riddle: c.riddle, complete: c.complete, cached: out.cached, degraded, retry, ms: now() - started });
    } else {
      const code = out.kind === "error" ? out.error.code : "EMPTY";
      holder().lastError.set(ex.slug, { at: now(), code });
      if (out.kind === "error" && NO_MODEL_CODES.has(out.error.code) && !retry) await shortenLock(ex.slug, day, deps);
      if (code === "STORE_UNAVAILABLE") storeTrouble("make_pass", deps);
      log("prewarm_failed", { example: ex.slug, kind: out.kind, code, retry, ms: now() - started }, "warn");
    }
  } catch (err) {
    holder().lastError.set(ex.slug, { at: now(), code: "EXCEPTION" });
    log("prewarm_failed", { example: ex.slug, kind: "exception", error: err instanceof Error ? err.name : "unknown", retry }, "error");
  }
}

/** True when today's degraded example pass may be rebuilt now (makePass's cap decides, R2-M1). */
function rebuildDue(ex: ExamplePark, pass: Pass, nowMs: number): Promise<boolean> {
  if (!isDegraded(pass)) return Promise.resolve(false);
  return mayRebuildDegraded(passKey(ex.parkId, EXAMPLE_BAND, nowMs), pass, (nowMs - Date.parse(pass.generatedAt)) / 1000, nowMs).catch(() => false);
}

/**
 * Start one background refresh (or the second try) for an example unless one is running here or another instance
 * holds the slot. True when one is running here afterwards.
 */
function maybeRefresh(ex: ExamplePark, day: string, deps: WarmDeps, need: Exclude<Need, "none">): Promise<boolean> {
  const h = holder();
  if (h.running.has(ex.slug)) return Promise.resolve(true);
  const pending = h.deciding.get(ex.slug);
  if (pending) return pending;
  const decision = (async () => {
    if (!(await (need === "retry" ? takeRetry(ex.slug, day, deps) : takeLock(ex.slug, day, deps)))) return false;
    const p = h.chain.then(() => refreshOne(ex, day, deps, need)).finally(() => h.running.delete(ex.slug));
    h.chain = p.catch(() => undefined);
    h.running.set(ex.slug, p);
    return true;
  })().finally(() => h.deciding.delete(ex.slug));
  h.deciding.set(ex.slug, decision);
  return decision;
}

type Inspected = {
  latest: Saved | null;
  latestC: Completeness | null;
  shown: Saved | null;
  shownPass: Pass | null;
  short: ExampleStatus["short"];
  need: Need;
};

/** Read one example's saved state (1 GET + memoized pass reads) and decide what it needs today. */
async function inspect(ex: ExamplePark, today: string, nowMs: number): Promise<Inspected> {
  const hit = await savedCache.get(ex.slug, nowMs);
  // The link must still open: the pass itself lives 30 days in the pass cache.
  const latestPass = hit ? await loadPass(hit.value.passId, nowMs) : null;
  const latest = hit && latestPass ? savedOf(hit.value) : null;
  const latestC = latestPass ? completeness(latestPass) : null;

  // Judge R7 T1: show the latest pass only when it is complete; else the last complete one (with its real date).
  let shown: Saved | null = null;
  let shownPass: Pass | null = null;
  if (latest && latestPass && latestC?.complete) {
    shown = latest;
    shownPass = latestPass;
  } else {
    // The last complete pass saved with this entry (an older pass, shown with its real date).
    const c = hit?.value.complete;
    const cPass = c ? await loadPass(c.passId, nowMs) : null;
    if (c && cPass && isCompletePass(cPass)) {
      shown = c;
      shownPass = cPass;
    }
  }
  const isToday = latest !== null && latest.day === today;
  const short = isToday && latestC && !latestC.complete ? { items: latestC.items, target: latestC.target, riddle: latestC.riddle } : null;
  let need: Need = "none";
  if (!isToday || !latestPass || (await rebuildDue(ex, latestPass, nowMs))) need = "refresh";
  // The second try: today's pass is short and the store has no complete pass to show instead (once a day per example).
  else if (short && shown === null && !holder().retried.has(`${ex.slug}:${today}`)) need = "retry";
  // Last fallback (Kevin 2026-10-07): the example's pinned real pass from the repo (src/lib/pinned.ts), with its real date.
  if (shown === null) {
    const pin = pinnedPass(ex.slug);
    if (pin) {
      shown = { passId: pin.id, day: pin.day, generatedAt: pin.generatedAt };
      shownPass = pin;
    }
  }
  return { latest, latestC, shown, shownPass, short, need };
}

/**
 * Status of every example for the home page. Stale or missing examples get a background refresh
 * (when enabled); the returned promise never waits for it. The page hands `prewarmIdle` to Next's
 * after() so a serverless instance keeps the refresh alive after the response. Serverless: at most ONE refresh
 * starts per call, and none while another is still running in this instance (a later request resumes).
 */
export async function exampleStatuses(deps: WarmDeps = {}): Promise<ExampleStatus[]> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const today = localDay(now());
  const enabled = prewarmEnabled(env);
  const oneAtATime = serverlessWarmup(env);
  const h = holder();
  let started = false;
  const out: ExampleStatus[] = [];
  for (const ex of deps.examples ?? EXAMPLE_PARKS) {
    const i = await inspect(ex, today, now());
    const { latest, shown, shownPass, short } = i;
    let refreshing = h.running.has(ex.slug);
    if (i.need !== "none" && enabled && !refreshing) {
      const mayStart = !oneAtATime || (!started && h.running.size === 0 && h.deciding.size === 0);
      if (mayStart) {
        refreshing = await maybeRefresh(ex, today, deps, i.need);
        started ||= refreshing;
      }
    }
    const err = h.lastError.get(ex.slug);
    const missing =
      shown !== null
        ? null
        : short && refreshing
          ? `No data available yet: today's first pass came out with ${short.items} of ${short.target} finds, so a second one is being made right now (about 15-30 seconds).`
          : short
            ? `No data available yet: today's pass came out with ${short.items} of ${short.target} finds${short.riddle === "code" ? " and no Find This Spot riddle" : ""}, and this page only shows complete example passes.`
            : !enabled
              ? "No data available yet: example passes are switched off on this server."
              : refreshing
                ? "No data available yet: it is being made right now (about 15-30 seconds)."
                : err
                  ? `No data available yet: the last try didn't work because ${failureReason(err.code)}.`
                  : "No data available yet: no pass has been made for it today.";
    out.push({ example: ex, pass: shown, latest, passData: shownPass, fresh: i.need !== "refresh", today: shown !== null && shown.day === today, short, refreshing, missing });
  }
  // Judge R7 top-5 #3: complete examples first (config order kept within each group).
  return [...out.filter((s) => s.pass !== null), ...out.filter((s) => s.pass === null)];
}

/**
 * SEC-3-02: readyExample() is memoized in process this long, so a stream of map-data failures costs at
 * most 4 example GETs per instance per 5 minutes (the same rate as the home page check; math in
 * src/lib/limits/prelimit.ts), not 4 per failed request.
 */
export const READY_EXAMPLE_MEMO_MS = 5 * 60_000;

/**
 * A ready example pass to offer when a park search can't answer (R1-B1): the first example whose
 * saved pass still opens. Never starts a refresh. Null when none is ready.
 */
export async function readyExample(deps: Pick<WarmDeps, "now" | "examples"> = {}): Promise<ExampleLink | null> {
  if (!deps.now && !deps.examples) return memoize("ready-example", READY_EXAMPLE_MEMO_MS, () => findReadyExample({}));
  return findReadyExample(deps);
}

async function findReadyExample(deps: Pick<WarmDeps, "now" | "examples">): Promise<ExampleLink | null> {
  const now = deps.now ?? (() => Date.now());
  // Judge R7 T1: a complete example pass first, then a pinned one (src/lib/pinned.ts), else any saved one (an error
  // page may still offer a short real pass). One GET per example, as before.
  const latest: { ex: ExamplePark; id: string }[] = [];
  for (const ex of deps.examples ?? EXAMPLE_PARKS) {
    const hit = await savedCache.get(ex.slug, now());
    if (!hit) continue;
    const complete = hit.value.complete;
    if (complete && (await loadPass(complete.passId, now()))) return { name: ex.name, href: `/pass/${complete.passId}?example=1` };
    latest.push({ ex, id: hit.value.passId });
  }
  for (const ex of deps.examples ?? EXAMPLE_PARKS) {
    const pin = pinnedPass(ex.slug);
    if (pin) return { name: ex.name, href: `/pass/${pin.id}?example=1` };
  }
  for (const { ex, id } of latest) if (await loadPass(id, now())) return { name: ex.name, href: `/pass/${id}?example=1` };
  return null;
}

export type WarmSummary = {
  enabled: boolean;
  /** One line per attempt started here: the example and whether it was today's pass or the second try. */
  attempts: { example: string; need: "refresh" | "retry" }[];
  /** Why the round ended early: the time budget, or the store didn't answer. Null when every example was checked. */
  stopped: null | "budget" | "store";
};

/**
 * A warm-up round (instrumentation.ts on a long-running server; the daily cron route on Vercel): today's example
 * passes one park at a time (polite to Overpass and iNaturalist), plus the one second try for an example whose
 * pass came out short with no complete pass saved. Uses the same per-example locks as the page, so several
 * instances make each pass once. With `budgetMs`, a new attempt starts only while a whole pass still fits.
 */
export async function warmExamples(deps: WarmDeps = {}, opts: { budgetMs?: number } = {}): Promise<WarmSummary> {
  const env = deps.env ?? process.env;
  if (!prewarmEnabled(env)) {
    log("prewarm_off", { reason: "PREWARM_EXAMPLES" });
    return { enabled: false, attempts: [], stopped: null };
  }
  const now = deps.now ?? (() => Date.now());
  const clock = deps.clock ?? (() => Date.now());
  const t0 = clock();
  const h = holder();
  const failuresAtStart = h.storeFailures;
  const attempts: WarmSummary["attempts"] = [];
  const fits = () => opts.budgetMs === undefined || clock() - t0 + REFRESH_WORST_MS <= opts.budgetMs;
  for (const ex of deps.examples ?? EXAMPLE_PARKS) {
    // A refresh, then (when it came out short with nothing complete to show) the second try.
    for (let round = 0; round < 2; round++) {
      const today = localDay(now());
      const i = await inspect(ex, today, now());
      if (i.need === "none") break;
      if (!fits()) {
        log("prewarm_budget_stop", { example: ex.slug, need: i.need, budgetMs: opts.budgetMs, usedMs: clock() - t0 });
        return { enabled: true, attempts, stopped: "budget" };
      }
      if (!(await maybeRefresh(ex, today, deps, i.need))) break;
      attempts.push({ example: ex.slug, need: i.need });
      await h.running.get(ex.slug);
      if (h.storeFailures > failuresAtStart) return { enabled: true, attempts, stopped: "store" };
    }
    if (h.storeFailures > failuresAtStart) return { enabled: true, attempts, stopped: "store" };
  }
  return { enabled: true, attempts, stopped: null };
}
