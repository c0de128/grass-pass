/**
 * Fresh-eyes review 2026-10-08 (reviews/2026-10-08/app-review.md), MAJOR-2 and MINOR-1, through makePass() with every
 * input replayed from live recordings (support/pass-replay.ts, support/serpapi-replay.ts). The iNaturalist 503 is a
 * built failure (it cannot be recorded on demand), as in pass-route.test.ts.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OtherParks } from "@/components/pass/PassMaker";
import { createJsonCache } from "@/lib/cache";
import { getStore, resetStores } from "@/lib/cache/store";
import { isCompletePass } from "@/lib/pass/complete";
import { estimatePrintPx, KID_PRINT_LINE, KID_PRINT_LINE_LONG, likelyOnePage, passPagePrintLine, PRINT_PAGE_PX } from "@/lib/pass/print-size";
import { PassSchema, type Pass } from "@/lib/pass/schema";
import { madeLine } from "@/lib/home/showcase";
import { pinnedPass } from "@/lib/pinned";
import { EXAMPLE_PARKS, exampleStatuses, prewarmIdle, readyExample, resetPrewarm } from "@/lib/prewarm";
import { quotaUsage } from "@/lib/limits";
import { setLogSink } from "@/lib/log";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import { OTHER_PARKS_MAX, otherParksNear } from "@/lib/parks/nearby";
import type { Park } from "@/lib/parks/schema";
import { LUCKY_COPY } from "@/lib/pool/lucky";
import { modelFailure } from "@/lib/ai/build-pass";
import { ModelError, reasonFor } from "@/lib/model";
import { PASS_COPY } from "@/lib/pass/schema";
import { TRIP_TIPS_COPY } from "@/lib/tips/schema";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { JUDGE_QUOTA } from "@/lib/accounts/judge-passes";
import { parseParks } from "@/lib/sources/overpass-parks";
import { fixture } from "./support/osm-replay";
import { PARKS, passReplay } from "./support/pass-replay";
import { serpReplay } from "./support/serpapi-replay";

/** Shaped like keys, NOT real keys. */
const SERP_KEY = "0123456789abcdef".repeat(4);
const ENV = { DO_INFERENCE_API_KEY: "test-key-not-real", SERPAPI_API_KEY: SERP_KEY };

let lines: string[];
let restore: () => void;
beforeEach(() => {
  resetStores();
  resetPassMaking();
  disableSavedOsmForTests();
  lines = [];
  restore = setLogSink((_l, line) => lines.push(line));
});
afterEach(() => {
  restore();
  resetSavedOsm();
  vi.unstubAllEnvs();
});

/** Connemara with iNaturalist down: 1 Park Find and no wildlife, so no pass can be made (a real "not enough data" park). */
function shortParkFetch() {
  const base = passReplay();
  const serp = serpReplay({
    next: async (url, init) => (new URL(url).host === "api.inaturalist.org" ? new Response("busy", { status: 503 }) : base.fetchImpl(url, init)),
  });
  return { base, serp };
}

const usage = (name: string, key: string) => quotaUsage(getStore("limits"), { name, key, period: { kind: "day" }, now: Date.now() });

describe("MAJOR-2: a park without enough data", () => {
  it("sends no SerpApi search and says why in the Lucky section; the headline counts every real find (MINOR-1)", async () => {
    const { base, serp } = shortParkFetch();
    const out = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip: "192.0.2.40", fetchImpl: serp.fetchImpl, modelFetch: base.fetchImpl, env: ENV });
    if (out.kind !== "empty") throw new Error(`expected empty, got ${out.kind}`);
    expect(serp.calls).toHaveLength(0);
    expect(out.sections.lucky).toEqual({ status: "empty", message: LUCKY_COPY.notSearched });
    expect(out.message).toContain("we found 1.");
    expect(base.calls.filter((c) => c.host === "inference.do-ai.run")).toHaveLength(0);
    expect(lines.some((l) => l.includes('"event":"lucky_skipped_short"'))).toBe(true);
  });

  it("does not use one of a signed-in grown-up's 2 passes", async () => {
    const { base, serp } = shortParkFetch();
    const account = { key: "acct-review-1", provider: "github" as const, judge: false };
    const out = await makePass(
      { parkId: PARKS.connemara.id, ageBand: "6-10" },
      { ip: "192.0.2.41", fetchImpl: serp.fetchImpl, modelFetch: base.fetchImpl, env: ENV, requireAccount: true, account },
    );
    expect(out.kind).toBe("empty");
    expect((await usage("acct-new", account.key)).key).toBe(0);
    // The per-IP share still counts (the map and wildlife calls really happened): flood protection stays.
    expect((await usage("pass-new", "192.0.2.41")).key).toBe(1);
    expect(lines.some((l) => l.includes('"event":"account_share_returned"'))).toBe(true);
  });

  it("does not use one of a judge's 3 passes (the shared judge counter is unchanged too)", async () => {
    const { base, serp } = shortParkFetch();
    const ip = "192.0.2.42";
    const account = { key: "judge-demo", provider: "judge" as const, judge: true };
    const out = await makePass({ parkId: PARKS.connemara.id, ageBand: "6-10" }, { ip, fetchImpl: serp.fetchImpl, modelFetch: base.fetchImpl, env: ENV, requireAccount: true, account });
    expect(out.kind).toBe("empty");
    const u = await usage(JUDGE_QUOTA, ip);
    expect([u.global, u.key]).toEqual([0, 0]);
  });

  it("a pass that is made still uses one of the grown-up's passes", async () => {
    const base = passReplay();
    const account = { key: "acct-review-2", provider: "github" as const, judge: false };
    const out = await makePass(
      { parkId: PARKS.connemara.id, ageBand: "6-10" },
      { ip: "192.0.2.43", fetchImpl: base.fetchImpl, modelFetch: base.fetchImpl, env: { DO_INFERENCE_API_KEY: "test-key-not-real" }, requireAccount: true, account },
    );
    expect(out.kind).toBe("pass");
    expect((await usage("acct-new", account.key)).key).toBe(1);
  });
});

// The real Allen TX park list (live Overpass recording, 2026-10-05), as the wizard holds it after a search.
function allenParks(): Park[] {
  const rec = fixture("overpass-parks-allen-tx");
  return parseParks(rec.body, rec._recording.center!).parks;
}

describe("MAJOR-2: the way forward in the wizard", () => {
  it("offers up to 3 other parks from the search, nearest to the failed park first, never the same park or name", () => {
    const parks = allenParks();
    expect(parks.length).toBeGreaterThan(4);
    const from = parks[1];
    const out = otherParksNear(from, [...parks, { ...from, id: "way/1" }]);
    expect(out).toHaveLength(OTHER_PARKS_MAX);
    expect(out.every((o) => o.park.id !== from.id && o.park.name !== from.name)).toBe(true);
    expect(out.map((o) => o.fromM)).toEqual([...out.map((o) => o.fromM)].sort((a, b) => a - b));
    expect(otherParksNear(from, [from])).toEqual([]);
  });

  it("renders the parks as buttons with their distance, plus a way back to search; with no search it says so", () => {
    const parks = allenParks();
    const html = renderToStaticMarkup(<OtherParks from={parks[0]} parks={parks} onPick={() => undefined} onSearch={() => undefined} headingId="h" />);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Try another park nearby");
    expect((html.match(/data-testid="other-park"/g) ?? []).length).toBe(3);
    expect(text).toMatch(/\d+(\.\d)? mi \(\d+(\.\d)? km\) from /);
    expect(text).toContain("Search for a different park");
    expect(html).not.toContain("bigger park nearby:"); // we don't know sizes, so we don't claim them
    const none = renderToStaticMarkup(<OtherParks from={parks[0]} parks={[]} onPick={() => undefined} onSearch={() => undefined} headingId="h" />);
    expect(none).toContain("No data available: there are no other parks from a search on this page to suggest.");
    expect(none).toContain("Search for a different park");
  });
});

/** A real recorded pass from tests/fixtures (its `pass`). */
function recordedPass(name: string): Pass {
  const j = JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8")) as { pass?: unknown; body?: { pass?: unknown } };
  return PassSchema.parse(j.pass ?? j.body?.pass ?? j);
}

describe("MAJOR-3: the one-page promise", () => {
  // PrintFit's own measure (sheet height at 0.91 with every optional line left out), headless Chromium on the live
  // print pages, 2026-10-08. The page holds PRINT_PAGE_PX (971 px).
  const MEASURED: [string, number][] = [
    ["white-rock", 938],
    ["oak-point", 943],
    ["celebration", 896],
  ];

  it("the estimate is within 5 px of the measured sheet for every pinned example, and each fits one page", () => {
    for (const [slug, px] of MEASURED) {
      const pass = pinnedPass(slug)!;
      expect(Math.abs(estimatePrintPx(pass) - px), slug).toBeLessThanOrEqual(5);
      expect(likelyOnePage(pass), slug).toBe(true);
    }
    expect(PRINT_PAGE_PX).toBeCloseTo(971.2, 1);
  });

  it("a long real pass (Arbor Hills, 8 finds with a Lucky Find) is estimated to need 2 pages; the pass page says so", () => {
    const long = recordedPass("pass-arbor-hills-lucky-live");
    expect(likelyOnePage(long)).toBe(false);
    expect(passPagePrintLine(long, "adult line")).toBe(KID_PRINT_LINE_LONG);
    expect(passPagePrintLine(pinnedPass("oak-point")!, "adult line")).toBe(KID_PRINT_LINE);
    // A 13+ sheet has its own fonts and floor: not estimated, its own line.
    const teen = recordedPass("pass-white-rock-13plus-r8-live");
    expect(likelyOnePage(teen)).toBeNull();
    expect(passPagePrintLine(teen, "adult line")).toBe("adult line");
  });

  describe("the example picker prefers a one-page pass", () => {
    beforeEach(() => {
      resetPrewarm();
      vi.stubEnv("PREWARM_EXAMPLES", "0");
    });
    afterEach(async () => {
      await prewarmIdle();
    });

    // Selection logic: a real recorded complete pass (Celebration, Oct 7) saved as White Rock's newest complete pass, with
    // the one-page answer injected (the estimate itself is tested above), so the test doesn't depend on its numbers.
    async function saveAsWhiteRock(pass: Pass, t: number) {
      const passes = createJsonCache({ name: "pass", schema: PassSchema, ttlSec: 30 * 24 * 3600, maxEntries: 10 });
      const entries = createJsonCache({ name: "example-pass", schema: z.object({ passId: z.string(), day: z.string(), generatedAt: z.string() }), ttlSec: 60 * 24 * 3600, maxEntries: 10 });
      await passes.set(pass.id, pass, { now: t });
      await entries.set("white-rock", { passId: pass.id, day: pass.day, generatedAt: pass.generatedAt }, { now: t });
    }
    const newest = () => recordedPass("pass-celebration-complete-live");
    const only = EXAMPLE_PARKS.filter((e) => e.slug === "white-rock");

    it("a newest complete pass that may need 2 pages gives way to the pinned one-page pass, and the card says why", async () => {
      const pass = newest();
      expect(isCompletePass(pass)).toBe(true);
      // The next day (Oct 8, 10 AM CDT), so neither pass is "today's".
      const t = Date.parse("2026-10-08T15:00:00Z");
      await saveAsWhiteRock(pass, t);
      const onePage = (p: Pass) => p.id !== pass.id;
      const [wr] = await exampleStatuses({ now: () => t, examples: only, onePage });
      const pin = pinnedPass("white-rock")!;
      expect(wr.latest?.passId).toBe(pass.id);
      expect(wr.pass?.passId).toBe(pin.id);
      expect(wr.passData?.id).toBe(pin.id);
      expect(wr.longPrint).toBe(true);
      expect(wr.today).toBe(false);
      expect(madeLine(wr, "Oct 7, 10:11 AM CDT")).toContain("looked too long for one printed page, so this one-page pass is shown");
      // The park-search fallback link follows the same rule.
      expect(await readyExample({ now: () => t, examples: only, onePage })).toMatchObject({ href: `/pass/${pin.id}?example=1` });
    });

    it("a newest complete pass that fits one page is still shown (no swap), with the real estimate", async () => {
      const pass = newest();
      expect(likelyOnePage(pass)).toBe(true);
      const t = Date.parse(pass.generatedAt) + 60_000;
      await saveAsWhiteRock(pass, t);
      const [wr] = await exampleStatuses({ now: () => t, examples: only });
      expect(wr.pass?.passId).toBe(pass.id);
      expect(wr.longPrint).toBeUndefined();
    });
  });
});

describe("MINOR-2: quota copy is honest about the prepaid model budget", () => {
  it("no 'free' AI budget anywhere; a used-up balance has no 'for today' and no 1-hour retry", () => {
    expect(PASS_COPY.paused).toBe("Clue writing is paused for today: today's AI budget is used up. Passes made earlier still work.");
    const quota = modelFailure(new ModelError("MODEL_QUOTA", { upstreamStatus: 402 }), "gemma-4-31B-it");
    expect(quota.error.message).toBe(PASS_COPY.modelBudget);
    expect(quota.error.message).not.toMatch(/free|today/i);
    expect(quota.error.retryAfter).toBeUndefined();
    expect(reasonFor("MODEL_QUOTA")).not.toMatch(/free/);
    expect(TRIP_TIPS_COPY.rulesWhy.budget).not.toMatch(/free/);
  });
});
