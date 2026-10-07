/**
 * Round-7 security (2026-10-06): kid-safety additions.
 * - SEC-7-01: more DFW touch/bite/eat hazards blocked by taxon (real iNat records: tests/fixtures/inat-taxa-sec7-hazards-and-lookalikes.json),
 *   and "bite(s)/biting" + cyanide, seizures, carcinogen, rabies, Chagas, Lyme... in the shared danger-word list.
 * - SEC-7-02: a pool species whose own common or Latin name holds a blocked word is left off.
 * - SEC-7-03: combining marks, the combining grapheme joiner, strike-through, small capitals and Hangul fillers are
 *   folded away before any safety match.
 * - The recorded summaries of the 20 eval parks: exactly which ones the new words stop (no harmless false drops).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKED_TAXA, blockedBy, blockedWordIn, dangerClueWord, dangerSourceWord, safetyText } from "@/lib/safety/danger-taxa";
import { wildPool } from "@/lib/pool/wild";
import { parseSpeciesCounts, parseTaxa, type SpeciesList, type TaxonSummary } from "@/lib/sources/inat";
import { rec } from "./support/pass-replay";

type RawTaxon = { id: number; name: string; rank: string; preferred_common_name?: string; iconic_taxon_name: string; ancestor_ids: number[]; wikipedia_summary: string | null };
const FIXTURE = "inat-taxa-sec7-hazards-and-lookalikes";
const raw = (rec(FIXTURE).body as { results: RawTaxon[] }).results;
const real = (name: string) => {
  const t = raw.find((x) => x.name === name);
  if (!t) throw new Error(`not in the fixture: ${name}`);
  return t;
};
const lineage = (name: string) => ({ taxonId: real(name).id, ancestorIds: real(name).ancestor_ids });
const summaries = parseTaxa(rec(FIXTURE).body);
const listOf = (names: readonly string[]): SpeciesList => ({
  totalSpecies: names.length,
  totalObservations: names.length * 3,
  species: names.map((n) => {
    const t = real(n);
    return { taxonId: t.id, name: t.name, commonName: t.preferred_common_name ?? null, rank: t.rank, iconic: t.iconic_taxon_name, ancestorIds: t.ancestor_ids, count: 3 } as SpeciesList["species"][number];
  }),
});

describe("SEC-7-01: every new or widened group stops a real DFW species through its real ancestor_ids", () => {
  const cases: [string, string][] = [
    ["Arilus cristatus", "Reduviidae"], // North American wheel bug: 423 research-grade DFW sightings this year
    ["Triatoma sanguisuga", "Reduviidae"], // eastern bloodsucking conenose (a kissing bug: Chagas)
    ["Zelus longipes", "Reduviidae"], // milkweed assassin bug (no summary at all)
    ["Triadica sebifera", "Triadica"], // Chinese tallow: iNat's summary stops at "The plant sap and leaves..."
    ["Rivina humilis", "Rivina"], // pigeonberry
    ["Pogonomyrmex barbatus", "Pogonomyrmex"], // red harvester ants
    ["Amblyomma americanum", "Ixodida"], // lone star tick
    ["Dermacentor variabilis", "Ixodida"], // American dog tick
    ["Ixodes scapularis", "Ixodida"], // black-legged (deer) tick
    ["Solenopsis invicta", "Solenopsis"], // red imported fire ant (was blocked as a species)
    ["Solenopsis geminata", "Solenopsis"], // geminata-group fire ants (no summary)
    ["Centruroides vittatus", "Scorpiones"], // striped bark scorpion (was blocked as Centruroides)
    ["Vaejovis carolinianus", "Scorpiones"], // Southern Devil Scorpion: a 106-character neutral summary
    ["Ailanthus altissima", "Ailanthus"], // tree-of-heaven
    ["Sapindus drummondii", "Sapindus"], // western soapberry (a Connemara candidate)
    ["Ungnadia speciosa", "Ungnadia"], // Mexican buckeye (a Trinity River pool item in run 2026-10-05-2)
  ];
  for (const [species, group] of cases) {
    it(`${species} is blocked by ${group}`, () => {
      expect(blockedBy(lineage(species))?.name).toBe(group);
    });
  }

  it("covers each round-7 group with a real species; 71 groups in all", () => {
    const fresh = BLOCKED_TAXA.slice(BLOCKED_TAXA.findIndex((t) => t.name === "Reduviidae")).map((t) => t.name);
    expect(fresh).toEqual(["Reduviidae", "Pogonomyrmex", "Ixodida", "Triadica", "Rivina", "Ailanthus", "Sapindus", "Ungnadia"]);
    for (const g of [...fresh, "Solenopsis", "Scorpiones"]) expect(cases.some(([, c]) => c === g), g).toBe(true);
    expect(BLOCKED_TAXA).toHaveLength(71);
  });

  it("look-alikes stay allowed by taxon: milkweed bug (not an assassin bug), carpenter ant, rattlesnake master", () => {
    for (const n of ["Oncopeltus fasciatus", "Camponotus pennsylvanicus", "Eryngium yuccifolium"]) expect(blockedBy(lineage(n)), n).toBeNull();
  });

  it("the new groups' common names are blocked words in model text", () => {
    expect(blockedWordIn("Look for the wheel bug on the fence.")).toBe("wheel bug");
    expect(blockedWordIn("an assassin bug on a flower")).toBe("assassin bug");
    expect(blockedWordIn("Kissing bugs hide in wood piles.")).toBe("Kissing bugs");
    expect(blockedWordIn("a tall Chinese tallow by the pond")).toBe("Chinese tallow");
    expect(blockedWordIn("red pigeonberry fruit")).toBe("pigeonberry");
    expect(blockedWordIn("a red harvester ant mound")).toBe("harvester ant");
    expect(blockedWordIn("Watch out for the lone star tick.")).toBe("lone star tick");
    expect(blockedWordIn("a tree-of-heaven sapling")).toBe("tree-of-heaven");
    expect(blockedWordIn("western soapberry")).toBe("soapberry");
    expect(blockedWordIn("Mexican buckeye")).toBe("buckeye");
    // A bare "tick" is not a blocked word: the harmless tick-trefoils, tickseeds and beggar-ticks are plants.
    expect(blockedWordIn("Find the tick-trefoil's sticky seeds.")).toBeNull();
    expect(blockedWordIn("bright yellow tickseed")).toBeNull();
  });
});

describe("SEC-7-01/03: danger words, shared by source and model text", () => {
  it("'bite(s)' and 'biting' are source words now: the real Lone Star tick summary ('bites painlessly') is caught by its words too", () => {
    const s = summaries.find((x) => x.id === real("Amblyomma americanum").id)!.summary!;
    expect(s).toMatch(/bites painlessly/);
    expect(dangerSourceWord(s)).toBe("bites");
    expect(dangerSourceWord("Its bite may transmit Lyme disease.")).toBe("bite");
    expect(dangerClueWord("a bug that can bite")).toBe("bite");
    expect(dangerClueWord("a bite-sized berry")).toBeNull();
  });

  it("careful negations: 'does not bite', 'seldom bites', and a bite in a sentence that says it is harmless", () => {
    expect(dangerSourceWord("This gentle snake does not bite.")).toBeNull();
    expect(dangerSourceWord("It seldom bites and rarely bites when handled.")).toBeNull();
    // Rough greensnake (real summary text): "...and seldom bites. Even when bites occur, they have no venom and are harmless."
    expect(dangerSourceWord("It seldom bites. Even when bites occur, they have no venom and are harmless.")).toBeNull();
    // Not a negation: the bite itself is the danger.
    expect(dangerSourceWord("It bites painlessly and commonly goes unnoticed.")).toBe("bites");
    expect(dangerSourceWord("Harmless to most people. Its bite can cause swelling.")).toBe("bite");
    // A harmless sentence keeps every other danger word.
    expect(dangerSourceWord("Its bite is harmless but painful.")).toBe("painful");
  });

  it("the words round 7 found missing", () => {
    expect(dangerSourceWord("The seeds contain cyanide.")).toBe("cyanide");
    expect(dangerSourceWord("Eating it causes seizures and liver failure.")).toBe("seizures");
    expect(dangerSourceWord("It is a known carcinogen.")).toBe("carcinogen");
    expect(dangerSourceWord("Bats may carry rabies.")).toBe("rabies");
    expect(dangerSourceWord("It is a vector of Chagas disease.")).toBe("Chagas");
    expect(dangerSourceWord("Contact can cause phytodermatitis.")).toBe("phytodermatitis");
    expect(dangerSourceWord("Bites may require hospitalization.")).toBe("Bites");
    expect(dangerSourceWord("Stings may require hospitalization.")).toBe("Stings");
    expect(dangerSourceWord("Cases may require hospitalization.")).toBe("hospitalization");
    expect(dangerSourceWord("It is not toxic. Its berries are, however, emetic and purgative.")).toBe("emetic");
    expect(dangerSourceWord("It causes severe pain and swelling.")).toBe("severe pain");
    expect(dangerSourceWord("Their bite sometimes requires medical attention.")).toBe("bite");
    expect(dangerSourceWord("The sting sometimes requires medical attention.")).toBe("sting");
    expect(dangerSourceWord("This sometimes requires medical attention.")).toBe("medical attention");
    for (const t of ["cyanide", "seizures", "carcinogenic", "rabies", "Chagas", "Lyme disease", "phytodermatitis", "emetic", "swelling"]) {
      expect(dangerClueWord(`Find the plant: ${t}.`), t).not.toBeNull();
    }
  });

  it("harmless text still passes", () => {
    expect(dangerSourceWord("The painted bunting is a colourful songbird.")).toBeNull();
    expect(dangerSourceWord("A bitter-tasting but harmless fruit; the habitat is limestone.")).toBeNull();
    expect(dangerSourceWord("It eats biscuits, bitterns and bittersweet berries.")).toBeNull();
  });
});

describe("SEC-7-03: text folding before every safety match", () => {
  const crafted: [string, string][] = [
    ["poísonous", "combining acute accent"],
    ["poi͏sonous", "combining grapheme joiner (Mn, not Cf)"],
    ["pois̶onous", "combining long stroke (strike-through)"],
    ["töxic", "precomposed o with diaeresis"],
    ["töxic", "o + combining diaeresis"],
    ["ᴛᴏxɪᴄ", "Latin small capitals"],
    ["poi️sonous", "variation selector"],
    ["poiㅤsonous", "Hangul filler"],
    ["vеnоmous", "Cyrillic look-alikes (round 6, still caught)"],
    ["p­oisonous", "soft hyphen (round 6, still caught)"],
  ];
  for (const [s, what] of crafted) {
    it(`${what}: both checks see it`, () => {
      expect(dangerSourceWord(`It is ${s}.`), s).not.toBeNull();
      expect(dangerClueWord(`Find the ${s} plant.`), s).not.toBeNull();
    });
  }
  it("blocked names are folded the same way", () => {
    expect(blockedWordIn("a sc̶orpion under a rock")).toMatch(/scorpion/i);
    expect(blockedWordIn("a récluse")).toMatch(/recluse/i);
    expect(blockedWordIn("ᴡᴀsp nest")).toBe("wasp");
  });
  it("plain text is unchanged apart from the fold (accents go: 'café' reads 'cafe')", () => {
    expect(safetyText("Café near the creek")).toBe("Cafe near the creek");
    expect(safetyText("a  red oak")).toBe("a red oak");
  });
});

describe("SEC-7-02: the species' own names are checked for blocked words before the model sees them", () => {
  it("rattlesnake master (allowed taxon, no danger word in its summary) is left off by its name and counted as blocked", () => {
    const name = "Eryngium yuccifolium";
    expect(blockedBy(lineage(name))).toBeNull();
    const s = summaries.find((x) => x.id === real(name).id)!;
    expect(dangerSourceWord(s.summary!)).toBeNull();
    const pool = wildPool(listOf([name]), summaries, "2026-09-22", undefined, { describableOnly: false });
    expect(pool.items).toEqual([]);
    expect(pool.blocked).toBe(1);
    // The look-alike bug with a harmless name is not counted as blocked.
    expect(wildPool(listOf(["Oncopeltus fasciatus"]), summaries, "2026-09-22", undefined, { describableOnly: false }).blocked).toBe(0);
  });
  it("the Southern Devil Scorpion's own name holds a blocked word (it is also blocked by taxon now)", () => {
    expect(blockedWordIn(`${real("Vaejovis carolinianus").preferred_common_name}. Vaejovis carolinianus`)).toBe("Scorpion");
  });
  it("only the common + Latin names are matched, so a blocked word inside a longer word does not count", () => {
    expect(blockedWordIn("scorpionweed. Phacelia")).toBeNull();
    expect(blockedWordIn("Eastern Hornet Fly. Spilomyia longicornis")).toBe("Hornet"); // accepted false hit (harmless hoverfly)
  });
});

describe("the recorded summaries of the 20 eval parks: what the round-7 words stop", () => {
  const dir = path.join(process.cwd(), "tests/fixtures/evals");
  const all = new Map<number, { name: string; common: string | null; sum: TaxonSummary; ancestors: number[] }>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { exchanges: { what: string; body: unknown }[] };
    const sc = j.exchanges.find((e) => e.what === "species_counts");
    if (!sc) continue;
    const list = parseSpeciesCounts(sc.body);
    const sums = j.exchanges.filter((e) => e.what === "taxa").flatMap((e) => parseTaxa(e.body));
    for (const s of list.species) {
      const sum = sums.find((x) => x.id === s.taxonId);
      if (sum?.summary) all.set(s.taxonId, { name: s.name, common: s.commonName, sum, ancestors: [...s.ancestorIds, ...sum.ancestorIds] });
    }
  }
  const NEW_WORD = /^(?:bites?|biting|cyanide\w*|seizures?|carcinogen\w*|rabies|chagas|lyme|hospitali[sz]\w*|medical attention|emetic|purgative|severe pain|swelling|\w+dermatitis)$/i;

  it("all 240 distinct species with a summary are checked", () => {
    expect(all.size).toBe(240);
  });
  it("the new words stop only species that are blocked by taxon anyway (no new false drop)", () => {
    const hits: string[] = [];
    for (const [id, t] of all) {
      const w = dangerSourceWord([t.common ?? "", t.name, ...(t.sum.names ?? []), t.sum.summary ?? ""].join(". "), { taxonId: id, ancestorIds: t.ancestors });
      if (w && NEW_WORD.test(w)) hits.push(`${t.name}:${w}:${blockedBy({ taxonId: id, ancestorIds: t.ancestors })?.name ?? "allowed"}`);
    }
    // None: the rough greensnake (Trinity: "seldom bites. Even when bites occur, they have no venom and are harmless")
    // is NOT stopped. (Outside the eval parks, the real Brown Recluse, conenose and tick summaries are: see above.)
    expect(hits).toEqual([]);
  });
  it("the name check stops no recorded species with a usable summary that the taxon list allows", () => {
    const hits = [...all].filter(([id, t]) => !blockedBy({ taxonId: id, ancestorIds: t.ancestors }) && blockedWordIn(`${t.common ?? ""}. ${t.name}`));
    expect(hits.map(([, t]) => t.name)).toEqual([]);
  });
});
