/**
 * `pnpm osm:snapshot`: record the saved OpenStreetMap answers in src/data/osm/ (R1-B1) LIVE, with the
 * app's own query and parse code, so the 4 example parks and park search near Dallas keep working when
 * public Overpass is down. Read by src/lib/sources/osm-snapshot.ts.
 *
 *   examples.json  park features + Find This Spot geometry for each example park
 *   dfw-parks.json every named leisure=park|nature_reserve in one box around Allen, Plano, McKinney,
 *                  Frisco, Richardson and Dallas (plus a 5 km margin)
 *
 * Polite: one query at a time, a pause between queries, the app's 3-endpoint failover and breakers.
 * An answer that can't be fetched keeps the entry already in the file (with ITS fetch time), or stays
 * missing; nothing is ever invented. OSM_SNAPSHOT_IMPORT=1 instead fills MISSING entries from the
 * earlier live recordings in tests/fixtures (each entry then names the file it came from).
 * OSM_SNAPSHOT_ONLY=features,geometry,index limits what is recorded; OSM_SNAPSHOT_MISSING=1 skips
 * entries that already hold a live recording.
 */
import "@/lib/zod-config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { MemoryStore } from "@/lib/cache/store";
import { EXAMPLE_PARKS } from "@/lib/prewarm";
import { SourceError, userAgent } from "@/lib/sources/common";
import { runOverpass } from "@/lib/sources/overpass";
import { featuresQuery, parseFeatures, parseParkId, type ParkFeatures } from "@/lib/sources/overpass-features";
import { geometryQuery, parseGeometry, type ParkGeometry } from "@/lib/spot/geometry";
import { APP_ROOT } from "./fixture";

export const OSM_DATA_DIR = path.join(APP_ROOT, "src", "data", "osm");
export const EXAMPLES_FILE = path.join(OSM_DATA_DIR, "examples.json");
export const DFW_FILE = path.join(OSM_DATA_DIR, "dfw-parks.json");

/** south, west, north, east: the six cities plus about 5 km on every side (so a 5 km search near an edge is whole). */
export const DFW_BBOX: [number, number, number, number] = [32.57, -97.06, 33.32, -96.46];
export const DFW_CITIES = ["Allen", "Plano", "McKinney", "Frisco", "Richardson", "Dallas"];
export const LICENCE = "Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)";

const PAUSE_MS = 5_000;
const BUSY_RETRY_WAIT_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => process.stdout.write(`${s}\n`);

export function dfwIndexQuery(): string {
  const [s, w, n, e] = DFW_BBOX;
  return `[out:json][timeout:120];nwr["leisure"~"^(park|nature_reserve)$"]["name"](${s},${w},${n},${e});out tags center qt;`;
}

type Recorded<V> = { fetchedAt: string; endpoint: string; query: string; from: string; value: V };
type ExamplesFile = {
  _recording: { what: string; recordedBy: string; licence: string; userAgent: string; log: string[] };
  parks: Record<string, { features: Recorded<ParkFeatures> | null; geometry: Recorded<ParkGeometry> | null }>;
};
type IndexRow = [string, string, "park" | "nature_reserve", number, number];
type DfwFile = {
  _recording: { what: string; recordedBy: string; licence: string; userAgent: string; fetchedAt: string | null; endpoint: string | null; latencyMs: number | null; query: string; bbox: typeof DFW_BBOX; cities: string[] };
  parks: IndexRow[];
};

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

function emptyExamples(): ExamplesFile {
  return {
    _recording: {
      what: "Saved OpenStreetMap answers for the example parks: park features (featuresQuery) and Find This Spot geometry (geometryQuery), parsed by the app's own code. Shown with their real fetch time.",
      recordedBy: "pnpm osm:snapshot (evals/osm-snapshot.ts)",
      licence: LICENCE,
      userAgent: userAgent({}),
      log: [],
    },
    parks: {},
  };
}

/** Parse an index answer into compact rows (named park/nature_reserve with a usable point), sorted by id. */
export function indexRows(json: unknown): IndexRow[] {
  const els = (json as { elements?: unknown[] }).elements ?? [];
  const rows: IndexRow[] = [];
  for (const raw of els) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
    const name = e.tags?.name?.trim();
    const kind = e.tags?.leisure;
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!e.type || !e.id || !name || (kind !== "park" && kind !== "nature_reserve") || lat === undefined || lng === undefined) continue;
    rows.push([`${e.type}/${e.id}`, name.slice(0, 120), kind, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]);
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

function describe(err: unknown): string {
  if (err instanceof SourceError) return `${err.source} ${err.code}${err.status ? ` (HTTP ${err.status})` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

/** One live query with the app's runner; one slow retry when Overpass is busy. */
async function live(query: string, opts: { timeoutMs?: number; totalBudgetMs?: number; maxBytes?: number } = {}) {
  let last: unknown = null;
  for (let tries = 1; tries <= 2; tries++) {
    try {
      // A fresh store per try: the app's breakers must not stop the slow retry.
      const r = await runOverpass(query, { store: new MemoryStore(), env: {}, ...opts });
      return { json: r.json, endpoint: new URL(r.endpoint).host, latencyMs: r.latencyMs, at: new Date().toISOString() };
    } catch (err) {
      last = err;
      say(`  try ${tries} failed: ${describe(err)}`);
      if (tries < 2) await sleep(BUSY_RETRY_WAIT_MS);
    }
  }
  throw last;
}

export async function recordExamples(only: Set<string>): Promise<string[]> {
  mkdirSync(OSM_DATA_DIR, { recursive: true });
  const file = readJson<ExamplesFile>(EXAMPLES_FILE) ?? emptyExamples();
  const log: string[] = [];
  const missingOnly = process.env.OSM_SNAPSHOT_MISSING === "1";
  for (const ex of EXAMPLE_PARKS) {
    const ref = parseParkId(ex.parkId);
    if (!ref) throw new Error(`bad example id ${ex.parkId}`);
    const entry = (file.parks[ex.parkId] ??= { features: null, geometry: null });
    if (only.has("features") && !(missingOnly && entry.features?.from === "live")) {
      const q = featuresQuery(ref);
      say(`${ex.name}: features`);
      try {
        const r = await live(q);
        const value = parseFeatures(r.json, ref);
        if (!value) throw new Error("the answer has no named park for this id");
        entry.features = { fetchedAt: r.at, endpoint: r.endpoint, query: q, from: "live", value };
        log.push(`${r.at} ${ex.parkId} features ok via ${r.endpoint} in ${r.latencyMs} ms`);
      } catch (err) {
        log.push(`${new Date().toISOString()} ${ex.parkId} features FAILED (${describe(err)}); kept ${entry.features ? `the answer from ${entry.features.fetchedAt}` : "nothing"}`);
      }
      await sleep(PAUSE_MS);
    }
    if (only.has("geometry") && ref.type !== "node" && !(missingOnly && entry.geometry?.from === "live")) {
      const q = geometryQuery(ref);
      say(`${ex.name}: geometry`);
      try {
        const r = await live(q);
        const value = parseGeometry(r.json, ref);
        if (!value) throw new Error("the answer has no outline for this park");
        entry.geometry = { fetchedAt: r.at, endpoint: r.endpoint, query: q, from: "live", value };
        log.push(`${r.at} ${ex.parkId} geometry ok via ${r.endpoint} in ${r.latencyMs} ms`);
      } catch (err) {
        log.push(`${new Date().toISOString()} ${ex.parkId} geometry FAILED (${describe(err)}); kept ${entry.geometry ? `the answer from ${entry.geometry.fetchedAt}` : "nothing"}`);
      }
      await sleep(PAUSE_MS);
    }
  }
  file._recording.log = [...log, ...file._recording.log].slice(0, 60);
  writeFileSync(EXAMPLES_FILE, `${JSON.stringify(file)}\n`);
  return log;
}

export async function recordIndex(): Promise<string[]> {
  mkdirSync(OSM_DATA_DIR, { recursive: true });
  const q = dfwIndexQuery();
  say(`DFW park index`);
  try {
    const r = await live(q, { timeoutMs: 150_000, totalBudgetMs: 300_000, maxBytes: 40 * 1024 * 1024 });
    const parks = indexRows(r.json);
    if (parks.length < 100) throw new Error(`only ${parks.length} parks in the answer; refusing to save a partial index`);
    const out: DfwFile = {
      _recording: {
        what: `Every named leisure=park|nature_reserve in the box ${DFW_BBOX.join(",")} (S,W,N,E: ${DFW_CITIES.join(", ")} plus about 5 km), as [osm id, name, kind, lat, lng].`,
        recordedBy: "pnpm osm:snapshot (evals/osm-snapshot.ts)",
        licence: LICENCE,
        userAgent: userAgent({}),
        fetchedAt: r.at,
        endpoint: r.endpoint,
        latencyMs: r.latencyMs,
        query: q,
        bbox: DFW_BBOX,
        cities: DFW_CITIES,
      },
      parks,
    };
    writeFileSync(DFW_FILE, `${JSON.stringify(out)}\n`);
    return [`${r.at} DFW index ok via ${r.endpoint} in ${r.latencyMs} ms: ${parks.length} parks`];
  } catch (err) {
    return [`${new Date().toISOString()} DFW index FAILED (${describe(err)}); kept the file as it was`];
  }
}

/** Write an index file with no parks (fetchedAt null) when none exists, so the app builds and says "not recorded". */
export function ensureIndexFile(): void {
  if (existsSync(DFW_FILE)) return;
  mkdirSync(OSM_DATA_DIR, { recursive: true });
  const out: DfwFile = {
    _recording: {
      what: "Not recorded yet: run pnpm osm:snapshot. Until then the app has no saved park index and says so.",
      recordedBy: "pnpm osm:snapshot (evals/osm-snapshot.ts)",
      licence: LICENCE,
      userAgent: userAgent({}),
      fetchedAt: null,
      endpoint: null,
      latencyMs: null,
      query: dfwIndexQuery(),
      bbox: DFW_BBOX,
      cities: DFW_CITIES,
    },
    parks: [],
  };
  writeFileSync(DFW_FILE, `${JSON.stringify(out)}\n`);
}

// ---------- import from earlier live recordings (only for entries still missing) ----------

type FixtureRec = { _recording: { fetchedAt: string; url: string; overpassQuery?: string }; body: unknown };
type EvalFx = { exchanges: { source: string; what: string; url: string; query?: string; fetchedAt: string; body: unknown }[] };

export function importRecordings(): string[] {
  mkdirSync(OSM_DATA_DIR, { recursive: true });
  const file = readJson<ExamplesFile>(EXAMPLES_FILE) ?? emptyExamples();
  const log: string[] = [];
  const fx = (rel: string) => path.join(APP_ROOT, "tests", "fixtures", rel);
  for (const ex of EXAMPLE_PARKS) {
    const ref = parseParkId(ex.parkId);
    if (!ref) continue;
    const entry = (file.parks[ex.parkId] ??= { features: null, geometry: null });
    const evalFile = fx(`evals/${ex.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.json`);
    const evalFx = readJson<EvalFx>(evalFile);
    const ov = evalFx?.exchanges.find((e) => e.source === "overpass" && e.what === "features");
    if (!entry.features && ov) {
      const value = parseFeatures(ov.body, ref);
      if (value) {
        entry.features = { fetchedAt: ov.fetchedAt, endpoint: new URL(ov.url).host, query: ov.query ?? "", from: path.relative(APP_ROOT, evalFile).replace(/\\/g, "/"), value };
        log.push(`${ex.parkId} features imported from ${entry.features.from} (fetched ${ov.fetchedAt})`);
      }
    }
    const slug = ex.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const gFile = fx(`overpass-geometry-${slug}.json`);
    const g = readJson<FixtureRec>(gFile);
    if (!entry.geometry && g) {
      const value = parseGeometry(g.body, ref);
      if (value) {
        entry.geometry = { fetchedAt: g._recording.fetchedAt, endpoint: new URL(g._recording.url).host, query: g._recording.overpassQuery ?? "", from: path.relative(APP_ROOT, gFile).replace(/\\/g, "/"), value };
        log.push(`${ex.parkId} geometry imported from ${entry.geometry.from} (fetched ${g._recording.fetchedAt})`);
      }
    }
  }
  file._recording.log = [...log, ...file._recording.log].slice(0, 60);
  writeFileSync(EXAMPLES_FILE, `${JSON.stringify(file)}\n`);
  ensureIndexFile();
  return log;
}

/** Same features parse for two answers (used to check a re-recording against an earlier one). */
export const sameFeatures = (a: ParkFeatures | null, b: ParkFeatures | null) => isDeepStrictEqual(a, b);
