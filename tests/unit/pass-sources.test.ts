import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/cache/store";
import {
  classify,
  featuresQuery,
  PARK_FILTER,
  parseFeatures,
  parseParkId,
} from "@/lib/sources/overpass-features";
import {
  parseSpeciesCounts,
  parseTaxa,
  sentencePrefix,
  speciesCountsUrl,
  stripHtml,
  taxaSummaries,
  taxaUrl,
  windowStart,
} from "@/lib/sources/inat";
import { parkFindsEmptyCopy, parkPool } from "@/lib/pool/park";
import { distinctiveWords, NAME_STOPWORDS, PLACE_WORDS } from "@/lib/pool/types";
import { nameLeak } from "@/lib/ai/validate";
import { leadSentences, shortDate, WILD_DOWN_COPY, WILD_SOURCE_CHARS, wildEmptyCopy, wildEvidence, wildPool } from "@/lib/pool/wild";
import { OVERPASS_DEFAULT_URLS } from "@/lib/sources/overpass";
import { PARKS, rec, RECORDED_AT } from "./support/pass-replay";

const features = (slug: string, id: string) => parseFeatures(rec(`overpass-features-${slug}`).body, parseParkId(id)!)!;

describe("Overpass park features (live recordings 2026-10-05)", () => {
  it("parkId parsing accepts only node/way/relation with a numeric id", () => {
    expect(parseParkId("way/306191453")).toEqual({ type: "way", id: 306191453 });
    expect(parseParkId("relation/1")).toEqual({ type: "relation", id: 1 });
    for (const bad of ["way/", "way/abc", "area/1", "way/1;out", "way/0", " way/1"]) expect(parseParkId(bad)).toBeNull();
  });

  it("the query is fixed: an area of the park for ways/relations, 150 m around a node park", () => {
    const q = featuresQuery({ type: "way", id: 306191453 });
    expect(q).toMatch(/^\[out:json\]\[timeout:25\];way\(306191453\)\["leisure"~"\^\(park\|nature_reserve\)\$"\]\["name"\]->\.p;\.p out tags center;\.p map_to_area->\.a;/);
    expect(q).toContain('nwr(area.a)["leisure"~"^(pitch|playground');
    // SEC-1-01: the requested element itself must be a NAMED park/nature reserve, for every OSM type.
    expect(featuresQuery({ type: "relation", id: 5 })).toContain(`rel(5)${PARK_FILTER}->.p`);
    expect(featuresQuery({ type: "node", id: 7 })).toContain(`node(7)${PARK_FILTER}->.p`);
    expect(featuresQuery({ type: "node", id: 7 })).toContain("nwr(around.p:150)");
    // Recorded before R1 added the filter; the same park selects the same element with it.
    expect(rec(`overpass-features-${PARKS.connemara.slug}`)._recording.overpassQuery).toBe(q.replace(PARK_FILTER, ""));
  });

  it("Celebration Park: the architect's live counts (25 soccer, 4 tennis, 2 basketball, playground, shelter)", () => {
    const f = features(PARKS.celebration.slug, PARKS.celebration.id);
    expect(f.park).toMatchObject({ id: "way/188145317", name: "Celebration Park", kind: "park" });
    expect(f.features.soccer?.count).toBe(25);
    expect(f.features.tennis?.count).toBe(4);
    expect(f.features.basketball?.count).toBe(2);
    expect(f.features.baseball?.count).toBe(5);
    expect(f.features.playground?.count).toBe(1);
    expect(f.features.shelter?.count).toBe(1);
    expect(f.trees).toBe(52);
  });

  it("Connemara: no play features, only Rowlett Creek and a stream", () => {
    const f = features(PARKS.connemara.slug, PARKS.connemara.id);
    expect(f.park.name).toBe("Connemara Meadow Preserve");
    expect(Object.keys(f.features)).toEqual(["creek"]);
    expect(f.features.creek?.names).toEqual(["Rowlett Creek"]);
  });

  it("an id that isn't a named park in the answer -> null (not a park we can read)", () => {
    expect(parseFeatures(rec(`overpass-features-${PARKS.celebration.slug}`).body, { type: "way", id: 1 })).toBeNull();
  });

  it("classifies sports, equipment and nature; restrooms and paths are not finds", () => {
    expect(classify({ leisure: "pitch", sport: "basketball;volleyball" })).toBe("basketball");
    expect(classify({ leisure: "pitch" })).toBe("sports_field");
    expect(classify({ playground: "slide" })).toBe("slide");
    expect(classify({ amenity: "toilets" })).toBeNull();
    expect(classify({ highway: "footway" })).toBeNull();
    expect(classify({ highway: "footway", bridge: "yes" })).toBe("bridge");
    expect(classify({ waterway: "river", name: "Rowlett Creek" })).toBe("creek");
    expect(classify({ natural: "tree" })).toBe("tree");
  });

  it("three endpoints by default, with the live-verified mail.ru mirror second", () => {
    expect(OVERPASS_DEFAULT_URLS.map((u) => new URL(u).host)).toEqual(["overpass-api.de", "maps.mail.ru", "overpass.private.coffee"]);
  });
});

describe("Park Finds pool", () => {
  it("Celebration: one item per kind with code-written counts and evidence", () => {
    const { items, state } = parkPool(features(PARKS.celebration.slug, PARKS.celebration.id));
    expect(state).toEqual({ status: "ok" });
    const bball = items.find((i) => i.id === "osm-basketball")!;
    expect(bball.sourceText).toContain("Celebration Park has 2 basketball courts on the map (OpenStreetMap).");
    expect(bball.evidence).toBe("2 on the park map · OpenStreetMap");
    expect(bball.answer).toBe("Basketball courts");
    expect(bball.nameWords).toContain("basketball");
    const soccer = items.find((i) => i.id === "osm-soccer")!;
    expect(soccer.answer).toBe("Soccer fields (Celebration Park Soccer Fields)");
    expect(items.every((i) => i.section === "park" && i.source === "OpenStreetMap")).toBe(true);
  });

  it("Connemara: the creek has no count (waterways are mapped in pieces) and a water safety line", () => {
    const { items } = parkPool(features(PARKS.connemara.slug, PARKS.connemara.id));
    expect(items).toHaveLength(1);
    expect(items[0].sourceText).toMatch(/^Connemara Meadow Preserve has a creek or stream on the map \(OpenStreetMap\)\. Mapped name: Rowlett Creek\./);
    expect(items[0].evidence).toBe("on the park map · OpenStreetMap");
    expect(items[0].nameWords).toEqual(expect.arrayContaining(["creek", "stream", "rowlett"]));
    expect(items[0].safety).toBe("Stay with your grown-up near water.");
  });

  it("no features -> the exact SPEC 5.4 copy with the park name", () => {
    const f = { ...features(PARKS.connemara.slug, PARKS.connemara.id), features: {} };
    expect(parkPool(f).state).toEqual({ status: "empty", message: parkFindsEmptyCopy("Connemara Meadow Preserve") });
    expect(parkFindsEmptyCopy("X")).toBe("No data available: OpenStreetMap has no mapped playgrounds, courts or shelters inside X.");
  });
});

describe("iNaturalist (live recordings 2026-10-05)", () => {
  it("the 14-day window starts 14 Chicago days back (Oct 5 -> Sep 21)", () => {
    expect(windowStart(RECORDED_AT)).toBe("2026-09-21");
    expect(windowStart(Date.UTC(2026, 9, 6, 4, 30))).toBe("2026-09-21"); // 11:30 PM CDT Oct 5
    expect(shortDate("2026-09-21")).toBe("Sep 21");
  });

  it("species_counts URL: research grade, 1.5 km, d1; the recording used exactly this URL", () => {
    const r = rec(`inat-species-${PARKS.connemara.slug}`);
    const u = new URL(String(r._recording.url));
    expect(speciesCountsUrl({ lat: Number(u.searchParams.get("lat")), lng: Number(u.searchParams.get("lng")) }, "2026-09-21")).toBe(r._recording.url);
    expect(u.searchParams.get("quality_grade")).toBe("research");
    expect(u.searchParams.get("radius")).toBe("1.5");
  });

  it("Connemara: 79 research-grade species; Celebration: 0", () => {
    const c = parseSpeciesCounts(rec(`inat-species-${PARKS.connemara.slug}`).body);
    expect(c.totalSpecies).toBe(79);
    expect(c.species.length).toBe(79);
    expect(c.totalObservations).toBeGreaterThanOrEqual(79);
    const cel = parseSpeciesCounts(rec(`inat-species-${PARKS.celebration.slug}`).body);
    expect(cel).toEqual({ totalSpecies: 0, totalObservations: 0, species: [] });
  });

  it("NEVER calls taxa/ with an empty id list (it would return the tree of life)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("{}");
    };
    expect(await taxaSummaries([], { store: new MemoryStore(), fetchImpl })).toEqual([]);
    expect(calls).toBe(0);
    expect(() => taxaUrl([])).toThrow(/tree of life/);
  });

  it("summaries are plain text, sentence-cut to 600 chars", () => {
    const t = parseTaxa(rec(`inat-taxa-${PARKS.connemara.slug}`).body);
    expect(t.length).toBe(24);
    for (const s of t) {
      if (s.summary) {
        expect(s.summary).not.toMatch(/<[^>]+>/);
        expect(s.summary.length).toBeLessThanOrEqual(600);
      }
    }
    expect(stripHtml("<b>Bold</b> &amp; <i>it</i>&#39;s")).toBe("Bold & it's");
    expect(sentencePrefix("A".repeat(90) + ". Second sentence goes on.", 100)).toBe("A".repeat(90) + ".");
  });
});

describe("Wild Finds pool", () => {
  const list = parseSpeciesCounts(rec(`inat-species-${PARKS.connemara.slug}`).body);
  const summaries = parseTaxa(rec(`inat-taxa-${PARKS.connemara.slug}`).body);

  it("Connemara: up to 16 items, each with real evidence, a safety line and its name words", () => {
    const { items, state, blocked } = wildPool(list, summaries, "2026-09-21");
    expect(state).toEqual({ status: "ok" });
    // R2-M5: only species whose summary says how they look (11 of the 16 safe ones with a summary).
    expect(items.length).toBe(11);
    expect(wildPool(list, summaries, "2026-09-21", undefined, { describableOnly: false }).items.length).toBe(16);
    expect(blocked).toBeGreaterThanOrEqual(4);
    const snail = items.find((i) => i.id === "inat-126257")!;
    expect(snail.answer).toBe("Globular Drop Snail (Helicina orbiculata)");
    expect(snail.evidence).toBe("seen 4 times since Sep 21 · iNaturalist");
    expect(snail.nameWords).toEqual(expect.arrayContaining(["globular drop snail", "globular", "drop", "helicina", "orbiculata"]));
    expect(snail.sourceText.startsWith("Globular Drop Snail (Helicina orbiculata). ")).toBe(true);
    for (const i of items) {
      expect(i.safety).toBeTruthy();
      expect(i.taxon).toBeDefined();
    }
  });

  it("Celebration: the exact SPEC 5.4 copy with N from the API", () => {
    const cel = parseSpeciesCounts(rec(`inat-species-${PARKS.celebration.slug}`).body);
    const { items, state } = wildPool(cel, [], "2026-09-21");
    expect(items).toEqual([]);
    expect(state).toEqual({
      status: "empty",
      message: "No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist.",
    });
  });

  it("copy and evidence helpers", () => {
    expect(wildEmptyCopy(2)).toBe("No data available: only 2 research-grade sightings within 1.5 km in the last 14 days on iNaturalist.");
    expect(wildEmptyCopy(9)).toMatch(/^No data available: 9 research-grade sightings .* but fewer than 3 are safe/);
    expect(WILD_DOWN_COPY).toBe("No data available: iNaturalist didn't answer.");
    expect(wildEvidence(1, "2026-09-21")).toBe("seen once since Sep 21 · iNaturalist");
  });

  it("name words skip generic words and short hyphen parts", () => {
    expect(distinctiveWords("Red-shouldered Hawk")).toEqual(["red-shouldered", "shouldered", "hawk"]);
    expect(distinctiveWords("Golden-eye Lichen")).toEqual([]);
    expect(distinctiveWords("Hercules' club")).toEqual(["hercules", "club"]);
  });

  it("zero and one sighting read as plain English (same meaning as SPEC 5.4)", () => {
    expect(wildEmptyCopy(0)).toBe("No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist.");
    expect(wildEmptyCopy(1)).toBe("No data available: only 1 research-grade sighting within 1.5 km in the last 14 days on iNaturalist.");
    expect(wildEmptyCopy(0)).not.toMatch(/only 0/);
  });

  it("S8b: stopwords and OSM place words are never name words (S9 false leaks)", () => {
    // "Sheila and Jody Grant Children's Park" put "and", "the", "park" into nameWords before.
    expect(distinctiveWords("Sheila and Jody Grant Children's Park", { place: true })).toEqual(["sheila", "jody", "grant"]);
    expect(distinctiveWords("The Lake at the Park of the Arts")).toEqual(["lake", "park", "arts"]);
    expect(distinctiveWords("Rowlett Creek Trail", { place: true })).toEqual(["rowlett"]);
    for (const w of ["and", "the", "of", "at", "in", "on", "for", "with", "to"]) expect(NAME_STOPWORDS.has(w)).toBe(true);
    expect(PLACE_WORDS.has("park")).toBe(true);
  });

  it("S8b: real giveaways are still caught", () => {
    // Western Honey Bee: "honey" stays a name word, so "an insect that makes honey" is a leak.
    const bee = [...new Set(["western honey bee", ...distinctiveWords("Western Honey Bee"), "apis mellifera", ...distinctiveWords("Apis mellifera")])];
    expect(bee).toContain("honey");
    expect(nameLeak("Find a small insect that makes honey!", bee)).toBe("honey");
    expect(nameLeak("Find a buzzing insect on the flowers.", bee)).toBeNull();
    expect(distinctiveWords("Trumpet Creeper")).toEqual(["trumpet", "creeper"]);
    expect(nameLeak("Look for flowers shaped like trumpets.", distinctiveWords("Trumpet Creeper"))).toBe("trumpet");
    // A mapped playground name no longer forbids "and" / "park".
    const words = distinctiveWords("Sheila and Jody Grant Children's Park", { place: true });
    expect(nameLeak("Climb and slide in the park!", words)).toBeNull();
  });

  it("S8b: wild source text keeps whole lead sentences up to the cap", () => {
    const long = "Aaa bbb ccc. ".repeat(40).trim();
    const out = leadSentences(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(".")).toBe(true);
    expect(long.startsWith(out)).toBe(true);
    expect(leadSentences("Short one. Two.", 320)).toBe("Short one. Two.");
    const oneLong = "word ".repeat(100).trim();
    expect(leadSentences(oneLong, 50).length).toBeLessThanOrEqual(50);
    expect(oneLong.startsWith(leadSentences(oneLong, 50))).toBe(true);
    expect(WILD_SOURCE_CHARS).toBe(320);
  });
});
