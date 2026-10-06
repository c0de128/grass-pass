/**
 * The 20 eval parks (SPEC 6.4): every case has a real recorded fixture that replays through the
 * app's own source code with no unrecorded request, and the no-AI template baseline obeys the
 * same server checks as a model answer.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MASK, maskNames, sentences, templatePass, templateSentence, cutWords } from "../../evals/baseline";
import {
  createReplayFetch,
  EvalFixtureSchema,
  fixturePath,
  loadCaseData,
  loadCases,
  loadFixture,
  summarize,
  taxaIdsOf,
  trimOverpass,
} from "../../evals/fixture";
import { prettyJson } from "../../evals/json";
import { isGrounded, nameLeak } from "@/lib/ai/validate";
import { blockedBy } from "@/lib/safety/danger-taxa";
import { CLUE_MAX } from "@/lib/ai/schema";

const casesFile = loadCases();
const band = casesFile.ageBand;

describe("eval cases", () => {
  it("lists 20 distinct real parks with OSM ids", () => {
    expect(casesFile.cases).toHaveLength(20);
    expect(new Set(casesFile.cases.map((c) => c.parkId)).size).toBe(20);
    expect(new Set(casesFile.cases.map((c) => c.slug)).size).toBe(20);
    expect(casesFile.cases.map((c) => c.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe.each(casesFile.cases)("fixture for case $n $name", (c) => {
  it("exists, is a live recording with fetch times, and replays with no unrecorded request", async () => {
    expect(existsSync(fixturePath(c.slug)), `No data available: ${c.slug}.json was not recorded`).toBe(true);
    const fx = loadFixture(c.slug);
    expect(EvalFixtureSchema.safeParse(fx).success).toBe(true);
    expect(fx._recording.live).toBe(true);
    expect(fx._recording.parkId).toBe(c.parkId);
    expect(Number.isNaN(Date.parse(fx._recording.fetchedAt))).toBe(false);
    for (const e of fx.exchanges) expect(Number.isNaN(Date.parse(e.fetchedAt))).toBe(false);

    const d = await loadCaseData(fx, band);
    expect(d.misses).toEqual([]);
    expect(d.parkName).not.toBeNull();
    // The summary written at recording time matches what the app reads from the file now.
    expect(summarize(d.features, d.species, fx._recording.summary.taxaRequested)).toEqual(fx._recording.summary);
    // No hard-blocked taxon ever reaches a pool.
    for (const p of d.pool) if (p.taxon) expect(blockedBy(p.taxon)).toBeNull();
  });
});

describe("case profiles (what each case is for)", () => {
  it("1 Connemara is wildlife-rich and can fill a whole pass", async () => {
    const d = await loadCaseData(loadFixture("connemara-meadow-preserve"), band);
    expect(d.dataRich).toBe(true);
    expect(d.wild?.items.length).toBeGreaterThanOrEqual(3);
  });

  it("2 Celebration Park has play features and an honest empty Wild Finds", async () => {
    const d = await loadCaseData(loadFixture("celebration-park"), band);
    expect(d.park?.items.length).toBeGreaterThan(0);
    expect(d.wild?.state.status).toBe("empty");
  });

  it("20 the pocket park takes the no-data path (no pass, so no model call)", async () => {
    const d = await loadCaseData(loadFixture("orchards-park"), band);
    expect(d.mix).toBeNull();
    expect(d.pool.length).toBeLessThan(3);
  });
});

describe("replay", () => {
  it("answers only recorded requests and lists the rest as misses", async () => {
    const fx = loadFixture("celebration-park");
    const r = createReplayFetch(fx);
    await expect(r.fetch("https://api.inaturalist.org/v1/taxa/1", { method: "GET" })).rejects.toThrow(/not in the recorded fixture/);
    expect(r.misses).toEqual(["GET https://api.inaturalist.org/v1/taxa/1"]);
    const species = fx.exchanges.find((e) => e.what === "species_counts")!;
    const res = await r.fetch(species.url, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(species.body);
  });

  it("answers a taxa request for a subset of the recorded ids with exactly those recorded rows", async () => {
    // The app's taxon cache is shared across parks, so a later park can ask for fewer ids than were recorded.
    const fx = loadFixture("connemara-meadow-preserve");
    const taxa = fx.exchanges.find((e) => e.what === "taxa")!;
    const ids = taxaIdsOf(taxa.url)!;
    expect(ids.length).toBeGreaterThan(3);
    const sub = [ids[2], ids[0]];
    const url = taxa.url.replace(/taxa\/[\d,]+/, `taxa/${sub.join(",")}`);
    const r = createReplayFetch(fx);
    const body = (await (await r.fetch(url, { method: "GET" })).json()) as { results: { id: number }[] };
    expect(body.results.map((x) => x.id)).toEqual(sub);
    const recorded = (taxa.body as { results: { id: number }[] }).results;
    expect(body.results[0]).toEqual(recorded.find((x) => x.id === sub[0]));
    // An id that was never recorded is a miss, not an invention.
    await expect(r.fetch(url.replace(/taxa\/[\d,]+/, `taxa/${ids[0]},999999999`), { method: "GET" })).rejects.toThrow();
    expect(r.misses).toHaveLength(1);
  });

  it("trims Overpass answers to what the app reads, keeping the park's position", () => {
    const raw = {
      version: 0.6,
      elements: [
        { type: "way", id: 7, center: { lat: 1, lon: 2 }, tags: { name: "P", leisure: "park", website: "x" } },
        { type: "node", id: 8, lat: 3, lon: 4, tags: { natural: "tree", species: "Quercus" } },
      ],
    };
    expect(trimOverpass(raw, "way/7")).toEqual({
      version: 0.6,
      elements: [
        { type: "way", id: 7, center: { lat: 1, lon: 2 }, tags: { name: "P", leisure: "park" } },
        { type: "node", id: 8, tags: { natural: "tree" } },
      ],
    });
  });

  it("writes deep rows on one line", () => {
    expect(prettyJson({ a: [{ b: 1 }] }, 2)).toBe('{\n "a": [\n  {"b":1}\n ]\n}\n');
  });
});

describe("no-AI template baseline", () => {
  it("splits sentences and masks names, plurals included", () => {
    expect(sentences("One here. Two there! 3 more.")).toEqual(["One here.", "Two there!", "3 more."]);
    expect(maskNames("Basketball courts and a basketball.", ["basketball"])).toBe(`${MASK} courts and a ${MASK}.`);
    expect(maskNames("Hawks fly; a hawk's nest.", ["hawk"])).toBe(`${MASK} fly; a ${MASK} nest.`);
    expect(cutWords("a ".repeat(100).trim(), 20).length).toBeLessThanOrEqual(20);
  });

  it("builds a grounded, name-free, checked pass from the real Connemara pool", async () => {
    const d = await loadCaseData(loadFixture("connemara-meadow-preserve"), band);
    const { draft, result } = templatePass(d.pool, d.mix!);
    expect(draft.items).toHaveLength(d.mix!.n);
    const byId = new Map(d.pool.map((p) => [p.id, p]));
    for (const it of draft.items) {
      const p = byId.get(it.itemId)!;
      expect(isGrounded(it.sourceQuote, p.sourceText)).toBe(true);
      expect(it.clue.length).toBeLessThanOrEqual(CLUE_MAX);
    }
    for (const v of result.items) expect(nameLeak(v.clue, v.item.nameWords)).toBeNull();
    // Each section's minimum is met.
    for (const s of ["park", "wild"] as const) {
      expect(result.items.filter((v) => v.item.section === s).length).toBeGreaterThanOrEqual(Math.min(d.mix!.min[s], 1));
    }
  });

  it("uses the kind description for Park Finds and the summary (not the name) for Wild Finds", async () => {
    const d = await loadCaseData(loadFixture("celebration-park"), band);
    const park = d.pool.find((p) => p.section === "park")!;
    expect(park.sourceText.endsWith(templateSentence(park))).toBe(true);
    const c = await loadCaseData(loadFixture("connemara-meadow-preserve"), band);
    const wild = c.pool.find((p) => p.section === "wild")!;
    expect(templateSentence(wild).startsWith(wild.answer)).toBe(false);
  });
});
