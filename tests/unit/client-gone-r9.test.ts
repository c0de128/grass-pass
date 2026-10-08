/**
 * Round 9 (Q-9-01): every client leaves BEFORE the paid steps (Lucky Finds searches, the model call). The build stops:
 * no SerpApi search, no model reservation or call, no saved pass, and no "too slow" note blamed on iNaturalist or
 * OpenStreetMap for a pass nobody waited for. A pass already past the model call still finishes and is cached
 * (tests/unit/pass-route.test.ts "a client that leaves does not cancel the paid model call").
 *
 * Every upstream answer is a real recording (tests/unit/support/pass-replay.ts); SerpApi is never answered here, so
 * any search that is sent is counted (and would fail).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WaiterAbortedError } from "@/lib/cache";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { loadPass, makePass, passId, resetPassMaking } from "@/lib/pass/make";
import { WILD_SLOW_COPY } from "@/lib/ai/build-pass";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { SPOT_COPY } from "@/lib/spot/types";
import type { PassStep } from "@/lib/pass/schema";
import { PARKS, passReplay, type Call } from "./support/pass-replay";
import { primeAccountCookies } from "./support/session";

const FAKE_KEY = "test-key-not-real"; // gitleaks:allow (dummy test value)
const FAKE_SERP = "test-serpapi-not-real"; // gitleaks:allow (dummy test value)
let n = 0;
const ip = () => `198.18.9.${(++n % 250) + 1}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const isModel = (c: Call) => c.host === "inference.do-ai.run";
const isSerp = (c: Call) => c.host.endsWith("serpapi.com");
const isAiReserve = (line: string) => line.includes("ai-calls");

let logs: string[];
let restoreLog: () => void;
beforeAll(() => primeAccountCookies(50));
beforeEach(() => {
  resetStores();
  resetPassMaking();
  vi.stubEnv("DO_INFERENCE_API_KEY", FAKE_KEY);
  vi.stubEnv("MODEL_BASE_URL", "");
  vi.stubEnv("MODEL_ID", "");
  vi.stubEnv("AI_DAILY_CAP", "");
  vi.stubEnv("SERPAPI_API_KEY", FAKE_SERP);
  logs = [];
  restoreLog = setLogSink((_l, line) => logs.push(line));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetSavedOsm();
  restoreLog();
});

/** Wait until the stopped build has logged its stop (or the pass, which would be the bug). */
async function settled(): Promise<void> {
  for (let i = 0; i < 300 && !logs.some((l) => l.includes("pass_stopped_client_gone") || l.includes("pass_made") || l.includes("pass_not_made")); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  // Anything still queued (a late search or model call would show up here).
  await new Promise((r) => setTimeout(r, 50));
}

async function leaveAt(step: PassStep, park: { id: string }) {
  const replay = passReplay();
  vi.stubGlobal("fetch", replay.fetchImpl);
  const client = new AbortController();
  const p = makePass(
    { parkId: park.id, ageBand: "6-10" },
    {
      ip: ip(),
      signal: client.signal,
      fetchImpl: replay.fetchImpl,
      modelFetch: replay.fetchImpl,
      onStep: (s) => {
        if (s.step === step) queueMicrotask(() => client.abort());
      },
    },
  );
  await expect(p).rejects.toBeInstanceOf(WaiterAbortedError);
  await settled();
  return replay;
}

describe("Q-9-01: a client that leaves before the paid steps stops the build", () => {
  for (const savedOsm of [true, false]) {
    it(`leave at the "map" step (saved OSM ${savedOsm ? "on" : "off"}): 0 model calls, 0 SerpApi, no saved pass, no "too slow" pass`, async () => {
      if (!savedOsm) disableSavedOsmForTests();
      const replay = await leaveAt("map", PARKS.celebration);
      expect(replay.calls.filter(isModel)).toHaveLength(0);
      expect(replay.calls.filter(isSerp)).toHaveLength(0);
      expect(logs.some((l) => l.includes("model_call"))).toBe(false);
      expect(logs.some((l) => l.includes("pass_made"))).toBe(false);
      expect(await loadPass(passId(PARKS.celebration.id, "6-10", today(), 1))).toBeNull();
    });
  }

  it(`leave at the "wildlife" step: still 0 model calls and no saved pass`, async () => {
    const replay = await leaveAt("wildlife", PARKS.celebration);
    expect(replay.calls.filter(isModel)).toHaveLength(0);
    expect(logs.some((l) => l.includes("pass_made"))).toBe(false);
    expect(logs.filter(isAiReserve).some((l) => l.includes("quota_alert"))).toBe(false);
    expect(await loadPass(passId(PARKS.celebration.id, "6-10", today(), 1))).toBeNull();
  });

  it("the next visitor gets a fresh pass, not a saved one that blames iNaturalist or OpenStreetMap for being slow", async () => {
    await leaveAt("map", PARKS.celebration);
    vi.stubEnv("SERPAPI_API_KEY", "");
    const replay = passReplay();
    vi.stubGlobal("fetch", replay.fetchImpl);
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: ip(), fetchImpl: replay.fetchImpl, modelFetch: replay.fetchImpl });
    if (out.kind !== "pass") throw new Error(`expected a pass, got ${JSON.stringify(out).slice(0, 300)}`);
    expect(out.cached).toBe(false);
    expect(out.pass.sections.wild).not.toEqual({ status: "unavailable", message: WILD_SLOW_COPY });
    expect(out.pass.spot).not.toEqual({ status: "none", message: SPOT_COPY.slow });
    expect(replay.calls.filter(isModel).length).toBeGreaterThan(0);
  }, 15_000);
});
