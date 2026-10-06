/**
 * Audit round 5: S1 (a live 10-13 pass for Tenney Park printed white snakeroot as "a poisonous perennial
 * herb") and C3 / Q-5-01 (clues that paste Wikipedia). Real iNaturalist records only
 * (tests/fixtures/inat-taxa-toxic-plants-and-lookalikes.json, recorded live 2026-10-06).
 */
import { describe, expect, it } from "vitest";
import { blockedBy, dangerClueWord, dangerSourceWord } from "@/lib/safety/danger-taxa";
import { parseTaxa, type SpeciesList } from "@/lib/sources/inat";
import { kidSourceText, wildPool } from "@/lib/pool/wild";
import { validateDraft } from "@/lib/ai/validate";
import { computeMix, kidWordsRule, PROMPT_EXAMPLE_TEXTS, systemPrompt } from "@/lib/ai/prompt";
import { jargonProblem, measureCount, triviaProblem } from "@/lib/ai/jargon";
import { stockOpening } from "@/lib/ai/validate";
import { rec } from "./support/pass-replay";

type RawTaxon = {
  id: number;
  name: string;
  preferred_common_name: string;
  ancestor_ids: number[];
  rank: string;
  iconic_taxon_name: string;
  wikipedia_summary: string | null;
};
const FIXTURE = "inat-taxa-toxic-plants-and-lookalikes";
const raw = (rec(FIXTURE).body as { results: RawTaxon[] }).results;
const byName = new Map(raw.map((t) => [t.name, t]));
const real = (name: string) => {
  const t = byName.get(name);
  if (!t) throw new Error(`not in the fixture: ${name}`);
  return t;
};
const summaries = parseTaxa(rec(FIXTURE).body);
const summaryOf = (name: string) => summaries.find((s) => s.id === real(name).id)!.summary!;
const listOf = (names: readonly string[]): SpeciesList => ({
  totalSpecies: names.length,
  totalObservations: names.length * 3,
  species: names.map((n) => {
    const t = real(n);
    return { taxonId: t.id, name: t.name, commonName: t.preferred_common_name, rank: t.rank, iconic: t.iconic_taxon_name, ancestorIds: t.ancestor_ids, count: 3 };
  }),
});

describe("S1: new hard-blocked groups match real iNaturalist species by ancestor_ids", () => {
  const cases: [string, number][] = [
    ["Ageratina altissima", 64116], // white snakeroot (the Tenney Park pass)
    ["Cicuta maculata", 60126], // water hemlock
    ["Conium maculatum", 52999], // poison hemlock
    ["Phytolacca americana", 48601], // pokeweed, now the whole genus
    ["Pastinaca sativa", 54899], // wild parsnip
    ["Heracleum maximum", 53095], // cow parsnip
    ["Melia azedarach", 53725], // chinaberry
    ["Nerium oleander", 47564], // oleander
    ["Ricinus communis", 56740], // castor bean
    ["Taxus baccata", 47555], // yew
    ["Dermatophyllum secundiflorum", 468609], // Texas mountain laurel
    ["Lantana urticoides", 50334], // Texas lantana
    ["Arisaema triphyllum", 50311], // jack-in-the-pulpit
    ["Amanita muscaria", 48419], // fly agaric
    ["Galerina marginata", 118297], // funeral bell
    ["Chlorophyllum molybdites", 117308], // green-spored parasol (the species itself)
  ];
  for (const [name, group] of cases) {
    it(`${name} (${real(name).preferred_common_name}) is blocked by group ${group}`, () => {
      const t = real(name);
      expect(blockedBy({ taxonId: t.id, ancestorIds: t.ancestor_ids })?.id).toBe(group);
    });
  }

  it("the harmless look-alikes stay allowed by the blocklist", () => {
    for (const name of ["Apis mellifera", "Bombus impatiens", "Thamnophis sirtalis", "Opheodrys aestivus", "Pantherophis obsoletus", "Danaus plexippus", "Asclepias syriaca", "Passer domesticus", "Verbena hastata", "Anolis carolinensis", "Libellula luctuosa", "Leucocoprinus birnbaumii", "Senna lindheimeriana"]) {
      const t = real(name);
      expect(blockedBy({ taxonId: t.id, ancestorIds: t.ancestor_ids }), name).toBeNull();
    }
  });
});

describe("S1: danger words in the SOURCE text leave a species off before the model sees it", () => {
  it("the Tenney Park case: white snakeroot's real summary says 'a poisonous perennial herb'", () => {
    const s = summaryOf("Ageratina altissima");
    expect(s).toContain("is a poisonous perennial herb");
    expect(dangerSourceWord(s)?.toLowerCase()).toBe("poisonous");
  });

  it("species the blocklist doesn't name are caught by their own words (real summaries)", () => {
    expect(dangerSourceWord(summaryOf("Leucocoprinus birnbaumii"))?.toLowerCase()).toBe("poisonous"); // "poisonous, if consumed"
    expect(dangerSourceWord(summaryOf("Senna lindheimeriana"))?.toLowerCase()).toBe("lethally"); // "lethally toxic to livestock"
    expect(dangerSourceWord(summaryOf("Conium maculatum"))).not.toBeNull();
    expect(dangerSourceWord(summaryOf("Nerium oleander"))?.toLowerCase()).toBe("toxic");
    expect(dangerSourceWord(summaryOf("Galerina marginata"))?.toLowerCase()).toBe("poisonous");
    expect(dangerSourceWord(summaryOf("Chlorophyllum molybdites"))).not.toBeNull();
    expect(dangerSourceWord(summaryOf("Phytolacca americana"))?.toLowerCase()).toBe("toxicity");
  });

  it("harmless species stay: negations ('nonvenomous', 'no venom ... harmless') and bees' own sting words", () => {
    for (const name of ["Opheodrys aestivus", "Pantherophis obsoletus", "Passer domesticus", "Verbena hastata", "Danaus plexippus", "Libellula luctuosa", "Anolis carolinensis", "Thamnophis sirtalis"]) {
      expect(dangerSourceWord(summaryOf(name)), name).toBeNull();
    }
    const bee = real("Apis mellifera");
    expect(dangerSourceWord(`${summaryOf("Apis mellifera")} Workers can sting.`, { taxonId: bee.id, ancestorIds: bee.ancestor_ids })).toBeNull();
    // ... but a sting is a danger word for anything that is not a bee.
    expect(dangerSourceWord("Its caterpillar has stinging spines.")).toBe("stinging");
  });

  it("word list: whole words, plural and adjective forms, phrases; not inside harmless words", () => {
    expect(dangerSourceWord("The berries are poisonous to humans.")).toBe("poisonous");
    expect(dangerSourceWord("It contains a neurotoxin.")).toBe("neurotoxin");
    expect(dangerSourceWord("Its sap is phototoxic.")).toBe("phototoxic");
    expect(dangerSourceWord("a mildly venomous snake")).toBe("venomous");
    expect(dangerSourceWord("Ingestion can be fatal.")).toBe("fatal");
    expect(dangerSourceWord("Contact causes a rash.")).toBe("rash");
    expect(dangerSourceWord("The hairs are an irritant.")).toBe("irritant");
    expect(dangerSourceWord("Do not eat the fruit.")).toBe("Do not eat");
    expect(dangerSourceWord("It is deadly.")).toBe("deadly");
    expect(dangerSourceWord("a non-toxic, nonvenomous and not poisonous animal; it has no venom and is harmless")).toBeNull();
    expect(dangerSourceWord("brash colours on a rashly painted wall")).toBeNull();
    expect(dangerSourceWord("an edible fruit and a sweet nectar")).toBeNull();
  });

  it("a pool from the real records keeps only the safe, describable species", () => {
    const names = ["Ageratina altissima", "Leucocoprinus birnbaumii", "Senna lindheimeriana", "Conium maculatum", "Passer domesticus", "Verbena hastata", "Opheodrys aestivus", "Danaus plexippus"];
    const pool = wildPool(listOf(names), summaries, "2026-09-22");
    const kept = pool.items.map((i) => i.answer);
    for (const bad of ["white snakeroot", "flowerpot parasol", "Lindheimer's Senna", "poison hemlock"]) {
      expect(kept.join(" | ").toLowerCase()).not.toContain(bad.toLowerCase());
    }
    expect(pool.blocked).toBe(4);
    for (const item of pool.items) expect(dangerSourceWord(item.sourceText), item.answer).toBeNull();
  });
});

describe("S1: danger words in the model's clue are dropped after the model", () => {
  const pool = wildPool(listOf(["Passer domesticus", "Verbena hastata", "Danaus plexippus", "Opheodrys aestivus"]), summaries, "2026-09-22", undefined, { describableOnly: false }).items;
  const mix = computeMix({ park: 0, wild: pool.length, lucky: 0 }, "10-13")!;
  const vervain = pool.find((p) => p.answer.startsWith("Blue vervain"))!;

  it("the Tenney Park clue, on a safe item, is dropped as danger", () => {
    const clue = "Hunt for a plant with seeds or fruit that is a poisonous perennial herb.";
    expect(dangerClueWord(clue)).toBe("poisonous");
    const out = validateDraft(
      { items: [{ itemId: vervain.id, section: "wild", clue, lookWhere: "", sourceQuote: "opposite, simple leaves", difficulty: "hard" }] },
      pool,
      mix,
      { hasMap: false, band: "10-13" },
    );
    expect(out.items).toEqual([]);
    expect(out.drops.danger).toBe(1);
  });

  it("clue danger words: no negation allowed on a kids' pass", () => {
    expect(dangerClueWord("Spot a snake that is not venomous.")).toBe("venomous");
    expect(dangerClueWord("Spot a nonvenomous green snake.")).toBe("nonvenomous");
    expect(dangerClueWord("Watch the fuzzy bee; it stings!")).toBe("stings");
    expect(dangerClueWord("Find berries that are toxic to birds.")).toBe("toxic");
    expect(dangerClueWord("Point to a tall plant with purple spikes.")).toBeNull();
  });
});

describe("C3: the text sent to the model loses taxonomy and weights (real summaries)", () => {
  it("house sparrow: no family name, no mass; the length stays", () => {
    const t = kidSourceText(summaryOf("Passer domesticus"));
    expect(t).not.toMatch(/Passeridae|family|mass|39\.5|oz\b/);
    expect(t).toContain("16 cm");
    expect(t).toMatch(/pale brown/);
  });
  it("blue vervain: 'in the vervain family, Verbenaceae' goes; the leaves and stems stay", () => {
    const t = kidSourceText(summaryOf("Verbena hastata"));
    expect(t).not.toMatch(/Verbenaceae|family/);
    expect(t).toContain("square stems");
  });
  it("monarch: the (subfamily Danainae) aside and 'in the family Nymphalidae' go", () => {
    const t = kidSourceText(summaryOf("Danaus plexippus"));
    expect(t).not.toMatch(/Danainae|Nymphalidae|subfamily/);
    expect(t).toMatch(/milkweed butterfly/);
  });
  it("sentences about names and classification are left out", () => {
    const t = kidSourceText("A tall plant with white flowers. An older binomial name for this species is Eupatorium rugosum. It grows in shade.");
    expect(t).toBe("A tall plant with white flowers. It grows in shade.");
  });
});

describe("C3 / Q-5-01: jargon (always dropped) and trivia (a preference), real printed clues", () => {
  const jargon: string[] = [
    "Where is a moth of the Crambidae family?",
    "Spot a mammal from the family Vespertilionidae.",
    "Watch for a phrynosomatid reptile that is native to south central United States.",
    "Watch for a bug that is shiny black with pale yellow hindtarsomere.",
    "Who has a typical length of 16 cm and a mass of 24-39.5 g?",
    "Somewhere you will see the most widespread species in its genus.",
    "Hunt for a plant that is the most variable species in North America.",
    "Peek at the tiny bug with a red pterostigma.",
    "What plant has an inflorescence of tiny white flowers?",
  ];
  for (const clue of jargon) {
    it(`jargon: "${clue}"`, () => expect(jargonProblem(clue, "6-10")).not.toBeNull());
  }
  const trivia: string[] = [
    "Hunt for a lizard native to Texas and Oklahoma.",
    "Watch for a spider common to Hawaii and Mexico.",
    "Which tree is native to eastern North America?",
    "Point to a land snail with an operculum.",
    "Watch for a lizard that is arboreal and lives in the trees.",
    "Watch for a bird that is black.",
    "Peek at a bird that is a large aquatic soaring bird.",
  ];
  for (const clue of trivia) {
    it(`trivia: "${clue}"`, () => {
      expect(jargonProblem(clue, "6-10")).toBeNull();
      expect(triviaProblem(clue, "6-10")).not.toBeNull();
    });
  }
  const fine: string[] = [
    "Spot a small brown bird with a grey cap hopping under the picnic tables.",
    "Point to a tall plant with purple flower spikes on square stems.",
    "Watch for an orange butterfly with black veins and white dots on its wings.",
    "Count the 4 roofs over the picnic tables.",
    "Peek at a green lizard on a fence that can turn brown.",
    "Find a katydid or an aphid on a leaf.",
    "Notice a dragonfly with clear wings about 5 cm long.",
  ];
  for (const clue of fine) {
    it(`fine for every band: "${clue}"`, () => {
      expect(jargonProblem(clue, "10-13")).toBeNull();
      expect(triviaProblem(clue, "10-13")).toBeNull();
    });
  }

  it("bands: 4-6 drops any measurement; 6-10 and 10-13 allow one (a range is one); 2+ is jargon everywhere", () => {
    const one = "Notice a dragonfly with clear wings about 5 cm long.";
    expect(jargonProblem(one, "4-6")).not.toBeNull();
    expect(jargonProblem(one, "6-10")).toBeNull();
    expect(measureCount("16 cm (6.3 in)")).toBe(2);
    expect(measureCount("24-39.5 g")).toBe(1);
    // A range is one measurement (run -6: "a small shorebird that is 18-20 cm long" stays for 6-10).
    expect(jargonProblem("Watch for a small shorebird that is 18-20 cm long.", "6-10")).toBeNull();
    expect(jargonProblem("A bird 16 cm long with wings 25 cm across.", "10-13")).not.toBeNull();
  });
  it("bands: 10-13 may say thorax or larva; younger bands get them as trivia", () => {
    const clue = "Spot a bee with a fuzzy yellow thorax on the flowers.";
    expect(triviaProblem(clue, "10-13")).toBeNull();
    expect(triviaProblem(clue, "6-10")).toBe("thorax");
  });
  it("'for a bird that is' is a stock phrase anywhere in a clue (Q-5-01, M10 #2 repeat)", () => {
    expect(stockOpening("Watch for a bird that is grey with a long tail.")).toBe("for a bird that is");
    expect(stockOpening("Spot a grey bird with a long tail.")).toBeNull();
  });

  it("in validateDraft: jargon is dropped, trivia is kept only when no spare can replace it", () => {
    const pool = wildPool(listOf(["Passer domesticus", "Verbena hastata", "Danaus plexippus", "Opheodrys aestivus", "Anolis carolinensis"]), summaries, "2026-09-22", undefined, { describableOnly: false }).items;
    const sparrow = pool.find((p) => p.answer.startsWith("House Sparrow"))!;
    const vervain = pool.find((p) => p.answer.startsWith("Blue vervain"))!;
    const mix = { n: 1, min: { park: 0, wild: 1, lucky: 0 }, max: { park: 0, wild: 1, lucky: 0 }, hardMin: 0 };
    const ask = { ...mix, n: 2, max: { park: 0, wild: 2, lucky: 0 } };
    const out = validateDraft(
      {
        items: [
          { itemId: vervain.id, section: "wild", clue: "Point to a plant with an inflorescence on square stems.", lookWhere: "", sourceQuote: "branching square stems", difficulty: "easy" },
          { itemId: sparrow.id, section: "wild", clue: "Spot a pale brown and grey bird native to Europe.", lookWhere: "", sourceQuote: "coloured pale brown and grey", difficulty: "easy" },
        ],
      },
      pool,
      mix,
      { hasMap: false, band: "6-10", ask },
    );
    expect(out.drops.jargon).toBe(1);
    // The trivia clue is the only one left, so it is printed (a preference, never a lost find).
    expect(out.items.map((i) => i.item.id)).toEqual([sparrow.id]);
    expect(out.items[0].style).toBe("trivia");
  });

  it("the prompt asks for kid words and quotes the bad examples (copying one is dropped)", () => {
    const mix = computeMix({ park: 2, wild: 4, lucky: 0 }, "10-13")!;
    const p = systemPrompt("10-13", mix, null, { month: 10 });
    expect(p).toContain(kidWordsRule());
    expect(p).not.toMatch(/Use the exact describing words/);
    expect(PROMPT_EXAMPLE_TEXTS).toContain("Where is a moth of the Crambidae family?");
  });
});
