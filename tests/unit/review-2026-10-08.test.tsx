/**
 * Fresh-eyes review 2026-10-08 (reviews/2026-10-08/app-review.md), MAJOR-2 and MINOR-1, through makePass() with every
 * input replayed from live recordings (support/pass-replay.ts, support/serpapi-replay.ts). The iNaturalist 503 is a
 * built failure (it cannot be recorded on demand), as in pass-route.test.ts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OtherParks } from "@/components/pass/PassMaker";
import { getStore, resetStores } from "@/lib/cache/store";
import { quotaUsage } from "@/lib/limits";
import { setLogSink } from "@/lib/log";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import { OTHER_PARKS_MAX, otherParksNear } from "@/lib/parks/nearby";
import type { Park } from "@/lib/parks/schema";
import { LUCKY_COPY } from "@/lib/pool/lucky";
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
