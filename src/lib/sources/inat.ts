/**
 * iNaturalist API v1 (ADR 0002 D3): research-grade species seen near a park in the last 14 days,
 * plus a Wikipedia summary per species (the only text a Wild Finds clue may quote).
 *
 * Politeness (iNat asks for <= 60 requests/min and < 10,000/day):
 * - one request at a time per process, at least 1 s apart, plus a 1-per-second slot on the shared
 *   store so several serverless instances together stay at 1 req/s;
 * - a global daily budget (INAT_DAILY_CAP, default 3,000) charged the moment a request is sent;
 * - a circuit breaker after a 429 (honours Retry-After) or a 5xx/timeout.
 * Guard: `taxa/` is NEVER called with an empty id list. Live 2026-10-05: `GET /v1/taxa/` with no ids
 * answers 200 with "Life, Animals, Plants...", which would look like real data for an empty park.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import type { Store } from "@/lib/cache/store";
import {
  breakerRetryAfter,
  createSpacedQueue,
  intFromEnv,
  QueueAbortedError,
  reserveQuota,
  takeSecondSlot,
  tripBreaker,
} from "@/lib/limits";
import { log } from "@/lib/log";
import { localDay } from "@/lib/time";
import type { LatLng } from "@/lib/geo";
import { fetchText, parseRetryAfter, SourceError, userAgent, type FetchLike } from "./common";

export const INAT_SOURCE = "inaturalist";
export const INAT_API = "https://api.inaturalist.org/v1";
/** SPEC F3: 1.5 km around the park centre, last 14 days, research grade only. */
export const WILD_RADIUS_KM = 1.5;
export const WILD_WINDOW_DAYS = 14;
/** Measured 2026-10-05: species_counts 280-600 ms, taxa 170 ms. */
export const INAT_TIMEOUT_MS = 12_000;
export const INAT_MIN_INTERVAL_MS = 1_000;
export const INAT_QUEUE_MAX_WAIT_MS = 10_000;
export const INAT_ERROR_OPEN_SEC = 60;
export const INAT_DAILY_CAP_DEFAULT = 3_000;
/** The taxa endpoint takes at most 30 ids per call. */
export const TAXA_MAX_IDS = 30;
/** We never need more species than this (the prompt uses the top ones). */
export const SPECIES_PER_PAGE = 200;

type Env = Record<string, string | undefined>;

/** First day of the 14-day window, in Chicago time: Oct 5 -> "2026-09-21". */
export function windowStart(nowMs: number): string {
  const today = localDay(nowMs);
  const [y, m, d] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - WILD_WINDOW_DAYS));
  return start.toISOString().slice(0, 10);
}

export function speciesCountsUrl(center: LatLng, d1: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d1)) throw new RangeError("bad date");
  const u = new URL(`${INAT_API}/observations/species_counts`);
  u.searchParams.set("lat", center.lat.toFixed(5));
  u.searchParams.set("lng", center.lng.toFixed(5));
  u.searchParams.set("radius", String(WILD_RADIUS_KM));
  u.searchParams.set("quality_grade", "research");
  u.searchParams.set("d1", d1);
  u.searchParams.set("per_page", String(SPECIES_PER_PAGE));
  u.searchParams.set("locale", "en");
  return u.toString();
}

export function taxaUrl(ids: number[]): string {
  if (ids.length === 0) throw new RangeError("taxa/ must never be called without ids (it returns the tree of life)");
  if (ids.length > TAXA_MAX_IDS) throw new RangeError("too many ids");
  if (!ids.every((i) => Number.isSafeInteger(i) && i > 0)) throw new RangeError("bad id");
  const u = new URL(`${INAT_API}/taxa/${ids.join(",")}`);
  u.searchParams.set("per_page", String(TAXA_MAX_IDS));
  u.searchParams.set("locale", "en");
  return u.toString();
}

// ---------- shapes ----------

const TaxonLite = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  rank: z.string(),
  preferred_common_name: z.string().nullish(),
  iconic_taxon_name: z.string().nullish(),
  ancestor_ids: z.array(z.number().int()).default([]),
});

const SpeciesCountsBody = z.object({
  total_results: z.number().int().min(0),
  results: z.array(z.object({ count: z.number().int().min(0), taxon: z.unknown() })),
});

export const SpeciesSchema = z.object({
  taxonId: z.number().int().positive(),
  name: z.string().max(200),
  commonName: z.string().max(200).nullable(),
  rank: z.string().max(40),
  iconic: z.string().max(40).nullable(),
  ancestorIds: z.array(z.number().int()).max(80),
  count: z.number().int().min(1),
});
export type Species = z.infer<typeof SpeciesSchema>;

export const SpeciesListSchema = z.object({
  /** Distinct research-grade species in the window (iNat total_results). */
  totalSpecies: z.number().int().min(0),
  /** Research-grade observations in the window (sum of counts; exact when totalSpecies <= 200). */
  totalObservations: z.number().int().min(0),
  species: z.array(SpeciesSchema),
});
export type SpeciesList = z.infer<typeof SpeciesListSchema>;

const clip = (s: string, n: number) => s.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, n);

export function parseSpeciesCounts(json: unknown): SpeciesList {
  const body = SpeciesCountsBody.parse(json);
  const species: Species[] = [];
  let totalObservations = 0;
  for (const r of body.results) {
    totalObservations += r.count;
    const t = TaxonLite.safeParse(r.taxon);
    if (!t.success || r.count < 1) continue;
    species.push({
      taxonId: t.data.id,
      name: clip(t.data.name, 200),
      commonName: t.data.preferred_common_name ? clip(t.data.preferred_common_name, 200) : null,
      rank: clip(t.data.rank, 40),
      iconic: t.data.iconic_taxon_name ? clip(t.data.iconic_taxon_name, 40) : null,
      ancestorIds: t.data.ancestor_ids.slice(0, 80),
      count: r.count,
    });
  }
  return { totalSpecies: body.total_results, totalObservations, species };
}

/** Wikipedia summaries come as HTML snippets. Plain text only, single spaces. */
export function stripHtml(s: string): string {
  return s
    .replace(/<\/?(b|i|em|strong|a|span|sup|sub|small|u)\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Longest sentence-aligned prefix of `s` up to `max` chars (whole text when shorter). */
export function sentencePrefix(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 80 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")).trim();
}

export const TAXON_SUMMARY_MAX = 600;

export const TaxonSummarySchema = z.object({
  id: z.number().int().positive(),
  /** Plain-text Wikipedia summary, sentence-cut to 600 chars; null when iNat has none. */
  summary: z.string().max(TAXON_SUMMARY_MAX).nullable(),
  ancestorIds: z.array(z.number().int()).max(80),
});
export type TaxonSummary = z.infer<typeof TaxonSummarySchema>;

const TaxaBody = z.object({
  results: z.array(
    z.object({
      id: z.number().int().positive(),
      wikipedia_summary: z.string().nullish(),
      ancestor_ids: z.array(z.number().int()).default([]),
    }),
  ),
});

export function parseTaxa(json: unknown): TaxonSummary[] {
  return TaxaBody.parse(json).results.map((t) => {
    const text = t.wikipedia_summary ? sentencePrefix(stripHtml(t.wikipedia_summary), TAXON_SUMMARY_MAX) : "";
    return { id: t.id, summary: text.length > 0 ? text : null, ancestorIds: t.ancestor_ids.slice(0, 80) };
  });
}

// ---------- the polite fetch ----------

type QueueHolder = { queue: ReturnType<typeof createSpacedQueue> };
const QUEUE_KEY = Symbol.for("grass-pass.inat-queue");
function processQueue(): QueueHolder["queue"] {
  const g = globalThis as unknown as Record<symbol, QueueHolder | undefined>;
  return (g[QUEUE_KEY] ??= { queue: createSpacedQueue(INAT_MIN_INTERVAL_MS) }).queue;
}

export type InatDeps = {
  store: Store;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  env?: Env;
  /** Called right before the first request is sent (charge budgets here). */
  onStart?: () => void;
  now?: () => number;
  queue?: { run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> };
};

export function inatDailyCap(env: Env = process.env): number {
  return intFromEnv(env.INAT_DAILY_CAP, INAT_DAILY_CAP_DEFAULT);
}

async function getJson(url: string, what: string, deps: InatDeps): Promise<unknown> {
  const now = deps.now ?? (() => Date.now());
  const wait = await breakerRetryAfter(deps.store, INAT_SOURCE, now());
  if (wait > 0) throw new SourceError(INAT_SOURCE, "not_called", { started: false, retryAfter: wait });

  const budget = await reserveQuota(deps.store, {
    name: "inat-calls",
    key: "server",
    perKey: Infinity,
    global: inatDailyCap(deps.env),
    period: { kind: "day" },
    now: now(),
  });
  if (!budget.ok) throw new SourceError(INAT_SOURCE, "not_called", { started: false, retryAfter: budget.retryAfter });
  const ticket = budget.ticket;

  const queue = deps.queue ?? processQueue();
  const queueSignal = deps.signal
    ? AbortSignal.any([deps.signal, AbortSignal.timeout(INAT_QUEUE_MAX_WAIT_MS)])
    : AbortSignal.timeout(INAT_QUEUE_MAX_WAIT_MS);
  let res;
  try {
    res = await queue.run(async () => {
      const slot = await takeSecondSlot(deps.store, { name: INAT_SOURCE, perSecond: 1, maxWaitMs: 3_000, now });
      if (!slot) throw new SourceError(INAT_SOURCE, "not_called", { started: false, retryAfter: 5 });
      ticket.commit();
      deps.onStart?.();
      return fetchText(
        INAT_SOURCE,
        url,
        { method: "GET", headers: { "User-Agent": userAgent(deps.env), Accept: "application/json" } },
        { timeoutMs: INAT_TIMEOUT_MS, fetchImpl: deps.fetchImpl, signal: deps.signal },
      );
    }, queueSignal);
  } catch (err) {
    await ticket.release();
    if (err instanceof QueueAbortedError) throw new SourceError(INAT_SOURCE, "not_called", { started: false, retryAfter: 5, cause: err });
    if (err instanceof SourceError) {
      if (err.started) {
        await tripBreaker(deps.store, INAT_SOURCE, now(), INAT_ERROR_OPEN_SEC);
        log("upstream_call", { source: INAT_SOURCE, what, outcome: err.code }, "warn");
      }
      throw err;
    }
    throw err;
  }

  const base = { source: INAT_SOURCE, what, status: res.status, latencyMs: res.latencyMs };
  if (res.status === 429 || res.status === 403) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now()) ?? 300;
    await tripBreaker(deps.store, INAT_SOURCE, now(), retryAfter);
    log("upstream_call", { ...base, outcome: "rate_limited", retryAfter }, "warn");
    throw new SourceError(INAT_SOURCE, "rate_limited", { status: res.status, retryAfter, started: true });
  }
  if (res.status >= 500) {
    await tripBreaker(deps.store, INAT_SOURCE, now(), INAT_ERROR_OPEN_SEC);
    log("upstream_call", { ...base, outcome: "busy" }, "warn");
    throw new SourceError(INAT_SOURCE, "busy", { status: res.status, started: true, retryAfter: INAT_ERROR_OPEN_SEC });
  }
  if (res.status !== 200) {
    log("upstream_call", { ...base, outcome: "bad_status" }, "error");
    throw new SourceError(INAT_SOURCE, "bad_output", { status: res.status, started: true });
  }
  try {
    const json = JSON.parse(res.text) as unknown;
    log("upstream_call", { ...base, outcome: "ok" });
    return json;
  } catch (err) {
    log("upstream_call", { ...base, outcome: "bad_output" }, "warn");
    throw new SourceError(INAT_SOURCE, "bad_output", { status: res.status, started: true, cause: err });
  }
}

/** Research-grade species within 1.5 km of `center` since `d1`. Throws SourceError. */
export async function speciesCounts(center: LatLng, d1: string, deps: InatDeps): Promise<SpeciesList> {
  const json = await getJson(speciesCountsUrl(center, d1), "species_counts", deps);
  try {
    return parseSpeciesCounts(json);
  } catch (err) {
    throw new SourceError(INAT_SOURCE, "bad_output", { started: true, cause: err });
  }
}

/**
 * Wikipedia summaries for up to 30 taxa in one call. An empty id list returns an empty list
 * WITHOUT calling iNat (see the guard note at the top of this file).
 */
export async function taxaSummaries(ids: number[], deps: InatDeps): Promise<TaxonSummary[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const json = await getJson(taxaUrl(unique.slice(0, TAXA_MAX_IDS)), "taxa", deps);
  try {
    const wanted = new Set(unique);
    return parseTaxa(json).filter((t) => wanted.has(t.id));
  } catch (err) {
    throw new SourceError(INAT_SOURCE, "bad_output", { started: true, cause: err });
  }
}
