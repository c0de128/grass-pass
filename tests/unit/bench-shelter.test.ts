/**
 * Bench/shelter fix (2026-10-07). Builder AH's two complete Celebration Park warm-up passes (gemma-4-31B-it, made
 * 2026-10-07 about 10:10 AM CDT by `warmExamples`, both id w188145317-6to10-20261007-1 in fresh in-memory stores) each
 * printed a picnic-shelter clue with the answer "Benches". The shelter was the Find This Spot target, so its facts were
 * in the same prompt (for the riddle). The bench's own fact sheet says nothing about a roof.
 *
 * Every clue below is the REAL printed clue of those two passes, with its real item. The passes did not save the
 * model's proof quotes, so each test item gets a real phrase of its own Celebration fact sheet as its quote (the
 * check under test reads the clue and the item's facts, not the quote).
 */
import { describe, expect, it } from "vitest";
import { buildMessages, systemPrompt, userPrompt, type Mix } from "@/lib/ai/prompt";
import { FEATURE_SIGNATURE_WORDS, featureKindOfId, otherFeatureWord } from "@/lib/ai/feature-words";
import { DROP_REASONS, validateDraft } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { KIND_FACTS, parkPool } from "@/lib/pool/park";
import type { PoolItem } from "@/lib/pool/types";
import { FEATURE_KIND_IDS, FEATURE_KINDS, parseFeatures, parseParkId } from "@/lib/sources/overpass-features";
import { PARKS, rec } from "./support/pass-replay";

const celebration = parkPool(parseFeatures(rec(`overpass-features-${PARKS.celebration.slug}`).body, parseParkId(PARKS.celebration.id)!)!).items;
const byId = (id: string) => {
  const item = celebration.find((p) => p.id === id);
  if (!item) throw new Error(`not in the Celebration pool: ${id}`);
  return item;
};

/** A real 4-word phrase of the item's own fact sheet (after the "on the map (OpenStreetMap)." sentence). */
function quoteOf(item: PoolItem): string {
  const facts = item.sourceText.split("(OpenStreetMap).").pop()!.trim();
  return facts.split(/\s+/).slice(1, 5).join(" ");
}

/** Pass 1 (run1) and pass 2 (run2): every printed park clue, in print order, with its item. */
const PASS_1: [string, string][] = [
  ["osm-bench", "Spot a place with a roof and pillars where people eat."],
  ["osm-water", "Point to the water that shines like a mirror."],
  ["osm-fountain", "Check for the water that glitters in the sun."],
  ["osm-bridge", "Which thing carries hikers above water and has railings?"],
  ["osm-basketball", "Hunt for the 2 flat smooth areas with rings on tall posts."],
  ["osm-playground", "Somewhere kids climb ladders to reach a play tower."],
  ["osm-tennis", "Peek at the 4 flat courts with a low net in the center."],
  ["osm-baseball", "Where are the sandy areas with a white base at every turn?"],
];
const PASS_2: [string, string][] = [
  ["osm-bench", "Spot me! I have pillars holding up a roof to keep you dry in the rain."],
  ["osm-basketball", "Point to the 2 flat areas where rings on tall posts wait for a ball."],
  ["osm-fountain", "Check the water that glitters as it falls from the air."],
  ["osm-water", "Which place has a mirror shine on a calm day?"],
  ["osm-tennis", "Hunt for the 4 flat areas with a low net in the middle."],
  ["osm-baseball", "Watch a sandy area with a white base at every turn."],
  ["osm-playground", "Peek at the tower where kids climb ladders to reach the top."],
  ["osm-bridge", "Where is the path that carries hikers above a ditch?"],
];

describe("the Celebration bench clues that described the picnic shelter", () => {
  it("the bench fact sheet says nothing about a roof or pillars (the words came from the shelter)", () => {
    const bench = byId("osm-bench");
    expect(bench.sourceText.toLowerCase()).not.toMatch(/roof|pillar/);
    expect(byId("osm-shelter").sourceText.toLowerCase()).toMatch(/roof|cover/);
  });

  it.each([PASS_1[0], PASS_2[0]])("%s: %s -> other_feature", (id, clue) => {
    expect(otherFeatureWord(clue, byId(id))).not.toBeNull();
  });

  it("every other printed clue of both passes is about its own item and is not flagged", () => {
    for (const [id, clue] of [...PASS_1.slice(1), ...PASS_2.slice(1)]) {
      expect(otherFeatureWord(clue, byId(id)), `${id}: ${clue}`).toBeNull();
    }
  });

  it("validateDraft drops the bench clue (a real bench quote, so grounding alone let it through)", () => {
    for (const pass of [PASS_1, PASS_2]) {
      const items = pass.map(([itemId, clue]) => {
        const item = byId(itemId);
        return { itemId, section: "park", clue, lookWhere: "", difficulty: "easy", sourceQuote: quoteOf(item) };
      });
      const mix: Mix = { n: 8, min: { park: 2, wild: 0, lucky: 0 }, max: { park: 8, wild: 0, lucky: 0 }, hardMin: 0 };
      const traced: string[] = [];
      const r = validateDraft({ items }, celebration, mix, { hasMap: true, trace: (d) => traced.push(`${d.reason}:${d.itemId}`) });
      expect(traced).toContain("other_feature:osm-bench");
      expect(r.drops.other_feature).toBe(1);
      expect(r.items.map((v) => v.item.id)).not.toContain("osm-bench");
      // A content failure: the refill offers other items before the bench again.
      expect(r.failedIds).toContain("osm-bench");
    }
  });

  it("the grounding check alone passes the bench item (why a new check was needed)", () => {
    const bench = byId("osm-bench");
    const items = [{ itemId: "osm-bench", section: "park", clue: "Spot a long seat by the path.", lookWhere: "", difficulty: "easy", sourceQuote: quoteOf(bench) }];
    const mix: Mix = { n: 1, min: { park: 1, wild: 0, lucky: 0 }, max: { park: 1, wild: 0, lucky: 0 }, hardMin: 0 };
    const r = validateDraft({ items }, celebration, mix, { hasMap: true });
    expect(r.drops).toEqual({});
    expect(r.items).toHaveLength(1);
  });
});

describe("otherFeatureWord", () => {
  const item = (kind: string, sourceText: string, section = "park") => ({ id: `osm-${kind.replace(/_/g, "-")}`, section, sourceText });

  it("a shelter clue may say roof, a bench clue may not", () => {
    expect(otherFeatureWord("Spot a roof on poles.", item("shelter", "It has a cover on poles."))).toBeNull();
    expect(otherFeatureWord("Spot a seat under a roof.", item("bench", "It is a long seat."))).toBe("roof");
    expect(otherFeatureWord("Notice the seat with pillars.", item("bench", "It is a long seat."))).toBe("pillar");
  });

  it("the item's own SOURCE always wins (a playground's 'play tower', a bench with side rails)", () => {
    expect(otherFeatureWord("Peek at the tower kids climb.", item("playground", "Kids use ladders to get to the top of the play tower."))).toBeNull();
    expect(otherFeatureWord("Spot a table in the shade.", item("shelter", "It has a roof and tables below it."))).toBeNull();
    expect(otherFeatureWord("Spot a seat by a table.", item("bench", "It is a long seat."))).toBe("table");
    expect(otherFeatureWord("Spot a seat by a table.", item("bench", "It is a long seat next to a table."))).toBeNull();
  });

  it("Wild and Lucky clues are never checked", () => {
    expect(otherFeatureWord("Watch for a bird that nests under a roof.", item("x", "A bird.", "wild"))).toBeNull();
    expect(otherFeatureWord("You might see a dog on a leash.", { id: "lucky-dog", section: "lucky", sourceText: "A dog." })).toBeNull();
  });

  it("every signature word's kinds are real feature kinds, and every pool id maps back to its kind", () => {
    for (const kinds of Object.values(FEATURE_SIGNATURE_WORDS)) for (const k of kinds) expect(FEATURE_KIND_IDS).toContain(k);
    for (const p of celebration) expect(Object.keys(FEATURE_KINDS)).toContain(featureKindOfId(p.id));
    expect(featureKindOfId("osm-picnic-table")).toBe("picnic_table");
    expect(featureKindOfId("inat-123")).toBeNull();
  });

  it("no feature's own fact bank trips the check on a clue that copies its own facts", () => {
    for (const kind of FEATURE_KIND_IDS) {
      for (const fact of KIND_FACTS[kind]) {
        const plain = fact.replace(/\{([^{}|]*)\|[^{}]*\}/g, "$1");
        expect(otherFeatureWord(plain, item(kind, plain)), `${kind}: ${plain}`).toBeNull();
      }
    }
  });
});

describe("the prompt keeps each item's facts with its own item", () => {
  const mix: Mix = { n: 8, min: { park: 2, wild: 2, lucky: 0 }, max: { park: 6, wild: 6, lucky: 0 }, hardMin: 0 };
  const spot = { id: "way/536185861", label: "picnic shelter", sourceText: "It has a roof held up by pillars." };

  it("says each clue uses only its own item's SOURCE, and the SPOT facts are for the riddle only", () => {
    const s = systemPrompt("6-10", mix, spot, { month: 10 });
    expect(s).toContain("- Each clue uses facts ONLY from its own item's SOURCE.");
    expect(s).toContain("The SPOT facts are for this riddle only, never for a POOL clue.");
    expect(systemPrompt("6-10", mix, null, { month: 10 })).toContain("- Each clue uses facts ONLY from its own item's SOURCE.");
  });

  it("labels the SPOT source as the riddle's, not a POOL item", () => {
    const u = userPrompt("Celebration Park", celebration.slice(0, 2), spot);
    expect(u).toContain("SPOT (for the riddle only, not a POOL item):");
    expect(userPrompt("Celebration Park", celebration.slice(0, 2), null)).not.toContain("SPOT");
    expect(buildMessages("Celebration Park", celebration, "6-10", mix, spot, { month: 10 })[1].content).toContain("SPOT (for the riddle only");
  });
});

describe("the new drop reason is explained", () => {
  it("is a listed drop reason with plain words on /how-it-works", () => {
    expect(DROP_REASONS).toContain("other_feature");
    expect(DROP_REASON_INFO.other_feature.kind).toBe("always");
  });
});

describe("the pinned Celebration pass (made after this fix) has every Park Find clue about its own item", () => {
  it("no clue names another feature's own thing, and the bench clue has no roof", async () => {
    const { pinnedPass } = await import("@/lib/pinned");
    const pass = pinnedPass("celebration");
    expect(pass).not.toBeNull();
    const park = pass!.items.filter((i) => i.section === "park");
    expect(park.length).toBeGreaterThan(0);
    for (const i of park) {
      const ref = (i as { ref?: string }).ref;
      expect(ref, i.clue).toBeTruthy();
      expect(otherFeatureWord(i.clue, byId(ref!)), `${ref}: ${i.clue}`).toBeNull();
    }
    const bench = park.find((i) => (i as { ref?: string }).ref === "osm-bench");
    if (bench) expect(bench.clue.toLowerCase()).not.toMatch(/roof|pillar/);
  });
});
