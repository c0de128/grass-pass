/**
 * S6 end to end through makePass(): Celebration Park with every input replayed from live recordings
 * (OpenStreetMap + iNaturalist + the recorded gemma-4-31B-it answer: support/pass-replay.ts; SerpApi:
 * support/serpapi-replay.ts). Proves the Lucky Finds lookup runs inside a pass build only, is charged and
 * cached, and that review text never reaches the model request.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PassPreview } from "@/components/pass/PassPreview";
import { ParentStub } from "@/components/pass/ParentStub";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { formatTime } from "@/lib/pass/format";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import { PARKS, passReplay } from "./support/pass-replay";
import { serpBody, serpFixture, serpReplay } from "./support/serpapi-replay";

/** Shaped like keys, NOT real keys. */
const SERP_KEY = "fedcba9876543210".repeat(4);
const ENV = { DO_INFERENCE_API_KEY: "test-key-not-real", SERPAPI_API_KEY: SERP_KEY };

const SNIPPETS = ["google-maps-reviews-celebration-park-dog", "google-maps-reviews-celebration-park-bike", "google-maps-reviews-celebration-park-ducks"].flatMap(
  (n) => ((serpBody(serpFixture(n)).reviews as { snippet?: string }[] | undefined) ?? []).map((r) => r.snippet ?? "").filter((s) => s.length >= 25),
);

let lines: string[];
let restore: () => void;
beforeEach(() => {
  resetStores();
  resetPassMaking();
  lines = [];
  restore = setLogSink((_l, line) => lines.push(line));
});
afterEach(() => restore());

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("a Celebration Park pass with Lucky Finds (all real recordings)", () => {
  it("looks up the place and 3 keywords once, offers the dog find to the model without any review text, and caches it", async () => {
    const base = passReplay();
    const serp = serpReplay({ next: base.fetchImpl });
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "192.0.2.10", fetchImpl: serp.fetchImpl, modelFetch: base.fetchImpl, env: ENV });
    if (out.kind !== "pass") throw new Error(`expected a pass, got ${out.kind}`);

    // 1 place search + dogs, bikes and ducks (Celebration has ponds on the map; only dogs reach 3 reviews).
    expect(serp.calls.map((c) => (c.params.engine === "google_maps" ? "maps" : c.params.query))).toEqual(["maps", "dog", "bike", "ducks"]);
    const p = out.pass;
    expect(p.sections.lucky).toEqual({ status: "ok" });
    expect(p.dataCheckedAt.lucky).toEqual(expect.any(String));

    // The model request: the lucky item's fixed text is there; no review text and no SerpApi key anywhere.
    const model = base.calls.filter((c) => c.host === "inference.do-ai.run");
    expect(model.length).toBeGreaterThanOrEqual(1);
    const sent = model.map((c) => c.body ?? "").join("\n");
    expect(sent).toContain('id=\\"lucky-dog\\" section=\\"lucky\\"');
    expect(sent).toContain("Google reviews of this park from the last two years mention dogs");
    for (const s of SNIPPETS) expect(sent).not.toContain(JSON.stringify(s.slice(0, 25)).slice(1, -1));
    expect(sent).not.toContain(SERP_KEY);
    expect(lines.join("\n")).not.toContain(SERP_KEY);

    // The recorded model answer predates S6 (no lucky ids): the pass still prints what passed every check.
    expect(p.items.length).toBeGreaterThanOrEqual(p.target - 1);
    expect(p.items.every((i) => i.section !== "lucky" || i.source === "Google reviews via SerpApi")).toBe(true);

    // The grown-up's parts name the source and the time the counts were made.
    const stub = text(renderToStaticMarkup(<ParentStub pass={p} passUrl="grass-pass.test/pass/x" />));
    expect(stub).toContain(`Lucky Finds: counts of Google reviews via SerpApi (no review text), checked ${formatTime(p.dataCheckedAt.lucky!)}.`);
    const screen = text(renderToStaticMarkup(<PassPreview pass={p} />));
    expect(screen).toContain(`Visitor reviews checked ${formatTime(p.dataCheckedAt.lucky!)} (Google reviews via SerpApi)`);
    expect(screen).toContain("review text is never shown or sent to the AI");

    // A different pass for the same park today: the counts come from the 30-day cache, no new search.
    const before = serp.calls.length;
    const again = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10", fresh: true }, { ip: "192.0.2.10", fetchImpl: serp.fetchImpl, modelFetch: base.fetchImpl, env: ENV });
    expect(again.kind).toBe("pass");
    expect(serp.calls.length).toBe(before);
  });

  it("without a SerpApi key nothing is sent to SerpApi and the stub says 'not connected'", async () => {
    const base = passReplay();
    const serp = serpReplay({ next: base.fetchImpl });
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "192.0.2.11", fetchImpl: serp.fetchImpl, modelFetch: base.fetchImpl, env: { DO_INFERENCE_API_KEY: "test-key-not-real" } });
    if (out.kind !== "pass") throw new Error(out.kind);
    expect(serp.calls).toHaveLength(0);
    expect(out.pass.sections.lucky).toMatchObject({ status: "off", message: expect.stringContaining("not connected") });
    expect(out.pass.dataCheckedAt.lucky).toBeUndefined();
  });
});
