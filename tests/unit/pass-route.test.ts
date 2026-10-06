import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LUCKY_COPY } from "@/lib/pool/lucky";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { MemoryStore, resetStores, StoreError } from "@/lib/cache/store";
import { WaiterAbortedError } from "@/lib/cache";
import { setLogSink } from "@/lib/log";
import { loadPass, makePass, passId, passKey, resetPassMaking } from "@/lib/pass/make";
import { PASS_COPY, PassErrorResponseSchema, PassLineSchema, type PassLine } from "@/lib/pass/schema";
import { WILD_DOWN_COPY } from "@/lib/pool/wild";
import { PARKS_COPY } from "@/lib/parks/schema";
import { SPOT_COPY } from "@/lib/spot/types";
import * as route from "@/app/api/pass/route";
import { recordedResponse } from "./support/osm-replay";
import { modelRec, PARKS, passReplay, type Call } from "./support/pass-replay";

const FAKE_KEY = "test-key-not-real";
let n = 0;
const nextIp = () => `203.0.113.${(++n % 250) + 1}`;

function post(body: unknown, headers: Record<string, string> = {}, ip = nextIp()) {
  return new Request("http://localhost:3123/api/pass", {
    method: "POST",
    headers: {
      host: "localhost:3123",
      origin: "http://localhost:3123",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function lines(res: Response): Promise<PassLine[]> {
  expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .map((l) => PassLineSchema.parse(JSON.parse(l)));
}
const final = (ls: PassLine[]) => ls[ls.length - 1];

const connemara = { parkId: PARKS.connemara.id, ageBand: "6-10" as const };
const celebration = { parkId: PARKS.celebration.id, ageBand: "6-10" as const };

let replay: ReturnType<typeof passReplay>;
let restoreLog: () => void;
let logs: string[];
beforeEach(() => {
  resetStores();
  resetPassMaking();
  // These tests exercise the LIVE Overpass path for the example parks (saved answers: osm-snapshot tests).
  disableSavedOsmForTests();
  replay = passReplay();
  vi.stubGlobal("fetch", replay.fetchImpl);
  vi.stubEnv("DO_INFERENCE_API_KEY", FAKE_KEY);
  vi.stubEnv("MODEL_BASE_URL", "");
  vi.stubEnv("MODEL_ID", "");
  vi.stubEnv("AI_DAILY_CAP", "");
  logs = [];
  restoreLog = setLogSink((_l, line) => logs.push(line));
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSavedOsm();
  vi.unstubAllEnvs();
  restoreLog();
});

const modelCalls = (calls: Call[]) => calls.filter((c) => c.host === "inference.do-ai.run");
const isOctoberCall = (c: Call) => /^\/v1\/observations(\/histogram)?$/.test(new URL(c.url).pathname);
/** The Overpass QL sent in a call (form body `data=`). */
const overpassQuery = (c: Call) => new URLSearchParams(String(c.init?.body ?? c.body ?? "")).get("data") ?? "";

describe("POST /api/pass guards (before any limit, cache or upstream)", () => {
  it("exports only the handler plus runtime/maxDuration", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration", "runtime"]);
    expect(route.maxDuration).toBe(90);
    expect(route.runtime).toBe("nodejs");
  });

  it("403 cross-site / other origin, 415 non-JSON, 413 big or chunked body, 400 bad input; zero upstream calls", async () => {
    expect((await route.POST(post(connemara, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await route.POST(post(connemara, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await route.POST(post(connemara, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await route.POST(post({ ...connemara, pad: "x".repeat(3000) }))).status).toBe(413);
    const chunked = new Request("http://localhost:3123/api/pass", {
      method: "POST",
      headers: { host: "localhost:3123", "content-type": "application/json" },
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < 4; i++) c.enqueue(new TextEncoder().encode("x".repeat(1000)));
          c.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect((await route.POST(chunked)).status).toBe(413);
    for (const bad of ["{", { parkId: "way/abc", ageBand: "6-10" }, { parkId: "way/1", ageBand: "5-9" }, { parkId: "way/1;out", ageBand: "6-10" }]) {
      const res = await route.POST(post(bad));
      expect(res.status).toBe(400);
      expect(PassErrorResponseSchema.parse(await res.json()).error.code).toMatch(/BAD_(JSON|INPUT)/);
    }
    expect(replay.calls).toHaveLength(0);
  });
});

describe("POST /api/pass: Connemara (live recordings)", () => {
  it("streams the real steps, then a 7-item pass from the real first answer and its real refill", async () => {
    const res = await route.POST(post(connemara));
    expect(res.status).toBe(200);
    const ls = await lines(res);
    // Content tuning: the first answer keeps 6 of 8, so the one retry is a refill of the missing items.
    expect(ls.filter((l) => l.type === "step").map((l) => (l.type === "step" ? l.step : ""))).toEqual(["map", "wildlife", "clues", "check", "retry", "check"]);
    const steps = ls.filter((l) => l.type === "step").map((l) => (l.type === "step" ? l.text : ""));
    expect(steps[2]).toBe("Writing clues with gemma-4-31B-it (open model)…");
    const f = final(ls);
    if (f.type !== "result") throw new Error(`expected result, got ${f.type}`);
    expect(f.cached).toBe(false);
    const p = f.pass;
    // Content-tuning recording: 9 asked (low-data pool: 8 + 1 spare). One duplicate id and two generic plant
    // clues ("fruit or seeds" only) leave 6, so the refill asks for 2 + 1 spare from the 4 unused items. It
    // keeps 1 (a "round shell" the snail's source never says is dropped, and one name leak): 7 of 8.
    expect(p.items).toHaveLength(7);
    expect(p.target).toBe(8);
    expect(p.removed).toEqual({ notGrounded: 0, other: 5 });
    expect(p.model.attempts).toBe(2);
    expect(p.model.answered).toBe("gemma-4-31B-it");
    expect(p.park).toMatchObject({ id: "way/306191453", name: "Connemara Meadow Preserve" });
    expect(p.sections.wild).toEqual({ status: "ok" });
    expect(p.sections.lucky).toEqual({ status: "off", message: LUCKY_COPY.notConnected });
    expect(p.safetyFiltered).toBeGreaterThanOrEqual(4);
    expect(p.items.map((i) => i.section)).toEqual(["park", "wild", "wild", "wild", "wild", "wild", "wild"]);
    // R2-M5: the grown-up's line is code-written from these items. In this answer the only easy find that stays
    // put is the creek (find 1), so the tip names it and says to stay close.
    expect(p.parentNote).toMatch(/^Start with find 1: it's easy and it stays put, but it's near water, so stay close./);
    for (const i of p.items) expect(i.evidence).toMatch(/· (OpenStreetMap|iNaturalist)$/);
    expect(p.items.some((i) => /^Golden-eye Lichen/.test(i.answer))).toBe(true);

    // Two Overpass queries, two iNaturalist calls plus the three R1-M4 season-check calls ("Flowers and
    // Fruits" counts), two model calls (the first answer and the refill). (In October the S7 monarch box adds two free iNaturalist counts; they
    // are tested with a fixed clock in october.test.ts.)
    // SEC-1-01: the park-features query goes FIRST; the optional Find This Spot geometry query starts only
    // after it confirmed a named park (it then runs alongside the wildlife step).
    const calls = replay.calls.filter((c) => !isOctoberCall(c));
    expect(calls[0].host).toBe("overpass-api.de");
    expect(overpassQuery(calls[0])).not.toContain("out geom");
    expect(calls.map((c) => c.host).sort()).toEqual([
      ...Array<string>(5).fill("api.inaturalist.org"),
      "inference.do-ai.run",
      "inference.do-ai.run",
      "overpass-api.de",
      "overpass-api.de",
    ]);
    expect(calls.filter((c) => new URL(c.url).searchParams.has("term_id"))).toHaveLength(3);
    expect(calls.at(-1)!.host).toBe("inference.do-ai.run");
    expect(replay.calls.filter((c) => overpassQuery(c).includes("out geom"))).toHaveLength(1);
    // Connemara has no single landmark on the map: the exact SPEC 5.4 copy, and the S3 prompt unchanged.
    expect(p.spot).toEqual({ status: "none", message: SPOT_COPY.noLandmark });
    // Key-to-host: the DO key goes only to DO.
    for (const c of replay.calls) {
      const auth = new Headers(c.init?.headers).get("authorization");
      expect(auth).toBe(c.host === "inference.do-ai.run" ? `Bearer ${FAKE_KEY}` : null);
    }
    // The requests sent to the model are exactly the recorded live ones (first call and refill).
    const sent = JSON.parse(modelCalls(replay.calls)[0].body!);
    expect(sent.messages).toEqual(modelRec(PARKS.connemara.slug).request.messages);
    expect(sent.response_format.json_schema.strict).toBe(true);
    const sentRefill = JSON.parse(modelCalls(replay.calls)[1].body!);
    expect(sentRefill.messages).toEqual(modelRec(PARKS.connemara.slug).refill!.request.messages);
    expect(sentRefill.response_format).toEqual(modelRec(PARKS.connemara.slug).refill!.request.response_format);

    // The pass page reads it back from the cache only.
    expect(await loadPass(p.id)).toEqual(p);
    expect(logs.some((l) => l.includes('"event":"pass_checks"') && l.includes('"kept":6') && l.includes('"refill":false'))).toBe(true);
    expect(logs.some((l) => l.includes('"event":"pass_checks"') && l.includes('"kept":1') && l.includes('"refill":true'))).toBe(true);
  });

  it("the same park + age today is answered from the cache: one line, cached:true, no upstream call", async () => {
    await lines(await route.POST(post(connemara)));
    const before = replay.calls.length;
    const res = await route.POST(post(connemara));
    const ls = await lines(res);
    expect(ls).toHaveLength(1);
    const f = final(ls);
    expect(f.type === "result" && f.cached).toBe(true);
    expect(replay.calls.length).toBe(before);
  });

  it("'Make a different pass' makes variants 2 and 3, then says 3 is the most", async () => {
    const ip = nextIp();
    const ids: string[] = [];
    for (const fresh of [false, true, true]) {
      const f = final(await lines(await route.POST(post({ ...connemara, fresh }, {}, ip))));
      if (f.type !== "result") throw new Error(f.type);
      ids.push(f.pass.id);
    }
    expect(ids.map((i) => i.slice(-2))).toEqual(["-1", "-2", "-3"]);
    // Each Connemara build is the first call + its refill (content-tuning recording).
    expect(modelCalls(replay.calls)).toHaveLength(6);
    const res = await route.POST(post({ ...connemara, fresh: true }, {}, nextIp()));
    expect(res.status).toBe(429);
    expect(PassErrorResponseSchema.parse(await res.json()).error).toMatchObject({ code: "VARIANT_LIMIT", message: PASS_COPY.variantLimit });
    expect(modelCalls(replay.calls)).toHaveLength(6);
    // Without "fresh", the latest variant comes back from the cache.
    const again = final(await lines(await route.POST(post(connemara))));
    expect(again.type === "result" && again.pass.variant).toBe(3);
  });

  it("per-IP: 3 new passes a minute, then 429 with Retry-After and no upstream call", async () => {
    const ip = "198.51.100.9";
    for (const ageBand of ["4-6", "6-10", "10-13"] as const) {
      const res = await route.POST(post({ parkId: PARKS.connemara.id, ageBand }, {}, ip));
      expect(res.status).toBe(200);
      expect(final(await lines(res)).type).toBe("result"); // read to the end: no build left running
    }
    const before = replay.calls.length;
    const res = await route.POST(post(celebration, {}, ip));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(PassErrorResponseSchema.parse(await res.json()).error.code).toBe("RATE_LIMITED");
    expect(replay.calls.length).toBe(before);
  });

  it("AI_DAILY_CAP is checked before any upstream call: the next new pass is refused with the paused copy", async () => {
    vi.stubEnv("AI_DAILY_CAP", "1");
    expect(final(await lines(await route.POST(post(connemara)))).type).toBe("result");
    const before = replay.calls.length;
    const res = await route.POST(post(celebration));
    expect(res.status).toBe(429);
    expect(PassErrorResponseSchema.parse(await res.json()).error).toMatchObject({ code: "DAILY_LIMIT", message: PASS_COPY.paused });
    expect(replay.calls.length).toBe(before); // not even Overpass
  });

  it("identical concurrent requests share ONE build (one first call and its refill)", async () => {
    const [a, b] = await Promise.all([route.POST(post(connemara)), route.POST(post(connemara))]);
    const fa = final(await lines(a));
    const fb = final(await lines(b));
    expect(fa.type === "result" && fb.type === "result" && fa.pass.id === fb.pass.id).toBe(true);
    expect(modelCalls(replay.calls)).toHaveLength(2);
  });
});

describe("POST /api/pass: honest empties and failures", () => {
  it("Celebration: 7 of 8 Park Finds, and Wild Finds shows the exact SPEC 5.4 copy", async () => {
    const f = final(await lines(await route.POST(post(celebration))));
    if (f.type !== "result") throw new Error(f.type);
    // Audit R2 recording: 9 asked, all 9 pass every check (counts are whole courts and fields with the map's
    // numbers), 8 are printed; the spare is not counted as removed.
    expect(f.pass.items).toHaveLength(8);
    expect(f.pass.removed).toEqual({ notGrounded: 0, other: 0 });
    expect(modelCalls(replay.calls)).toHaveLength(1);
    expect(f.pass.items.every((i) => i.section === "park")).toBe(true);
    expect(f.pass.sections.wild).toEqual({
      status: "empty",
      message: "No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist.",
    });
    expect(f.pass.dataCheckedAt.inat).not.toBeNull();
    // Zero species -> no taxa call (the empty-id guard).
    expect(replay.calls.filter((c) => c.url.includes("/v1/taxa"))).toHaveLength(0);
    // S5: the X is the park's only picnic shelter, the riddle is the open model's (it passed every check),
    // and the shelter is not also a Park Find.
    const spot = f.pass.spot;
    if (spot?.status !== "ok") throw new Error("expected a Find This Spot map");
    expect(spot.target).toEqual({ osmId: "way/536185861", label: "picnic shelter", name: null, answer: "The picnic shelter" });
    expect(spot.riddleBy).toBe("model");
    expect(spot.start).toEqual({ osmId: "way/374628989", label: "parking lot" });
    expect(spot.walk).toEqual({ meters: 140, direction: "south-east" });
    expect(f.pass.items.some((i) => /shelter/i.test(i.answer))).toBe(false);
  });

  it("Overpass busy on every server (real 504 page): the exact busy copy, no iNat or model call", async () => {
    replay = passReplay();
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname.endsWith("/interpreter")) {
        replay.calls.push({ url, host: new URL(url).host, init });
        return recordedResponse("overpass-504-too-busy");
      }
      return replay.fetchImpl(url, init);
    });
    const ls = await lines(await route.POST(post(connemara)));
    const f = final(ls);
    expect(f).toMatchObject({ type: "error", status: 503, error: { code: "OSM_UNAVAILABLE", message: PARKS_COPY.overpassDown } });
    // The park-features query tried every server once; the geometry query only ever hit Overpass too.
    expect(replay.calls.filter((c) => !overpassQuery(c).includes("out geom")).map((c) => c.host)).toEqual(["overpass-api.de", "maps.mail.ru", "overpass.private.coffee"]);
    expect(replay.calls.every((c) => c.url.endsWith("/interpreter"))).toBe(true);
  });

  it("iNaturalist down at Connemara: not enough data for a pass; each section says why; no model call", async () => {
    // Built failure: a 503 from iNaturalist (cannot be recorded on demand).
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
      new URL(url).host === "api.inaturalist.org" ? new Response("busy", { status: 503 }) : replay.fetchImpl(url, init),
    );
    const f = final(await lines(await route.POST(post(connemara))));
    if (f.type !== "empty") throw new Error(f.type);
    expect(f.sections.wild).toEqual({ status: "unavailable", message: WILD_DOWN_COPY });
    expect(f.message).toMatch(/^Not enough real data for a pass at Connemara Meadow Preserve right now/);
    expect(modelCalls(replay.calls)).toHaveLength(0);
  });

  it("model down (built 503s): retried once inside the client, then the SPEC copy + the real park data; nothing cached", async () => {
    replay = passReplay({ model: () => new Response("upstream error", { status: 503 }) });
    vi.stubGlobal("fetch", replay.fetchImpl);
    const f = final(await lines(await route.POST(post(connemara))));
    if (f.type !== "error") throw new Error(f.type);
    expect(f.status).toBe(502);
    expect(f.error.message).toBe("Gemma couldn't write clues right now (the AI service had a problem answering). Your park data is below; try again in a minute.");
    expect(f.parkData?.parkName).toBe("Connemara Meadow Preserve");
    expect(f.parkData?.items.length).toBe(12); // 1 Park Find + 11 describable species (R2-M5)
    expect(f.parkData?.items[0]).toEqual({ section: "park", answer: "Creek or stream (Rowlett Creek)", evidence: "on the park map · OpenStreetMap" });
    expect(modelCalls(replay.calls)).toHaveLength(2);
    expect(await loadPass(passId(PARKS.connemara.id, "6-10", new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }), 1))).toBeNull();
  });

  it("an under-filled answer (built: every quote invented) gets ONE retry, which counts against the AI cap", async () => {
    let call = 0;
    const real = modelRec(PARKS.connemara.slug).response as { choices: { message: { content: string } }[] };
    replay = passReplay({
      model: () => {
        call++;
        if (call > 1) return undefined; // the recorded real answer
        const draft = JSON.parse(real.choices[0].message.content) as { items: { sourceQuote: string }[] };
        for (const i of draft.items) i.sourceQuote = "words that are not in any source text";
        const bad = structuredClone(real);
        bad.choices[0].message.content = JSON.stringify(draft);
        return Response.json(bad);
      },
    });
    vi.stubGlobal("fetch", replay.fetchImpl);
    const ls = await lines(await route.POST(post(connemara)));
    expect(ls.some((l) => l.type === "step" && l.step === "retry")).toBe(true);
    const f = final(ls);
    if (f.type !== "result") throw new Error(f.type);
    // Nothing was kept, so the retry is the whole request again (not a refill): the real first answer, 6 of 8.
    expect(f.pass.items).toHaveLength(6);
    expect(f.pass.model.attempts).toBe(2);
    expect(modelCalls(replay.calls)).toHaveLength(2);
    expect(logs.filter((l) => l.includes('"event":"pass_checks"'))).toHaveLength(2);
  });

  it("store down -> 503 and nothing upstream", async () => {
    const broken = new MemoryStore();
    broken.incr = async () => {
      throw new StoreError("down");
    };
    const out = await makePass(connemara, { ip: "192.0.2.1", store: broken, fetchImpl: replay.fetchImpl });
    expect(out).toMatchObject({ kind: "error", status: 503, error: { code: "STORE_UNAVAILABLE" } });
    expect(replay.calls).toHaveLength(0);
  });
});

describe("a client that leaves does not cancel the paid model call", () => {
  it("the model call finishes (its signal never aborts), is charged once, and the next request is a cache hit", async () => {
    let modelSignalAborted = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    replay = passReplay({
      model: async (c) => {
        c.init?.signal?.addEventListener("abort", () => (modelSignalAborted = true));
        await gate;
        return undefined; // then the recorded real answer
      },
    });
    const client = new AbortController();
    const steps: string[] = [];
    const first = makePass(connemara, {
      ip: "192.0.2.50",
      signal: client.signal,
      fetchImpl: replay.fetchImpl,
      modelFetch: replay.fetchImpl,
      onStep: (s) => {
        steps.push(s.step);
        if (s.step === "clues") queueMicrotask(() => client.abort());
      },
    });
    await expect(first).rejects.toBeInstanceOf(WaiterAbortedError);
    release();
    // Let the pinned build finish and fill the cache.
    for (let i = 0; i < 400 && !(await loadPass(passId(PARKS.connemara.id, "6-10", new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }), 1))); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(modelSignalAborted).toBe(false);
    const again = await makePass(connemara, { ip: "192.0.2.51", fetchImpl: replay.fetchImpl, modelFetch: replay.fetchImpl });
    expect(again).toMatchObject({ kind: "pass", cached: true });
    // One build: the gated first call and its refill (Connemara's real first answer keeps 6 of 8).
    expect(modelCalls(replay.calls)).toHaveLength(2);
    expect(steps).toContain("clues");
  }, 15_000);

  it("pass key is park | age band | Chicago day", () => {
    expect(passKey("way/1", "6-10", Date.UTC(2026, 9, 6, 4, 30))).toBe("way/1|6-10|2026-10-05");
    expect(passId("way/306191453", "10-13", "2026-10-05", 2)).toBe("w306191453-10to13-20261005-2");
  });
});
