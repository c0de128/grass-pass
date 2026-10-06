import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExampleParks } from "@/components/ExampleParks";
import { MemoryStore, resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { loadPass, resetPassMaking } from "@/lib/pass/make";
import { EXAMPLE_PARKS, exampleStatuses, prewarmEnabled, prewarmIdle, resetPrewarm, warmExamples, REFRESH_LOCK_SEC, RETRY_NO_MODEL_SEC, type ExamplePark } from "@/lib/prewarm";
import { localDay } from "@/lib/time";
import { searchParks } from "@/lib/parks/search";
import { ExampleLinkSchema } from "@/lib/parks/schema";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { PARKS, passReplay, type Call } from "./support/pass-replay";

// Park data and model answers are the LIVE recordings in tests/fixtures (see support/pass-replay.ts).
// The only built responses are the model 500s in the "failed refresh" tests, which say so.

const EXAMPLES: ExamplePark[] = ["connemara", "celebration"].map((slug) => EXAMPLE_PARKS.find((e) => e.slug === slug)!);
const DAY_MS = 24 * 3600 * 1000;

let replay: ReturnType<typeof passReplay>;
let restoreLog: () => void;
let logs: string[];
const modelCalls = () => replay.calls.filter((c: Call) => c.host === "inference.do-ai.run").length;

function useReplay(r: ReturnType<typeof passReplay>) {
  replay = r;
  vi.stubGlobal("fetch", replay.fetchImpl);
}

beforeEach(() => {
  resetStores();
  resetPassMaking();
  resetPrewarm();
  useReplay(passReplay());
  vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
  vi.stubEnv("MODEL_BASE_URL", "");
  vi.stubEnv("MODEL_ID", "");
  vi.stubEnv("AI_DAILY_CAP", "");
  vi.stubEnv("PREWARM_EXAMPLES", "");
  logs = [];
  restoreLog = setLogSink((_l, line) => logs.push(line));
});
afterEach(async () => {
  await prewarmIdle();
  resetSavedOsm();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  restoreLog();
});

describe("pre-warmed example parks (S8, SWR)", { timeout: 90_000 }, () => {
  it("the examples are real eval parks with confirmed OSM ids", () => {
    // R2-m9: a complete pass (Arbor Hills: Park + Wild Finds + map) first, thin Connemara last.
    expect(EXAMPLE_PARKS.map((e) => e.parkId)).toEqual(["way/38113837", "way/460905359", "way/188145317", "way/306191453"]);
    expect(PARKS.connemara.id).toBe(EXAMPLES[0].parkId);
    expect(PARKS.celebration.id).toBe(EXAMPLES[1].parkId);
  });

  it("PREWARM_EXAMPLES switch", () => {
    expect(prewarmEnabled({})).toBe(true);
    expect(prewarmEnabled({ PREWARM_EXAMPLES: "1" })).toBe(true);
    for (const v of ["0", "off", "false", "NO"]) expect(prewarmEnabled({ PREWARM_EXAMPLES: v })).toBe(false);
  });

  it("warm-up makes one real pass per example (not limited per IP), then the page links them at once with the real time", async () => {
    vi.stubEnv("PASS_PER_IP_PER_MIN", "1");
    vi.stubEnv("PASS_PER_IP_PER_DAY", "1");
    const now = Date.now();
    await warmExamples({ examples: EXAMPLES, now: () => now });
    expect(modelCalls()).toBe(2);
    const statuses = await exampleStatuses({ examples: EXAMPLES, now: () => now + 1000 });
    expect(modelCalls()).toBe(2); // the page never calls upstream for a fresh example
    for (const s of statuses) {
      expect(s.pass).not.toBeNull();
      expect(s.fresh).toBe(true);
      expect(s.refreshing).toBe(false);
      expect(s.missing).toBeNull();
      const pass = await loadPass(s.pass!.passId, now);
      expect(pass?.park.id).toBe(s.example.parkId);
      expect(s.pass!.generatedAt).toBe(pass!.generatedAt);
      expect(s.pass!.day).toBe(localDay(now));
    }
    // A second warm-up the same day makes nothing new.
    await warmExamples({ examples: EXAMPLES, now: () => now + 2000 });
    expect(modelCalls()).toBe(2);
  });

  it("next day: serves yesterday's pass with its real time and starts ONE background refresh per example", async () => {
    const day1 = Date.now();
    await warmExamples({ examples: EXAMPLES, now: () => day1 });
    const before = await exampleStatuses({ examples: EXAMPLES, now: () => day1 });
    const day2 = day1 + DAY_MS;
    const [a, b] = await Promise.all([
      exampleStatuses({ examples: EXAMPLES, now: () => day2 }),
      exampleStatuses({ examples: EXAMPLES, now: () => day2 }),
    ]);
    for (const list of [a, b]) {
      list.forEach((s, i) => {
        expect(s.pass).toEqual(before[i].pass); // still linked, never hidden
        expect(s.fresh).toBe(false);
        expect(s.refreshing).toBe(true);
      });
    }
    await prewarmIdle();
    expect(modelCalls()).toBe(4); // 2 on day 1 + exactly 1 refresh per example on day 2
    const after = await exampleStatuses({ examples: EXAMPLES, now: () => day2 + 1000 });
    for (const s of after) {
      expect(s.fresh).toBe(true);
      expect(s.pass!.day).toBe(localDay(day2));
    }
  });

  it("a failed refresh keeps the old pass, and no instance retries within the lock window", async () => {
    // The shared lock lives in the store; this store's clock is moved by hand for the lock window.
    const lockClock = { t: Date.now() };
    const store = new MemoryStore({ now: () => lockClock.t });
    const day1 = Date.now();
    await warmExamples({ examples: EXAMPLES, now: () => day1, store });
    const old = await exampleStatuses({ examples: EXAMPLES, now: () => day1, store });
    // Built failure (cannot be recorded on demand): the model host answers 500.
    useReplay(passReplay({ model: () => new Response("upstream error", { status: 500 }) }));
    const day2 = day1 + DAY_MS;
    await exampleStatuses({ examples: EXAMPLES, now: () => day2, store });
    await prewarmIdle();
    const failedCalls = modelCalls();
    expect(failedCalls).toBeGreaterThan(0);
    const s = await exampleStatuses({ examples: EXAMPLES, now: () => day2 + 60_000, store });
    expect(s.map((x) => x.pass)).toEqual(old.map((x) => x.pass));
    expect(s.every((x) => !x.fresh && !x.refreshing && x.missing === null)).toBe(true);
    // A new instance (in-process state gone) still respects the shared lock.
    resetPrewarm();
    await exampleStatuses({ examples: EXAMPLES, now: () => day2 + 120_000, store });
    await prewarmIdle();
    expect(modelCalls()).toBe(failedCalls);
    expect(logs.some((l) => l.includes("prewarm_failed"))).toBe(true);
    // After the lock window, one new try.
    lockClock.t += REFRESH_LOCK_SEC * 1000 + 1000;
    await exampleStatuses({ examples: EXAMPLES, now: () => day2 + REFRESH_LOCK_SEC * 1000 + 1000, store });
    await prewarmIdle();
    expect(modelCalls()).toBeGreaterThan(failedCalls);
  });

  it("an OpenStreetMap failure (no model call) may be retried after 10 minutes, not 2 hours", async () => {
    // The live-Overpass path: as if no map data were saved for the example.
    disableSavedOsmForTests();
    const lockClock = { t: Date.now() };
    const store = new MemoryStore({ now: () => lockClock.t });
    // Built failure (cannot be recorded on demand): every Overpass server answers 504; nothing else is called.
    const busy = passReplay();
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname.endsWith("/interpreter")) {
        busy.calls.push({ url, host: new URL(url).host, init });
        return new Response("busy", { status: 504 });
      }
      return busy.fetchImpl(url, init);
    });
    replay = busy;
    const now = Date.now();
    const one = EXAMPLES.slice(0, 1);
    await exampleStatuses({ examples: one, now: () => now, store });
    await prewarmIdle();
    const first = busy.calls.length;
    expect(first).toBeGreaterThan(0);
    expect(modelCalls()).toBe(0);
    resetPrewarm();
    await exampleStatuses({ examples: one, now: () => now, store }); // inside 10 min: no new try
    await prewarmIdle();
    expect(busy.calls.length).toBe(first);
    const tries = () => logs.filter((l) => l.includes('"event":"prewarm_failed"')).length;
    expect(tries()).toBe(1);
    lockClock.t += RETRY_NO_MODEL_SEC * 1000 + 1000;
    await exampleStatuses({ examples: one, now: () => now, store });
    await prewarmIdle();
    // A new try ran (the Overpass breakers, still open, answered it without a request).
    expect(tries()).toBe(2);
  });

  it("no pass yet and the try failed: the page says why (never a made-up pass)", async () => {
    useReplay(passReplay({ model: () => new Response("upstream error", { status: 500 }) }));
    const now = Date.now();
    const first = await exampleStatuses({ examples: EXAMPLES, now: () => now });
    expect(first.every((s) => s.pass === null && s.refreshing)).toBe(true);
    expect(first[0].missing).toBe("No data available yet: it is being made right now (about 15-30 seconds).");
    await prewarmIdle();
    const s = await exampleStatuses({ examples: EXAMPLES, now: () => now + 1000 });
    expect(s[0].pass).toBeNull();
    // Q-1-10: one sentence, one "No data available", a short code-written reason (never the nested message).
    expect(s[0].missing).toBe("No data available yet: the last try didn't work because the AI model didn't write clues.");
  });

  it("R1-B1: a park search that can't answer offers a link to a READY example pass (none ready -> no link)", async () => {
    const down = async () => new Response("bad gateway", { status: 502 }); // built failure: every upstream down
    const before = await searchParks({ kind: "text", q: "Allen TX" }, { ip: "203.0.113.77", store: new MemoryStore(), fetchImpl: down, env: {} });
    expect(before).toMatchObject({ ok: false, error: { code: "GEOCODER_UNAVAILABLE" } });
    expect(!before.ok && before.error.example).toBeUndefined();
    const now = Date.now();
    await warmExamples({ examples: EXAMPLES.slice(0, 1), now: () => now });
    const [s] = await exampleStatuses({ examples: EXAMPLES.slice(0, 1), now: () => now });
    expect(s.pass).not.toBeNull();
    const after = await searchParks({ kind: "text", q: "Plano TX" }, { ip: "203.0.113.78", store: new MemoryStore(), fetchImpl: down, env: {} });
    expect(after).toMatchObject({ ok: false, error: { code: "GEOCODER_UNAVAILABLE", example: { name: EXAMPLES[0].name, href: `/pass/${s.pass!.passId}?example=1` } } });
    expect(!after.ok && ExampleLinkSchema.safeParse(after.error.example).success).toBe(true);
  });

  it("switched off: no upstream call, and the page says so", async () => {
    vi.stubEnv("PREWARM_EXAMPLES", "0");
    await warmExamples({ examples: EXAMPLES });
    const s = await exampleStatuses({ examples: EXAMPLES });
    expect(replay.calls).toHaveLength(0);
    expect(s.every((x) => x.pass === null && x.missing === "No data available yet: example passes are switched off on this server.")).toBe(true);
  });

  it("renders links with the real generated time, and an honest line when there is no pass", async () => {
    const now = Date.now();
    await warmExamples({ examples: EXAMPLES.slice(0, 1), now: () => now });
    vi.stubEnv("PREWARM_EXAMPLES", "0");
    const statuses = await exampleStatuses({ examples: EXAMPLES, now: () => now });
    const html = renderToStaticMarkup(<ExampleParks statuses={statuses} enabled={false} />);
    expect(html).toContain(`href="/pass/${statuses[0].pass!.passId}?example=1"`);
    expect(html).toMatch(/Made [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M C[DS]T/);
    // R1-B1 / ux M1: no dashed failure cards; one line per missing example with a Try again link.
    expect(html).toContain("No data available yet: example passes are switched off on this server.");
    expect(html.match(/No data available/g)).toHaveLength(EXAMPLES.length - 1);
    expect(html).not.toContain("border-dashed");
    // Switched off: nothing to retry, so no button. A failed try (warm-up on) offers ONE "Try again"
    // button below the list (not a link: every link in the list is a ready pass).
    expect(html).not.toContain("Try again");
    const waiting = { ...statuses[1], refreshing: false, missing: "No data available yet: the last try didn't work because OpenStreetMap was busy." };
    const html2 = renderToStaticMarkup(<ExampleParks statuses={[statuses[0], waiting]} enabled />);
    expect(html2).toContain(`${waiting.example.name}:</span> No data available yet: the last try didn&#x27;t work because OpenStreetMap was busy.`);
    expect(html2.match(/Try again/g)).toHaveLength(1);
    expect(html2).toContain('<form action="/" method="get">');
    expect(html2.match(/<a /g)).toHaveLength(1); // only the ready pass
    expect(html).toContain('<h2 id="examples-title"');
  });
});

describe("errors from another bundle's copy of a class still match (instrumentation.ts is bundled separately)", () => {
  it("instanceof works by name for errors thrown by globalThis singletons", async () => {
    const { QueueAbortedError } = await import("@/lib/limits/concurrency");
    const { WaiterAbortedError } = await import("@/lib/cache/inflight");
    const { StoreError } = await import("@/lib/cache/store");
    const { SourceError } = await import("@/lib/sources/common");
    const { ModelError } = await import("@/lib/model");
    for (const [C, name] of [
      [QueueAbortedError, "QueueAbortedError"],
      [WaiterAbortedError, "WaiterAbortedError"],
      [StoreError, "StoreError"],
      [SourceError, "SourceError"],
      [ModelError, "ModelError"],
    ] as const) {
      // Stands in for the same class from the other bundle: an Error with the same name.
      const other = Object.assign(new Error("x"), { name });
      expect(other instanceof C).toBe(true);
      expect(new Error("x") instanceof C).toBe(false);
      expect({ name } instanceof C).toBe(false);
    }
    expect(new QueueAbortedError() instanceof QueueAbortedError).toBe(true);
  });
});
