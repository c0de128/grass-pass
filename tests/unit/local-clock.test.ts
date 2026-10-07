/**
 * Judge G2 (round 6): the longer clock for a model on this computer. Off by default; never for a hosted model; never
 * on a Vercel deploy; and the page is told how long to wait.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isLocalModel, LOCAL_MODEL_TIMEOUT_MAX_MS, LOCAL_PASS_DEADLINE_MAX_MS, localModelClock } from "@/lib/pass/local-clock";
import { MAX_MODEL_TIMEOUT_MS } from "@/lib/model";
import { LOCAL_WAIT_COPY, localTimeoutCopy } from "@/components/pass/usePassRequest";
import { PassLineSchema, type PassLine } from "@/lib/pass/schema";
import { resetStores } from "@/lib/cache/store";
import { resetPassMaking } from "@/lib/pass/make";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { setLogSink } from "@/lib/log";
import * as route from "@/app/api/pass/route";
import { nextAccountCookie, primeAccountCookies } from "./support/session";
import { PARKS, passReplay } from "./support/pass-replay";

const OLLAMA = "http://localhost:11434/v1";

describe("localModelClock", () => {
  it("is off by default, and for every hosted model (production is unaffected)", () => {
    expect(localModelClock({})).toBeNull();
    expect(localModelClock({ DO_INFERENCE_API_KEY: "k" })).toBeNull();
    // DigitalOcean (the default) even with the setting
    expect(localModelClock({ LOCAL_MODEL_TIMEOUT_MS: "300000" })).toBeNull();
    expect(localModelClock({ MODEL_BASE_URL: "https://inference.do-ai.run/v1", LOCAL_MODEL_TIMEOUT_MS: "300000" })).toBeNull();
    expect(localModelClock({ MODEL_BASE_URL: "https://api.example.com/v1", MODEL_API_KEY: "k", LOCAL_MODEL_TIMEOUT_MS: "300000" })).toBeNull();
    // A look-alike host is not this computer
    expect(localModelClock({ MODEL_BASE_URL: "https://localhost.evil.test/v1", LOCAL_MODEL_TIMEOUT_MS: "300000" })).toBeNull();
    // Local, but not switched on
    expect(localModelClock({ MODEL_BASE_URL: OLLAMA })).toBeNull();
    expect(localModelClock({ MODEL_BASE_URL: OLLAMA, LOCAL_MODEL_TIMEOUT_MS: "" })).toBeNull();
    expect(localModelClock({ MODEL_BASE_URL: OLLAMA, LOCAL_MODEL_TIMEOUT_MS: "abc" })).toBeNull();
    // Not longer than the normal limit: nothing to change
    expect(localModelClock({ MODEL_BASE_URL: OLLAMA, LOCAL_MODEL_TIMEOUT_MS: String(MAX_MODEL_TIMEOUT_MS) })).toBeNull();
  });

  it("never on a Vercel deploy", () => {
    expect(localModelClock({ MODEL_BASE_URL: OLLAMA, LOCAL_MODEL_TIMEOUT_MS: "300000", VERCEL: "1" })).toBeNull();
  });

  it("local + switched on: the call, refill, pass and page waits", () => {
    expect(isLocalModel({ MODEL_BASE_URL: OLLAMA })).toBe(true);
    expect(isLocalModel({ MODEL_BASE_URL: "http://127.0.0.1:8080/v1" })).toBe(true);
    expect(localModelClock({ MODEL_BASE_URL: OLLAMA, LOCAL_MODEL_TIMEOUT_MS: "270000" })).toEqual({
      modelTimeoutMs: 270_000,
      refillTimeoutMs: 180_000,
      passDeadlineMs: 600_000,
      clientWaitMs: 610_000,
    });
    expect(localModelClock({ MODEL_BASE_URL: OLLAMA, LOCAL_MODEL_TIMEOUT_MS: "120000", LOCAL_PASS_DEADLINE_MS: "400000" })?.passDeadlineMs).toBe(400_000);
    // The pass always leaves room for one whole call
    expect(localModelClock({ MODEL_BASE_URL: OLLAMA, LOCAL_MODEL_TIMEOUT_MS: "120000", LOCAL_PASS_DEADLINE_MS: "1000" })?.passDeadlineMs).toBe(150_000);
  });

  it("is capped (10 min a call, 20 min a pass)", () => {
    const c = localModelClock({ MODEL_BASE_URL: OLLAMA, LOCAL_MODEL_TIMEOUT_MS: "99999999", LOCAL_PASS_DEADLINE_MS: "99999999" })!;
    expect(c.modelTimeoutMs).toBe(LOCAL_MODEL_TIMEOUT_MAX_MS);
    expect(c.passDeadlineMs).toBe(LOCAL_PASS_DEADLINE_MAX_MS);
    expect(PassLineSchema.safeParse({ type: "clock", local: true, waitMs: c.clientWaitMs }).success).toBe(true);
  });

  it("page copy: says a model on this computer is slow, and the real wait", () => {
    expect(LOCAL_WAIT_COPY).toMatch(/A model on this computer can take a few minutes/);
    expect(localTimeoutCopy(610_000)).toMatch(/^This is taking longer than 10 minutes, so we stopped waiting\./);
    expect(localTimeoutCopy(60_000)).toMatch(/longer than 1 minute,/);
  });
});

describe("POST /api/pass with a model on this computer", () => {
  beforeAll(() => primeAccountCookies(20));
  let replay: ReturnType<typeof passReplay>;
  let restoreLog: () => void;
  beforeEach(() => {
    resetStores();
    resetPassMaking();
    disableSavedOsmForTests();
    replay = passReplay();
    // The local server answers like the recorded model (same OpenAI-compatible API): reuse the recordings.
    vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.host === "localhost:11434") return replay.fetchImpl(`https://inference.do-ai.run${u.pathname}`, init);
      return replay.fetchImpl(String(url), init);
    });
    vi.stubEnv("DO_INFERENCE_API_KEY", "");
    vi.stubEnv("MODEL_BASE_URL", OLLAMA);
    vi.stubEnv("MODEL_ID", "");
    vi.stubEnv("AI_DAILY_CAP", "");
    vi.stubEnv("VERCEL", "");
    restoreLog = setLogSink(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSavedOsm();
    vi.unstubAllEnvs();
    restoreLog();
  });

  const post = () =>
    new Request("http://localhost:3123/api/pass", {
      method: "POST",
      headers: {
        cookie: nextAccountCookie(),
        host: "localhost:3123",
        origin: "http://localhost:3123",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.77",
      },
      body: JSON.stringify({ parkId: PARKS.celebration.id, ageBand: "6-10" }),
    });
  const lines = async (res: Response): Promise<PassLine[]> =>
    (await res.text())
      .trim()
      .split("\n")
      .map((l) => PassLineSchema.parse(JSON.parse(l)));

  it("switched on: the first line tells the page to wait the local pass time, then the normal steps and the pass", async () => {
    vi.stubEnv("LOCAL_MODEL_TIMEOUT_MS", "270000");
    const ls = await lines(await route.POST(post()));
    expect(ls[0]).toEqual({ type: "clock", local: true, waitMs: 610_000 });
    expect(ls[1].type).toBe("step");
    expect(ls.filter((l) => l.type === "clock")).toHaveLength(1);
    expect(ls.at(-1)?.type).toBe("result");
  });

  it("not switched on: no clock line (the page keeps its normal 95 s wait)", async () => {
    vi.stubEnv("LOCAL_MODEL_TIMEOUT_MS", "");
    const ls = await lines(await route.POST(post()));
    expect(ls.some((l) => l.type === "clock")).toBe(false);
    expect(ls[0].type).toBe("step");
  });
});
