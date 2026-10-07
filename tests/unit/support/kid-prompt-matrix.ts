/**
 * Teens & adults (2026-10-07): a fixed matrix of prompt inputs for the three kid bands. `age-13plus.test.ts`
 * hashes every system prompt it builds and compares with hashes taken from the code BEFORE the 13+ band was
 * added, so a 13+ change can never shift a kid prompt by one byte (the recorded fixtures replay against them).
 */
import { createHash } from "node:crypto";
import { buildMessages, refillRules, systemPrompt, voiceFor, type Mix, type PromptContext, type PromptSpot } from "@/lib/ai/prompt";
import type { AgeBand } from "@/lib/pass/schema";

export const KID_BANDS: readonly AgeBand[] = ["4-6", "6-10", "10-13"];

const MIXES: Record<string, Mix> = {
  full: { n: 8, min: { park: 2, wild: 2, lucky: 1 }, max: { park: 5, wild: 5, lucky: 2 }, hardMin: 0 },
  hard: { n: 8, min: { park: 2, wild: 2, lucky: 0 }, max: { park: 6, wild: 6, lucky: 0 }, hardMin: 3 },
  parkOnly: { n: 6, min: { park: 6, wild: 0, lucky: 0 }, max: { park: 6, wild: 0, lucky: 0 }, hardMin: 0 },
  wildOnly: { n: 4, min: { park: 0, wild: 4, lucky: 0 }, max: { park: 0, wild: 4, lucky: 0 }, hardMin: 1 },
};

const SPOT: PromptSpot = { id: "spot-1", label: "picnic shelter", sourceText: "A roof on posts over picnic tables." };

const CTXS: Record<string, PromptContext | null> = {
  none: null,
  month: { month: 10 },
  full: {
    month: 10,
    openers: ["Spot", "Hunt", "Who", "Peek"],
    hasSeasonNotes: true,
    voice: "Voice for this park: short, curious questions.",
  },
  refill: {
    month: 10,
    openers: ["Watch", "Check"],
    hasSeasonNotes: false,
    refill: { copied: ["a red tail", "white flowers on"], generic: true, jargon: true, taken: ["spot", "hunt"] },
  },
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Every kid-band prompt piece this matrix builds, keyed by a readable name, hashed. */
export function kidPromptHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const band of KID_BANDS) {
    for (const [m, mix] of Object.entries(MIXES)) {
      for (const [c, ctx] of Object.entries(CTXS)) {
        for (const spot of [null, SPOT]) {
          out[`${band}|${m}|${c}|${spot ? "spot" : "nospot"}`] = sha(systemPrompt(band, mix, spot, ctx));
        }
      }
    }
    for (const seed of ["Celebration Park", "White Rock Lake Park", "Oak Point Park and Nature Preserve", "Connemara Meadow Preserve"]) {
      out[`${band}|voice|${seed}`] = sha(voiceFor(seed, band));
    }
    const pool = [
      { id: "osm-bench", section: "park" as const, kind: "bench", sourceText: "There are 12 benches.", answer: "Benches" },
      { id: "inat-1", section: "wild" as const, kind: "plant", sourceText: "A tree with <b>grey</b> bark.", answer: "Pecan" },
    ];
    // buildMessages only reads id, section, kind, sourceText and season from pool items.
    const msgs = buildMessages("Celebration Park", pool as never, band, MIXES.full, SPOT, { month: 10 });
    out[`${band}|messages`] = sha(JSON.stringify(msgs));
  }
  out["refillRules"] = sha(JSON.stringify(refillRules({ copied: ["a b c"], generic: true, jargon: true, taken: ["spot"] })));
  return out;
}
