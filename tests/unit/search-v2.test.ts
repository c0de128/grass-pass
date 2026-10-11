/**
 * Search v2 (2026-10-10): the distance choice (1, 3, 5, 10 mi), cache and in-flight keys per distance, miles
 * formatting, the results summary, the map helpers and config, and the claims that changed with it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import {
  DEFAULT_RADIUS_MILES,
  isRadiusMiles,
  MAX_PARKS,
  METERS_PER_MILE,
  PARK_RADIUS_M,
  RADIUS_MILES,
  radiusLabel,
  radiusMeters,
  radiusShort,
} from "@/lib/parks/constants";
import { MAPLIBRE_VERSION, MAPLIBRE_WORKER_URL, MAP_COPY, OPENFREEMAP_ORIGIN, OPENFREEMAP_STYLE_URL } from "@/lib/parks/map-config";
import { circleRing, milesShort, resultsBounds, resultsSummary } from "@/lib/parks/results-view";
import { PARKS_COPY, ParksResultSchema, RadiusMilesSchema } from "@/lib/parks/schema";
import { inflightKey, parksKey, pointKey, resetParksSearch, searchParks } from "@/lib/parks/search";
import { distanceLabel, distanceM } from "@/lib/geo";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { locationSearchingLabel, searchingLabel } from "@/components/parks/useParkSearch";
import { osmReplay, recordedResponse } from "./support/osm-replay";

const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("distance choices", () => {
  it("offers exactly 1, 3, 5 and 10 miles, default 3", () => {
    expect(RADIUS_MILES).toEqual([1, 3, 5, 10]);
    expect(DEFAULT_RADIUS_MILES).toBe(3);
    expect(PARK_RADIUS_M).toBe(4828);
  });

  it("converts miles to whole metres", () => {
    expect(RADIUS_MILES.map(radiusMeters)).toEqual([1609, 4828, 8047, 16093]);
    expect(METERS_PER_MILE).toBe(1609.344);
  });

  it("labels miles first, km in brackets", () => {
    expect(RADIUS_MILES.map(radiusLabel)).toEqual(["1 mi (1.6 km)", "3 mi (4.8 km)", "5 mi (8.0 km)", "10 mi (16 km)"]);
    expect(radiusShort(10)).toBe("10 mi");
  });

  it("the schema and the guard accept only the four values", () => {
    for (const ok of RADIUS_MILES) {
      expect(RadiusMilesSchema.safeParse(ok).success).toBe(true);
      expect(isRadiusMiles(ok)).toBe(true);
    }
    for (const bad of [0, 2, 4, 6, 10.5, 15, -3, 4828, "3", null, undefined, NaN, Infinity]) {
      expect(RadiusMilesSchema.safeParse(bad).success, String(bad)).toBe(false);
      expect(isRadiusMiles(bad), String(bad)).toBe(false);
    }
  });

  it("park cards show miles first (km in brackets)", () => {
    expect(distanceLabel(800)).toBe("0.5 mi (0.8 km)");
    expect(distanceLabel(16_093)).toBe("10 mi (16 km)");
    expect(milesShort(4828)).toBe("3.0 mi");
    expect(milesShort(20_000)).toBe("12 mi");
  });
});

describe("cache and in-flight keys include the distance", () => {
  const p = { lat: 33.10317, lng: -96.67055 };
  it("park-list cache key = point + distance", () => {
    expect(parksKey(p, 3)).toBe(`${pointKey(p)}|r3mi`);
    const keys = RADIUS_MILES.map((mi) => parksKey(p, mi));
    expect(new Set(keys).size).toBe(4);
  });

  it("in-flight key = place (or point) + distance; missing distance = 3 mi", () => {
    expect(inflightKey({ kind: "text", q: "Allen TX" })).toBe(inflightKey({ kind: "text", q: "Allen TX", radiusMi: 3 }));
    expect(inflightKey({ kind: "text", q: "Allen TX", radiusMi: 1 })).not.toBe(inflightKey({ kind: "text", q: "Allen TX", radiusMi: 10 }));
    expect(inflightKey({ kind: "location", lat: 33.09, lng: -96.7, radiusMi: 5 })).toBe("l:33.0900,-96.7000|r5mi");
  });

  describe("searchParks", () => {
    let restoreLog: () => void;
    beforeEach(() => {
      resetStores();
      resetParksSearch();
      disableSavedOsmForTests();
      restoreLog = setLogSink(() => undefined);
    });
    afterEach(() => {
      restoreLog();
      resetSavedOsm();
    });

    it("a cached 3 mi list is never served for 10 mi (a new Overpass query with the bigger circle)", async () => {
      const store = new MemoryStore();
      // The recorded Connemara answer stands in for the rounded point; this test is about keys and what we SEND.
      const { fetchImpl, calls } = osmReplay({ overpass: () => recordedResponse("overpass-parks-connemara-meadow-preserve") });
      const deps = { ip: "203.0.113.7", store, fetchImpl, env: {} };
      const three = await searchParks({ kind: "location", lat: 33.09, lng: -96.7 }, deps);
      expect(three.ok && three.result.radiusMi).toBe(3);
      const overpassCalls = () => calls.filter((c) => c.query).map((c) => c.query!.match(/around:(\d+)/)![1]);
      expect(overpassCalls()).toEqual(["4828"]);
      // Same distance again: from the cache.
      const again = await searchParks({ kind: "location", lat: 33.09, lng: -96.7, radiusMi: 3 }, deps);
      expect(again.ok && again.result.cached).toBe(true);
      expect(overpassCalls()).toEqual(["4828"]);
      // A new distance: its own query and its own answer.
      const ten = await searchParks({ kind: "location", lat: 33.09, lng: -96.7, radiusMi: 10 }, deps);
      expect(ten.ok && ten.result.cached).toBe(false);
      expect(ten.ok && ten.result.radiusMi).toBe(10);
      expect(ten.ok && ten.result.radiusM).toBe(16093);
      expect(overpassCalls()).toEqual(["4828", "16093"]);
      expect(ten.ok && ParksResultSchema.safeParse(ten.result).success).toBe(true);
    });

    it("concurrent 1 mi and 10 mi searches for the same place are not merged into one answer", async () => {
      const { fetchImpl, calls } = osmReplay({ overpass: () => recordedResponse("overpass-parks-connemara-meadow-preserve") });
      const store = new MemoryStore();
      const deps = () => ({ ip: "203.0.113.8", store, fetchImpl, env: {} });
      const [a, b] = await Promise.all([
        searchParks({ kind: "location", lat: 33.09, lng: -96.7, radiusMi: 1 }, deps()),
        searchParks({ kind: "location", lat: 33.09, lng: -96.7, radiusMi: 10 }, deps()),
      ]);
      expect(a.ok && a.result.radiusMi).toBe(1);
      expect(b.ok && b.result.radiusMi).toBe(10);
      expect(calls.filter((c) => c.query).map((c) => c.query!.match(/around:(\d+)/)![1]).sort()).toEqual(["1609", "16093"]);
    });
  });
});

describe("results view", () => {
  it("says how many parks were found within the distance, and when the list was cut", () => {
    expect(resultsSummary(7, 7, 1)).toBe("7 named parks within 1 mi.");
    expect(resultsSummary(1, 1, 3)).toBe("1 named park within 3 mi.");
    expect(resultsSummary(MAX_PARKS, 312, 10)).toBe(`312 named parks within 10 mi. Showing the ${MAX_PARKS} nearest (the list stops at ${MAX_PARKS}).`);
  });

  it("the empty copy names the distance and offers a longer one only below 10 mi", () => {
    expect(PARKS_COPY.noParks(1)).toBe("No parks within 1 mi in OpenStreetMap. Try a longer distance.");
    expect(PARKS_COPY.noParks(10)).toBe("No parks within 10 mi in OpenStreetMap.");
  });

  it("the circle ring is closed and every point is the chosen distance from the centre", () => {
    const c = { lat: 33.10317, lng: -96.67055 };
    const ring = circleRing(c, 16_093, 36);
    expect(ring).toHaveLength(37);
    expect(ring[0]).toEqual(ring[36]);
    for (const [lng, lat] of ring) expect(Math.abs(distanceM(c, { lat, lng }) - 16_093)).toBeLessThan(25);
  });

  it("the first view holds the point and every park, and is never tiny", () => {
    const c = { lat: 33.1, lng: -96.67 };
    const parks = [
      { lat: 33.12, lng: -96.7 },
      { lat: 33.08, lng: -96.6 },
    ];
    const [[w, s], [e, n]] = resultsBounds(c, parks);
    const eps = 1e-9;
    for (const p of [c, ...parks]) {
      expect(p.lng).toBeGreaterThanOrEqual(w - eps);
      expect(p.lng).toBeLessThanOrEqual(e + eps);
      expect(p.lat).toBeGreaterThanOrEqual(s - eps);
      expect(p.lat).toBeLessThanOrEqual(n + eps);
    }
    const [[w1, s1], [e1, n1]] = resultsBounds(c, []);
    expect(distanceM({ lat: s1, lng: w1 }, { lat: n1, lng: w1 })).toBeGreaterThan(590);
    expect(distanceM({ lat: s1, lng: w1 }, { lat: s1, lng: e1 })).toBeGreaterThan(590);
  });

  it("the status line names the place and the distance (no fake progress)", () => {
    expect(searchingLabel("Allen TX", 10)).toBe("Finding “Allen TX” on OpenStreetMap, then looking for parks within 10 mi…");
    expect(locationSearchingLabel(1)).toBe("Looking on OpenStreetMap for parks within 1 mi of you…");
  });
});

describe("map config", () => {
  it("uses OpenFreeMap's Positron style from one https origin", () => {
    expect(OPENFREEMAP_ORIGIN).toBe("https://tiles.openfreemap.org");
    expect(OPENFREEMAP_STYLE_URL).toBe("https://tiles.openfreemap.org/styles/positron");
  });

  it("serves the worker of the installed MapLibre version from our own origin, unchanged but for the source-map line", () => {
    const pkg = JSON.parse(read("node_modules/maplibre-gl/package.json")) as { version: string; license: string };
    expect(pkg.version).toBe(MAPLIBRE_VERSION);
    expect(pkg.license).toBe("BSD-3-Clause");
    expect(MAPLIBRE_WORKER_URL).toBe(`/vendor/maplibre-gl-worker-${MAPLIBRE_VERSION}.mjs`);
    const ours = read(`public${MAPLIBRE_WORKER_URL}`);
    const theirs = read("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs").replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");
    expect(ours).toBe(theirs);
    expect(read("public/vendor/maplibre-gl-LICENSE.txt")).toContain("MapLibre contributors");
  });

  it("the map has its unavailable note and the OpenFreeMap attribution in the component", () => {
    const src = read("src/components/parks/ParkResultsMap.tsx");
    expect(MAP_COPY.unavailable).toBe("Map unavailable right now. The list below has every park.");
    expect(src).toContain("MAP_COPY.unavailable");
    expect(src).toContain("OpenFreeMap");
    expect(src).toContain("© OpenMapTiles");
    expect(src).toContain("https://www.openstreetmap.org/copyright");
  });
});

describe("claims sweep: no park-search '5 km' left on user-facing surfaces", () => {
  const files = [
    "README.md",
    "src/app/how-it-works/page.tsx",
    "src/lib/about/content.ts",
    "src/components/parks/ParkStep.tsx",
    "src/components/parks/useParkSearch.ts",
    "src/lib/parks/schema.ts",
    "src/app/api/parks/route.ts",
  ];
  it.each(files)("%s", (f) => {
    // Wild Finds really use 1.5 km (iNaturalist); only the park search changed.
    expect(read(f)).not.toMatch(/(?<!1\.)\b5 km\b|within 5 ?km|around:5000/);
  });

  it("README and the about page list the map's privacy row and credits", () => {
    const readme = read("README.md").replace(/\s+/g, " ");
    expect(readme).toContain("| The map area of your search results | your browser, straight to the OpenFreeMap tile server");
    expect(readme).toContain("[MapLibre GL JS](https://maplibre.org/) 6.13.0");
    expect(read("src/lib/about/content.ts")).toContain('what: "The map area of your search results"');
    expect(read("src/app/about/page.tsx")).toContain('data-testid="map-credit"');
  });
});
