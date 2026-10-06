/**
 * Eval fixtures (SPEC 6.4): one file per park under tests/fixtures/evals/<slug>.json holding the
 * REAL upstream answers (Overpass park features, iNaturalist species_counts and taxa) recorded live
 * by `pnpm eval:record`, with when and where each was fetched.
 *
 * - `recordingFetch` wraps the real fetch while the app's own source code runs (pattern
 *   record-real-api-fixtures-via-scratch-vitest), so the stored requests are exactly what the app sends.
 * - `createReplayFetch` answers those same requests from the file. A request that was not recorded
 *   is NOT invented: it fails like a network error and is listed in `misses`.
 * - `loadCaseData` rebuilds the park pool, wild pool and mix from a fixture with the app's code.
 */
import "@/lib/zod-config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MemoryStore } from "@/lib/cache/store";
import { computeMix, type Mix } from "@/lib/ai/prompt";
import { AGE_BAND_INFO, AgeBandSchema, type AgeBand } from "@/lib/pass/schema";
import { parkPool } from "@/lib/pool/park";
import type { PoolItem, SectionState } from "@/lib/pool/types";
import { wildCandidates, wildPool } from "@/lib/pool/wild";
import type { FetchLike } from "@/lib/sources/common";
import { speciesCounts, taxaSummaries, windowStart, type SpeciesList, type TaxonSummary } from "@/lib/sources/inat";
import { parkFeatures, parseParkId, type ParkFeatures } from "@/lib/sources/overpass-features";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR = path.join(APP_ROOT, "tests", "fixtures", "evals");
export const CASES_FILE = path.join(APP_ROOT, "evals", "cases.json");

// ---------- cases ----------

export const EvalCaseSchema = z.object({
  n: z.number().int().min(1).max(99),
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
  name: z.string().min(1),
  city: z.string().min(1),
  parkId: z.string().regex(/^(node|way|relation)\/\d{1,15}$/),
  profile: z.string(),
  note: z.string(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const CasesFileSchema = z.object({
  _about: z.string(),
  ageBand: AgeBandSchema,
  cases: z.array(EvalCaseSchema).min(1),
});
export type CasesFile = z.infer<typeof CasesFileSchema>;

export function loadCases(file = CASES_FILE): CasesFile {
  return CasesFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

// ---------- fixture file ----------

export const AttemptSchema = z.object({
  url: z.string(),
  status: z.number().int().nullable(),
  error: z.string().nullable(),
  latencyMs: z.number().min(0),
  at: z.string(),
});

export const ExchangeSchema = z.object({
  source: z.enum(["overpass", "inaturalist"]),
  what: z.enum(["features", "species_counts", "taxa"]),
  method: z.enum(["GET", "POST"]),
  url: z.string().url(),
  /** Overpass QL (the POST `data` field). */
  query: z.string().optional(),
  status: z.number().int(),
  contentType: z.string().nullable(),
  fetchedAt: z.string(),
  latencyMs: z.number().min(0),
  /** Failed tries before this answer (504s, 429s, timeouts on other Overpass mirrors). */
  failedAttempts: z.array(AttemptSchema),
  body: z.unknown(),
});
export type Exchange = z.infer<typeof ExchangeSchema>;

export const FixtureSummarySchema = z.object({
  parkName: z.string().nullable(),
  featureKinds: z.number().int().min(0),
  trees: z.number().int().min(0),
  totalSpecies: z.number().int().min(0),
  totalObservations: z.number().int().min(0),
  taxaRequested: z.number().int().min(0),
});
export type FixtureSummary = z.infer<typeof FixtureSummarySchema>;

export const EvalFixtureSchema = z.object({
  _recording: z.object({
    what: z.string(),
    live: z.literal(true),
    case: z.number().int(),
    parkId: z.string(),
    recordedBy: z.string(),
    userAgent: z.string(),
    /** First request of this park (ISO) and the same in ms: replays run their clock from here. */
    fetchedAt: z.string(),
    fetchedAtMs: z.number().int(),
    trimmed: z.string(),
    summary: FixtureSummarySchema,
  }),
  exchanges: z.array(ExchangeSchema).min(1),
});
export type EvalFixture = z.infer<typeof EvalFixtureSchema>;

export const fixturePath = (slug: string) => path.join(FIXTURE_DIR, `${slug}.json`);

export function loadFixture(slug: string): EvalFixture {
  return EvalFixtureSchema.parse(JSON.parse(readFileSync(fixturePath(slug), "utf8")));
}

// ---------- trimming (keep only what the app reads; every kept value exactly as received) ----------

/** Tags `classify()` / `parseFeatures()` read. */
export const OSM_TAGS_READ = [
  "name",
  "leisure",
  "sport",
  "playground",
  "amenity",
  "tourism",
  "information",
  "natural",
  "waterway",
  "man_made",
  "bridge",
  "highway",
  "historic",
] as const;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(o: Json, keys: readonly string[]): Json {
  const out: Json = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
}

/** Overpass: elements keep type, id, the park's position, and only the tags the app reads. */
export function trimOverpass(json: unknown, parkId: string): Json {
  if (!isObj(json) || !Array.isArray(json.elements)) throw new Error("not an Overpass answer");
  const elements = json.elements.map((raw) => {
    if (!isObj(raw)) return raw;
    const isPark = `${String(raw.type)}/${String(raw.id)}` === parkId;
    const e: Json = pick(raw, isPark ? ["type", "id", "lat", "lon", "center"] : ["type", "id"]);
    if (isObj(raw.tags)) e.tags = pick(raw.tags, OSM_TAGS_READ);
    return e;
  });
  return { ...pick(json, ["version", "generator", "osm3s", "remark"]), elements };
}

const TAXON_KEYS = ["id", "name", "rank", "preferred_common_name", "iconic_taxon_name", "ancestor_ids"] as const;

export function trimSpecies(json: unknown): Json {
  if (!isObj(json) || !Array.isArray(json.results)) throw new Error("not a species_counts answer");
  return {
    ...pick(json, ["total_results", "page", "per_page"]),
    results: json.results.map((r) => (isObj(r) ? { count: r.count, taxon: isObj(r.taxon) ? pick(r.taxon, TAXON_KEYS) : r.taxon } : r)),
  };
}

export function trimTaxa(json: unknown): Json {
  if (!isObj(json) || !Array.isArray(json.results)) throw new Error("not a taxa answer");
  return {
    ...pick(json, ["total_results", "page", "per_page"]),
    results: json.results.map((r) =>
      isObj(r) ? pick(r, ["id", "name", "preferred_common_name", "wikipedia_summary", "ancestor_ids"]) : r,
    ),
  };
}

export const TRIM_NOTE =
  "Real answers. Fields the app never reads were removed to keep the repo small: Overpass elements keep type, id, the park's own position and only the tags in OSM_TAGS_READ (evals/fixture.ts); iNaturalist keeps total_results/page/per_page, each count and the taxon fields the app reads (id, name, rank, preferred_common_name, iconic_taxon_name, ancestor_ids, wikipedia_summary). Every kept value is exactly as received. The recorder checked that the app parses the trimmed and the full answer to the same result.";

// ---------- recording ----------

export type RecordedCall = {
  url: string;
  method: string;
  body: string | null;
  status: number | null;
  contentType: string | null;
  error: string | null;
  latencyMs: number;
  at: string;
  text: string | null;
};

/** Wrap the real fetch: every request the app code makes is kept (status, body text, timing). */
export function recordingFetch(base: FetchLike = (u, i) => fetch(u, i)): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const f: FetchLike = async (input, init) => {
    const t0 = Date.now();
    const at = new Date(t0).toISOString();
    const body = typeof init?.body === "string" ? init.body : null;
    const method = (init?.method ?? "GET").toUpperCase();
    try {
      const res = await base(input, init);
      const text = await res.text();
      calls.push({ url: input, method, body, status: res.status, contentType: res.headers.get("content-type"), error: null, latencyMs: Date.now() - t0, at, text });
      return new Response(text, { status: res.status, headers: res.headers });
    } catch (err) {
      calls.push({ url: input, method, body, status: null, contentType: null, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), latencyMs: Date.now() - t0, at, text: null });
      throw err;
    }
  };
  return { fetch: f, calls };
}

/** The Overpass QL inside a recorded POST body (`data=...`). */
export function overpassQueryOf(body: string | null | undefined): string | null {
  if (!body) return null;
  return new URLSearchParams(body).get("data");
}

// ---------- replay ----------

export type Replay = { fetch: FetchLike; misses: string[]; served: number };

const TAXA_PATH_RE = /^https:\/\/api\.inaturalist\.org\/v1\/taxa\/([\d,]+)\?/;

/** Ids in a `taxa/<ids>` URL, or null for any other URL. */
export function taxaIdsOf(url: string): number[] | null {
  const m = TAXA_PATH_RE.exec(url);
  return m ? m[1].split(",").map(Number) : null;
}

/**
 * A `taxa/<ids>` request for a SUBSET of the recorded ids (the app's taxon cache, shared across
 * parks, already had the others): answered with the recorded results for exactly those ids, values
 * unchanged. iNaturalist answers each taxon independently, so this is the same data it would send.
 * Null when any id was not recorded.
 */
export function taxaSubsetBody(fx: EvalFixture, url: string): Record<string, unknown> | null {
  const ids = taxaIdsOf(url);
  if (!ids) return null;
  const recorded = new Map<number, unknown>();
  for (const e of fx.exchanges) {
    if (e.what !== "taxa" || !isObj(e.body) || !Array.isArray(e.body.results)) continue;
    for (const r of e.body.results) if (isObj(r) && typeof r.id === "number") recorded.set(r.id, r);
  }
  if (!ids.every((id) => recorded.has(id))) return null;
  const results = ids.map((id) => recorded.get(id));
  return { total_results: results.length, page: 1, per_page: 30, results };
}

/**
 * Answer the app's requests from a fixture: Overpass POSTs by their exact query (any mirror),
 * iNaturalist GETs by exact URL, and taxa requests for a subset of the recorded ids (see
 * taxaSubsetBody). Anything else throws like a network error and is listed in `misses`.
 */
export function createReplayFetch(fx: EvalFixture): Replay {
  const misses: string[] = [];
  const state = { served: 0 };
  const f: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    let status = 200;
    let contentType: string | null = "application/json";
    let hit: Exchange | undefined;
    if (method === "POST") {
      const q = overpassQueryOf(typeof init?.body === "string" ? init.body : null);
      hit = fx.exchanges.find((e) => e.method === "POST" && e.query === q);
    } else {
      hit = fx.exchanges.find((e) => e.method === "GET" && e.url === input);
    }
    if (hit) {
      body = hit.body;
      status = hit.status;
      contentType = hit.contentType;
    } else if (method === "GET") {
      body = taxaSubsetBody(fx, input) ?? undefined;
    }
    if (body === undefined) {
      misses.push(`${method} ${input}`);
      throw new TypeError(`not in the recorded fixture: ${method} ${input}`);
    }
    state.served++;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": contentType ?? "application/json" },
    });
  };
  return {
    fetch: f,
    misses,
    get served() {
      return state.served;
    },
  };
}

/** A clock that starts at the recording time and moves with real time (keeps the iNat window the same). */
export function replayClock(fx: EvalFixture, realNow: () => number = () => Date.now()): () => number {
  const t0 = realNow();
  return () => fx._recording.fetchedAtMs + (realNow() - t0);
}

/** Runs each queued job at once (replays never reach iNaturalist, so no politeness spacing is needed). */
const immediateQueue = { run: <T>(fn: () => Promise<T>) => fn() };

export type CaseData = {
  parkName: string | null;
  features: ParkFeatures | null;
  species: SpeciesList | null;
  summaries: TaxonSummary[];
  since: string;
  park: { items: PoolItem[]; state: SectionState } | null;
  wild: { items: PoolItem[]; state: SectionState; blocked: number } | null;
  pool: PoolItem[];
  mix: Mix | null;
  band: AgeBand;
  /** The pool can fill a whole pass for this age band (M3 counts these cases). */
  dataRich: boolean;
  misses: string[];
};

/** Rebuild the pools and mix for one fixture with the app's own source + pool code (no network). */
export async function loadCaseData(fx: EvalFixture, band: AgeBand): Promise<CaseData> {
  const replay = createReplayFetch(fx);
  const now = replayClock(fx);
  const since = windowStart(now());
  const ref = parseParkId(fx._recording.parkId);
  if (!ref) throw new Error(`bad park id in fixture: ${fx._recording.parkId}`);
  const base = { fetchImpl: replay.fetch, env: {}, now };
  const features = await parkFeatures(ref, { ...base, store: new MemoryStore() });
  const empty: CaseData = {
    parkName: null,
    features: null,
    species: null,
    summaries: [],
    since,
    park: null,
    wild: null,
    pool: [],
    mix: null,
    band,
    dataRich: false,
    misses: replay.misses,
  };
  if (!features) return empty;
  // A fresh store per call so the per-second iNat slot never waits in a replay.
  const species = await speciesCounts({ lat: features.park.lat, lng: features.park.lng }, since, {
    ...base,
    store: new MemoryStore(),
    queue: immediateQueue,
  });
  const ids = wildCandidates(species).candidates.map((c) => c.taxonId);
  const summaries = ids.length > 0 ? await taxaSummaries(ids, { ...base, store: new MemoryStore(), queue: immediateQueue }) : [];
  const park = parkPool(features);
  const wild = wildPool(species, summaries, since);
  const pool = [...park.items, ...wild.items];
  const mix = computeMix({ park: park.items.length, wild: wild.items.length, lucky: 0 }, band);
  return {
    parkName: features.park.name,
    features,
    species,
    summaries,
    since,
    park,
    wild,
    pool,
    mix,
    band,
    dataRich: mix !== null && mix.n === AGE_BAND_INFO[band].items,
    misses: replay.misses,
  };
}

/** loadCaseData, but a fixture that does not replay cleanly is reported, never patched. */
export async function caseDataOrNull(fx: EvalFixture, band: AgeBand): Promise<{ data: CaseData | null; problem: string | null }> {
  try {
    const d = await loadCaseData(fx, band);
    if (d.misses.length > 0) return { data: null, problem: `No data available: the fixture has no recording for ${d.misses.join("; ")}.` };
    if (!d.parkName) return { data: null, problem: "No data available: the recorded Overpass answer is not a named park." };
    return { data: d, problem: null };
  } catch (err) {
    return { data: null, problem: `No data available: the recorded fixture could not be replayed (${err instanceof Error ? err.message : String(err)}).` };
  }
}

/** Numbers a reviewer can check against the fixture without running anything. */
export function summarize(features: ParkFeatures | null, species: SpeciesList | null, taxaRequested: number): FixtureSummary {
  return {
    parkName: features?.park.name ?? null,
    featureKinds: features ? Object.keys(features.features).length : 0,
    trees: features?.trees ?? 0,
    totalSpecies: species?.totalSpecies ?? 0,
    totalObservations: species?.totalObservations ?? 0,
    taxaRequested,
  };
}

