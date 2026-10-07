/**
 * Round-6 Q-6-03, the deferred bits (eval r8, 2026-10-06):
 * - a lichen is not a "fungus" to a child (`wrong_kind`), and not a "who" (code writes "What");
 * - a near give-away of the common name the stem check cannot see ("globe" for Globular Drop Snail) is a `name_trait`
 *   preference.
 * Real clues: the round-6 quality audit (Connemara example pass, Find 5 and Find 6) and builder Z's live check
 * (Connemara, Find 6). Real taxa: the recorded Connemara Meadow eval fixture (iNaturalist, recorded Oct 5-6, 2026).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixLichenWho, KIND_TAXA, wrongKindWord } from "@/lib/ai/jargon";
import { nameLeak, nameRootLeak, validateDraft } from "@/lib/ai/validate";
import type { PoolItem } from "@/lib/pool/types";

type RawTaxon = { id: number; name: string; preferred_common_name?: string; ancestor_ids?: number[]; wikipedia_summary?: string | null };
const fixture = JSON.parse(readFileSync(join(resolve(__dirname, "../.."), "tests/fixtures/evals/connemara-meadow-preserve.json"), "utf8")) as unknown;
function findTaxon(common: string, withSummary = false): RawTaxon {
  let found: RawTaxon | null = null;
  const walk = (o: unknown): void => {
    if (found || !o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    const t = o as RawTaxon;
    if (t.preferred_common_name === common && Array.isArray(t.ancestor_ids) && t.ancestor_ids.length > 0 && (!withSummary || !!t.wikipedia_summary)) {
      found = t;
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(fixture);
  if (!found) throw new Error(`not in the fixture: ${common}`);
  return found;
}
const lichen = findTaxon("Golden-eye Lichen");
const snail = findTaxon("Globular Drop Snail", true);
const lineage = (t: RawTaxon) => ({ taxonId: t.id, ancestorIds: t.ancestor_ids ?? [] });

describe("Q-6-03: a lichen is a lichen (wrong_kind)", () => {
  it("the real lichen record sits under the lichen class id", () => {
    expect(lichen.name).toBe("Teloschistes chrysophthalmus");
    expect(lichen.ancestor_ids).toContain(KIND_TAXA.lichens);
  });
  it("'a fungus' for Golden-eye Lichen is a wrong kind (builder Z's live clue); 'a lichen' is fine", () => {
    expect(wrongKindWord("Spot a fungus with bright-orange parts that have spikes.", lineage(lichen))).toBe("fungus");
    expect(wrongKindWord("Who has bright-orange rims with spiny projections?", lineage(lichen))).toBeNull();
    expect(wrongKindWord("Spot a lichen with bright-orange parts that have spikes.", lineage(lichen))).toBeNull();
    expect(wrongKindWord("Look for a tiny orange bush growing on a branch.", lineage(lichen))).toBeNull();
  });
  it("'Who ...?' for a lichen becomes 'What ...?' (the recorded Connemara clue and the audit's example clue)", () => {
    expect(fixLichenWho("Who has bright-orange parts with spiny projections?", lineage(lichen))).toBe("What has bright-orange parts with spiny projections?");
    expect(fixLichenWho("Who has bright-orange rims with spiny projections?", lineage(lichen))).toBe("What has bright-orange rims with spiny projections?");
    expect(fixLichenWho("Guess who is bright orange on this branch?", lineage(lichen))).toBe("Guess what is bright orange on this branch?");
    expect(fixLichenWho("Spot a lichen that is bright orange.", lineage(lichen))).toBe("Spot a lichen that is bright orange.");
  });
  it("'who' stays for things that are not lichens", () => {
    expect(fixLichenWho("Who has a round shell and lives in the leaves?", lineage(snail))).toBe("Who has a round shell and lives in the leaves?");
    expect(wrongKindWord("Who has a round shell and lives in the leaves?", lineage(snail))).toBeNull();
  });
});

describe("Q-6-03 (c): a near give-away of the common name is a name_trait preference", () => {
  it("'like a globe' for Globular Drop Snail: the stem check misses it, the root check sees it", () => {
    const clue = "Point to a land snail with a shell that is like a globe.";
    expect(nameLeak(clue, ["globular drop snail", "globular", "helicina orbiculata", "helicina", "orbiculata"])).toBeNull();
    expect(nameRootLeak(clue, "Globular Drop Snail (Helicina orbiculata)")).toBe("globe");
  });
  it("only common-name words count, and not -ed words", () => {
    expect(nameRootLeak("Track a small turtle with red near its ears.", "Pond Slider (Trachemys scripta)")).toBeNull();
    expect(nameRootLeak("Look for a plant that climbs up other things.", "Climbing hempvine (Mikania scandens)")).toBe("climbs");
    expect(nameRootLeak("Find a bug with spots on its wings.", "Spotted Spreadwing (Lestes congener)")).toBeNull();
  });
  it("in validateDraft: kept (no hard leak), flagged name_trait, so a spare goes first", () => {
    // The real summary says nothing about the shell's shape. "globe" passes the generic check only because its first
    // 4 letters match "Globular" in the label: the give-away itself.
    const summary = (snail.wikipedia_summary ?? "").replace(/<[^>]+>/g, "");
    const item = {
      id: `inat-${snail.id}`,
      section: "wild",
      kind: "snail or slug",
      sourceText: `Globular Drop Snail (Helicina orbiculata). ${summary}`,
      answer: "Globular Drop Snail (Helicina orbiculata)",
      evidence: "seen nearby · iNaturalist",
      source: "iNaturalist",
      nameWords: ["globular drop snail", "globular", "helicina orbiculata", "helicina", "orbiculata", "oligyra"],
      safety: "Look, don't touch.",
      stationary: false,
      taxon: lineage(snail),
    } as unknown as PoolItem;
    const draft = { itemId: item.id, section: "wild", clue: "Point to a land snail with a shell that is like a globe.", lookWhere: "", sourceQuote: "a species of land snail with an operculum", difficulty: "easy" };
    const mix = { n: 1, min: { park: 0, wild: 1, lucky: 0 }, max: { park: 0, wild: 1, lucky: 0 }, hardMin: 0 };
    const out = validateDraft({ items: [draft] }, [item], mix, { hasMap: false, band: "6-10" });
    expect(out.drops).toEqual({});
    expect(out.items.map((i) => i.style)).toEqual(["name_trait"]);
  });
});
