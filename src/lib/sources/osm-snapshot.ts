/**
 * Saved OpenStreetMap answers (R1-B1): real Overpass answers recorded by `pnpm osm:snapshot`
 * (evals/osm-snapshot.ts runs the app's own query + parse code against live Overpass), each with the
 * time it was fetched. Two files in src/data/osm/:
 *   - examples.json: park features + Find This Spot geometry for the 4 example parks, so the
 *     examples never need live Overpass to render;
 *   - dfw-parks.json: every named park / nature reserve in one box around Allen, Plano, McKinney,
 *     Frisco, Richardson and Dallas, so park search near Dallas still answers when Overpass is down.
 * Nothing here is invented: an entry that was never recorded is missing, and callers then say
 * "No data available". Every answer carries its real `fetchedAt`, shown as "map data checked <date>".
 * The live caches (7-30 days in the shared store) are tried first and refreshed in the background;
 * this file is the floor under them.
 */
import "server-only";
import "@/lib/zod-config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import examplesJson from "@/data/osm/examples.json";
import dfwJson from "@/data/osm/dfw-parks.json";
import { distanceM, isValidLatLng, type LatLng } from "@/lib/geo";
import { MAX_PARKS, PARK_RADIUS_M, type Park } from "@/lib/parks/schema";
import { ParkGeometrySchema, type ParkGeometry } from "@/lib/spot/geometry";
import { ParkFeaturesSchema, type ParkFeatures } from "./overpass-features";
import { parseParks } from "./overpass-parks";

const Recorded = <T extends z.ZodType>(value: T) =>
  z.object({
    fetchedAt: z.iso.datetime(),
    endpoint: z.string().min(1),
    /** The exact query that was sent (or the recording it came from, see `from`). */
    query: z.string().min(1),
    /** Where it came from: "live" (recorded by pnpm osm:snapshot) or the earlier live recording file it was taken from. */
    from: z.string().min(1),
    value,
  });

const ExamplesFileSchema = z.object({
  _recording: z.looseObject({ what: z.string(), recordedBy: z.string(), licence: z.string() }),
  parks: z.record(
    z.string().regex(/^(node|way|relation)\/\d{1,15}$/),
    z.object({ features: Recorded(ParkFeaturesSchema).nullable(), geometry: Recorded(ParkGeometrySchema).nullable() }),
  ),
});

/** [osm id, name, kind, lat, lng] */
const IndexRow = z.tuple([
  z.string().regex(/^(node|way|relation)\/\d{1,15}$/),
  z.string().min(1).max(120),
  z.enum(["park", "nature_reserve"]),
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
]);
const DfwFileSchema = z.object({
  _recording: z.looseObject({
    what: z.string(),
    fetchedAt: z.iso.datetime().nullable(),
    endpoint: z.string().nullable(),
    query: z.string(),
    /** south, west, north, east */
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    cities: z.array(z.string()),
  }),
  parks: z.array(IndexRow),
});

export type SavedAnswer<V> = { value: V; fetchedAt: number; endpoint: string; from: string };

type Loaded = { examples: z.infer<typeof ExamplesFileSchema> | null; dfw: z.infer<typeof DfwFileSchema> | null };
let loaded: Loaded | null = null;

/** Tests of the LIVE path switch the saved answers off (resetSavedOsm switches them back on). */
let enabled = true;

/** Parse both files once. A file that fails validation counts as missing (logged by the caller's "no data" path). */
function data(): Loaded {
  if (!enabled) return { examples: null, dfw: null };
  if (loaded) return loaded;
  const ex = ExamplesFileSchema.safeParse(examplesJson);
  const dfw = DfwFileSchema.safeParse(dfwJson);
  loaded = { examples: ex.success ? ex.data : null, dfw: dfw.success ? dfw.data : null };
  return loaded;
}

function answer<V>(r: { value: V; fetchedAt: string; endpoint: string; from: string } | null | undefined): SavedAnswer<V> | null {
  if (!r) return null;
  return { value: r.value, fetchedAt: Date.parse(r.fetchedAt), endpoint: r.endpoint, from: r.from };
}

/** The saved park-features answer for this park id, or null when none was recorded. */
export function savedFeatures(parkId: string): SavedAnswer<ParkFeatures> | null {
  return answer(data().examples?.parks[parkId]?.features);
}

/** The saved geometry answer for this park id, or null when none was recorded. */
export function savedGeometry(parkId: string): SavedAnswer<ParkGeometry> | null {
  return answer(data().examples?.parks[parkId]?.geometry);
}

/** Park ids with any saved answer (the examples). */
export function savedParkIds(): string[] {
  return Object.keys(data().examples?.parks ?? {});
}

export type SavedIndexInfo = { fetchedAt: number; cities: string[]; bbox: [number, number, number, number]; count: number };

/** About the saved DFW park index (null when it was never recorded). */
export function savedIndexInfo(): SavedIndexInfo | null {
  const d = data().dfw;
  if (!d || !d._recording.fetchedAt || d.parks.length === 0) return null;
  return { fetchedAt: Date.parse(d._recording.fetchedAt), cities: d._recording.cities, bbox: d._recording.bbox, count: d.parks.length };
}

/** True when the whole 5 km circle around `p` lies inside the saved index box. */
export function indexCovers(p: LatLng, radiusM: number = PARK_RADIUS_M): boolean {
  const info = savedIndexInfo();
  if (!info || !isValidLatLng(p)) return false;
  const [s, w, n, e] = info.bbox;
  const dLat = radiusM / 110_574;
  const dLng = radiusM / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return p.lat - dLat >= s && p.lat + dLat <= n && p.lng - dLng >= w && p.lng + dLng <= e;
}

/**
 * The nearest named parks within 5 km from the saved index (same parsing, merging and order as a
 * live search), or null when the index doesn't cover the whole circle around this point.
 */
export function savedParksNear(center: LatLng): { parks: Park[]; totalFound: number; fetchedAt: number } | null {
  const d = data().dfw;
  const info = savedIndexInfo();
  if (!d || !info || !indexCovers(center)) return null;
  // Same circle as the live `around:5000` query, then the live parser does the merging and sorting.
  const elements = d.parks
    .filter(([, , , lat, lng]) => distanceM(center, { lat, lng }) <= PARK_RADIUS_M)
    .map(([id, name, kind, lat, lng]) => {
      const [type, num] = id.split("/");
      return { type, id: Number(num), center: { lat, lon: lng }, tags: { name, leisure: kind } };
    });
  const near = parseParks({ elements }, center);
  return { parks: near.parks.slice(0, MAX_PARKS), totalFound: near.totalFound, fetchedAt: info.fetchedAt };
}

// ---------- R2-M3: saved features + geometry for every park in the DFW index ----------

/**
 * One brotli-compressed JSON file per DFW park (src/data/osm/parks/way-38113837.json.br), written by
 * `pnpm osm:snapshot` (OSM_SNAPSHOT_ONLY=dfw-features,dfw-geometry). Read from disk only when a pass
 * for that park needs it (next.config.ts traces the folder into the /api/pass function), so the
 * 1,321 parks never sit in a JS bundle. `features`/`geometry` are null when that part was recorded
 * as missing (e.g. a park with no outline) or not recorded yet.
 */
export const DfwParkFileSchema = z.object({
  parkId: z.string().regex(/^(node|way|relation)\/\d{1,15}$/),
  features: Recorded(ParkFeaturesSchema).nullable(),
  geometry: Recorded(ParkGeometrySchema).nullable(),
  /** Why a part is missing ("no outline in the answer", "not a named park in the answer"). */
  notes: z.array(z.string().max(200)).max(10),
});
export type DfwParkFile = z.infer<typeof DfwParkFileSchema>;

/** The folder with the per-park files (relative to the app root, which is the server's cwd). */
export const DFW_PARKS_DIR = path.join("src", "data", "osm", "parks");
const PARK_ID_RE = /^(node|way|relation)\/(\d{1,15})$/;

/** "way/38113837" -> "way-38113837.json.br"; null for anything that isn't a park id (no path tricks). */
export function dfwParkFileName(parkId: string): string | null {
  const m = PARK_ID_RE.exec(parkId);
  return m ? `${m[1]}-${m[2]}.json.br` : null;
}

const DFW_MEMO_MAX = 64;
const dfwMemo = new Map<string, DfwParkFile | null>();
let dfwDir: string | null = null;

/** The saved file for one DFW park, or null (not recorded, unreadable or invalid: all count as missing). */
export function dfwParkFile(parkId: string): DfwParkFile | null {
  if (!enabled) return null;
  if (dfwMemo.has(parkId)) return dfwMemo.get(parkId) ?? null;
  const name = dfwParkFileName(parkId);
  let out: DfwParkFile | null = null;
  if (name) {
    // SEC-3-05: a computed path makes Turbopack trace the whole project into every server function. The
    // ignore comments stop that; next.config.ts `outputFileTracingIncludes` ships src/data/osm/parks/**.
    const file = path.join(/*turbopackIgnore: true*/ dfwDir ?? path.join(/*turbopackIgnore: true*/ process.cwd(), DFW_PARKS_DIR), name);
    try {
      if (existsSync(/*turbopackIgnore: true*/ file)) {
        const parsed = DfwParkFileSchema.safeParse(JSON.parse(brotliDecompressSync(readFileSync(/*turbopackIgnore: true*/ file)).toString("utf8")));
        if (parsed.success && parsed.data.parkId === parkId) out = parsed.data;
      }
    } catch {
      out = null;
    }
  }
  if (dfwMemo.size >= DFW_MEMO_MAX) dfwMemo.delete(dfwMemo.keys().next().value as string);
  dfwMemo.set(parkId, out);
  return out;
}

/** Saved features for a DFW park (the fallback when live Overpass fails), or null. */
export function savedDfwFeatures(parkId: string): SavedAnswer<ParkFeatures> | null {
  return answer(dfwParkFile(parkId)?.features);
}

/** Saved Find This Spot geometry for a DFW park, or null. */
export function savedDfwGeometry(parkId: string): SavedAnswer<ParkGeometry> | null {
  return answer(dfwParkFile(parkId)?.geometry);
}

/** Tests: read the per-park files from another folder (null = the app's own folder). */
export function setDfwParksDirForTests(dir: string | null): void {
  dfwDir = dir;
  dfwMemo.clear();
}

/** Tests: forget the parsed files and switch the saved answers back on. */
export function resetSavedOsm(): void {
  loaded = null;
  enabled = true;
  dfwMemo.clear();
  dfwDir = null;
}

/** Tests: act as if nothing was saved (to test the live Overpass path for the example parks). */
export function disableSavedOsmForTests(): void {
  enabled = false;
  dfwMemo.clear();
}
