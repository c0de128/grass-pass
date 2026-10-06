import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKS } from "../../scripts/copy/blocks.mts";
import { batchJsonSchema, checkDraft, numbersIn, properNouns, textIsInSource, type CopyBlock } from "../../scripts/copy/check.mts";
import { GEMMA_COPY } from "@/lib/about/content";

const ROOT = path.resolve(__dirname, "../..");

const block: CopyBlock = {
  id: "t",
  page: "/",
  file: "x",
  role: "card body",
  maxChars: 140,
  text: "Real sightings within 1.5 km in the last 14 days. Gemma quotes each source; {blocked} groups are never printed.",
  facts: ["Wild Finds come from iNaturalist."],
  keep: ["1.5 km", "14 days", "never printed"],
};

describe("checkDraft (Gemma copy code check)", () => {
  it("accepts a rewrite that keeps the facts", () => {
    expect(checkDraft(block, "Birds and blooms people spotted within 1.5 km over the last 14 days, from iNaturalist. {blocked} risky groups are never printed.")).toEqual({ ok: true, reasons: [] });
  });

  it("rejects a dropped fact, a new number, a lost placeholder and too much text", () => {
    const r = checkDraft(block, "Birds people spotted in the last 30 days. Risky ones are never printed. ".repeat(3));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" | ")).toMatch(/dropped a fact: "1.5 km"/);
    expect(r.reasons.join(" | ")).toMatch(/new number\(s\) not in FACTS: 30/);
    expect(r.reasons.join(" | ")).toMatch(/placeholders changed/);
    expect(r.reasons.join(" | ")).toMatch(/too long/);
  });

  it("rejects new number words, new names, hype words, emoji and markup", () => {
    const r = checkDraft(block, "Three magical finds within 1.5 km in 14 days, loved by Yellowstone rangers 🌲. {blocked} are **never printed**.");
    const all = r.reasons.join(" | ");
    expect(all).toMatch(/number word\(s\).*three/);
    expect(all).toMatch(/new name\(s\).*Yellowstone/);
    expect(all).toMatch(/banned word\(s\): magical/);
    expect(all).toMatch(/emoji/);
    expect(all).toMatch(/markup/);
  });

  it('always keeps "No data available"', () => {
    const b: CopyBlock = { ...block, text: "No data available: the map is busy.", keep: [], facts: [] };
    expect(checkDraft(b, "Sorry, the map is busy.").reasons).toContain('dropped a fact: "No data available"');
  });

  it("finds numbers and mid-sentence names", () => {
    expect(numbersIn("10–30 seconds, 1,321 parks, 1.5 km, {n} more")).toEqual(["10", "30", "1321", "1.5"]);
    expect(properNouns("Pick a park. Then Gemma writes: Code checks. It uses OpenStreetMap")).toEqual(["Gemma", "OpenStreetMap"]);
  });

  it("asks Gemma for exactly the batch's ids", () => {
    const s = batchJsonSchema(["a", "b"]) as { properties: { drafts: { minItems: number; maxItems: number; items: { properties: { id: { enum: string[] } } } } } };
    expect(s.properties.drafts.minItems).toBe(2);
    expect(s.properties.drafts.maxItems).toBe(2);
    expect(s.properties.drafts.items.properties.id.enum).toEqual(["a", "b"]);
  });
});

describe("the copy blocks", () => {
  it("have unique ids", () => {
    expect(new Set(BLOCKS.map((b) => b.id)).size).toBe(BLOCKS.length);
  });

  // If the text sent to Gemma fails its own rules, the rules (FACTS / KEEP / limits) are wrong, not Gemma.
  // Exception: blocks whose old text became untrue after the run (factFixAfterRun in review.json): their FACTS
  // were corrected, so the old text no longer passes them.
  const stale = new Set(
    (JSON.parse(readFileSync(path.join(ROOT, "docs/copy-by-gemma/review.json"), "utf8")) as { decisions: { id: string; factFixAfterRun?: boolean }[] }).decisions
      .filter((d) => d.factFixAfterRun)
      .map((d) => d.id),
  );
  it.each(BLOCKS.filter((b) => !stale.has(b.id)).map((b) => [b.id, b] as const))("%s: the sent text passes its own check", (_id, b) => {
    expect(checkDraft(b, b.text)).toEqual({ ok: true, reasons: [] });
  });
});

describe("the shipped copy is really in the code", () => {
  const review = JSON.parse(readFileSync(path.join(ROOT, "docs/copy-by-gemma/review.json"), "utf8")) as {
    decisions: { id: string; decision: "accepted" | "edited" | "rejected" | "unchanged"; shipped: string }[];
  };
  const byId = new Map(BLOCKS.map((b) => [b.id, b]));

  it("the /about and README credit numbers match the review", () => {
    const count = (k: string) => review.decisions.filter((d) => d.decision === k).length;
    expect(review.decisions.length).toBe(GEMMA_COPY.sent);
    expect(count("accepted") + count("edited")).toBe(GEMMA_COPY.shipped);
    expect(count("edited")).toBe(GEMMA_COPY.edited);
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(`redrafted ${GEMMA_COPY.sent} blocks`);
    expect(readme).toContain(`${GEMMA_COPY.shipped} of its drafts`);
  });

  it("hand edits still pass the code check", () => {
    for (const d of review.decisions.filter((x) => x.decision === "edited")) {
      expect(checkDraft(byId.get(d.id)!, d.shipped), d.id).toEqual({ ok: true, reasons: [] });
    }
  });

  it.each(review.decisions.map((d) => [d.id, d] as const))("%s", (id, d) => {
    const b = byId.get(id);
    expect(b, `unknown block ${id}`).toBeDefined();
    const src = readFileSync(path.join(ROOT, b!.file), "utf8");
    expect(textIsInSource(d.shipped, src), `${d.decision} text for ${id} not found in ${b!.file}`).toBe(true);
  });
});
