/**
 * Audit round 1 follow-up (Builder E): the season fact as quotable SOURCE text, name-leak false
 * positives (a feature kind's own label words and landscape words inside OpenStreetMap names, "-ed"
 * describing words), the count-clue prompt rule, a failed season lookup marks the pass degraded, and
 * the Find This Spot target's OSM name is filtered on the way in. Real data: the live recordings in
 * tests/fixtures (the eval parks for the OSM names); test-built inputs say so.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCaseData, loadFixture } from "../../evals/fixture";
import { computeMix, systemPrompt } from "@/lib/ai/prompt";
import { isGrounded, nameLeak, nameStem, validateDraft } from "@/lib/ai/validate";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { isDegraded, makePass, resetPassMaking } from "@/lib/pass/make";
import { distinctiveWords, kindLabelWords, type PoolItem } from "@/lib/pool/types";
import { wildPool } from "@/lib/pool/wild";
import { parseSpeciesCounts, parseTaxa } from "@/lib/sources/inat";
import { parsePhenology } from "@/lib/sources/inat-phenology";
import { FEATURE_KINDS, parseFeatures, parseParkId } from "@/lib/sources/overpass-features";
import { parseGeometry, type ParkGeometry } from "@/lib/spot/geometry";
import { pickTarget, safeOsmName } from "@/lib/spot/pick-target";
import { PARKS, passReplay, phenologyRec, rec, RECORDED_AT } from "./support/pass-replay";

const CON = PARKS.connemara;
const CEL = PARKS.celebration;
const OCT = 10;

let restore: () => void;
beforeEach(() => {
  resetStores();
  resetPassMaking();
  restore = setLogSink(() => undefined);
});
afterEach(() => restore());

function connemaraWild(failed = false): PoolItem[] {
  const r = phenologyRec(CON.slug);
  const body = (v: string | null) => r.exchanges.find((e) => new URL(e.url).searchParams.get("term_value_id") === v)!.body;
  const ph = failed ? null : parsePhenology(r._recording.month, body(null), body("13"), body("14"));
  const list = parseSpeciesCounts(rec(`inat-species-${CON.slug}`).body);
  // describableOnly: false keeps the sunflower (no looks-like words, R2-M5) for these season-logic tests.
  return wildPool(list, parseTaxa(rec(`inat-taxa-${CON.slug}`).body), "2026-09-21", { month: OCT, phenology: ph }, { describableOnly: false }).items;
}
const byAnswer = (pool: PoolItem[], re: RegExp) => pool.find((p) => re.test(p.answer))!;
const item = (p: PoolItem, clue: string, sourceQuote: string, lookWhere = "") => ({ itemId: p.id, clue, lookWhere, sourceQuote, difficulty: "medium" });

/** A park item from a real eval fixture (live Overpass recording). */
async function evalParkItem(slug: string, id: string): Promise<PoolItem> {
  const d = await loadCaseData(loadFixture(slug), "6-10");
  const found = d.park?.items.find((i) => i.id === id);
  if (!found) throw new Error(`No data available: ${id} not in the ${slug} recording`);
  return found;
}

describe("the season fact is a code-written sentence in the plant's SOURCE (Llama copied the old tag attribute)", () => {
  it("a flower clue may quote it (grounded, kept); the same quote cannot rescue an out-of-season pear clue", () => {
    const pool = connemaraWild();
    const sun = byAnswer(pool, /^Maximilian sunflower/);
    const pear = byAnswer(pool, /^Callery pear/);
    const mix = computeMix({ park: 0, wild: 3, lucky: 0 }, "6-10")!;
    expect(isGrounded("photos from this area show it with flowers", sun.sourceText)).toBe(true);
    // R2-M5: a flower clue also needs a trait from the source. The sunflower's summary has none ("yellow" is
    // not in it), so its clue is now generic; the white morning-glory's "white" is, so its clue is kept.
    const generic = validateDraft({ items: [item(sun, "Find a tall plant with yellow petals.", "photos from this area show it with flowers")] }, pool, mix);
    expect(generic.drops).toEqual({ generic_clue: 1 });
    const glory = byAnswer(pool, /^White Morning-glory/);
    expect(isGrounded("photos from this area show it with flowers", glory.sourceText)).toBe(true);
    const ok = validateDraft({ items: [item(glory, "Find a vine with white flowers.", "photos from this area show it with flowers")] }, pool, mix);
    expect(ok.items).toHaveLength(1);
    const pearQuote = "do not show it with flowers or fruit";
    expect(isGrounded(pearQuote, pear.sourceText)).toBe(true);
    const bad = validateDraft({ items: [item(pear, "Find a tree with white flowers.", pearQuote)] }, pool, mix);
    expect(bad.drops).toEqual({ out_of_season: 1 });
  });

  it("a failed lookup says so in the SOURCE, and no flower clue survives", () => {
    const pool = connemaraWild(true);
    const sun = byAnswer(pool, /^Maximilian sunflower/);
    expect(sun.sourceText.endsWith(" We could not check its flowers or fruit for October.")).toBe(true);
    const out = validateDraft({ items: [item(sun, "Find a tall plant with yellow petals.", "could not check its flowers")] }, pool, computeMix({ park: 0, wild: 3, lucky: 0 }, "6-10")!);
    expect(out.drops).toEqual({ out_of_season: 1 });
  });

  it("animals get no season sentence", () => {
    for (const p of connemaraWild()) expect(p.sourceText.includes("iNaturalist photos from this area"), p.answer).toBe(p.season !== undefined);
  });
});

describe("name-leak false positives found in run 4 (each a real eval-park OSM name)", () => {
  it("kindLabelWords: a kind's own label words that its nameWords allow", () => {
    expect([...kindLabelWords(FEATURE_KINDS.tennis)]).toEqual(["court", "courts"]);
    expect([...kindLabelWords(FEATURE_KINDS.soccer)]).toEqual(["field", "fields"]);
    expect(kindLabelWords(FEATURE_KINDS.baseball).has("diamond")).toBe(false);
    expect(FEATURE_KINDS.baseball.nameWords).toContain("diamond");
    expect(FEATURE_KINDS.baseball.describe).not.toMatch(/diamond/i);
    expect(FEATURE_KINDS.artwork.describe).not.toMatch(/sculpture|statue|mural/i);
  });

  it("golden-gate-park tennis (Taube Family Championship Court): 'a flat court' is no longer a leak; 'Taube' still is", async () => {
    const tennis = await evalParkItem("golden-gate-park", "osm-tennis");
    expect(tennis.answer).toContain("Championship Court");
    expect(nameLeak("Find a flat court with a low net and a tall fence around it.", tennis.nameWords)).toBeNull();
    expect(nameLeak("near the sports courts", tennis.nameWords)).toBeNull();
    expect(nameLeak("Find the Taube court.", tennis.nameWords)).toBe("taube");
    expect(nameLeak("Can you see a tennis net?", tennis.nameWords)).toBe("tennis");
  });

  it("central-park soccer (North Meadow Soccer Field 5): 'a big grass field' is fine; 'soccer' is not", async () => {
    const soccer = await evalParkItem("central-park", "osm-soccer");
    expect(nameLeak("Look for a big grass field with a goal with a net at each end.", soccer.nameWords)).toBeNull();
    expect(nameLeak("Kick like a soccer star!", soccer.nameWords)).toBe("soccer");
  });

  it("white-rock-lake-park shelters (Jeanne's Pavilion at the Shadow Garden): 'near a garden' is fine; 'gazebo' is not", async () => {
    const shelter = await evalParkItem("white-rock-lake-park", "osm-shelter");
    expect(shelter.answer).toContain("Shadow Garden");
    expect(nameLeak("near a garden", shelter.nameWords)).toBeNull();
    expect(nameLeak("Find a gazebo.", shelter.nameWords)).toBe("gazebo");
    expect(nameLeak("Find Jeanne's spot.", shelter.nameWords)).toBe("jeanne");
  });

  it("celebration-park baseball (Celebration Park Baseball Diamonds): 'a dirt diamond' is still a leak (a real giveaway)", async () => {
    const baseball = await evalParkItem("celebration-park", "osm-baseball");
    expect(nameLeak("Find a dirt diamond with bases.", baseball.nameWords)).not.toBeNull();
    expect(nameLeak("Find a field with a tall fence behind home plate.", baseball.nameWords)).toBeNull();
  });

  it("'-ed' describing words have no stem: 'a bright throat' is fine for a ruby-throated hummingbird, 'throated' is not", () => {
    const words = ["ruby-throated hummingbird", ...distinctiveWords("Ruby-throated Hummingbird")];
    expect(nameStem("throated")).toBeNull();
    expect(nameLeak("Look up for a tiny bird with a bright throat.", words)).toBeNull();
    expect(nameLeak("A ruby-throated flier", words)).not.toBeNull();
    // Real stems still catch real leaks.
    expect(nameLeak("a member of the bird family Columbidae", ["rock pigeon", "columba livia", "columba", "livia"])).toBe("columba");
  });
});

describe("prompt: a count clue counts the whole thing without naming it (run 4: 'Count the bridges.' x3; R2-M5: no copyable good example)", () => {
  it("says so with bad examples only, and gives plain lookWhere places", () => {
    const sys = systemPrompt("6-10", computeMix({ park: 6, wild: 6, lucky: 0 }, "6-10")!);
    expect(sys).toContain("It counts the WHOLE thing the SOURCE counts, described without its name");
    expect(sys).toContain('Bad: "Count the hoops. There are 4." (the SOURCE counts courts, not hoops)');
    expect(sys).not.toContain("Good:");
    expect(sys).not.toContain("ways over the water");
    expect(sys).toContain('lookWhere is a plain place in a park: "near the water"');
    expect(sys).toContain('"by the stream" for a creek');
  });
});

describe("a failed season lookup marks the pass degraded (re-made after 15 min)", { timeout: 60_000 }, () => {
  /** The recording day (Oct 5, Chicago), moving with real time. */
  const ticking = () => {
    const t0 = performance.now();
    return () => RECORDED_AT + Math.round(performance.now() - t0);
  };
  const env = { DO_INFERENCE_API_KEY: "test-key-not-real" }; // gitleaks:allow (dummy test value)

  it("phenology 503 (built: iNaturalist busy on that call) -> seasonUnknown, degraded; the live answers -> not degraded", async () => {
    const isPhenology = (url: string) => new URL(url).searchParams.has("term_id");
    const r = passReplay();
    const busy = async (url: string, init?: RequestInit) => (isPhenology(url) ? new Response("busy", { status: 503 }) : r.fetchImpl(url, init));
    const down = await makePass({ parkId: CON.id, ageBand: "6-10" }, { ip: "192.0.2.90", fetchImpl: busy, modelFetch: r.fetchImpl, env, now: ticking() });
    if (down.kind !== "pass") throw new Error(down.kind);
    expect(down.pass.seasonUnknown).toBe(true);
    expect(down.pass.sections.wild.status).toBe("ok");
    expect(isDegraded(down.pass)).toBe(true);

    resetStores();
    resetPassMaking();
    const good = await makePass({ parkId: CON.id, ageBand: "6-10" }, { ip: "192.0.2.91", fetchImpl: passReplay().fetchImpl, modelFetch: r.fetchImpl, env, now: ticking() });
    if (good.kind !== "pass") throw new Error(good.kind);
    expect(good.pass.seasonUnknown).toBeUndefined();
    expect(isDegraded(good.pass)).toBe(false);
  });

  it("no plants (Celebration: 0 species) -> nothing to check, not degraded", async () => {
    const r = passReplay();
    const out = await makePass({ parkId: CEL.id, ageBand: "6-10" }, { ip: "192.0.2.92", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env, now: ticking() });
    if (out.kind !== "pass") throw new Error(out.kind);
    expect(out.pass.seasonUnknown).toBeUndefined();
  });
});

describe("Find This Spot: the target's OSM name is filtered on the way in (R1-m7 follow-up)", () => {
  const geo = (): ParkGeometry => parseGeometry(rec(`overpass-geometry-${CEL.slug}`).body, parseParkId(CEL.id)!)!;
  const feats = () => parseFeatures(rec(`overpass-features-${CEL.slug}`).body, parseParkId(CEL.id)!)!;

  it("safeOsmName", () => {
    expect(safeOsmName("Founders Pavilion")).toBe("Founders Pavilion");
    for (const bad of ["Text 555 0100 for a prize", "kidsprize.com shelter", "Follow @grasspass", "<b>Shelter</b>"]) expect(safeOsmName(bad), bad).toBeNull();
    expect(safeOsmName(undefined)).toBeNull();
    expect(safeOsmName("  ")).toBeNull();
  });

  it("a planted contact name on the real Celebration shelter (test-built) never reaches the fact sheet, the answer or the name words", () => {
    const g = geo();
    const planted: ParkGeometry = {
      ...g,
      elements: g.elements.map((e) => (e.osmId === "way/536185861" ? { ...e, tags: { ...e.tags, name: "Text 555 0100 for a prize at kidsprize.com" } } : e)),
    };
    const t = pickTarget(planted, { parkName: "Celebration Park", features: feats(), variant: 1 })!;
    expect(t.osmId).toBe("way/536185861");
    expect(t.name).toBeNull();
    expect(t.sourceText).not.toMatch(/kidsprize|555/);
    expect(t.answer).toBe("The picnic shelter");
    expect(t.nameWords).toEqual(["shelter", "pavilion", "gazebo"]);
    // A normal name is kept.
    const named: ParkGeometry = { ...g, elements: g.elements.map((e) => (e.osmId === "way/536185861" ? { ...e, tags: { ...e.tags, name: "Founders Pavilion" } } : e)) };
    const n = pickTarget(named, { parkName: "Celebration Park", features: feats(), variant: 1 })!;
    expect(n.sourceText).toContain("named Founders Pavilion");
    expect(n.nameWords).toContain("founders");
  });
});
