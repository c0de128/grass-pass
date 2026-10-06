import { describe, expect, it } from "vitest";
import {
  BLOCKED_TAXA,
  BLOCKED_WORDS,
  blockedBy,
  blockedWordIn,
  isBlocked,
  isStationary,
  SAFETY_LINES,
  safetyLineFor,
  TAXA,
} from "@/lib/safety/danger-taxa";
import { parseSpeciesCounts, parseTaxa } from "@/lib/sources/inat";
import { wildCandidates, wildPool } from "@/lib/pool/wild";
import { validateDraft } from "@/lib/ai/validate";
import { computeMix } from "@/lib/ai/prompt";
import { PARKS, rec } from "./support/pass-replay";

type RawTaxon = { id: number; name: string; preferred_common_name: string; ancestor_ids: number[]; rank: string; iconic_taxon_name: string; wikipedia_summary: string | null };
const planted = (rec("inat-taxa-planted-dangers").body as { results: RawTaxon[] }).results;

describe("hard-blocked taxa (ADR 0003): one test per entry", () => {
  for (const t of BLOCKED_TAXA) {
    it(`${t.name} (${t.id}, ${t.common}) is blocked itself and through any descendant's ancestor_ids`, () => {
      expect(blockedBy({ taxonId: t.id, ancestorIds: [] })?.id).toBe(t.id);
      // A made-up descendant id under it: blocked via the ancestor list (this is how species are matched).
      expect(blockedBy({ taxonId: 999_999_999, ancestorIds: [48460, 1, t.id] })?.id).toBe(t.id);
    });
  }

  it("has the 15 ADR ids plus Urtica (51886) and Solanum (50641), no duplicates", () => {
    const ids = BLOCKED_TAXA.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([48137, 47370, 30668, 30692, 30979, 30493, 67598, 51079, 48599, 84185, 48943, 52747, 133074, 53765, 119059, 51886, 50641]),
    );
  });

  it("SPEC 6.4 planted cases, REAL iNat records: Copperhead, Brown Recluse, Poison Ivy, Fire Ant, Pokeweed are all blocked", () => {
    expect(planted.map((t) => t.preferred_common_name)).toEqual([
      "Eastern Copperhead",
      "Brown Recluse",
      "eastern poison ivy",
      "Red Imported Fire Ant",
      "American pokeweed",
    ]);
    for (const t of planted) expect(isBlocked({ taxonId: t.id, ancestorIds: t.ancestor_ids }), t.name).toBe(true);
  });

  it("real allowed species from the Connemara recording are not blocked", () => {
    const list = parseSpeciesCounts(rec(`inat-species-${PARKS.connemara.slug}`).body);
    const byName = new Map(list.species.map((s) => [s.commonName, s]));
    for (const name of ["Maximilian sunflower", "Osage-orange", "Red-shouldered Hawk", "Globular Drop Snail"]) {
      const s = byName.get(name)!;
      expect(isBlocked({ taxonId: s.taxonId, ancestorIds: s.ancestorIds }), name).toBe(false);
    }
  });
});

describe("danger filter before the model (pool)", () => {
  it("the real Connemara list loses Brown Recluse, pokeweed, horsenettle and buffalo-bur before any summary call", () => {
    const list = parseSpeciesCounts(rec(`inat-species-${PARKS.connemara.slug}`).body);
    const names = list.species.map((s) => s.commonName);
    expect(names).toEqual(expect.arrayContaining(["Brown Recluse", "American pokeweed", "western horsenettle", "buffalo-bur"]));
    const { candidates, blocked } = wildCandidates(list);
    const kept = new Set(candidates.map((c) => c.taxonId));
    for (const id of [50181, 48599, 79136, 62642]) expect(kept.has(id)).toBe(false);
    expect(blocked).toBeGreaterThanOrEqual(4);
  });

  it("a pool built from ONLY the five planted dangers (real summaries) has no items and says why", () => {
    const list = {
      totalSpecies: planted.length,
      totalObservations: planted.length,
      species: planted.map((t) => ({
        taxonId: t.id,
        name: t.name,
        commonName: t.preferred_common_name,
        rank: t.rank,
        iconic: t.iconic_taxon_name,
        ancestorIds: t.ancestor_ids,
        count: 3,
      })),
    };
    const summaries = parseTaxa(rec("inat-taxa-planted-dangers").body);
    const pool = wildPool(list, summaries, "2026-09-21");
    expect(pool.items).toEqual([]);
    expect(pool.blocked).toBe(5);
    expect(pool.state.status).toBe("empty");
  });
});

describe("danger filter after the model (defence in depth)", () => {
  const list = parseSpeciesCounts(rec(`inat-species-${PARKS.connemara.slug}`).body);
  const summaries = parseTaxa(rec(`inat-taxa-${PARKS.connemara.slug}`).body);
  // R2-M5 leaves undescribable species (the sunflower) out of the app's pool; this defence-in-depth test needs one.
  const pool = wildPool(list, summaries, "2026-09-21", undefined, { describableOnly: false }).items;
  const mix = computeMix({ park: 0, wild: pool.length, lucky: 0 }, "6-10")!;
  const sunflower = pool.find((p) => p.answer.startsWith("Maximilian sunflower"))!;

  it("an id for a blocked species (Brown Recluse) is never in the pool, so the model can't print it", () => {
    const out = validateDraft(
      { items: [{ itemId: "inat-50181", section: "wild", clue: "Look for a small brown eight-legged hunter.", lookWhere: "under a log", sourceQuote: "spider", difficulty: "hard" }], parentNote: "" },
      pool,
      mix,
    );
    expect(out.items).toEqual([]);
    expect(out.drops.unknown_id).toBe(1);
  });

  it("a safe item whose clue names a blocked thing is dropped", () => {
    const out = validateDraft(
      {
        items: [
          { itemId: sunflower.id, section: "wild", clue: "Find a tall yellow plant, not poison ivy!", lookWhere: "in the meadow", sourceQuote: sunflower.sourceText.slice(40, 90), difficulty: "easy" },
        ],
        parentNote: "",
      },
      pool,
      mix,
    );
    expect(out.drops.danger).toBe(1);
  });

  it("a pool item whose taxon is blocked is re-checked after the model (not only before)", () => {
    const sneaky = { ...sunflower, id: "inat-48599", taxon: { taxonId: 48599, ancestorIds: [47126] } };
    const out = validateDraft(
      { items: [{ itemId: sneaky.id, section: "wild", clue: "Find a tall yellow plant in the sun.", lookWhere: "in the meadow", sourceQuote: sneaky.sourceText.slice(40, 90), difficulty: "easy" }], parentNote: "" },
      [sneaky],
      mix,
    );
    expect(out.items).toEqual([]);
    expect(out.drops.danger).toBe(1);
  });
});

describe("blocked words", () => {
  it("matches whole words and plurals in any case, not inside other words", () => {
    expect(blockedWordIn("Watch out for Wasps!")).toBe("Wasps");
    expect(blockedWordIn("a rattlesnake")).toBe("rattlesnake");
    expect(blockedWordIn("Poison Ivy vines")).toBe("Poison Ivy");
    expect(blockedWordIn("the devil’s trumpet flower")).toBe("devil's trumpet");
    expect(blockedWordIn("a pretty yellow flower")).toBeNull();
    expect(blockedWordIn("a big aspen tree")).toBeNull();
  });
  it("every blocked word is lower case", () => {
    for (const w of BLOCKED_WORDS) expect(w).toBe(w.toLowerCase());
  });
});

describe("fixed safety lines", () => {
  const t = (...ancestors: number[]) => ({ taxonId: 123, ancestorIds: ancestors });
  it("fungi, berries, spines, plants, caterpillars, bees, wildlife, small animals", () => {
    expect(safetyLineFor(t(TAXA.fungi), "a bracket fungus")).toBe(SAFETY_LINES.fungi);
    expect(safetyLineFor(t(TAXA.plants), "It has purple berries in fall.")).toBe(SAFETY_LINES.berries);
    expect(safetyLineFor(t(TAXA.plants), "has distinctive spined thick, corky lumps")).toBe(SAFETY_LINES.prickly);
    expect(safetyLineFor(t(TAXA.plants), "a tall grass")).toBe(SAFETY_LINES.plant);
    expect(safetyLineFor(t(TAXA.lepidoptera), "a butterfly")).toBe(SAFETY_LINES.caterpillar);
    expect(safetyLineFor(t(TAXA.honeyBees), "a bee")).toBe(SAFETY_LINES.bee);
    expect(safetyLineFor(t(TAXA.bumbleBees), "a bee")).toBe(SAFETY_LINES.bee);
    expect(safetyLineFor(t(TAXA.birds), "a hawk")).toBe(SAFETY_LINES.wildlife);
    expect(safetyLineFor(t(TAXA.mammals), "a squirrel")).toBe(SAFETY_LINES.wildlife);
    expect(safetyLineFor(t(47115), "a snail")).toBe(SAFETY_LINES.small);
  });
  it("a lichen gets a lichen line, not the mushroom line (judge R4: Connemara's Golden-eye Lichen)", () => {
    // Real ancestry of Teloschistes chrysophthalmus (taxon 55553) from tests/fixtures/inat-taxa-connemara-meadow-preserve.json.
    const goldenEye = { taxonId: 55553, ancestorIds: [48460, 47170, 48250, 372740, 54743, 952186, 54755, 54756, 1232043, 55554] };
    expect(safetyLineFor(goldenEye, "is a fruticose lichen with branching lobes")).toBe(SAFETY_LINES.lichen);
    expect(safetyLineFor(goldenEye, "")).toBe(SAFETY_LINES.lichen);
    // A lichen outside Lecanoromycetes is still caught by its own words.
    expect(safetyLineFor(t(TAXA.fungi), "a crustose lichen on rocks")).toBe(SAFETY_LINES.lichen);
    expect(safetyLineFor(t(TAXA.fungi, TAXA.lichinomycetes), "")).toBe(SAFETY_LINES.lichen);
    expect(SAFETY_LINES.lichen).not.toMatch(/mushroom/i);
    // A mushroom still gets the mushroom line.
    expect(safetyLineFor(t(TAXA.fungi), "a gilled mushroom")).toBe(SAFETY_LINES.fungi);
  });
  it("plants and fungi stay put; birds don't", () => {
    expect(isStationary(t(TAXA.plants))).toBe(true);
    expect(isStationary(t(TAXA.fungi))).toBe(true);
    expect(isStationary(t(TAXA.birds))).toBe(false);
  });
});
