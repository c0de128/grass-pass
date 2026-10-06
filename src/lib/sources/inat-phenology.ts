/**
 * Plant phenology for the season check (audit R1-M4, src/lib/pool/season.ts): how many iNaturalist
 * observations of each candidate plant, within PHENOLOGY_RADIUS_KM of the park and in the current
 * calendar month (all years), carry the "Flowers and Fruits" annotation, and how many of those show
 * flowers or fruit/seeds.
 *
 * Why a month across all years and 50 km (not 1.5 km / 14 days like the pool): annotations are rare.
 * Live 2026-10-05 near Connemara, 1.5 km / 14 days had 4 annotated species in total, and Maximilian
 * sunflower (in full bloom) had none; the same month across all years within 50 km gave 26 flowering
 * records for the sunflower and 1 of 2 for the Callery pear (a spring bloomer).
 *
 * Three species_counts calls (all annotated, flowers, fruits) restricted to the candidate plant ids,
 * through the polite iNat client (`getJson`: daily budget, breaker, 1 req/s). Cached 7 days per park,
 * month and id set. Never throws: any failure returns null, and the season check then treats every
 * plant's flowers and fruit as unsupported (the safe side).
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createJsonCache } from "@/lib/cache";
import { log } from "@/lib/log";
import type { LatLng } from "@/lib/geo";
import { PHENOLOGY_FLOWERS, PHENOLOGY_FRUITS, PHENOLOGY_TERM_ID, type PhenologyCount } from "@/lib/pool/season";
import { SourceError } from "./common";
import { getJson, INAT_API, parseSpeciesCounts, TAXA_MAX_IDS, type InatDeps } from "./inat";

export const PHENOLOGY_RADIUS_KM = 50;
export const PHENOLOGY_CACHE_SEC = 7 * 24 * 3600;
/** The three calls together never hold up a pass longer than this (then: season unknown). */
export const PHENOLOGY_MAX_MS = 8_000;

export type PhenologyValue = typeof PHENOLOGY_FLOWERS | typeof PHENOLOGY_FRUITS | null;

export function phenologyUrl(center: LatLng, month: number, taxonIds: readonly number[], value: PhenologyValue): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("bad month");
  if (taxonIds.length === 0 || taxonIds.length > TAXA_MAX_IDS) throw new RangeError("1-30 taxon ids");
  if (!taxonIds.every((i) => Number.isSafeInteger(i) && i > 0)) throw new RangeError("bad id");
  const u = new URL(`${INAT_API}/observations/species_counts`);
  u.searchParams.set("lat", center.lat.toFixed(5));
  u.searchParams.set("lng", center.lng.toFixed(5));
  u.searchParams.set("radius", String(PHENOLOGY_RADIUS_KM));
  u.searchParams.set("verifiable", "true");
  u.searchParams.set("month", String(month));
  u.searchParams.set("taxon_id", taxonIds.join(","));
  u.searchParams.set("term_id", String(PHENOLOGY_TERM_ID));
  if (value !== null) u.searchParams.set("term_value_id", String(value));
  u.searchParams.set("per_page", String(TAXA_MAX_IDS));
  u.searchParams.set("locale", "en");
  return u.toString();
}

export const PhenologySchema = z.object({
  month: z.number().int().min(1).max(12),
  /** Taxon id -> counts. A candidate with no annotated record this month is absent. */
  taxa: z.record(z.string(), z.object({ flowers: z.number().int().min(0), fruits: z.number().int().min(0), annotated: z.number().int().min(0) })),
});
export type Phenology = z.infer<typeof PhenologySchema>;

/**
 * Counts per taxon from the three answers (species_counts bodies).
 *
 * R2-m7 (Q-2-06): species_counts answers with LEAF taxa, so observations of a candidate plant logged as
 * a subspecies or variety (or, for a genus candidate, as one of its species) come back under another
 * id. With `candidates`, every returned taxon is counted for each candidate that is the taxon itself
 * or one of its ancestors (iNaturalist's `ancestor_ids`), so those records are not lost.
 */
export function parsePhenology(month: number, all: unknown, flowers: unknown, fruits: unknown, candidates?: readonly number[]): Phenology {
  const wanted = candidates ? new Set(candidates) : null;
  const counts = (json: unknown) => {
    const m = new Map<number, number>();
    for (const sp of parseSpeciesCounts(json).species) {
      const ids = wanted ? [...new Set([sp.taxonId, ...sp.ancestorIds])].filter((id) => wanted.has(id)) : [sp.taxonId];
      for (const id of ids) m.set(id, (m.get(id) ?? 0) + sp.count);
    }
    return m;
  };
  const a = counts(all);
  const fl = counts(flowers);
  const fr = counts(fruits);
  const taxa: Record<string, PhenologyCount> = {};
  for (const id of new Set([...a.keys(), ...fl.keys(), ...fr.keys()])) {
    const f = fl.get(id) ?? 0;
    const r = fr.get(id) ?? 0;
    // "annotated" can never be below what the value-filtered calls saw (eventual consistency between calls).
    taxa[String(id)] = { flowers: f, fruits: r, annotated: Math.max(a.get(id) ?? 0, f, r) };
  }
  return { month, taxa };
}

const cache = createJsonCache({ name: "inat-phenology", schema: PhenologySchema, ttlSec: PHENOLOGY_CACHE_SEC, maxEntries: 2_000 });

/**
 * Phenology for up to 30 plant ids, or null when iNaturalist didn't answer in time (logged).
 * An empty id list returns an empty result without any call.
 */
export async function loadPhenology(
  parkId: string,
  center: LatLng,
  month: number,
  plantIds: readonly number[],
  deps: InatDeps,
): Promise<Phenology | null> {
  const ids = [...new Set(plantIds)].slice(0, TAXA_MAX_IDS).sort((x, y) => x - y);
  if (ids.length === 0) return { month, taxa: {} };
  const now = deps.now ?? (() => Date.now());
  const key = `${parkId}|${month}|${ids.join(",")}`;
  const hit = await cache.get(key, now());
  if (hit) return hit.value;
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(PHENOLOGY_MAX_MS)]) : AbortSignal.timeout(PHENOLOGY_MAX_MS);
  const d = { ...deps, signal };
  try {
    const all = await getJson(phenologyUrl(center, month, ids, null), "phenology", d);
    const flowers = await getJson(phenologyUrl(center, month, ids, PHENOLOGY_FLOWERS), "phenology", d);
    const fruits = await getJson(phenologyUrl(center, month, ids, PHENOLOGY_FRUITS), "phenology", d);
    const p = parsePhenology(month, all, flowers, fruits, ids);
    await cache.set(key, p, { now: now() });
    return p;
  } catch (err) {
    if (err instanceof SourceError || (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) || err instanceof z.ZodError) {
      log("phenology_unavailable", { reason: err instanceof SourceError ? err.code : err.name }, "warn");
      return null;
    }
    throw err;
  }
}
