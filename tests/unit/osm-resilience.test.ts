/**
 * Audit round 1, Builder A: Overpass resilience (R1-B1), one pass deadline (R1-M1), Overpass abuse
 * hardening (R1-M2 / SEC-1-01), our own queue vs "OpenStreetMap is busy" (Q-1-06) and degraded passes
 * (R1-m2 / Q-1-05).
 *
 * Park data is the LIVE recordings (tests/fixtures, src/data/osm). Failure shapes that cannot be
 * recorded on demand (a hung server, a 504 for one query, a "Query timed out" remark) are built in the
 * tests that need them and say so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, resetStores } from "@/lib/cache/store";
import { breakerRetryAfter } from "@/lib/limits";
import { setLogSink } from "@/lib/log";
import { DATA_TOO_SLOW_COPY, loadFeatures } from "@/lib/pass/park-data";
import { DEGRADED_RETRY_SEC, degradedReasons, isDegraded, makePass, MAX_DEGRADED_REBUILDS, mayRebuildDegraded, REPEAT_RETRY_SEC, resetPassMaking } from "@/lib/pass/make";
import { OCTOBER_REASONS } from "@/lib/october";
import { PASS_DEADLINE_MS, WILD_SLOW_COPY } from "@/lib/ai/build-pass";
import { EXAMPLE_PARKS } from "@/lib/prewarm";
import { PARKS_COPY } from "@/lib/parks/schema";
import { WILD_DOWN_COPY } from "@/lib/pool/wild";
import { SourceError } from "@/lib/sources/common";
import {
  disableSavedOsmForTests,
  indexCovers,
  resetSavedOsm,
  savedFeatures,
  savedGeometry,
  savedIndexInfo,
  savedParksNear,
} from "@/lib/sources/osm-snapshot";
import { osmRefreshIdle, refreshLater, setBackgroundRefreshForTests } from "@/lib/sources/osm-refresh";
import { breakerName, OVERPASS_DEFAULT_URLS, overpassSlots, runOverpass, withoutMaxsize } from "@/lib/sources/overpass";
import { featuresQuery, PARK_FILTER, parseParkId } from "@/lib/sources/overpass-features";
import { loadGeometry } from "@/lib/spot/load";
import { SPOT_COPY } from "@/lib/spot/types";
import { fixture } from "./support/osm-replay";
import { PARKS, passReplay, type Call } from "./support/pass-replay";

const FAKE_KEY = "test-key-not-real"; // gitleaks:allow (dummy test value)
const ENV = { DO_INFERENCE_API_KEY: FAKE_KEY, MODEL_BASE_URL: "", MODEL_ID: "", AI_DAILY_CAP: "" };
/** A day outside the October-box window (Sep 15 - Nov 15), noon in Dallas. */
const DEC_5 = Date.UTC(2026, 11, 5, 18, 0, 0);
let ipN = 0;
const ip = () => `198.51.100.${(++ipN % 250) + 1}`;

/** Dec 5 noon, moving with real time. */
const movingDec5 = () => {
  const start = Date.now();
  return () => DEC_5 + (Date.now() - start);
};
const isOverpass = (c: Call) => new URL(c.url).pathname.endsWith("/interpreter");
const isGeometry = (c: Call) => (new URLSearchParams(c.body ?? "").get("data") ?? "").includes("out geom");
const isInat = (c: Call) => c.host === "api.inaturalist.org";
const isModel = (c: Call) => c.host === "inference.do-ai.run";
const hang = (c: Call) =>
  new Promise<Response>((_, reject) => {
    const s = c.init?.signal;
    if (s?.aborted) reject(new DOMException("aborted", "AbortError"));
    s?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

/** passReplay with built failures layered on top (each says what it builds). */
function replayWith(over: (c: Call) => Promise<Response | undefined> | Response | undefined) {
  const base = passReplay();
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const call: Call = { url, host: u.host, init, body: typeof init?.body === "string" ? init.body : undefined };
    calls.push(call);
    const o = await over(call);
    if (o) return o;
    return base.fetchImpl(url, init);
  };
  return { fetchImpl, calls };
}

let restoreLog: () => void;
beforeEach(() => {
  resetStores();
  resetPassMaking();
  resetSavedOsm();
  restoreLog = setLogSink(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  resetSavedOsm();
  setBackgroundRefreshForTests(false);
  restoreLog();
});

describe("R1-B1 saved OpenStreetMap answers (real recordings with their fetch time)", () => {
  it("every example park has saved features AND geometry, each with a real fetch time and source", () => {
    for (const ex of EXAMPLE_PARKS) {
      const f = savedFeatures(ex.parkId);
      const g = savedGeometry(ex.parkId);
      expect(f, ex.name).not.toBeNull();
      expect(g, ex.name).not.toBeNull();
      expect(f!.value.park.name).toBe(ex.name);
      expect(g!.value.parkId).toBe(ex.parkId);
      for (const a of [f!, g!]) {
        expect(Number.isFinite(a.fetchedAt)).toBe(true);
        expect(a.fetchedAt).toBeGreaterThan(Date.UTC(2026, 9, 5));
        expect(a.endpoint).toMatch(/\./);
        expect(a.from.startsWith("live") || a.from.startsWith("tests/fixtures/")).toBe(true);
      }
    }
  });

  it("the Dallas-area park index is a real recorded answer that covers the six cities (and not Austin)", () => {
    const info = savedIndexInfo();
    expect(info).not.toBeNull();
    expect(info!.cities).toEqual(["Allen", "Plano", "McKinney", "Frisco", "Richardson", "Dallas"]);
    expect(info!.count).toBeGreaterThan(500);
    const points = { allen: { lat: 33.1032, lng: -96.6706 }, plano: { lat: 33.0198, lng: -96.6989 }, mckinney: { lat: 33.1972, lng: -96.6398 }, frisco: { lat: 33.1507, lng: -96.8236 }, richardson: { lat: 32.9483, lng: -96.7299 }, dallas: { lat: 32.7767, lng: -96.797 } };
    for (const [name, p] of Object.entries(points)) expect(indexCovers(p), name).toBe(true);
    const austin = { lat: 30.2672, lng: -97.7431 };
    expect(indexCovers(austin)).toBe(false);
    expect(savedParksNear(austin)).toBeNull();
    // From Connemara's own centre, the saved list starts with Connemara itself.
    const c = savedFeatures(PARKS.connemara.id)!.value.park;
    const near = savedParksNear({ lat: c.lat, lng: c.lng });
    expect(near!.parks[0].id).toBe(PARKS.connemara.id);
    expect(near!.fetchedAt).toBe(savedIndexInfo()!.fetchedAt);
  });

  it("an example pass is made with EVERY Overpass server down: no Overpass request, and the map date is the saved one", async () => {
    // Built failure: every Overpass server answers 504.
    const r = replayWith((c) => (isOverpass(c) ? new Response("busy", { status: 504 }) : undefined));
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: ip(), fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now: movingDec5() });
    if (out.kind !== "pass") throw new Error(`expected a pass, got ${JSON.stringify(out)}`);
    expect(r.calls.filter(isOverpass)).toHaveLength(0);
    expect(out.pass.dataCheckedAt.osm).toBe(new Date(savedFeatures(PARKS.celebration.id)!.fetchedAt).toISOString());
    expect(out.pass.spot?.status).toBe("ok");
    if (out.pass.spot?.status === "ok") expect(out.pass.spot.checkedAt).toBe(new Date(savedGeometry(PARKS.celebration.id)!.fetchedAt).toISOString());
    for (const u of OVERPASS_DEFAULT_URLS) expect(await breakerRetryAfter(new MemoryStore(), breakerName(u), DEC_5)).toBe(0);
  });

  it("a saved answer is refreshed live once in the background (low priority), then served from the cache with ITS time", async () => {
    setBackgroundRefreshForTests(true);
    const r = passReplay();
    const deps = { store: new MemoryStore(), env: {}, now: () => Date.now(), fetchImpl: r.fetchImpl };
    const ref = parseParkId(PARKS.celebration.id)!;
    const first = await loadFeatures(ref, deps);
    expect(first.ok && first.from).toBe("saved");
    await osmRefreshIdle();
    expect(r.calls.filter((c) => c.url.endsWith("/interpreter"))).toHaveLength(1);
    const refreshedAt = Date.now();
    const second = await loadFeatures(ref, deps);
    expect(second.ok && second.from).toBe("cache");
    expect(second.ok && second.at).toBeGreaterThan(first.ok ? first.at : 0);
    expect(second.ok && second.at).toBeLessThanOrEqual(refreshedAt);
    // Geometry: same rule; the lock lets only one refresh per park and kind run.
    const g1 = await loadGeometry(ref, deps);
    expect(g1.status).toBe("ok");
    await osmRefreshIdle();
    resetStores(); // forget the caches, keep nothing else: the next load is "saved" again...
    const deps2 = { ...deps, store: deps.store }; // ...but the refresh lock lives in the (kept) store
    await loadFeatures(ref, deps2);
    await osmRefreshIdle();
    expect(r.calls.filter((c) => c.url.endsWith("/interpreter") && !isGeometry(c))).toHaveLength(1);
  });
});

describe("background refreshes", () => {
  it("run one at a time, and give the lock back when nothing was sent (our slots busy / breakers open)", async () => {
    setBackgroundRefreshForTests(true);
    const store = new MemoryStore();
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const job = (name: string, fail?: SourceError) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 30));
      order.push(name);
      running--;
      if (fail) throw fail;
    };
    refreshLater({ kind: "features", parkId: "way/1" }, job("a"), { store, env: {} });
    refreshLater({ kind: "geometry", parkId: "way/1" }, job("b", new SourceError("overpass", "queue_full", { started: false })), { store, env: {} });
    refreshLater({ kind: "features", parkId: "way/2" }, job("c", new SourceError("overpass", "timeout", { started: true })), { store, env: {} });
    await osmRefreshIdle();
    expect(order).toEqual(["a", "b", "c"]);
    expect(maxRunning).toBe(1);
    // "b" sent nothing: its lock is free again. "a" and "c" reached Overpass: locked for 6 h.
    refreshLater({ kind: "geometry", parkId: "way/1" }, job("b2"), { store, env: {} });
    refreshLater({ kind: "features", parkId: "way/1" }, job("a2"), { store, env: {} });
    refreshLater({ kind: "features", parkId: "way/2" }, job("c2"), { store, env: {} });
    await osmRefreshIdle();
    expect(order).toEqual(["a", "b", "c", "b2"]);
  });
});

describe("R1-M2 / SEC-1-01: Overpass abuse hardening", () => {
  beforeEach(() => disableSavedOsmForTests());

  it("a 'Query timed out' remark: PARK_TOO_BIG, no shared breaker, no failover, and the id is not sent again for 15 min", async () => {
    // Built failure: Overpass's documented 200 + runtime-error remark for a query that is too heavy.
    const heavy = { elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.' };
    const r = replayWith((c) => (isOverpass(c) ? Response.json(heavy) : undefined));
    const store = new MemoryStore({ now: () => DEC_5 });
    const first = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: ip(), store, fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now: movingDec5() });
    expect(first).toMatchObject({ kind: "error", status: 503, error: { code: "PARK_TOO_BIG", message: PARKS_COPY.parkTooBig } });
    expect(r.calls.filter(isOverpass)).toHaveLength(1); // no failover to the mirrors
    expect(r.calls.filter(isGeometry)).toHaveLength(0); // geometry never started
    expect(r.calls.filter(isModel)).toHaveLength(0);
    for (const u of OVERPASS_DEFAULT_URLS) expect(await breakerRetryAfter(store, breakerName(u), DEC_5)).toBe(0);
    const again = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: ip(), store, fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now: () => DEC_5 + 60_000 });
    expect(again).toMatchObject({ kind: "error", error: { code: "PARK_TOO_BIG" } });
    expect(r.calls.filter(isOverpass)).toHaveLength(1);
  });

  it("a non-park id (relation/114690, the State of Texas): the filtered query selects nothing (live recording), NOT_A_PARK, no geometry query, negative-cached", async () => {
    const recd = fixture("overpass-features-not-a-park-texas");
    const meta = recd._recording as unknown as { overpassQuery: string };
    expect(withoutMaxsize(featuresQuery({ type: "relation", id: 114690 }))).toBe(meta.overpassQuery);
    expect(meta.overpassQuery).toContain(`rel(114690)${PARK_FILTER}->.p;`);
    const r = replayWith((c) => {
      if (!isOverpass(c)) return undefined;
      const q = withoutMaxsize(new URLSearchParams(c.body ?? "").get("data") ?? "");
      if (q !== meta.overpassQuery) throw new Error(`no recording for ${q?.slice(0, 80)}`);
      return Response.json(recd.body);
    });
    const store = new MemoryStore({ now: () => DEC_5 });
    const out = await makePass({ parkId: "relation/114690", ageBand: "6-10" }, { ip: ip(), store, fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now: movingDec5() });
    expect(out).toMatchObject({ kind: "error", status: 404, error: { code: "NOT_A_PARK" } });
    expect(r.calls.filter(isOverpass)).toHaveLength(1);
    expect(r.calls.filter(isGeometry)).toHaveLength(0);
    expect(r.calls.filter((c) => isInat(c) || isModel(c))).toHaveLength(0);
    for (const u of OVERPASS_DEFAULT_URLS) expect(await breakerRetryAfter(store, breakerName(u), DEC_5)).toBe(0);
    // The same id again: answered from the negative cache, nothing sent.
    const again = await makePass({ parkId: "relation/114690", ageBand: "6-10" }, { ip: ip(), store, fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now: movingDec5() });
    expect(again).toMatchObject({ kind: "error", status: 404, error: { code: "NOT_A_PARK" } });
    expect(r.calls.filter(isOverpass)).toHaveLength(1);
  });

  it("the geometry query starts only after the features query confirmed a named park", async () => {
    const order: string[] = [];
    const r = replayWith((c) => {
      if (isOverpass(c)) order.push(isGeometry(c) ? "geometry" : "features");
      return undefined;
    });
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: ip(), fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now: movingDec5() });
    expect(out.kind).toBe("pass");
    expect(order).toEqual(["features", "geometry"]);
  });
});

describe("Q-1-06: our own Overpass slots vs 'OpenStreetMap is busy'", () => {
  const q = "[out:json][timeout:25];node(1);out;";
  it("a low-priority query waits for BOTH slots; a normal query never waits behind it", async () => {
    const store = new MemoryStore();
    const ac = new AbortController();
    const sent: string[] = [];
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      const data = new URLSearchParams(String(init?.body)).get("data") ?? "";
      sent.push(data.includes("node(2)") ? "low" : data.includes("node(3)") ? "normal2" : "normal1");
      if (data.includes("node(1)")) {
        await new Promise<void>((resolve) => ac.signal.addEventListener("abort", () => resolve()));
      }
      return Response.json({ elements: [] });
    };
    const busy = runOverpass(q, { store, fetchImpl, env: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(overpassSlots().active).toBe(1);
    const low = runOverpass(q.replace("node(1)", "node(2)"), { store, fetchImpl, env: {}, priority: "low" });
    await new Promise((r) => setTimeout(r, 600));
    expect(sent).toEqual(["normal1"]); // the low one is still waiting: one slot is in use
    await runOverpass(q.replace("node(1)", "node(3)"), { store, fetchImpl, env: {} });
    expect(sent).toEqual(["normal1", "normal2"]); // a normal query went straight past it
    ac.abort();
    await busy;
    await low;
    expect(sent).toEqual(["normal1", "normal2", "low"]);
  });

  it("no free slot of OUR OWN in time -> 'queue_full' (nothing sent), shown as 'Grass Pass is busy'", async () => {
    const store = new MemoryStore();
    const ac = new AbortController();
    let sent = 0;
    const fetchImpl = async () => {
      sent++;
      await new Promise<void>((resolve) => ac.signal.addEventListener("abort", () => resolve()));
      return Response.json({ elements: [] });
    };
    const a = runOverpass(q, { store, fetchImpl, env: {} });
    const b = runOverpass(q, { store, fetchImpl, env: {} });
    await new Promise((r) => setTimeout(r, 20));
    const err = await runOverpass(q, { store, fetchImpl, env: {}, totalBudgetMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.code).toBe("queue_full");
    expect(err.started).toBe(false);
    expect(sent).toBe(2);
    for (const u of OVERPASS_DEFAULT_URLS) expect(await breakerRetryAfter(store, breakerName(u), Date.now())).toBe(0);
    ac.abort();
    await Promise.all([a, b]);
  });
});

describe("R1-M1: one deadline for every data stage (fake clock)", () => {
  beforeEach(() => {
    disableSavedOsmForTests();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(DEC_5);
  });

  async function run(p: Promise<unknown>, maxMs: number): Promise<number> {
    const t0 = Date.now();
    let done = false;
    void p.finally(() => (done = true));
    while (!done && Date.now() - t0 < maxMs) await vi.advanceTimersByTimeAsync(500);
    return Date.now() - t0;
  }

  it("slow Overpass (answers at 40 s) + hung iNaturalist: iNat is stopped at the deadline and the pass is ready before 85 s", async () => {
    // Built failures: the features answer (real recording) arrives after 40 s; geometry and iNat hang.
    const r = replayWith(async (c) => {
      if (isOverpass(c) && isGeometry(c)) return hang(c);
      if (isOverpass(c)) {
        await new Promise((res) => setTimeout(res, 40_000));
        return undefined;
      }
      if (isInat(c)) return hang(c);
      return undefined;
    });
    const p = makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: ip(), fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV });
    const ms = await run(p, 120_000);
    const out = await p;
    if (!out || (out as { kind: string }).kind !== "pass") throw new Error(`expected a pass, got ${JSON.stringify(out)}`);
    const pass = (out as Extract<Awaited<ReturnType<typeof makePass>>, { kind: "pass" }>).pass;
    expect(ms).toBeLessThan(PASS_DEADLINE_MS);
    expect(pass.sections.wild).toEqual({ status: "unavailable", message: WILD_SLOW_COPY });
    expect(pass.spot).toEqual({ status: "none", message: SPOT_COPY.slow });
    expect(r.calls.filter(isModel)).toHaveLength(1);
    // Our own deadline is not iNaturalist's fault: no iNat breaker.
    expect(await breakerRetryAfter(new MemoryStore(), "inaturalist", Date.now())).toBe(0);
  });

  it("hung Overpass: DATA_TOO_SLOW well before the route's 90 s limit, and no model call", async () => {
    const r = replayWith((c) => (isOverpass(c) ? hang(c) : undefined));
    const p = makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: ip(), fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV });
    const ms = await run(p, 120_000);
    expect(await p).toMatchObject({ kind: "error", status: 504, error: { code: "DATA_TOO_SLOW", message: DATA_TOO_SLOW_COPY } });
    expect(ms).toBeLessThan(PASS_DEADLINE_MS);
    expect(r.calls.filter(isModel)).toHaveLength(0);
    // The deadline is ours: no Overpass breaker opened.
    for (const u of OVERPASS_DEFAULT_URLS) expect(await breakerRetryAfter(new MemoryStore(), breakerName(u), Date.now())).toBe(0);
  });
});

describe("R1-m2 / R2-M1: degraded passes are re-made, but capped", { timeout: 60_000 }, () => {
  it("iNaturalist down -> degraded pass, shown for an hour, one rebuild try, a longer wait after the same failure, then a better one", async () => {
    // A clock that starts on Dec 5 and moves with real time (the 1 req/s slots wait for the next second).
    const start = Date.now();
    let t = DEC_5;
    const now = () => t + (Date.now() - start);
    // Built failure: iNaturalist answers 503 for the first pass.
    let inatDown = true;
    const r = replayWith((c) => (isInat(c) && inatDown ? new Response("down", { status: 503 }) : undefined));
    const d = () => ({ ip: ip(), fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now });
    const first = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, d());
    if (first.kind !== "pass") throw new Error("expected a pass");
    expect(first.pass.sections.wild).toEqual({ status: "unavailable", message: WILD_DOWN_COPY });
    expect(isDegraded(first.pass)).toBe(true);

    t += 10 * 60_000;
    const cached = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, d());
    expect(cached).toMatchObject({ kind: "pass", cached: true });
    const modelCalls = r.calls.filter(isModel).length;

    // Later, iNaturalist is back but the model fails: the degraded pass is still shown (never an error).
    t += DEGRADED_RETRY_SEC * 1000;
    inatDown = false;
    const failing = replayWith((c) => (isModel(c) ? new Response("upstream error", { status: 500 }) : undefined));
    const kept = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ...d(), fetchImpl: failing.fetchImpl, modelFetch: failing.fetchImpl });
    expect(kept).toMatchObject({ kind: "pass", cached: true });
    expect(kept.kind === "pass" && kept.pass.id).toBe(first.pass.id);

    // R2-M1: the rebuild just tried (and failed) is not tried again a minute later (no model call).
    t += 60_000;
    const capped = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, d());
    expect(capped).toMatchObject({ kind: "pass", cached: true });
    expect(r.calls.filter(isModel).length).toBe(modelCalls);
    // Same reasons as last time: the next try waits REPEAT_RETRY_SEC, not just an hour.
    t += DEGRADED_RETRY_SEC * 1000;
    expect(await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, d())).toMatchObject({ kind: "pass", cached: true });
    expect(r.calls.filter(isModel).length).toBe(modelCalls);

    // Model back, after the longer wait: a better pass replaces it under the same id.
    t += REPEAT_RETRY_SEC * 1000;
    const better = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, d());
    if (better.kind !== "pass") throw new Error("expected a pass");
    expect(better.cached).toBe(false);
    expect(better.pass.id).toBe(first.pass.id);
    expect(better.pass.sections.wild.status).not.toBe("unavailable");
    expect(isDegraded(better.pass)).toBe(false);
    expect(r.calls.filter(isModel).length).toBe(modelCalls + 1);
  });

  it("isDegraded: wild down, map busy/slow, October down/slow; an honest empty section is NOT degraded", async () => {
    const out = await makePass(
      { parkId: PARKS.celebration.id, ageBand: "6-10" },
      { ip: ip(), fetchImpl: passReplay().fetchImpl, modelFetch: passReplay().fetchImpl, env: ENV, now: movingDec5() },
    );
    if (out.kind !== "pass") throw new Error("expected a pass");
    const p = out.pass;
    expect(isDegraded(p)).toBe(false); // Celebration: Wild Finds honestly empty (0 species)
    expect(isDegraded({ ...p, sections: { ...p.sections, wild: { status: "unavailable", message: WILD_DOWN_COPY } } })).toBe(true);
    expect(isDegraded({ ...p, spot: { status: "none", message: SPOT_COPY.busy } })).toBe(true);
    expect(isDegraded({ ...p, spot: { status: "none", message: SPOT_COPY.slow } })).toBe(true);
    expect(isDegraded({ ...p, spot: { status: "none", message: SPOT_COPY.noLandmark } })).toBe(false);
    expect(isDegraded({ ...p, october: { status: "unavailable", reason: "iNaturalist was too slow when this pass was made, so there are no monarch counts to show." } })).toBe(true);
    // R2-M1: a reason that would just repeat (our side couldn't read the answer) never triggers a rebuild.
    expect(isDegraded({ ...p, october: { status: "unavailable", reason: OCTOBER_REASONS.badOutput } })).toBe(false);
    expect(OCTOBER_REASONS.badOutput).not.toMatch(/^iNaturalist sent/);
  });

  it("Q-3-03: rebuilds are counted only when they start, so a refused try leaves the day's rebuilds for later", async () => {
    const start = Date.now();
    let t = DEC_5;
    const now = () => t + (Date.now() - start);
    const r = replayWith((c) => (isInat(c) ? new Response("down", { status: 503 }) : undefined));
    const body = { parkId: PARKS.celebration.id, ageBand: "6-10" as const };
    const first = await makePass(body, { ip: ip(), fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now });
    if (first.kind !== "pass") throw new Error("expected a pass");
    t += DEGRADED_RETRY_SEC * 1000 + 1;

    // A client whose per-IP minute share is already used: refused, shown the degraded pass, nothing counted.
    const busy = ip();
    const { hitRateLimit } = await import("@/lib/limits");
    const { getStore } = await import("@/lib/cache/store");
    for (let i = 0; i < 3; i++) await hitRateLimit(getStore("limits"), { name: "pass", key: busy, limit: 3, windowSec: 60, now: now() });
    const before = r.calls.filter(isModel).length;
    for (let i = 0; i < 5; i++) {
      const out = await makePass(body, { ip: busy, fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now });
      expect(out).toMatchObject({ kind: "pass", cached: true });
    }
    expect(r.calls.filter(isModel).length).toBe(before);
    expect(await mayRebuildDegraded(`${PARKS.celebration.id}|6-10|${first.pass.day}`, first.pass, DEGRADED_RETRY_SEC + 1, now())).toBe(true);

    // Another visitor: the rebuild really runs (a model call), and it is the first one counted today.
    const ok = await makePass(body, { ip: ip(), fetchImpl: passReplay().fetchImpl, modelFetch: passReplay().fetchImpl, env: ENV, now });
    if (ok.kind !== "pass") throw new Error("expected a pass");
    expect(ok.cached).toBe(false);
    expect(isDegraded(ok.pass)).toBe(false);
  });

  it("R2-M1: a source that stays down all day costs at most 1 + MAX_DEGRADED_REBUILDS model calls, even if asked every 15 min", async () => {
    const start = Date.now();
    let t = DEC_5;
    const now = () => t + (Date.now() - start);
    // Built failure: iNaturalist answers 503 all day; the model is fine.
    const logs: string[] = [];
    setLogSink((_l, line) => logs.push(line));
    const r = replayWith((c) => (isInat(c) ? new Response("down", { status: 503 }) : undefined));
    const d = () => ({ ip: ip(), fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV, now });
    for (let m = 0; m < 20 * 60; m += 15) {
      t = DEC_5 + m * 60_000;
      const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, d());
      expect(out.kind).toBe("pass");
    }
    // The 20 h cross Chicago midnight, so there are two pass days (two ids): count builds per id.
    const made = new Map<string, number>();
    for (const l of logs) {
      const m = /"event":"pass_made","id":"([^"]+)"/.exec(l);
      if (m) made.set(m[1], (made.get(m[1]) ?? 0) + 1);
    }
    expect(r.calls.filter(isModel).length).toBe([...made.values()].reduce((a, b) => a + b, 0)); // one model call per build
    expect([...made.values()].some((n) => n > 1)).toBe(true); // it did try again
    for (const n of made.values()) expect(n).toBeLessThanOrEqual(1 + MAX_DEGRADED_REBUILDS);
    // A pass that isn't degraded, or is too young, is never rebuilt.
    const fresh = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ...d(), fetchImpl: passReplay().fetchImpl, modelFetch: passReplay().fetchImpl });
    if (fresh.kind !== "pass") throw new Error("expected a pass");
    expect(await mayRebuildDegraded("k", { ...fresh.pass, october: undefined, sections: { ...fresh.pass.sections, wild: { status: "unavailable", message: WILD_DOWN_COPY } } }, 15 * 60, t)).toBe(false);
    expect(degradedReasons({ ...fresh.pass, october: { status: "unavailable", reason: OCTOBER_REASONS.down } })).toContain("october");
  });
});
