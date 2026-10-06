/**
 * Named parks and nature reserves near a point, from OpenStreetMap via Overpass (SPEC F1).
 * The query is fixed; only the two numbers come from the request, and they are validated
 * and formatted by code (no user text ever reaches the query).
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { distanceM, isValidLatLng, type LatLng } from "@/lib/geo";
import { MAX_PARKS, PARK_RADIUS_M, type Park } from "@/lib/parks/schema";
import { OVERPASS_QUERY_TIMEOUT_SEC, runOverpass, type OverpassDeps } from "./overpass";

export function parksQuery(center: LatLng, radiusM: number = PARK_RADIUS_M): string {
  if (!isValidLatLng(center)) throw new RangeError("bad point");
  const lat = center.lat.toFixed(5);
  const lng = center.lng.toFixed(5);
  const r = Math.round(radiusM);
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SEC}];nwr["leisure"~"^(park|nature_reserve)$"]["name"](around:${r},${lat},${lng});out center tags;`;
}

const Element = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number().int().positive(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

/** Two park objects with the same name this close together are one park mapped twice. */
export const DUPLICATE_NAME_RADIUS_M = 1_000;

export const normName = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Turn an Overpass answer into the nearest named parks. Elements that are not a named
 * park/nature reserve with a usable point are skipped. Same-name objects within 1 km of each
 * other are merged (keeps the nearer). Sorted by distance, then name.
 */
export function parseParks(json: unknown, center: LatLng): { parks: Park[]; totalFound: number } {
  const elements = z.object({ elements: z.array(z.unknown()) }).parse(json).elements;
  const all: Park[] = [];
  for (const raw of elements) {
    const e = Element.safeParse(raw);
    if (!e.success) continue;
    const tags = e.data.tags ?? {};
    const name = tags.name?.trim();
    const leisure = tags.leisure;
    if (!name || (leisure !== "park" && leisure !== "nature_reserve")) continue;
    const lat = e.data.lat ?? e.data.center?.lat;
    const lng = e.data.lon ?? e.data.center?.lon;
    if (lat === undefined || lng === undefined || !isValidLatLng({ lat, lng })) continue;
    all.push({
      id: `${e.data.type}/${e.data.id}`,
      name: name.slice(0, 120),
      kind: leisure,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      distanceM: Math.round(distanceM(center, { lat, lng })),
    });
  }
  all.sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const kept: Park[] = [];
  for (const p of all) {
    const dup = kept.some((k) => normName(k.name) === normName(p.name) && distanceM(k, p) <= DUPLICATE_NAME_RADIUS_M);
    if (!dup) kept.push(p);
  }
  return { parks: kept.slice(0, MAX_PARKS), totalFound: kept.length };
}

/** Fetch and parse. Throws SourceError from runOverpass, or "bad_output" when the shape is wrong. */
export async function parksNear(center: LatLng, deps: OverpassDeps): Promise<{ parks: Park[]; totalFound: number }> {
  const { json } = await runOverpass(parksQuery(center), deps);
  return parseParks(json, center);
}
