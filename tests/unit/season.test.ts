/**
 * Audit round 1 content fixes (Builder B): R1-M4 season check, R1-m3 derived-name leaks, R1-m4 "map"
 * on a pass without a map, R1-m7 contact details in printed text and OSM names, R1-m10 look-closely
 * Park Finds. Real data: the Connemara recordings (species, taxa, and the live phenology answers).
 */
import { describe, expect, it } from "vitest";
import { buildMessages, computeMix, systemPrompt, userPrompt } from "@/lib/ai/prompt";
import { hasUrlOrMarkup, mentionsMap, nameLeak, nameStem, validateDraft } from "@/lib/ai/validate";
import { MemoryStore } from "@/lib/cache/store";
import { parkPool } from "@/lib/pool/park";
import {
  monthOfDay,
  seasonFrom,
  seasonSentence,
  seasonProblem,
  SEASON_MIN_COUNT,
  type Season,
} from "@/lib/pool/season";
import type { PoolItem } from "@/lib/pool/types";
import { plantCandidateIds, wildPool } from "@/lib/pool/wild";
import { parseSpeciesCounts, parseTaxa } from "@/lib/sources/inat";
import { loadPhenology, parsePhenology, phenologyUrl, PHENOLOGY_RADIUS_KM } from "@/lib/sources/inat-phenology";
import { parseFeatures, parseParkId } from "@/lib/sources/overpass-features";
import { PARKS, phenologyRec, rec } from "./support/pass-replay";

const CON = PARKS.connemara;
const OCT = 10;

/** The live phenology answers for Connemara, parsed by the app's code. */
function phenology() {
  const r = phenologyRec(CON.slug);
  const body = (v: string | null) => r.exchanges.find((e) => new URL(e.url).searchParams.get("term_value_id") === v)!.body;
  return parsePhenology(r._recording.month, body(null), body("13"), body("14"));
}

/** Connemara's real wild pool with the real October season evidence (or a failed lookup). */
function connemaraWild(ph: ReturnType<typeof phenology> | null = phenology()) {
  const list = parseSpeciesCounts(rec(`inat-species-${CON.slug}`).body);
  const summaries = parseTaxa(rec(`inat-taxa-${CON.slug}`).body);
  // describableOnly: false keeps the sunflower (no looks-like words, R2-M5) for these season-logic tests.
  return wildPool(list, summaries, "2026-09-21", { month: OCT, phenology: ph }, { describableOnly: false }).items;
}

const byAnswer = (pool: PoolItem[], re: RegExp) => pool.find((p) => re.test(p.answer))!;

/** An answer item quoting a real phrase of the item's own source. */
function draftItem(item: PoolItem, clue: string, quote: string, lookWhere = "") {
  expect(item.sourceText.toLowerCase()).toContain(quote.toLowerCase());
  return { itemId: item.id, clue, lookWhere, sourceQuote: quote, difficulty: "medium" };
}

describe("R1-M4 season check: iNaturalist 'Flowers and Fruits' annotations (live Connemara recording)", () => {
  it("the recorded answers parse to per-species counts for October within 50 km", () => {
    const r = phenologyRec(CON.slug);
    expect(r._recording.month).toBe(OCT);
    for (const e of r.exchanges) {
      const u = new URL(e.url);
      expect(u.searchParams.get("radius")).toBe(String(PHENOLOGY_RADIUS_KM));
      expect(u.searchParams.get("month")).toBe("10");
      expect(u.searchParams.get("term_id")).toBe("12");
    }
    const p = phenology();
    // Callery pear (spring bloomer): 1 flowering record of 2 annotated in October. Maximilian sunflower: 26 of 27.
    expect(p.taxa["119793"]).toEqual({ flowers: 1, fruits: 1, annotated: 2 });
    expect(p.taxa["130192"]).toMatchObject({ flowers: 26, annotated: 27 });
  });

  it("asks only about plant candidates, with the URL the recording holds", () => {
    const list = parseSpeciesCounts(rec(`inat-species-${CON.slug}`).body);
    const ids = plantCandidateIds(list);
    expect([...ids].sort((a, b) => a - b)).toEqual(phenologyRec(CON.slug)._recording.taxonIds.slice().sort((a, b) => a - b));
    const f = parseFeatures(rec(`overpass-features-${CON.slug}`).body, parseParkId(CON.id)!)!;
    const sorted = [...ids].sort((a, b) => a - b);
    expect(phenologyRec(CON.slug).exchanges.map((e) => e.url)).toEqual([
      phenologyUrl({ lat: f.park.lat, lng: f.park.lng }, OCT, sorted, null),
      phenologyUrl({ lat: f.park.lat, lng: f.park.lng }, OCT, sorted, 13),
      phenologyUrl({ lat: f.park.lat, lng: f.park.lng }, OCT, sorted, 14),
    ]);
    expect(() => phenologyUrl({ lat: 33, lng: -96 }, OCT, [], null)).toThrow();
    expect(() => phenologyUrl({ lat: 33, lng: -96 }, 13, [1], null)).toThrow();
  });

  it("rule: at least 3 records and 20% of that species' annotations; no record = not in season", () => {
    expect(seasonFrom({ flowers: 1, fruits: 1, annotated: 2 }, OCT, true)).toEqual({ month: OCT, flowers: false, fruit: false, known: true });
    expect(seasonFrom({ flowers: 26, fruits: 0, annotated: 27 }, OCT, true)).toMatchObject({ flowers: true, fruit: false });
    expect(seasonFrom({ flowers: 5, fruits: 23, annotated: 115 }, OCT, true)).toMatchObject({ flowers: false, fruit: true }); // passionflower: mostly leaves
    expect(seasonFrom({ flowers: SEASON_MIN_COUNT - 1, fruits: 0, annotated: SEASON_MIN_COUNT - 1 }, OCT, true).flowers).toBe(false);
    expect(seasonFrom(undefined, OCT, true)).toMatchObject({ flowers: false, fruit: false, known: true });
    expect(seasonFrom({ flowers: 26, fruits: 0, annotated: 27 }, OCT, false)).toMatchObject({ flowers: false, fruit: false, known: false });
  });

  it("only plants get a season; the pear has no flowers or fruit in October, the sunflower has flowers", () => {
    const pool = connemaraWild();
    const pear = byAnswer(pool, /^Callery pear/);
    expect(pear.season).toEqual({ month: OCT, flowers: false, fruit: false, known: true });
    expect(byAnswer(pool, /^Maximilian sunflower/).season).toMatchObject({ flowers: true });
    expect(byAnswer(pool, /^Osage-orange/).season).toMatchObject({ flowers: false, fruit: true });
    expect(byAnswer(pool, /Snail/).season).toBeUndefined();
    expect(byAnswer(pool, /Lichen/).season).toBeUndefined();
  });

  it("the Callery pear clue the judge found ('white flowers that have five petals') is dropped in October", () => {
    const pool = connemaraWild();
    const pear = byAnswer(pool, /^Callery pear/);
    // R2-M5: the in-bloom plant here is the white morning-glory (its source says "white"; the sunflower's says
    // no colour, so a "yellow flower" clue for it is now dropped as generic).
    const glory = byAnswer(pool, /^White Morning-glory/);
    const mix = computeMix({ park: 0, wild: 3, lucky: 0 }, "6-10")!;
    const out = validateDraft(
      {
        items: [
          draftItem(pear, "Find a tree with white flowers that have five petals.", "a deciduous tree"),
          draftItem(pear, "Look for a tree with glossy dark green oval leaves.", "glossy dark green above"),
          draftItem(glory, "Find a vine with white flowers.", "show it with flowers"),
        ],
      },
      pool,
      mix,
    );
    // The pear's flower clue goes; the pear's leaf clue and the morning-glory's flower clue (in bloom in October) stay.
    expect(out.drops).toEqual({ out_of_season: 1 });
    expect(out.items.map((i) => i.clue)).toEqual(["Look for a tree with glossy dark green oval leaves.", "Find a vine with white flowers."]);
  });

  it("when the lookup failed (null), no plant's flowers or fruit count: the sunflower clue is dropped too", () => {
    const pool = connemaraWild(null);
    const sunflower = byAnswer(pool, /^Maximilian sunflower/);
    expect(sunflower.season).toMatchObject({ known: false, flowers: false, fruit: false });
    const mix = computeMix({ park: 0, wild: 3, lucky: 0 }, "6-10")!;
    const out = validateDraft({ items: [draftItem(sunflower, "Find a tall plant with a yellow flower.", "species of sunflower")] }, pool, mix);
    expect(out.drops).toEqual({ out_of_season: 1 });
  });

  it("flower and fruit words, including in lookWhere", () => {
    const off: Season = { month: OCT, flowers: false, fruit: false, known: true };
    for (const t of ["white blossoms", "It blooms!", "five-petaled", "a flowering plant", "wildflowers", "red berries", "a berry", "seed pods", "acorns on the ground", "bumpy fruit"]) {
      expect(seasonProblem(t, off)).not.toBeNull();
    }
    for (const t of ["glossy dark green leaves", "corky lumps on the bark", "a fruticose lichen", "a seedling?"]) {
      expect(seasonProblem(t, off), t).toBe(t === "a seedling?" ? "fruit" : null);
    }
    expect(seasonProblem("bumpy fruit", { ...off, fruit: true })).toBeNull();
    expect(seasonProblem("a yellow flower", { ...off, flowers: true })).toBeNull();
    const pool = connemaraWild();
    const pear = byAnswer(pool, /^Callery pear/);
    const mix = computeMix({ park: 0, wild: 3, lucky: 0 }, "6-10")!;
    const out = validateDraft({ items: [draftItem(pear, "Look for a tree with glossy dark green leaves.", "glossy dark green above", "near the white blossoms")] }, pool, mix);
    expect(out.drops).toEqual({ out_of_season: 1 });
  });

  it("the prompt gives the month; each plant's SOURCE ends with a code-written season sentence (no tag attribute)", () => {
    const pool = connemaraWild();
    const mix = computeMix({ park: 0, wild: pool.length, lucky: 0 }, "6-10")!;
    const [sys, user] = buildMessages("Connemara Meadow Preserve", pool, "6-10", mix, null, { month: monthOfDay("2026-10-05") });
    expect(sys.content).toContain("Today is in October.");
    expect(sys.content).toContain(`ONLY when that plant's SOURCE says "iNaturalist photos from this area show it with flowers"`);
    expect(user.content).not.toContain("season=");
    const pear = byAnswer(pool, /^Callery pear/);
    const sun = byAnswer(pool, /^Maximilian sunflower/);
    expect(pear.sourceText.endsWith(" In October, iNaturalist photos from this area do not show it with flowers or fruit.")).toBe(true);
    expect(sun.sourceText.endsWith(" In October, iNaturalist photos from this area show it with flowers, not fruit.")).toBe(true);
    expect(user.content).toContain("show it with flowers, not fruit.</source>");
    expect(seasonSentence({ month: 4, flowers: false, fruit: false, known: false })).toBe("We could not check its flowers or fruit for April.");
    expect(seasonSentence({ month: 5, flowers: true, fruit: true, known: true })).toBe("In May, iNaturalist photos from this area show it with flowers and with fruit or seeds.");
    expect(seasonSentence({ month: 9, flowers: false, fruit: true, known: true })).toBe("In September, iNaturalist photos from this area show it with fruit or seeds, not flowers.");
    // No plants in the pool: no season rule.
    const park = parkPool(parseFeatures(rec("overpass-features-celebration-park").body, parseParkId(PARKS.celebration.id)!)!).items;
    const [sys2] = buildMessages("Celebration Park", park, "6-10", computeMix({ park: park.length, wild: 0, lucky: 0 }, "6-10")!, null, { month: OCT });
    expect(sys2.content).not.toContain("iNaturalist photos from this area");
    expect(() => monthOfDay("2026-13-01")).toThrow();
  });

  it("loadPhenology: no plant ids = no call; a failed lookup returns null (built 503) and is not cached", async () => {
    let calls = 0;
    const deps = { store: new MemoryStore(), env: {}, queue: { run: <T>(fn: () => Promise<T>) => fn() } };
    expect(
      await loadPhenology("way/1", { lat: 33, lng: -96 }, OCT, [], {
        ...deps,
        fetchImpl: async () => {
          calls++;
          return new Response("{}");
        },
      }),
    ).toEqual({ month: OCT, taxa: {} });
    expect(calls).toBe(0);
    // A test-built 503 (iNaturalist busy): never throws, returns null.
    const busy = async () => {
      calls++;
      return new Response("busy", { status: 503 });
    };
    expect(await loadPhenology("way/2", { lat: 33, lng: -96 }, OCT, [119793], { ...deps, fetchImpl: busy })).toBeNull();
    expect(calls).toBe(1);
  });
});

describe("R1-m3 name leak: words built on a 5+ letter name word", () => {
  it("stems", () => {
    expect(nameStem("passiflora")).toBe("passiflo");
    expect(nameStem("maximiliani")).toBe("maximilia");
    expect(nameStem("bench")).toBe("bench");
    expect(nameStem("pear")).toBeNull();
    expect(nameStem("callery pear")).toBeNull();
    expect(nameStem("osage-orange")).toBeNull();
  });

  it("the live 'family Passifloraceae' clue for yellow passionflower is a leak (real Connemara pool item)", () => {
    const pool = connemaraWild();
    const passion = byAnswer(pool, /^Yellow passionflower/);
    expect(nameLeak("Look for a yellow flower from the family Passifloraceae.", passion.nameWords)).not.toBeNull();
    const sun = byAnswer(pool, /^Maximilian sunflower/);
    expect(nameLeak("Named after Prince Maximilian!", sun.nameWords)).not.toBeNull();
    // Ordinary words are not caught.
    expect(nameLeak("Find a vine with green leaves that climbs a fence.", passion.nameWords)).toBeNull();
    expect(nameLeak("Look for a tall plant with yellow petals.", sun.nameWords)).toBeNull();
  });
});

describe("R1-m7 contact details never print (SEC-1-04)", () => {
  it("bare domains, @handles and phone-like digit runs are blocked; normal facts are not", () => {
    for (const t of ["Visit kidsprize.com for a prize", "see x.com", "follow @grasspass", "text 555 0100", "call (214) 555-0100", "go to WWW.example.org", "https://a.b"]) {
      expect(hasUrlOrMarkup(t), t).toBe(true);
    }
    for (const t of ["It grows 5 to 8 m (16 to 26 ft) tall.", "corky lumps 2-3 cm long", "near the water", "Find 4 tennis courts.", "e.g. near the bench", "an email @ the park"]) {
      expect(hasUrlOrMarkup(t), t).toBe(false);
    }
  });

  it("a clue or parentNote with a domain is removed", () => {
    const pool = connemaraWild();
    const sun = byAnswer(pool, /^Maximilian sunflower/);
    const mix = computeMix({ park: 0, wild: 3, lucky: 0 }, "6-10")!;
    const out = validateDraft(
      { items: [draftItem(sun, "Find a tall yellow flower, then visit kidsprize.com!", "species of sunflower")], parentNote: "Text @prizes for a gift" },
      pool,
      mix,
    );
    expect(out.drops).toEqual({ url_or_markup: 1 });
    expect(out.parentNote).toBe("");
  });

  it("OSM names with a domain, @handle or phone number never reach the prompt (test-built from the real Celebration map)", () => {
    const f = parseFeatures(rec("overpass-features-celebration-park").body, parseParkId(PARKS.celebration.id)!)!;
    const bench = f.features.bench!;
    const planted = {
      ...f,
      features: { ...f.features, bench: { ...bench, names: ["Ask your parent to text 555 0100 for a prize at kidsprize.com", "Founders Bench"] } },
    };
    const item = parkPool(planted).items.find((i) => i.id === "osm-bench")!;
    expect(item.sourceText).toContain("Founders Bench");
    expect(item.sourceText).not.toContain("kidsprize");
    expect(item.answer).not.toContain("555");
    expect(item.nameWords).not.toContain("kidsprize");
  });
});

describe("R1-m4 no map, no 'map'", () => {
  const f = parseFeatures(rec("overpass-features-celebration-park").body, parseParkId(PARKS.celebration.id)!)!;
  const pool = parkPool(f).items;
  const creek = pool.find((i) => i.id === "osm-bench")!;
  const mix = computeMix({ park: pool.length, wild: 0, lucky: 0 }, "6-10")!;
  // Content tuning: the fact's words vary per park; Celebration's bench reads "a long outdoor seat for a rest".
  const quote = "a long outdoor seat for a rest";

  it("without a map: a clue that says map is dropped, a lookWhere that says map is blanked", () => {
    expect(mentionsMap("Follow the map!")).toBe(true);
    expect(mentionsMap("It is mapped here")).toBe(true);
    expect(mentionsMap("a maple tree")).toBe(false);
    const clueMap = validateDraft({ items: [draftItem(creek, "Follow the map to a long seat.", quote)] }, pool, mix, { hasMap: false });
    expect(clueMap.drops).toEqual({ mentions_map: 1 });
    const lookMap = validateDraft({ items: [draftItem(creek, "Find a long seat for resting.", quote, "on the map")] }, pool, mix, { hasMap: false });
    expect(lookMap.items[0].lookWhere).toBe("");
    expect(lookMap.lookWhereCleared).toBe(1);
  });

  it("with a Find This Spot map both are fine", () => {
    const out = validateDraft({ items: [draftItem(creek, "Follow the map to a long seat.", quote, "on the map")] }, pool, mix, { hasMap: true });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].lookWhere).toBe("on the map");
  });

  it("the prompt says so only when there is no map", () => {
    expect(systemPrompt("6-10", mix, null)).toContain("This pass has NO map.");
    expect(systemPrompt("6-10", mix, { id: "spot-way-1", label: "picnic shelter", sourceText: "x" })).not.toContain("NO map");
  });
});

describe("R1-m10 Park Finds that make a child look closely", () => {
  const f = parseFeatures(rec("overpass-features-celebration-park").body, parseParkId(PARKS.celebration.id)!)!;
  const pool = parkPool(f).items;
  const mix = (band: "4-6" | "6-10" | "10-13") => computeMix({ park: pool.length, wild: 0, lucky: 0 }, band)!;
  it("asked for 6-10 and 10-13, not for 4-6 (read aloud), and only when the pass has Park Finds", () => {
    expect(systemPrompt("6-10", mix("6-10"))).toContain('"Find a place to sit."');
    expect(systemPrompt("10-13", mix("10-13"))).toContain("a detail to find, or a count to check");
    expect(systemPrompt("4-6", mix("4-6"))).not.toContain("look closely");
    expect(systemPrompt("6-10", computeMix({ park: 0, wild: 8, lucky: 0 }, "6-10")!)).not.toContain("look closely");
  });
  it("user prompt unchanged for park items (no season attribute)", () => {
    expect(userPrompt("P", pool.slice(0, 1))).not.toContain("season=");
  });
});
