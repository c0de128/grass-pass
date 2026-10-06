/**
 * R2-M3: `pnpm osm:snapshot` with OSM_SNAPSHOT_ONLY=dfw-features,dfw-geometry records park features and
 * Find This Spot geometry for EVERY park in src/data/osm/dfw-parks.json, LIVE, with the app's own
 * per-park statements and parsers, so a pass for any Dallas-area park still works when public Overpass
 * is down (src/lib/pass/park-data.ts and src/lib/spot/load.ts read the files through
 * src/lib/sources/osm-snapshot.ts).
 *
 * - Batched: one query runs the app's exact per-park statements once per park inside `foreach->.p`;
 *   a `gp_end` marker element (with the park id) closes each park's part of the answer, so every park
 *   is parsed from ITS elements by the app's own parser.
 * - Polite: one query at a time, PAUSE_MS between queries, the app's endpoint failover and breakers,
 *   a too-heavy batch is split in half, and the run stops after a few failed batches in a row.
 * - Resumable: each park is written as soon as its batch answers; a park that already has the part
 *   (or a note saying OSM has none) is skipped. OSM_SNAPSHOT_REFRESH=1 records everything again;
 *   OSM_SNAPSHOT_REVERSE=1 works from the other end (a second recorder on another mirror).
 * - Small: one brotli JSON file per park holding only the parsed form the app reads.
 * - Honest: nothing is invented. A park whose batch failed has no file part, and dfw-coverage.json
 *   counts what was recorded, when, and from which server.
 */
import "@/lib/zod-config";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import { MemoryStore } from "@/lib/cache/store";
import { SourceError, userAgent } from "@/lib/sources/common";
import { DfwParkFileSchema, dfwParkFileName, type DfwParkFile } from "@/lib/sources/osm-snapshot";
import { runOverpass } from "@/lib/sources/overpass";
import { featuresQuery, featuresStatements, PARK_FILTER, parseFeatures, parseParkId, type OsmType } from "@/lib/sources/overpass-features";
import { geometryQuery, geometryStatements, parseGeometry } from "@/lib/spot/geometry";
import { DFW_FILE, LICENCE, OSM_DATA_DIR } from "./osm-snapshot";

export const DFW_PARKS_DIR_ABS = path.join(OSM_DATA_DIR, "parks");
export const COVERAGE_FILE = path.join(OSM_DATA_DIR, "dfw-coverage.json");
/** Parks per batched query. Geometry answers are much bigger than feature counts. */
export const FEATURE_BATCH = { way: 12, relation: 6, node: 11 } as const;
export const GEOMETRY_BATCH = { way: 4, relation: 2 } as const;
const BATCH_TIMEOUT_SEC = 180;
/** Overpass's own default memory cap; a batch that needs more is split in half. */
const BATCH_MAXSIZE = 512 * 1024 * 1024;
const MAX_FAILED_BATCHES_IN_A_ROW = 4;
const PAUSE_MS = 5_000;
const BUSY_RETRY_WAIT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => process.stdout.write(`${s}\n`);

type IndexFile = { _recording: { fetchedAt: string | null }; parks: [string, string, string, number, number][] };

/** One query for many parks of one OSM type (the app's per-park statements inside `foreach->.p`). */
export function batchQuery(kind: "features" | "geometry", type: OsmType, ids: number[]): string {
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new RangeError("bad ids");
  if (kind === "geometry" && type === "node") throw new RangeError("a park mapped as a point has no outline");
  const sel = type === "node" ? "node" : type === "way" ? "way" : "rel";
  const statements = kind === "features" ? featuresStatements(type) : geometryStatements();
  return `[out:json][timeout:${BATCH_TIMEOUT_SEC}][maxsize:${BATCH_MAXSIZE}];${sel}(id:${ids.join(",")})${PARK_FILTER};foreach->.p(${statements}make gp_end pid=p.u(id());out;);`;
}

/** Split a batched answer into one `{ elements }` answer per park id (by the gp_end markers). */
export function splitBatch(json: unknown): Map<number, { elements: unknown[] }> {
  const els = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(els)) throw new Error("the answer has no elements");
  const out = new Map<number, { elements: unknown[] }>();
  let part: unknown[] = [];
  for (const raw of els) {
    const e = raw as { type?: string; tags?: { pid?: string } };
    if (e.type === "gp_end") {
      const pid = Number(e.tags?.pid);
      if (Number.isSafeInteger(pid) && pid > 0) out.set(pid, { elements: part });
      part = [];
      continue;
    }
    part.push(raw);
  }
  return out;
}

export type Coverage = {
  _recording: { what: string; recordedBy: string; licence: string; userAgent: string; storage: string };
  index: { fetchedAt: string | null; parks: number };
  updatedAt: string;
  features: { ok: number; notAPark: number; notRecorded: number };
  geometry: { ok: number; noOutline: number; pointPark: number; notRecorded: number };
  firstFetchedAt: string | null;
  lastFetchedAt: string | null;
  bytesOnDisk: number;
  endpoints: Record<string, number>;
  log: string[];
};

function parkFilePath(parkId: string, dir: string): string {
  const name = dfwParkFileName(parkId);
  if (!name) throw new RangeError(`bad park id ${parkId}`);
  return path.join(dir, name);
}

export function readParkRec(parkId: string, dir: string = DFW_PARKS_DIR_ABS): DfwParkFile | null {
  const f = parkFilePath(parkId, dir);
  if (!existsSync(f)) return null;
  return DfwParkFileSchema.parse(JSON.parse(brotliDecompressSync(readFileSync(f)).toString("utf8")));
}

/** Checked against the app's own schema before it is written: the app must be able to read it. */
export function writeParkRec(rec: DfwParkFile, dir: string = DFW_PARKS_DIR_ABS): void {
  mkdirSync(dir, { recursive: true });
  const ok = DfwParkFileSchema.parse(rec);
  const buf = brotliCompressSync(Buffer.from(JSON.stringify(ok)), { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } });
  writeFileSync(parkFilePath(rec.parkId, dir), buf);
}

/** Count what is on disk now (the honest coverage numbers). */
export function coverageNow(index: IndexFile, log: string[], endpoints: Record<string, number>, dir: string = DFW_PARKS_DIR_ABS): Coverage {
  const c: Coverage = {
    _recording: {
      what: "Coverage of the saved per-park OpenStreetMap answers (park features + Find This Spot geometry) for every park in dfw-parks.json. A park part that is not recorded has no saved answer; the app then says so.",
      recordedBy: "pnpm osm:snapshot with OSM_SNAPSHOT_ONLY=dfw-features,dfw-geometry (evals/osm-dfw-parks.ts)",
      licence: LICENCE,
      userAgent: userAgent({}),
      storage: "src/data/osm/parks/<type>-<id>.json.br: brotli JSON, only the parsed form the app reads, checked against DfwParkFileSchema",
    },
    index: { fetchedAt: index._recording.fetchedAt, parks: index.parks.length },
    updatedAt: new Date().toISOString(),
    features: { ok: 0, notAPark: 0, notRecorded: 0 },
    geometry: { ok: 0, noOutline: 0, pointPark: 0, notRecorded: 0 },
    firstFetchedAt: null,
    lastFetchedAt: null,
    bytesOnDisk: 0,
    endpoints,
    log: log.slice(-200),
  };
  const seen = (at: string) => {
    if (!c.firstFetchedAt || at < c.firstFetchedAt) c.firstFetchedAt = at;
    if (!c.lastFetchedAt || at > c.lastFetchedAt) c.lastFetchedAt = at;
  };
  for (const [id] of index.parks) {
    const f = parkFilePath(id, dir);
    const rec = existsSync(f) ? readParkRec(id, dir) : null;
    if (rec) c.bytesOnDisk += statSync(f).size;
    if (rec?.features) {
      c.features.ok++;
      seen(rec.features.fetchedAt);
    } else if (rec?.notes.some((n) => n.startsWith("features:"))) c.features.notAPark++;
    else c.features.notRecorded++;
    if (id.startsWith("node/")) c.geometry.pointPark++;
    else if (rec?.geometry) {
      c.geometry.ok++;
      seen(rec.geometry.fetchedAt);
    } else if (rec?.notes.some((n) => n.startsWith("geometry:"))) c.geometry.noOutline++;
    else c.geometry.notRecorded++;
  }
  return c;
}

function describe(err: unknown): string {
  if (err instanceof SourceError) return `${err.source} ${err.code}${err.status ? ` (HTTP ${err.status})` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

async function liveBatch(query: string, store: MemoryStore) {
  const env = { OVERPASS_URLS: process.env.OVERPASS_URLS };
  const r = await runOverpass(query, { store, env, timeoutMs: (BATCH_TIMEOUT_SEC + 20) * 1000, totalBudgetMs: 480_000, maxBytes: 80 * 1024 * 1024 });
  return { json: r.json, endpoint: new URL(r.endpoint).host, latencyMs: r.latencyMs, at: new Date().toISOString() };
}

const hasNote = (rec: DfwParkFile, kind: "features" | "geometry") => rec.notes.some((n) => n.startsWith(`${kind}:`));

/** Put one park's part of a batched answer into its record (parsed by the app's own parser). */
export function applyPart(
  rec: DfwParkFile,
  kind: "features" | "geometry",
  part: { elements: unknown[] } | undefined,
  meta: { at: string; endpoint: string; batchSize: number },
): boolean {
  const ref = parseParkId(rec.parkId);
  if (!ref) throw new RangeError(`bad park id ${rec.parkId}`);
  const from = `live-batch (${meta.batchSize} parks, foreach)`;
  rec.notes = rec.notes.filter((n) => !n.startsWith(`${kind}:`));
  if (kind === "features") {
    const value = part ? parseFeatures(part, ref) : null;
    rec.features = value ? { fetchedAt: meta.at, endpoint: meta.endpoint, query: featuresQuery(ref), from, value } : null;
    if (!value) rec.notes.push(`features: not a named park in the ${meta.at} answer`);
    return value !== null;
  }
  const value = part ? parseGeometry(part, ref) : null;
  rec.geometry = value ? { fetchedAt: meta.at, endpoint: meta.endpoint, query: geometryQuery(ref), from, value } : null;
  if (!value) rec.notes.push(`geometry: no outline in the ${meta.at} answer`);
  return value !== null;
}

/**
 * Record features and/or geometry for every DFW park that has none yet. Stops after
 * MAX_FAILED_BATCHES_IN_A_ROW failed batches (Overpass down) and says so; run it again to resume.
 */
export async function recordDfwParks(parts: Set<"features" | "geometry">, opts: { limit?: number } = {}): Promise<string[]> {
  const index = existsSync(DFW_FILE) ? (JSON.parse(readFileSync(DFW_FILE, "utf8")) as IndexFile) : null;
  if (!index || index.parks.length === 0) return ["DFW parks FAILED: no saved park index (record it first)"];
  const refresh = process.env.OSM_SNAPSHOT_REFRESH === "1";
  const store = new MemoryStore();
  const prev = existsSync(COVERAGE_FILE) ? (JSON.parse(readFileSync(COVERAGE_FILE, "utf8")) as Coverage) : null;
  const endpoints: Record<string, number> = { ...(prev?.endpoints ?? {}) };
  const log: string[] = [];
  const note = (line: string) => {
    log.push(line);
    say(line);
  };
  const saveCoverage = () => writeFileSync(COVERAGE_FILE, `${JSON.stringify(coverageNow(index, [...(prev?.log ?? []), ...log], endpoints), null, 1)}\n`);
  let failedInARow = 0;
  let queries = 0;

  for (const kind of ["features", "geometry"] as const) {
    if (!parts.has(kind)) continue;
    for (const type of ["way", "relation", "node"] as const) {
      if (kind === "geometry" && type === "node") continue;
      const todo = index.parks
        .map((r) => r[0])
        .filter((id) => id.startsWith(`${type}/`))
        .filter((id) => {
          const rec = refresh ? null : readParkRec(id);
          return !rec || (!rec[kind] && !hasNote(rec, kind));
        })
        .slice(0, opts.limit ?? Infinity);
      // Most useful first: OSM_SNAPSHOT_NEAR="lat,lng" records the nearest parks first (a partial run then
      // covers the busiest area); OSM_SNAPSHOT_SHARD="i/n" lets n recorders on different mirrors split it.
      const near = (process.env.OSM_SNAPSHOT_NEAR ?? "").split(",").map(Number);
      if (near.length === 2 && near.every(Number.isFinite)) {
        const at = new Map(index.parks.map((r) => [r[0], (r[3] - near[0]) ** 2 + ((r[4] - near[1]) * Math.cos((near[0] * Math.PI) / 180)) ** 2]));
        todo.sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
      }
      const shard = /^(\d+)\/(\d+)$/.exec(process.env.OSM_SNAPSHOT_SHARD ?? "");
      if (shard) {
        const [i, n] = [Number(shard[1]), Number(shard[2])];
        const mine = todo.filter((_, k) => k % n === i);
        todo.splice(0, todo.length, ...mine);
      }
      // A second recorder (another mirror first) can work from the other end: OSM_SNAPSHOT_REVERSE=1.
      if (process.env.OSM_SNAPSHOT_REVERSE === "1") todo.reverse();
      note(`${new Date().toISOString()} ${kind} ${type}: ${todo.length} parks to record`);
      const size = kind === "features" ? FEATURE_BATCH[type] : GEOMETRY_BATCH[type as "way" | "relation"];
      const queue: string[][] = [];
      for (let i = 0; i < todo.length; i += size) queue.push(todo.slice(i, i + size));
      while (queue.length > 0) {
        const batch = queue.shift()!;
        const q = batchQuery(kind, type, batch.map((id) => Number(id.split("/")[1])));
        if (queries++ > 0) await sleep(PAUSE_MS);
        try {
          const r = await liveBatch(q, store);
          endpoints[r.endpoint] = (endpoints[r.endpoint] ?? 0) + 1;
          const split = splitBatch(r.json);
          let ok = 0;
          for (const id of batch) {
            const rec: DfwParkFile = readParkRec(id) ?? { parkId: id, features: null, geometry: null, notes: [] };
            if (applyPart(rec, kind, split.get(Number(id.split("/")[1])), { at: r.at, endpoint: r.endpoint, batchSize: batch.length })) ok++;
            writeParkRec(rec);
          }
          failedInARow = 0;
          note(`${r.at} ${kind} ${type} x${batch.length} ok via ${r.endpoint} in ${r.latencyMs} ms (${ok} with data)`);
        } catch (err) {
          // Too heavy, or too slow for a busy server: ask for half as many parks at a time.
          const splittable = err instanceof SourceError && (err.code === "too_heavy" || (err.code === "timeout" && batch.length > 3));
          if (splittable && batch.length > 1) {
            const half = Math.ceil(batch.length / 2);
            queue.unshift(batch.slice(0, half), batch.slice(half));
            note(`${new Date().toISOString()} ${kind} ${type} x${batch.length} ${err.code}; split in two`);
            continue;
          }
          failedInARow++;
          note(`${new Date().toISOString()} ${kind} ${type} x${batch.length} FAILED (${describe(err)}): ${batch.join(" ")}`);
          if (err instanceof SourceError && err.code === "bad_output" && err.status === 400) {
            saveCoverage();
            throw err; // our query is wrong: stop at once
          }
          if (failedInARow >= MAX_FAILED_BATCHES_IN_A_ROW) {
            note(`${new Date().toISOString()} stopping: ${failedInARow} failed batches in a row (Overpass busy). Run again to resume.`);
            saveCoverage();
            return log;
          }
          await sleep(BUSY_RETRY_WAIT_MS);
        }
        saveCoverage();
      }
    }
  }
  saveCoverage();
  return log;
}
