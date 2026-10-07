/**
 * r7 follow-ups (eval run 2026-10-06-7) + round-6 audit items in the same code (2026-10-06):
 * - safety: the blocklist (spurges, tarantulas, stinging wasps, blister beetles, and round-6 SEC-6-01's regional
 *   hazards), one danger-word list for source and model text (SEC-6-02, Q-6-01), invisible and look-alike letters;
 * - clue quality: "families" in our own Park Finds facts, range/habitat facts, two-word bare colours, wrong kind
 *   words, numbered segments, plurals, plain-word false positives (Q-6-04/05), hints that contradict the clue (Q-6-03);
 * - round-6 judge C4: one listening clue a pass, water facts to see, the water stock phrases;
 * - Q-6-02: the water line and the grown-up's tip for every find by the water;
 * - the prompt budget (M8) and M1 by taxon id.
 * Real iNaturalist records: tests/fixtures/inat-taxa-r7-hazards-and-lookalikes.json (recorded live 2026-10-06).
 * Real clues are quoted from evals/results/2026-10-06-7.json and the round-6 audit reports.
 */
import { describe, expect, it } from "vitest";
import { computeMix, kidWordsRule, openersFor, STOCK_FRAMES_PROMPT, systemPrompt, voiceFor } from "@/lib/ai/prompt";
import { jargonProblem, KIND_TAXA, subjectWords, triviaKind, triviaProblem, wrongKindWord } from "@/lib/ai/jargon";
import { hintContradicts, isSoundClue, parentNoteFor, stockOpening, validateDraft, withWaterSafety, type ValidItem } from "@/lib/ai/validate";
import { chooseWords, KIND_FACTS } from "@/lib/pool/park";
import type { PoolItem } from "@/lib/pool/types";
import { wildPool } from "@/lib/pool/wild";
import { BLOCKED_TAXA, blockedBy, blockedWordIn, dangerClueWord, dangerSourceWord, safetyText, SAFETY_LINES } from "@/lib/safety/danger-taxa";
import { parseTaxa, stripHtml, type SpeciesList } from "@/lib/sources/inat";
import { safetyViolations, soundThemes, type CaseContext, type RunRecord } from "../../evals/score";
import { rec } from "./support/pass-replay";

type RawTaxon = { id: number; name: string; rank: string; preferred_common_name?: string; iconic_taxon_name: string; ancestor_ids: number[]; wikipedia_summary: string | null };
const FIXTURE = "inat-taxa-r7-hazards-and-lookalikes";
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

describe("blocklist: every new group stops a real species through its real ancestor_ids", () => {
  const cases: [string, string][] = [
    // r7 follow-ups
    ["Euphorbia bicolor", "Euphorbia"], // snow-on-the-prairie, 4 Cedar Ridge passes of run -7
    ["Euphorbia marginata", "Euphorbia"],
    ["Euphorbia maculata", "Euphorbia"],
    ["Aphonopelma hentzi", "Theraphosidae"], // Texas Brown Tarantula, Arbor Hills ("a big bug")
    ["Sceliphron caementarium", "Sphecidae"],
    ["Chalybion californicum", "Sphecidae"],
    ["Trypoxylon politum", "Crabronidae"], // Organ-pipe Mud-dauber, Trinity
    ["Sphecius speciosus", "Crabronidae"], // cicada killer
    ["Dasymutilla occidentalis", "Pompiloidea"], // velvet ant "cow killer"
    ["Pepsis grossa", "Pompiloidea"], // tarantula hawk
    ["Scolia dubia", "Scoliidae"],
    ["Myzinum quinquecinctum", "Thynnidae"],
    ["Tiphia vernalis", "Tiphioidea"],
    ["Epicauta pensylvanica", "Meloidae"],
    // round-6 SEC-6-01
    ["Gelsemium sempervirens", "Gelsemium"],
    ["Erythrina herbacea", "Erythrina"],
    ["Campsis radicans", "Campsis"],
    ["Nandina domestica", "Nandina"],
    ["Ligustrum quihoui", "Ligustrum"],
    ["Aesculus pavia", "Aesculus"],
    ["Robinia pseudoacacia", "Robinia"],
    ["Tragia ramosa", "Tragia"],
    ["Mucuna pruriens", "Mucuna"],
    ["Dieffenbachia seguine", "Dieffenbachia"],
    ["Caladium bicolor", "Caladium"],
    ["Parthenocissus quinquefolia", "Parthenocissus"],
    ["Nephroia carolina", "Nephroia"], // iNat moved Carolina snailseed out of Cocculus
    ["Phoradendron leucarpum", "Phoradendron"],
    ["Wisteria sinensis", "Wisteria"],
    ["Ranunculus sardous", "Ranunculus"],
    ["Omphalotus illudens", "Omphalotus"],
    ["Megalopyge crispata", "Megalopygidae"],
    ["Acharia stimulea", "Limacodidae"], // saddleback
    ["Phobetron pithecium", "Limacodidae"], // hag moth
    ["Automeris io", "Automeris"],
    ["Hemileuca maia", "Hemileuca"],
    ["Rhinella marina", "Rhinella"],
  ];
  for (const [species, group] of cases) {
    it(`${species} is blocked by ${group}`, () => {
      expect(blockedBy(lineage(species))?.name).toBe(group);
    });
  }
  it("covers every new group with a real species", () => {
    // Round-7 SEC-7-01's 8 groups after Rhinella have their own real species in sec7-safety.test.ts.
    const fresh = BLOCKED_TAXA.slice(BLOCKED_TAXA.findIndex((t) => t.name === "Euphorbia"), BLOCKED_TAXA.findIndex((t) => t.name === "Rhinella") + 1).map((t) => t.name);
    expect(fresh).toHaveLength(31);
    for (const g of fresh) expect(cases.some(([, c]) => c === g), g).toBe(true);
  });
  it("harmless look-alikes stay allowed (toads that are not cane toads, bees, milkweed, monarch, spiders, grape, cicada)", () => {
    for (const n of ["Incilius nebulifer", "Xylocopa virginica", "Bombus pensylvanicus", "Asclepias viridis", "Danaus plexippus", "Argiope aurantia", "Phidippus audax", "Vitis mustangensis", "Ipomoea lacunosa", "Neotibicen superbus"]) {
      expect(blockedBy(lineage(n)), n).toBeNull();
    }
  });
  it("the common names are blocked words too", () => {
    expect(blockedWordIn("Look for the snow-on-the-prairie by the path.")).toBe("snow-on-the-prairie");
    expect(blockedWordIn("A big tarantula crossed the trail.")).toBe("tarantula");
    expect(blockedWordIn("the mud daubers' nests")).toMatch(/mud dauber/i);
    expect(blockedWordIn("a fuzzy red velvet ant")).toBe("velvet ant");
    expect(blockedWordIn("Spot the trumpet creeper on the fence.")).toBe("trumpet creeper");
    expect(blockedWordIn("Spot the trumpet vine.")).toBeNull(); // "trumpet vine" alone is the clue example word; the taxon id blocks it
  });
});

describe("danger words: one list for source and model text (SEC-6-02, Q-6-01)", () => {
  it("the real Campsis summary ('cow itch vine') is caught by its own words", () => {
    const s = summaries.find((x) => x.id === real("Campsis radicans").id)!.summary!;
    expect(s).toMatch(/cow itch/i);
    expect(dangerSourceWord(s)).toMatch(/itch/i);
  });
  it("source text: the sentences round 6 found missing", () => {
    expect(dangerSourceWord("The plant is harmless-looking, but ingestion can cause death.")).toBe("death");
    expect(dangerSourceWord("Its seeds can kill livestock.")).toBe("kill");
    expect(dangerSourceWord("The wound can cause severe necrosis.")).toBe("necrosis");
    expect(dangerSourceWord("The bite can cause severe necrosis.")).toBe("bite"); // round 7: "bite" is a source word too
    expect(dangerSourceWord("Contact causes painful skin welts and severe itching.")).toBe("painful");
    expect(dangerSourceWord("It can cause an allergic reaction and anaphylaxis.")).toBe("allergic");
    expect(dangerSourceWord("The hairs are urticating.")).toBe("urticating");
    expect(dangerSourceWord("The berries are considered unsafe to eat.")).toBe("unsafe to eat");
    expect(dangerSourceWord("Not considered dangerous, it nonetheless has a painful bite.")).toBe("painful");
    expect(dangerSourceWord("Its milky sap can irritate the skin and eyes.")).toBe("irritate");
    expect(dangerSourceWord("The hairs are an irritant.")).toBe("irritant");
  });
  it("source text: harmless words are not caught", () => {
    expect(dangerSourceWord("The killdeer is a large plover.")).toBeNull();
    expect(dangerSourceWord("Its leaves switch colour; a kitchen garden plant.")).toBeNull();
    expect(dangerSourceWord("an edible fruit and a sweet nectar")).toBeNull();
  });
  it("bees keep their own sting words, including 'painful' (ADR 0003: 'It can sting.')", () => {
    const bee = lineage("Bombus pensylvanicus");
    expect(dangerSourceWord("Females can deliver a painful sting.", bee)).toBeNull();
    expect(dangerSourceWord("Females can deliver a painful sting.")).toBe("painful");
  });
  it("model text: itch, bite and allergy words are dropped; 'bite-sized' is fine", () => {
    expect(dangerClueWord("Find a vine that can make your skin itch.")).toBe("itch");
    expect(dangerClueWord("Spot a big hairy spider that can bite.")).toBe("bite");
    expect(dangerClueWord("Point to a plant that gives people an allergic sneeze.")).toBe("allergic");
    expect(dangerClueWord("Count the bite-sized red berries on the vine.")).toBeNull();
    expect(dangerClueWord("Its seeds can kill a cow.")).toBe("kill");
  });
  it("invisible characters and Cyrillic/Greek look-alike letters no longer hide a word", () => {
    expect(dangerSourceWord("The berries are p­oisonous.")).toBe("poisonous");
    expect(dangerSourceWord("The berries are po​isonous.")).toBe("poisonous");
    expect(dangerSourceWord("It is tоxic.")).toBe("toxic");
    expect(dangerClueWord("a vεnomous snake")).toBe("venomous");
    expect(blockedWordIn("pоison ivy")).toBe("poison ivy");
    expect(safetyText("a⁠b﻿c")).toBe("abc");
    expect(stripHtml("p&shy;oisonous")).toBe("poisonous");
  });
});

/** Every full expansion of a "{a|b}" fact template. */
function expandAll(template: string): string[] {
  const m = /\{([^{}]*)\}/.exec(template);
  if (!m) return [template];
  return m[1].split("|").flatMap((alt) => expandAll(template.slice(0, m.index) + alt + template.slice(m.index + m[0].length)));
}

describe("jargon: our own Park Finds facts and plain words are never jargon (r7 'families', Q-6-04)", () => {
  it("no expansion of any Park Finds fact template is jargon, in any section or band", () => {
    let n = 0;
    for (const bank of Object.values(KIND_FACTS)) {
      for (const t of bank) {
        for (const fact of expandAll(t)) {
          n++;
          for (const band of ["4-6", "6-10", "10-13"] as const) expect(jargonProblem(fact, band, "park"), fact).toBeNull();
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(KIND_FACTS.sports_field.some((f) => /families/.test(f))).toBe(true);
    expect(KIND_FACTS.shelter.some((f) => /Families/.test(f))).toBe(true);
  });
  it("a clue quoting those facts keeps its words: 'families' as people", () => {
    expect(jargonProblem("Spot the big lined field where players and families play running games.", "6-10", "park")).toBeNull();
    expect(jargonProblem("Families and friends meet under this roof for parties.", "6-10", "park")).toBeNull();
  });
  it("'family' as a rank is still jargon on any band", () => {
    for (const c of ["Hunt for a flower of the aster family.", "Spot a plant in the pea family.", "a bird from the family Turdidae", "a plant from the same family as mint", "Its family name is long."]) {
      expect(jargonProblem(c, "10-13"), c).not.toBeNull();
    }
  });
  it("Q-6-04: plain words and phrases are fine", () => {
    expect(jargonProblem("Find the bus terminal by the parking lot.", "6-10", "park")).toBeNull();
    expect(jargonProblem("Lift your own weight at the fitness station.", "6-10", "park")).toBeNull();
    expect(jargonProblem("Watch for a bird that is unafraid of people.", "6-10")).toBeNull();
    expect(jargonProblem("Notice the sign with inlaid tiles.", "6-10", "park")).toBeNull();
    expect(jargonProblem("Count the benches in the order you see them.", "6-10", "park")).toBeNull();
    expect(jargonProblem("Spot the most common bird at the feeder.", "6-10")).toBeNull();
    expect(jargonProblem("Peek at a green praying mantid on a stem.", "6-10")).toBeNull();
    // ... but a weight with a number, and a rank order, still are.
    expect(jargonProblem("Who has a weight of 30 g?", "6-10")).not.toBeNull();
    expect(jargonProblem("a moth in the order Lepidoptera", "10-13")).not.toBeNull();
  });
  it("Q-6-04: 'species' is a rank word for 4-10 and a plain word for 10-13 (a younger-band preference only)", () => {
    const c = "Spot one of the many species of beetle on the log.";
    expect(jargonProblem(c, "6-10")).toBe("species");
    expect(jargonProblem(c, "10-13")).toBeNull();
    expect(triviaProblem(c, "10-13")).toBeNull();
  });
  it("numbered body segments are jargon (run -7, ages 6-10)", () => {
    expect(jargonProblem("Which bug has blue on its tail segments 8 and 9?", "6-10")).toBe("segments 8 and 9");
    expect(jargonProblem("Peek for a small fly with blue on its belly segments 8 and 9.", "6-10")).toBe("segments 8 and 9");
    expect(jargonProblem("Look for blue on segment 3 of its tail.", "10-13")).toBe("segment 3");
  });
});

describe("trivia: what the checks missed in run -7 (real clues)", () => {
  const nothing: string[] = [
    "Watch for a bird that is resident in the central United States.", // Frisco
    "Hunt for a lizard from the south central United States.", // Spring Creek
    "Where is the tree that grows in riparian zones?", // Connemara
    "Check for a flying animal that is red.", // Klyde Warren
    "Point to a small bird that is yellow.", // Klyde Warren
    "Where is the animal that is red?", // Klyde Warren
    "Peek at a bird that is yellow.", // Klyde Warren
    "Check for a bug that is black and gold.", // garden spider
  ];
  for (const c of nothing) {
    it(`nothing to see: "${c}"`, () => {
      expect(triviaKind(c, "6-10")?.kind).toBe("nothing_to_see");
    });
  }
  it("a field-guide word next to a real trait is a preference (word), plurals included (Q-6-05)", () => {
    expect(triviaKind("Watch for a large semiaquatic rodent.", "6-10")).toEqual({ kind: "word", match: "semiaquatic" });
    expect(triviaKind("What plant has leaves made of many pairs of oblong leaflets?", "6-10")?.kind).toBe("word");
    expect(triviaProblem("What plant has leaves with many leaflets?", "6-10")).toBe("leaflets");
    expect(triviaProblem("Who has bright-orange rims with spiny projections?", "6-10")).toBe("projections");
    expect(triviaProblem("What has large, intricate flowers with prominent styles and stamens?", "10-13")).toBe("styles and stamens");
  });
  it("real traits are not trivia", () => {
    for (const c of ["Watch for a small bird that is yellow below and greenish above.", "Spot a bird that hides from us in the reeds.", "Who has a red cap and a black and white back?"]) {
      expect(triviaKind(c, "6-10"), c).toBeNull();
    }
  });
});

describe("wrong kind words (iNaturalist lineage, run -7)", () => {
  it("KIND_TAXA ids are in the real lineages", () => {
    expect(real("Argiope aurantia").ancestor_ids).toContain(KIND_TAXA.arachnida);
    expect(real("Danaus plexippus").ancestor_ids).toContain(KIND_TAXA.insecta);
    expect(real("Incilius nebulifer").ancestor_ids).toContain(KIND_TAXA.chordata);
    expect(real("Neotibicen superbus").ancestor_ids).not.toContain(KIND_TAXA.diptera);
  });
  it("a spider is not a bug; a wild fish is not a pet; a damselfly is not a fly; a bat is not a bird", () => {
    expect(wrongKindWord("Watch for a big bug with a dark brown body.", lineage("Aphonopelma hentzi"))).toBe("bug");
    expect(wrongKindWord("Check for a bug that is black and gold.", lineage("Argiope aurantia"))).toBe("bug");
    expect(wrongKindWord("Who is a water pet that can grow to about 24 cm long?", undefined)).toBe("pet");
    expect(wrongKindWord("Peek for a small fly with blue on its tail.", lineage("Neotibicen superbus"))).toBe("fly");
    expect(wrongKindWord("Watch for a bird with red fur at dusk.", lineage("Incilius nebulifer"))).toBe("bird");
  });
  it("the subject phrase decides: 'a lizard that eats bugs' and 'a bird that flies' are fine", () => {
    expect(subjectWords("Spot a lizard eating bugs on the wall.")).toEqual(["lizard"]);
    expect(wrongKindWord("Spot a toad that eats bugs at night.", lineage("Incilius nebulifer"))).toBeNull();
    expect(wrongKindWord("Watch for a spider with a zigzag web.", lineage("Argiope aurantia"))).toBeNull();
    expect(wrongKindWord("Spot a bug with orange wings.", lineage("Danaus plexippus"))).toBeNull();
    expect(wrongKindWord("Point to the dragonfly that flies over the water.", lineage("Neotibicen superbus"))).toBeNull();
  });
});

describe("in validateDraft (real Wild Finds from the fixture)", () => {
  const pool = wildPool(listOf(["Argiope aurantia", "Danaus plexippus", "Ipomoea lacunosa", "Phidippus audax"]), summaries, "2026-09-22", undefined, { describableOnly: false }).items;
  const spider = pool.find((p) => p.answer.startsWith("Bold Jumping Spider"))!;
  const quote = (p: PoolItem, word: RegExp) => {
    const m = new RegExp(`[^.]{0,30}${word.source}[^.,;]{0,25}`, "i").exec(p.sourceText);
    if (!m) throw new Error(`no ${word} in ${p.answer}`);
    return m[0].trim();
  };
  const mix = { n: 1, min: { park: 0, wild: 1, lucky: 0 }, max: { park: 0, wild: 1, lucky: 0 }, hardMin: 0 };
  const ask = { ...mix, n: 2, max: { park: 0, wild: 2, lucky: 0 } };
  it("the pool keeps them (they are allowed species)", () => {
    expect(spider).toBeDefined();
  });
  it("'a bug' for a jumping spider is dropped as wrong_kind", () => {
    const out = validateDraft(
      { items: [{ itemId: spider.id, section: "wild", clue: "Check for a black bug with spots and stripes on its legs.", lookWhere: "", sourceQuote: "a pattern of spots and stripes", difficulty: "easy" }] },
      pool,
      mix,
      { hasMap: false, band: "6-10", ask },
    );
    expect(out.drops.wrong_kind).toBe(1);
    expect(out.items).toEqual([]);
  });
  it("a bare colour is dropped on a pool with spares and printed (flagged) on a low-data pool", () => {
    const item = { itemId: spider.id, section: "wild", clue: "Watch for a small animal that is black.", lookWhere: "", sourceQuote: quote(spider, /black/), difficulty: "easy" };
    const rich = validateDraft({ items: [item] }, pool, mix, { hasMap: false, band: "6-10", ask });
    expect(rich.drops.trivia).toBe(1);
    expect(rich.failedIds).toContain(spider.id);
    const low = validateDraft({ items: [item] }, pool, mix, { hasMap: false, band: "6-10", ask, lowData: true });
    expect(low.items.map((i) => [i.item.id, i.style])).toEqual([[spider.id, "trivia"]]);
  });
});

/** Built Park Finds (test input: the fact sentences are the bank's own). */
const parkItem = (id: string, kind: string, sourceText: string, safety: string | null = null): PoolItem => ({
  id,
  section: "park",
  kind,
  sourceText,
  answer: kind,
  evidence: "on the park map · OpenStreetMap",
  source: "OpenStreetMap",
  nameWords: [kind],
  safety,
  stationary: true,
  count: { of: [], n: null },
});

describe("round-6 judge C4: listening clues and water facts", () => {
  const creek = parkItem("osm-creek", "creek or stream", "Test Park has a creek or stream on the map (OpenStreetMap). Flowing water in it can make a soft gurgling sound.", SAFETY_LINES.water);
  const fountain = parkItem("osm-fountain", "fountain", "Test Park has a fountain on the map (OpenStreetMap). You can hear its water splashing as you get close.", SAFETY_LINES.water);
  const bench = parkItem("osm-bench", "bench", "Test Park has 4 benches on the map (OpenStreetMap). They can be made of wood, metal or stone.");
  const mix = { n: 2, min: { park: 2, wild: 0, lucky: 0 }, max: { park: 2, wild: 0, lucky: 0 }, hardMin: 0 };
  const ask = { ...mix, n: 3, max: { park: 3, wild: 0, lucky: 0 } };
  const items = [
    { itemId: "osm-creek", section: "park", clue: "Peek at the running water that makes a soft gurgling noise.", lookWhere: "", sourceQuote: "can make a soft gurgling sound", difficulty: "easy" },
    { itemId: "osm-fountain", section: "park", clue: "Notice the spout you can hear splashing up close.", lookWhere: "", sourceQuote: "You can hear its water splashing", difficulty: "easy" },
    { itemId: "osm-bench", section: "park", clue: "Spot the seats made of wood, metal or stone.", lookWhere: "", sourceQuote: "made of wood, metal or stone", difficulty: "easy" },
  ];
  it("a second sound clue on a pass is dropped (the first one stays)", () => {
    const out = validateDraft({ items }, [creek, fountain, bench], mix, { hasMap: false, band: "6-10", ask });
    expect(out.drops.repeats_clue).toBe(1);
    expect(out.items.map((i) => i.item.id)).toEqual(["osm-creek", "osm-bench"]);
    expect(isSoundClue(items[0].clue) && isSoundClue(items[1].clue)).toBe(true);
  });
  it("... and is only a preference on a low-data pool", () => {
    const out = validateDraft({ items: items.slice(0, 2) }, [creek, fountain, bench], mix, { hasMap: false, band: "6-10", lowData: true });
    // (The creek clue also holds the stock water shape "water that makes a": a preference of its own.)
    expect(out.items.map((i) => [i.item.id, i.style ?? null])).toEqual([["osm-creek", "repeats_opening"], ["osm-fountain", "repeats_clue"]]);
  });
  it("the water-by-ear shapes of the example passes are stock phrases (they go first when a spare exists)", () => {
    for (const c of [
      "Where is the water that makes a gentle rushing sound?", // hero card / Connemara
      "Point to the water that can make a quiet gurgling sound.", // Arbor Hills
      "Hunt for the water that you can hear splashing.", // Celebration and White Rock, word for word
    ]) {
      expect(stockOpening(c), c).not.toBeNull();
    }
    expect(stockOpening("Count the 4 roofed areas with poles and tables below them.")).toBeNull();
  });
  it("creek and fountain facts are mostly things to see (the sound fact is 1 of 6 and 1 of 5)", () => {
    const sound = (bank: readonly string[]) => bank.filter((f) => isSoundClue(f.replace(/\{([^|}]*)[^}]*\}/g, "$1"))).length;
    expect([sound(KIND_FACTS.creek), KIND_FACTS.creek.length]).toEqual([1, 6]);
    expect([sound(KIND_FACTS.fountain), KIND_FACTS.fountain.length]).toEqual([1, 5]);
    // Word variety: the sound fact itself has 3 x 4 x 4 wordings.
    expect(new Set(expandAll(KIND_FACTS.creek.find((f) => /sound/.test(f))!)).size).toBe(48);
    expect(chooseWords(KIND_FACTS.creek[4], "x")).toMatch(/along on top of its water\.$/);
  });
  it("the prompt asks for at most one listening clue and sight for water, and names the water frame", () => {
    const sys = systemPrompt("6-10", computeMix({ park: 6, wild: 6, lucky: 0 }, "6-10")!, null, { month: 10, openers: ["Spot"] });
    expect(sys).toContain("in at most ONE clue per pass. For water, say what the child can see.");
    expect(STOCK_FRAMES_PROMPT).toContain('"Where is the water that"');
  });
});

describe("Q-6-02: every find by the water gets the water line and is in the grown-up's tip", () => {
  const v = (item: PoolItem, clue: string, lookWhere = "", difficulty: ValidItem["difficulty"] = "medium"): ValidItem => ({ item, clue, lookWhere, difficulty, sourceQuote: "x" });
  const bridge = parkItem("osm-bridge", "bridge", "It lets a path cross over water or a dip in the ground.");
  const frog = { ...parkItem("inat-1", "frog", "A large frog."), section: "wild" as const, safety: SAFETY_LINES.wildlife, stationary: false };
  const bench = parkItem("osm-bench", "bench", "Benches.");
  it("a bridge 'high over water' and a frog with 'Look: near the water' carry the line (round-6 live examples)", () => {
    expect(withWaterSafety(v(bridge, "Where is the walkway that goes high over water?", "near the water")).item.safety).toBe(SAFETY_LINES.water);
    expect(withWaterSafety(v(frog, "Watch for a big green frog with a loud call.", "near the water")).item.safety).toBe(`${SAFETY_LINES.wildlife} ${SAFETY_LINES.water}`);
    expect(withWaterSafety(v(bench, "Spot 4 seats by the path.")).item.safety).toBeNull();
    // Live check 2026-10-06 (Trinity): a drinking fountain's clue says water, but it is no water hazard.
    const drink = parkItem("osm-drinking-water", "drinking fountain", "It gives you a sip of water.");
    expect(withWaterSafety(v(drink, "What gives you a swallow of cool water when you push a button?")).item.safety).toBeNull();
  });
  it("the tip lists them", () => {
    const items = [v(bench, "Spot 4 seats by the path.", "", "easy"), v(bridge, "Where is the walkway that goes high over water?"), v(frog, "Watch for a big green frog.", "near the water")].map(withWaterSafety);
    expect(parentNoteFor(items)).toBe("Start with find 1: it's easy and it stays put. Finds 2 and 3 are near water: stay close.");
  });
});

describe("Q-6-03: a hint that contradicts its clue is left out", () => {
  it("real example-pass pairs", () => {
    expect(hintContradicts("Which tree has bumpy, round fruit that is bright yellow-green?", "on bushes")).toBe(true);
    expect(hintContradicts("Notice a tree with oval leaves that are glossy dark green on top.", "on tree trunks")).toBe(true);
    expect(hintContradicts("Notice the thick, corky lumps on this tree's bark.", "on tree trunks")).toBe(false);
    expect(hintContradicts("Spot a bush with red berries.", "on bushes")).toBe(false);
  });
});

describe("prompt budget (M8): run -7's first calls averaged 3,084 prompt tokens; the goal is about 2,850", () => {
  it("the 6-10 system prompt of a full mixed pass stays under 6,300 characters (7,154 in run -7)", () => {
    const mix = { n: 8, min: { park: 2, wild: 2, lucky: 0 }, max: { park: 6, wild: 6, lucky: 0 }, hardMin: 0 };
    const s = systemPrompt("6-10", mix, null, { month: 10, openers: openersFor("Arbor Hills", 8), voice: voiceFor("Arbor Hills", "6-10"), hasSeasonNotes: true });
    expect(s.length).toBeLessThan(6_300);
  });
  it("the kid-words rule keeps its five kinds of words, the bare colour and two BAD phrases in under 450 characters", () => {
    const r = kidWordsRule();
    expect(r.length).toBeLessThan(450);
    for (const w of ["family, genus or species", "Latin group name", "a weight", "field-guide word", "where in the world it lives", "poisonous, venomous or stings", "One colour alone"]) expect(r).toContain(w);
    expect(r).toContain('"a moth of the Crambidae family"');
  });
});

describe("eval M1 judges printed Wild Finds by taxon id (r7 follow-ups)", () => {
  const tarantula = real("Aphonopelma hentzi");
  const ctx = {
    caseN: 3,
    parkName: "Arbor Hills",
    pool: [],
    n: 8,
    dataRich: true,
    totalObservations: 30,
    parkEmpty: false,
    wildEmpty: false,
    blockedNames: [],
    plan: null,
    taxonByAnswer: new Map([[`texas brown tarantula (${tarantula.name.toLowerCase()})`, { taxonId: tarantula.id, ancestorIds: tarantula.ancestor_ids }]]),
  } satisfies CaseContext;
  const run = (items: RunRecord["items"]): RunRecord => ({ caseN: 3, slug: "arbor", parkName: "Arbor Hills", model: "m", run: 1, kind: "pass", sections: {}, n: 8, dataRich: true, items, calls: [], wallMs: 0 });
  it("a printed tarantula from run -7 ('a big bug', no blocked word in the clue) is a violation today", () => {
    const out = safetyViolations(run([{ section: "wild", clue: "Watch for a big bug with a dark brown body.", lookWhere: "", answer: "Texas Brown Tarantula (Aphonopelma hentzi)" }]), ctx);
    expect(out).toEqual([`Texas Brown Tarantula (Aphonopelma hentzi): blocked taxon ${tarantula.id} (in Theraphosidae 47424)`]);
  });
  it("a recorded taxonId is used when present", () => {
    const out = safetyViolations(run([{ section: "wild", clue: "Spot it.", lookWhere: "", answer: "something else", taxonId: tarantula.id }]), ctx);
    expect(out).toHaveLength(1);
  });
  it("soundThemes counts passes with listening clues across parks", () => {
    const s = soundThemes([run([{ section: "park", clue: "Where is the water that makes a gentle rushing sound?", lookWhere: "", answer: "Creek" }]), { ...run([{ section: "park", clue: "Spot 4 seats.", lookWhere: "", answer: "Benches" }]), caseN: 4 }]);
    expect(s).toEqual({ passes: 2, withSound: 1, waterSound: 1, waterSoundParks: 1, twoOrMore: 0 });
  });
});
