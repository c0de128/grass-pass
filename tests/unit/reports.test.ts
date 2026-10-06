/**
 * Item reports (Kevin, 2026-10-06): one per account per item per day, the 30-day "didn't find" rule, the
 * "not safe" hide after 2 different accounts, the 90-day expiry, the pool exclusion in a real build, and
 * POST /api/report's guards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStore, MemoryStore, resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { resetPassMaking } from "@/lib/pass/make";
import { withoutReported } from "@/lib/ai/build-pass";
import {
  excludedRefs,
  exclusionReason,
  NOT_SAFE_COUNTER,
  parkReportStats,
  recordItemReport,
  REPORT_COPY,
  statsFromHash,
  type ReportKind,
} from "@/lib/reports";
import { forgetReportStats, passItemStats } from "@/lib/reports/stats";
import { PassLineSchema, type Pass } from "@/lib/pass/schema";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import * as passRoute from "@/app/api/pass/route";
import * as reportRoute from "@/app/api/report/route";
import { PARKS, passReplay, type Call } from "./support/pass-replay";
import { judgeCookie, newAccountCookie } from "./support/session";

const DAY = 24 * 3600 * 1000;
const PARK = "way/306191453";
const T0 = Date.parse("2026-10-06T17:00:00Z");

async function report(store: MemoryStore, ref: string, kind: ReportKind, account: string, now = T0) {
  return recordItemReport(store, { parkId: PARK, ref, kind, account, now });
}

describe("recording reports", () => {
  let logs: string[];
  let restore: () => void;
  beforeEach(() => {
    logs = [];
    restore = setLogSink((_l, line) => logs.push(line));
  });
  afterEach(() => restore());

  it("one report per account per item per Chicago day (any kind); the next day counts again", async () => {
    const s = new MemoryStore();
    expect(await report(s, "inat-1", "found", "a:1")).toEqual({ status: "counted" });
    expect(await report(s, "inat-1", "notfound", "a:1")).toEqual({ status: "duplicate" });
    expect(await report(s, "inat-2", "found", "a:1")).toEqual({ status: "counted" });
    expect(await report(s, "inat-1", "found", "a:2")).toEqual({ status: "counted" });
    expect(await report(s, "inat-1", "found", "a:1", T0 + DAY)).toEqual({ status: "counted" });
    const st = await parkReportStats(s, PARK, T0 + DAY);
    expect(st.get("inat-1")).toEqual({ found: 3, notFound: 0, unsafe: 0, hidden: false });
  });

  it("'didn't find' leaves an item out only with >= 3 reports AND > 60% of its last-30-day reports", () => {
    const st = (found: number, notFound: number) => ({ found, notFound, unsafe: 0, hidden: false });
    expect(exclusionReason(st(0, 2))).toBeNull();
    expect(exclusionReason(st(0, 3))).toBe("not_found");
    expect(exclusionReason(st(2, 3))).toBeNull(); // exactly 60%: not more than
    expect(exclusionReason(st(1, 3))).toBe("not_found"); // 75%
    expect(exclusionReason(st(10, 4))).toBeNull();
    expect(exclusionReason({ ...st(5, 0), hidden: true })).toBe("not_safe");
  });

  it("only the last 30 days count; reports older than 90 days are deleted", async () => {
    const s = new MemoryStore();
    for (const [i, acct] of ["a:1", "a:2", "a:3"].entries()) await report(s, "osm-bench", "notfound", acct, T0 - (31 + i) * DAY);
    let ex = excludedRefs(await parkReportStats(s, PARK, T0));
    expect(ex.has("osm-bench")).toBe(false); // 31-33 days ago: outside the window
    for (const acct of ["a:4", "a:5", "a:6"]) await report(s, "osm-bench", "notfound", acct, T0 - 2 * DAY);
    ex = excludedRefs(await parkReportStats(s, PARK, T0));
    expect(ex.get("osm-bench")).toBe("not_found");
    // A report 95 days later prunes everything older than 90 days from the park's hash.
    await report(s, "osm-other", "found", "a:7", T0 + 95 * DAY);
    const fields = Object.keys(await s.hashGetAll(`rep:{${PARK}}:h`));
    expect(fields).toEqual([`osm-other|found|${new Date(T0 + 95 * DAY).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).replace(/-/g, "")}`]);
  });

  it("'not safe' from 2 DIFFERENT accounts hides the item at once, logs it and counts it for Kevin", async () => {
    const s = new MemoryStore();
    await report(s, "inat-9", "unsafe", "a:1");
    expect(excludedRefs(await parkReportStats(s, PARK, T0)).has("inat-9")).toBe(false);
    // The same account again the next day is still one account.
    await report(s, "inat-9", "unsafe", "a:1", T0 + DAY);
    expect(excludedRefs(await parkReportStats(s, PARK, T0 + DAY)).has("inat-9")).toBe(false);
    await report(s, "inat-9", "unsafe", "a:2", T0 + DAY);
    expect(excludedRefs(await parkReportStats(s, PARK, T0 + DAY)).get("inat-9")).toBe("not_safe");
    expect(logs.some((l) => l.includes('"event":"report_item_hidden"') || l.includes("report_item_hidden"))).toBe(true);
    expect(logs.join("\n")).not.toContain("a:2"); // never the account key in the logs
    expect(Number(await s.get(NOT_SAFE_COUNTER))).toBe(1);
    // A third account does not hide it twice.
    await report(s, "inat-9", "unsafe", "a:3", T0 + DAY);
    expect(Number(await s.get(NOT_SAFE_COUNTER))).toBe(1);
    // The hide lasts 90 days.
    expect(excludedRefs(await parkReportStats(s, PARK, T0 + 80 * DAY)).get("inat-9")).toBe("not_safe");
    expect(excludedRefs(await parkReportStats(s, PARK, T0 + 95 * DAY)).has("inat-9")).toBe(false);
  });

  it("stats ignore fields that aren't ours", () => {
    const st = statsFromHash({ "inat-1|found|20261006": "2", "BAD REF|found|20261006": "5", "inat-1|weird|20261006": "3", "inat-1|found|x": "1", "inat-2|hide": "20261006" }, T0);
    expect(st.get("inat-1")).toEqual({ found: 2, notFound: 0, unsafe: 0, hidden: false });
    expect(st.get("inat-2")?.hidden).toBe(true);
    expect(st.has("BAD REF")).toBe(false);
  });

  it("withoutReported drops excluded pool ids and keeps everything else", () => {
    const pool = { items: [{ id: "a" }, { id: "b" }] as never[], state: "x" };
    expect(withoutReported(pool, new Set(["a"])).items).toEqual([{ id: "b" }]);
    expect(withoutReported(pool, new Set())).toBe(pool);
    expect(withoutReported(pool, undefined)).toBe(pool);
  });
});

// ---------- through the routes ----------

let n = 0;
const nextIp = () => `198.18.1.${(++n % 250) + 1}`;
const jsonPost = (path: string, body: unknown, cookie: string | null, extra: Record<string, string> = {}, ip = nextIp()) =>
  new Request(`http://localhost:3123${path}`, {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      host: "localhost:3123",
      origin: "http://localhost:3123",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...extra,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function makePassAs(cookie: string, body: Record<string, unknown> = { parkId: PARKS.connemara.id, ageBand: "6-10" }): Promise<Pass> {
  const text = await (await passRoute.POST(jsonPost("/api/pass", body, cookie))).text();
  const last = PassLineSchema.parse(JSON.parse(text.trim().split("\n").at(-1)!));
  if (last.type !== "result") throw new Error(`no pass: ${text.slice(0, 300)}`);
  return last.pass;
}

describe("POST /api/report and the pool step", () => {
  let replay: ReturnType<typeof passReplay>;
  let restoreLog: () => void;
  beforeEach(() => {
    resetStores();
    resetPassMaking();
    forgetReportStats();
    disableSavedOsmForTests();
    replay = passReplay();
    vi.stubGlobal("fetch", replay.fetchImpl);
    vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
    vi.stubEnv("MODEL_BASE_URL", "");
    vi.stubEnv("MODEL_ID", "");
    restoreLog = setLogSink(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetSavedOsm();
    restoreLog();
  });

  it("new passes carry each find's pool id (ref)", async () => {
    const pass = await makePassAs((await newAccountCookie()).cookie);
    expect(pass.items.length).toBeGreaterThan(0);
    for (const it of pass.items) expect(it.ref).toMatch(/^(osm|inat|lucky)-[a-z0-9-]+$/);
  });

  it("guards: cross-site 403, text 415, signed out 401, bad kind 400, unknown item 404", async () => {
    const a = await newAccountCookie();
    const pass = await makePassAs(a.cookie);
    const ref = pass.items[0].ref!;
    const body = { passId: pass.id, ref, kind: "found" };
    expect((await reportRoute.POST(jsonPost("/api/report", body, a.cookie, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await reportRoute.POST(jsonPost("/api/report", body, a.cookie, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await reportRoute.POST(jsonPost("/api/report", body, a.cookie, { "content-type": "text/plain" }))).status).toBe(415);
    const anon = await reportRoute.POST(jsonPost("/api/report", body, null));
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as { error: { code: string } }).error.code).toBe("SIGN_IN_REQUIRED");
    expect((await reportRoute.POST(jsonPost("/api/report", { ...body, kind: "great" }, a.cookie))).status).toBe(400);
    expect((await reportRoute.POST(jsonPost("/api/report", { ...body, ref: "inat-999999999" }, a.cookie))).status).toBe(404);
    expect((await reportRoute.POST(jsonPost("/api/report", { ...body, passId: "w1-6to10-20261006-1" }, a.cookie))).status).toBe(404);
  });

  it("counted, then 'already reported today'; the signed-in pass page shows the real count", async () => {
    const a = await newAccountCookie();
    const pass = await makePassAs(a.cookie);
    const ref = pass.items[0].ref!;
    const r1 = await reportRoute.POST(jsonPost("/api/report", { passId: pass.id, ref, kind: "found" }, a.cookie));
    expect(await r1.json()).toEqual({ status: "counted", message: REPORT_COPY.thanks });
    const r2 = await reportRoute.POST(jsonPost("/api/report", { passId: pass.id, ref, kind: "notfound" }, a.cookie));
    expect(await r2.json()).toEqual({ status: "duplicate", message: REPORT_COPY.duplicate });
    expect((await passItemStats(pass))[ref]).toEqual({ found: 1, notFound: 0 });
    // Items nobody reported show nothing (never a zero or a made-up number).
    expect(Object.keys(await passItemStats(pass))).toEqual([ref]);
  });

  it("reports are rate limited per account (30 an hour)", async () => {
    const a = await newAccountCookie();
    const pass = await makePassAs(a.cookie);
    const ref = pass.items[0].ref!;
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await reportRoute.POST(jsonPost("/api/report", { passId: pass.id, ref, kind: "found" }, a.cookie))).status;
    expect(last).toBe(429);
  });

  it("the judge demo is ONE account: two judges can't hide an item on their own", async () => {
    const a = await newAccountCookie();
    const pass = await makePassAs(a.cookie);
    const ref = pass.items[0].ref!;
    const j1 = await judgeCookie();
    const j2 = await judgeCookie();
    expect(await (await reportRoute.POST(jsonPost("/api/report", { passId: pass.id, ref, kind: "unsafe" }, j1.cookie))).json()).toMatchObject({ status: "counted" });
    expect(await (await reportRoute.POST(jsonPost("/api/report", { passId: pass.id, ref, kind: "unsafe" }, j2.cookie))).json()).toMatchObject({ status: "duplicate" });
    expect(excludedRefs(await parkReportStats(getStore("limits"), pass.park.id, Date.now())).has(ref)).toBe(false);
  });

  it("a find hidden by 2 'not safe' reports is left out of the next new pass for that park: the model never sees it", async () => {
    const a = await newAccountCookie();
    const pass = await makePassAs(a.cookie);
    const ref = pass.items.find((i) => i.section === "park")?.ref ?? pass.items[0].ref!;
    const sourceTag = `<source id="${ref}"`;
    const promptText = (c: Call) => (JSON.parse(c.body ?? "{}") as { messages: { content: string }[] }).messages.map((m) => m.content).join("\n");
    // Control: the first pass's prompt did offer it.
    expect(replay.calls.filter((c) => c.host === "inference.do-ai.run").some((c) => promptText(c).includes(sourceTag))).toBe(true);
    for (const c of [await newAccountCookie(), await newAccountCookie()]) {
      await reportRoute.POST(jsonPost("/api/report", { passId: pass.id, ref, kind: "unsafe" }, c.cookie));
    }
    const before = replay.calls.length;
    const next = await makePassAs((await newAccountCookie()).cookie, { parkId: PARKS.connemara.id, ageBand: "6-10", fresh: true });
    expect(next.items.map((i) => i.ref)).not.toContain(ref);
    const prompts = replay.calls.slice(before).filter((c: Call) => c.host === "inference.do-ai.run");
    expect(prompts.length).toBeGreaterThan(0);
    for (const c of prompts) expect(promptText(c)).not.toContain(sourceTag);
  });
});
