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
import { osmRefreshIdle } from "@/lib/sources/osm-refresh";
import type { ExampleLink } from "@/lib/parks/schema";
import { DEFAULT_AGE_BAND, type AgeBand, type Pass } from "@/lib/pass/schema";
import { completeness, isCompletePass } from "@/lib/pass/complete";

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

export type WarmDeps = {
  env?: Env;
  now?: () => number;
  store?: Store;
  fetchImpl?: FetchLike;
  modelFetch?: FetchLike;
  examples?: readonly ExamplePark[];
};

type Holder = {
  /** Refreshes running in this process. */
  running: Map<string, Promise<void>>;
  /** Lock decisions in progress (so concurrent page renders share one decision). */
  deciding: Map<string, Promise<boolean>>;
  lastError: Map<string, { at: number; code: string }>;
  /** Refreshes run one after another in a process (polite to Overpass: one park's queries at a time). */
  chain: Promise<void>;
};
const HOLDER = Symbol.for("grass-pass.prewarm");
function holder(): Holder {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (g[HOLDER] ??= { running: new Map(), deciding: new Map(), lastError: new Map(), chain: Promise.resolve() });
}

/** Tests: forget in-process refresh state. */
export function resetPrewarm(): void {
  holder().running.clear();
  holder().deciding.clear();
  holder().lastError.clear();
  holder().chain = Promise.resolve();
}

/** Wait for every background refresh started so far (examples, then saved-map refreshes). */
export async function prewarmIdle(): Promise<void> {
  const h = holder();
  while (h.running.size > 0 || h.deciding.size > 0) await Promise.allSettled([...h.running.values(), ...h.deciding.values()]);
  await osmRefreshIdle();
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
  }
}

async function takeLock(slug: string, day: string, deps: WarmDeps): Promise<boolean> {
  try {
    const n = await lockStore(deps).incr(lockKey(slug, day), 1, REFRESH_LOCK_SEC);
    return n === 1;
  } catch {
    return false; // store down: never refresh blind
  }
}

/** Make (or reuse) today's pass for one example and remember it. Never throws. */
async function refreshOne(ex: ExamplePark, day: string, deps: WarmDeps): Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  try {
    const out = await makePass(
      { parkId: ex.parkId, ageBand: EXAMPLE_BAND },
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
      if (degraded) await shortenLock(ex.slug, day, deps, DEGRADED_RETRY_SEC);
      log("prewarm_ok", { example: ex.slug, id: out.pass.id, items: c.items, target: c.target, riddle: c.riddle, complete: c.complete, cached: out.cached, degraded, ms: now() - started });
    } else {
      const code = out.kind === "error" ? out.error.code : "EMPTY";
      holder().lastError.set(ex.slug, { at: now(), code });
      if (out.kind === "error" && NO_MODEL_CODES.has(out.error.code)) await shortenLock(ex.slug, day, deps);
      log("prewarm_failed", { example: ex.slug, kind: out.kind, code, ms: now() - started }, "warn");
    }
  } catch (err) {
    holder().lastError.set(ex.slug, { at: now(), code: "EXCEPTION" });
    log("prewarm_failed", { example: ex.slug, kind: "exception", error: err instanceof Error ? err.name : "unknown" }, "error");
  }
}

/** True when today's degraded example pass may be rebuilt now (makePass's cap decides, R2-M1). */
function rebuildDue(ex: ExamplePark, pass: Pass, nowMs: number): Promise<boolean> {
  if (!isDegraded(pass)) return Promise.resolve(false);
  return mayRebuildDegraded(passKey(ex.parkId, EXAMPLE_BAND, nowMs), pass, (nowMs - Date.parse(pass.generatedAt)) / 1000, nowMs).catch(() => false);
}

/** Start one background refresh for an example unless one is running here or another instance holds the slot. */
function maybeRefresh(ex: ExamplePark, day: string, deps: WarmDeps): Promise<boolean> {
  const h = holder();
  if (h.running.has(ex.slug)) return Promise.resolve(true);
  const pending = h.deciding.get(ex.slug);
  if (pending) return pending;
  const decision = (async () => {
    if (!(await takeLock(ex.slug, day, deps))) return false;
    const p = h.chain.then(() => refreshOne(ex, day, deps)).finally(() => h.running.delete(ex.slug));
    h.chain = p.catch(() => undefined);
    h.running.set(ex.slug, p);
    return true;
  })().finally(() => h.deciding.delete(ex.slug));
  h.deciding.set(ex.slug, decision);
  return decision;
}

/**
 * Status of every example for the home page. Stale or missing examples get a background refresh
 * (when enabled); the returned promise never waits for it. The page hands `prewarmIdle` to Next's
 * after() so a serverless instance keeps the refresh alive after the response.
 */
export async function exampleStatuses(deps: WarmDeps = {}): Promise<ExampleStatus[]> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const today = localDay(now());
  const enabled = prewarmEnabled(env);
  const out: ExampleStatus[] = [];
  for (const ex of deps.examples ?? EXAMPLE_PARKS) {
    const hit = await savedCache.get(ex.slug, now());
    // The link must still open: the pass itself lives 30 days in the pass cache.
    const latestPass = hit ? await loadPass(hit.value.passId, now()) : null;
    const latest = hit && latestPass ? savedOf(hit.value) : null;
    const fresh = latest !== null && latestPass !== null && latest.day === today && !(await rebuildDue(ex, latestPass, now()));
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
      const cPass = c ? await loadPass(c.passId, now()) : null;
      if (c && cPass && isCompletePass(cPass)) {
        shown = c;
        shownPass = cPass;
      }
    }
    const short = latest && latestC && !latestC.complete && latest.day === today ? { items: latestC.items, target: latestC.target, riddle: latestC.riddle } : null;

    let refreshing = holder().running.has(ex.slug);
    if (!fresh && enabled && !refreshing) refreshing = await maybeRefresh(ex, today, deps);
    const err = holder().lastError.get(ex.slug);
    const missing =
      shown !== null
        ? null
        : short
          ? `No data available yet: today's pass came out with ${short.items} of ${short.target} finds${short.riddle === "code" ? " and no Find This Spot riddle" : ""}, and this page only shows complete example passes.`
          : !enabled
            ? "No data available yet: example passes are switched off on this server."
            : refreshing
              ? "No data available yet: it is being made right now (about 15-30 seconds)."
              : err
                ? `No data available yet: the last try didn't work because ${failureReason(err.code)}.`
                : "No data available yet: no pass has been made for it today.";
    out.push({ example: ex, pass: shown, latest, passData: shownPass, fresh, today: shown !== null && shown.day === today, short, refreshing, missing });
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
  // Judge R7 T1: a complete example pass first, else any saved one (an error page may still offer a short real pass).
  // One GET per example, as before.
  const latest: { ex: ExamplePark; id: string }[] = [];
  for (const ex of deps.examples ?? EXAMPLE_PARKS) {
    const hit = await savedCache.get(ex.slug, now());
    if (!hit) continue;
    const complete = hit.value.complete;
    if (complete && (await loadPass(complete.passId, now()))) return { name: ex.name, href: `/pass/${complete.passId}?example=1` };
    latest.push({ ex, id: hit.value.passId });
  }
  for (const { ex, id } of latest) if (await loadPass(id, now())) return { name: ex.name, href: `/pass/${id}?example=1` };
  return null;
}

/**
 * Boot-time warm-up (instrumentation.ts): make today's example passes one park at a time (polite to
 * Overpass and iNaturalist). Uses the same per-example lock as the page, so several instances booting
 * together make each pass once.
 */
export async function warmExamples(deps: WarmDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  if (!prewarmEnabled(env)) {
    log("prewarm_off", { reason: "PREWARM_EXAMPLES" });
    return;
  }
  const now = deps.now ?? (() => Date.now());
  for (const ex of deps.examples ?? EXAMPLE_PARKS) {
    const hit = await savedCache.get(ex.slug, now());
    const pass = hit && hit.value.day === localDay(now()) ? await loadPass(hit.value.passId, now()) : null;
    if (pass && !(await rebuildDue(ex, pass, now()))) continue;
    if (await maybeRefresh(ex, localDay(now()), deps)) await holder().running.get(ex.slug);
  }
}
