/**
 * Audit round 2, Builder F (runtime and data): saved DFW park answers (R2-M3), the batched recorder,
 * the optional map wait (R2-M2), the season check by taxon ancestry (R2-m7), after() (R2-m5), the
 * "no model key" copy (R2-m6) and the pass-error UI (example link + one automatic retry).
 * Real recordings only: the per-park files in src/data/osm/parks were recorded live by
 * `pnpm osm:snapshot` (2026-10-06), and the batch answer in tests/fixtures by the same batch query.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PassFailure } from "@/components/pass/PassMaker";
import { AUTO_RETRY_MAX_MS, AUTO_RETRY_MIN_MS, autoRetryWaitMs, plannedAutoRetryMs, retryFailsNow } from "@/components/pass/usePassRequest";
import { PARKS_COPY } from "@/lib/parks/schema";
import { runAfterResponse } from "@/lib/after";
import { MODEL_NOT_CONFIGURED_TAIL, modelFailure, PASS_DEADLINE_MS } from "@/lib/ai/build-pass";
import { MemoryStore, resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { ModelError } from "@/lib/model";
import { loadFeatures } from "@/lib/pass/park-data";
import { AUTO_RETRY_CODES, MAP_DATA_FAILURE_CODES, PassLineSchema } from "@/lib/pass/schema";
import { parsePhenology } from "@/lib/sources/inat-phenology";
import { dfwParkFile, dfwParkFileName, resetSavedOsm, savedDfwFeatures, savedDfwGeometry } from "@/lib/sources/osm-snapshot";
import { OVERPASS_MAXSIZE_BYTES, parkQueryHead, withoutMaxsize } from "@/lib/sources/overpass";
import { featuresQuery, parseFeatures, parseParkId } from "@/lib/sources/overpass-features";
import { geometryQuery } from "@/lib/spot/geometry";
import { loadGeometry, SPOT_STAGE_END_MS, SPOT_WAIT_MS, spotWaitMs } from "@/lib/spot/load";
import { batchQuery, splitBatch } from "../../evals/osm-dfw-parks";
import { rec } from "./support/pass-replay";

/** A DFW park recorded live by pnpm osm:snapshot (features + geometry), not an example park. */
const DFW_PARK = "way/1012928178"; // Eladio R. Martinez Park, Dallas
const down = async () => new Response("Service Unavailable", { status: 503 });

let restore: () => void;
beforeEach(() => {
  resetStores();
  resetSavedOsm();
  restore = setLogSink(() => undefined);
});
afterEach(() => restore());

describe("R2-m2: every park query carries a memory cap", () => {
  it("features and geometry queries start with [timeout:25][maxsize:128 MiB]; withoutMaxsize gives the pre-R2 query", () => {
    const ref = parseParkId("way/188145317")!;
    expect(parkQueryHead()).toBe(`[out:json][timeout:25][maxsize:${OVERPASS_MAXSIZE_BYTES}];`);
    expect(featuresQuery(ref).startsWith(parkQueryHead())).toBe(true);
    expect(geometryQuery(ref).startsWith(parkQueryHead())).toBe(true);
    expect(withoutMaxsize(featuresQuery(ref)).startsWith("[out:json][timeout:25];")).toBe(true);
  });
});

describe("R2-M3: the batched recorder (one query, many parks, the app's own statements)", () => {
  const batch = rec("overpass-batch-features-celebration-connemara") as unknown as { _recording: { overpassQuery: string; fetchedAt: string }; body: unknown };

  it("the recorded query is exactly batchQuery(): the per-park statements inside foreach, a gp_end marker per park", () => {
    expect(batch._recording.overpassQuery).toBe(batchQuery("features", "way", [188145317, 306191453]));
    expect(batch._recording.overpassQuery).toContain("foreach->.p(");
    expect(batch._recording.overpassQuery).toContain("make gp_end pid=p.u(id());out;");
    expect(() => batchQuery("geometry", "node", [1])).toThrow(RangeError);
    expect(() => batchQuery("features", "way", [])).toThrow(RangeError);
    expect(() => batchQuery("features", "way", [1.5])).toThrow(RangeError);
  });

  it("splitBatch hands each park its own elements, and the app's parser reads them like a single-park answer", () => {
    const parts = splitBatch(batch.body);
    expect([...parts.keys()].sort()).toEqual([188145317, 306191453]);
    const cel = parseFeatures(parts.get(188145317)!, { type: "way", id: 188145317 });
    const con = parseFeatures(parts.get(306191453)!, { type: "way", id: 306191453 });
    expect(cel?.park.name).toBe("Celebration Park");
    expect(con?.park.name).toBe("Connemara Meadow Preserve");
    // Same park, same kinds of features as the single-park recordings of the day before (OSM edits may change counts).
    const single = parseFeatures(rec("overpass-features-celebration-park").body, { type: "way", id: 188145317 })!;
    expect(Object.keys(cel!.features).sort()).toEqual(Object.keys(single.features).sort());
    // A part never leaks into the other park.
    expect(parseFeatures(parts.get(188145317)!, { type: "way", id: 306191453 })).toBeNull();
    expect(() => splitBatch({ remark: "no elements" })).toThrow();
  });
});

describe("R2-M3: saved answers for every DFW park", () => {
  it("file names are only ever built from a valid park id (no path tricks)", () => {
    expect(dfwParkFileName("way/38113837")).toBe("way-38113837.json.br");
    for (const bad of ["../x", "way/1/../../etc", "way/abc", "area/1", ""]) expect(dfwParkFileName(bad)).toBeNull();
    expect(dfwParkFile("../../package.json")).toBeNull();
    expect(dfwParkFile("way/1")).toBeNull(); // not a recorded park: missing, never invented
  });

  it("a recorded park has real features and an outline with their fetch time and source", () => {
    const f = savedDfwFeatures(DFW_PARK)!;
    expect(f.value.park.id).toBe(DFW_PARK);
    expect(f.value.park.name).toBe("Eladio R. Martinez Park");
    expect(f.from).toMatch(/^live-batch/);
    expect(f.fetchedAt).toBeGreaterThan(Date.parse("2026-10-06T00:00:00Z"));
    const g = savedDfwGeometry(DFW_PARK)!;
    expect(g.value.parkId).toBe(DFW_PARK);
    expect(g.value.outline.length).toBeGreaterThan(0);
  });

  it("live Overpass down -> the pass uses the saved answer (with its real date) instead of failing", async () => {
    const ref = parseParkId(DFW_PARK)!;
    const store = new MemoryStore();
    const calls: string[] = [];
    const fetchImpl = async (u: string) => {
      calls.push(u);
      return down();
    };
    const out = await loadFeatures(ref, { store, env: {}, now: () => Date.now(), fetchImpl });
    expect(calls.length).toBeGreaterThan(0); // live was tried first
    if (!out.ok) throw new Error(`expected the saved answer, got ${out.outcome.error.code}`);
    expect(out.from).toBe("saved");
    expect(out.value).toEqual(savedDfwFeatures(DFW_PARK)!.value);
    expect(out.at).toBe(savedDfwFeatures(DFW_PARK)!.fetchedAt);
  });

  it("a park outside the saved index keeps the honest error (no saved answer to fall back on)", async () => {
    const out = await loadFeatures({ type: "way", id: 1 }, { store: new MemoryStore(), env: {}, now: () => Date.now(), fetchImpl: down });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.outcome.error.code).toBe("OSM_UNAVAILABLE");
  });

  it("the saved outline is used at once for the optional map (no live wait), with its real fetch time", async () => {
    const calls: string[] = [];
    const g = await loadGeometry(parseParkId(DFW_PARK)!, {
      store: new MemoryStore(),
      env: { OSM_BACKGROUND_REFRESH: "0" },
      now: () => Date.now(),
      fetchImpl: async (u: string) => {
        calls.push(u);
        return down();
      },
    });
    expect(g.status).toBe("ok");
    if (g.status === "ok") expect(g.checkedAt).toBe(savedDfwGeometry(DFW_PARK)!.fetchedAt);
    expect(calls).toEqual([]);
  });
});

describe("R2-M2: the optional map wait is cut short on a slow pass", () => {
  it("full wait early, shorter once the pass used SPOT_STAGE_END_MS, never into the model's time", () => {
    expect(spotWaitMs(5_000, PASS_DEADLINE_MS - 5_000)).toBe(SPOT_WAIT_MS);
    expect(spotWaitMs(28_000, PASS_DEADLINE_MS - 28_000)).toBe(SPOT_STAGE_END_MS - 28_000); // Finch Park: 12 s, not 25 s
    expect(spotWaitMs(SPOT_STAGE_END_MS, PASS_DEADLINE_MS - SPOT_STAGE_END_MS)).toBe(0);
    expect(spotWaitMs(10_000, 25_000)).toBe(5_000); // only 25 s left: keep 20 s for the model
    expect(spotWaitMs(70_000, 15_000)).toBe(0);
  });
});

describe("R2-m7: the season check counts subspecies and varieties for their species", () => {
  it("a genus-level candidate gets its species' real counts through iNaturalist's ancestor_ids", () => {
    const r = rec("inat-phenology-connemara-meadow-preserve") as unknown as { _recording: { month: number }; exchanges: { url: string; body: unknown }[] };
    const body = (v: string | null) => r.exchanges.find((e) => new URL(e.url).searchParams.get("term_value_id") === v)!.body;
    const exact = parsePhenology(10, body(null), body("13"), body("14"));
    const first = (body(null) as { results: { count: number; taxon: { id: number; ancestor_ids: number[] } }[] }).results[0];
    const parent = first.taxon.ancestor_ids.at(-2)!; // the taxon one rank above the returned one
    expect(parent).not.toBe(first.taxon.id);
    // Exact matching (before R2-m7) has nothing for the parent id; matching by ancestry does.
    expect(exact.taxa[String(parent)]).toBeUndefined();
    const byAncestry = parsePhenology(10, body(null), body("13"), body("14"), [parent, first.taxon.id]);
    expect(byAncestry.taxa[String(parent)].annotated).toBeGreaterThanOrEqual(first.count);
    // The species itself keeps exactly its own counts.
    expect(byAncestry.taxa[String(first.taxon.id)]).toEqual(exact.taxa[String(first.taxon.id)]);
    // Taxa that are no candidate (and have no candidate ancestor) are left out.
    expect(Object.keys(byAncestry.taxa).sort()).toEqual([String(parent), String(first.taxon.id)].sort());
  });
});

describe("R2-m5 / R2-m6", () => {
  it("runAfterResponse still runs the work outside a request (tests, scripts) and never throws", async () => {
    let ran = false;
    await new Promise<void>((resolve) => {
      runAfterResponse(async () => {
        ran = true;
        resolve();
      });
    });
    expect(ran).toBe(true);
    expect(() => runAfterResponse(async () => Promise.reject(new Error("boom")))).not.toThrow();
  });

  it("no model key: says who can fix it, never 'try again in a minute'", () => {
    const f = modelFailure(new ModelError("MODEL_NOT_CONFIGURED", { cause: "no key" }), "gemma-4-31B-it");
    expect(f.status).toBe(503);
    expect(f.error.code).toBe("MODEL_NOT_CONFIGURED");
    expect(f.error.message).toContain(MODEL_NOT_CONFIGURED_TAIL);
    expect(f.error.message).not.toMatch(/try again/i);
  });
});

describe("R2-M3: a pass that failed on map data offers a ready example and tries once more by itself", () => {
  it("the error line may carry an example link (validated like the search's)", () => {
    const line = PassLineSchema.parse({
      type: "error",
      status: 503,
      error: { code: "OSM_UNAVAILABLE", message: "busy", retryAfter: 60, example: { name: "Arbor Hills Nature Preserve", href: "/pass/w38113837-6to10-20261006-1?example=1" } },
    });
    expect(line.type === "error" && line.error.example?.name).toBe("Arbor Hills Nature Preserve");
    expect(() => PassLineSchema.parse({ type: "error", status: 503, error: { code: "X", message: "m", example: { name: "x", href: "https://evil.test/" } } })).toThrow();
    expect(AUTO_RETRY_CODES.every((c) => MAP_DATA_FAILURE_CODES.includes(c))).toBe(true);
    expect(AUTO_RETRY_CODES).not.toContain("PARK_TOO_BIG");
  });

  it("the automatic retry waits for Retry-After, at least 10 s and at most 60 s", () => {
    expect(autoRetryWaitMs(undefined)).toBe(15_000);
    expect(autoRetryWaitMs(1)).toBe(AUTO_RETRY_MIN_MS);
    expect(autoRetryWaitMs(30)).toBe(30_000);
    expect(autoRetryWaitMs(3600)).toBe(AUTO_RETRY_MAX_MS);
  });

  it("the failure shows the message, the countdown, 'Try again now' and the example link", () => {
    const html = renderToStaticMarkup(
      <PassFailure
        state={{ kind: "failed", code: "OSM_UNAVAILABLE", message: "No data available: the OpenStreetMap server is busy.", example: { name: "Arbor Hills Nature Preserve", href: "/pass/w38113837-6to10-20261006-1?example=1" }, autoRetryAt: 1 }}
        secondsToRetry={12}
        onTryAgain={() => undefined}
      />,
    );
    expect(html).toContain('data-error-code="OSM_UNAVAILABLE"');
    expect(html).toContain("Trying once more by itself in 12 s.");
    expect(html).toContain("Try again now");
    expect(html).toContain('href="/pass/w38113837-6to10-20261006-1?example=1"');
    expect(html).toContain("See a ready example pass: Arbor Hills Nature Preserve");
    const plain = renderToStaticMarkup(<PassFailure state={{ kind: "failed", code: "DAILY_LIMIT", message: "Paused." }} secondsToRetry={null} onTryAgain={() => undefined} />);
    expect(plain).not.toContain("Try again");
    expect(plain).not.toContain("example");
  });
});

describe("R2-m2: a park whose live query ran into our client timeout is not sent again for 15 min", () => {
  /** Never answers: only our own per-attempt timeout ends it (a built condition; a real one takes 30 s per mirror). */
  const hang = (calls: string[]) => (u: string, init?: RequestInit) => {
    calls.push(u);
    return new Promise<Response>((_, reject) => {
      const s = init?.signal;
      const stop = () => reject(s?.reason ?? new DOMException("aborted", "AbortError"));
      if (s?.aborted) stop();
      s?.addEventListener("abort", stop);
    });
  };

  it("outside DFW: the second try answers OSM_UNAVAILABLE at once, with no request", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const deps = { store, env: {}, now: () => Date.now(), fetchImpl: hang(calls), timeoutMs: 50 };
    const first = await loadFeatures({ type: "way", id: 1 }, deps);
    expect(first.ok).toBe(false);
    // Audit Q-3-01: the first failure already says the real 15-minute wait (it was just negative-cached).
    if (!first.ok) expect(first.outcome.error).toEqual({ code: "OSM_UNAVAILABLE", message: PARKS_COPY.parkSlow(15), retryAfter: 15 * 60 });
    const sent = calls.length;
    expect(sent).toBeGreaterThan(0);
    const second = await loadFeatures({ type: "way", id: 1 }, { ...deps, store });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.outcome.error).toMatchObject({ code: "OSM_UNAVAILABLE", retryAfter: 15 * 60 });
    expect(calls.length).toBe(sent);
  });

  it("audit Q-3-01: a later try gets the REAL time left, and the copy says it", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    let t = Date.UTC(2026, 9, 6, 14, 0, 0);
    const deps = { store, env: {}, now: () => t, fetchImpl: hang(calls), timeoutMs: 50 };
    await loadFeatures({ type: "way", id: 2 }, deps);
    t += 10 * 60 * 1000 + 30_000; // 10.5 min later: 4.5 min left
    const later = await loadFeatures({ type: "way", id: 2 }, deps);
    if (later.ok) throw new Error("expected a failure");
    expect(later.outcome.error).toEqual({ code: "OSM_UNAVAILABLE", message: PARKS_COPY.parkSlow(5), retryAfter: 270 });
    expect(PARKS_COPY.parkSlow(5)).toBe(
      "No data available: this park's map took too long to load from OpenStreetMap a moment ago, so we won't ask for it again for about 5 minutes. Meanwhile, open an example pass or pick another park.",
    );
    expect(PARKS_COPY.parkSlow(1)).toContain("about 1 minute.");
  });

  it("audit Q-3-01: the page never auto-retries into that wait, and offers no 'Try again' that would fail at once", () => {
    // The server error body of the slow cache, run through the client's decision.
    expect(plannedAutoRetryMs("OSM_UNAVAILABLE", 900)).toBeNull();
    expect(plannedAutoRetryMs("OSM_UNAVAILABLE", 270)).toBeNull();
    expect(plannedAutoRetryMs("OSM_UNAVAILABLE", 19)).toBe(19_000);
    expect(plannedAutoRetryMs("OSM_UNAVAILABLE", undefined)).toBe(15_000);
    expect(plannedAutoRetryMs("DATA_TOO_SLOW", 60)).toBe(60_000);
    expect(plannedAutoRetryMs("MODEL_TIMEOUT", 5)).toBeNull();
    expect(retryFailsNow("OSM_UNAVAILABLE", 900)).toBe(true);
    expect(retryFailsNow("OSM_UNAVAILABLE", 60)).toBe(false);
    expect(retryFailsNow("MODEL_RATE_LIMITED", 900)).toBe(false);
    const html = renderToStaticMarkup(
      <PassFailure
        state={{ kind: "failed", code: "OSM_UNAVAILABLE", message: PARKS_COPY.parkSlow(15), retryAfter: 900, example: { name: "Arbor Hills Nature Preserve", href: "/pass/w38113837-6to10-20261006-1?example=1" } }}
        secondsToRetry={null}
        onTryAgain={() => undefined}
      />,
    );
    expect(html).toContain("about 15 minutes");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("Trying once more");
    expect(html).toContain("See a ready example pass: Arbor Hills Nature Preserve");
  });

  it("audit Q-3-06: the busy copy no longer promises 'a minute' next to the page's own countdown", () => {
    expect(PARKS_COPY.overpassDown).not.toMatch(/in a minute/);
    expect(PARKS_COPY.overpassDown).toBe("No data available: the OpenStreetMap server is busy. Try again shortly, or pick an example park.");
  });

  it("a DFW park still gets its saved answer while it is negative-cached", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const deps = { store, env: {}, now: () => Date.now(), fetchImpl: hang(calls), timeoutMs: 50 };
    const first = await loadFeatures(parseParkId(DFW_PARK)!, deps);
    expect(first.ok && first.from).toBe("saved");
  });
});

describe("R2-M3: the recorded DFW files", () => {
  it("every saved park file is valid for the app, belongs to a park in the index, and dfw-coverage.json counts what is on disk", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const index = JSON.parse(readFileSync("src/data/osm/dfw-parks.json", "utf8")) as { parks: [string][] };
    const ids = new Set(index.parks.map((r) => r[0]));
    const coverage = JSON.parse(readFileSync("src/data/osm/dfw-coverage.json", "utf8")) as { features: { ok: number }; geometry: { ok: number } };
    let features = 0;
    let geometry = 0;
    for (const name of readdirSync("src/data/osm/parks")) {
      const id = name.replace(/\.json\.br$/, "").replace("-", "/");
      expect(ids.has(id), name).toBe(true);
      const file = dfwParkFile(id);
      expect(file, name).not.toBeNull(); // parsed with DfwParkFileSchema; an invalid file would be null
      if (file?.features) {
        features++;
        expect(file.features.value.park.id).toBe(id);
        expect(Date.parse(file.features.fetchedAt)).toBeGreaterThan(Date.parse("2026-10-06T00:00:00Z"));
      }
      if (file?.geometry) geometry++;
    }
    expect(features).toBe(coverage.features.ok);
    expect(geometry).toBe(coverage.geometry.ok);
  });
});
