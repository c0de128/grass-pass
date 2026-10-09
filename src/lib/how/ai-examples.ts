/**
 * The three real model jobs shown on /how-it-works ("Where the AI is", Kevin 2026-10-09). Every string comes from
 * src/data/how/ai-examples.json, which is copied byte-for-byte from real recordings in tests/fixtures (app code never
 * imports test fixtures; tests/unit/how-blueprint.test.tsx re-reads each fixture and fails on any difference).
 *
 * What the page says code did is computed here, at build time, by the app's own check functions on those strings:
 * isGrounded (the proof-quote check) and fixCommandQuestion (the "?" after a command edit). Nothing is typed in.
 */
import raw from "@/data/how/ai-examples.json";
import { fixCommandQuestion, isGrounded } from "@/lib/ai/validate";

export type Highlighted = { before: string; quote: string; after: string } | null;

/** The excerpt split around the proof quote (case-insensitive), or null when the quote isn't in it word for word. */
export function highlightQuote(text: string, quote: string): Highlighted {
  const i = text.toLowerCase().indexOf(quote.toLowerCase());
  if (i < 0) return null;
  return { before: text.slice(0, i), quote: text.slice(i, i + quote.length), after: text.slice(i + quote.length) };
}

export const AI_EXAMPLES = raw;

/** A short date like "Oct 6, 2026" (Dallas time) for a recording. */
export function recordedDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
}

export function clueExample() {
  const c = raw.clue;
  return {
    ...c,
    grounded: isGrounded(c.out.sourceQuote, c.inExcerpt),
    printed: fixCommandQuestion(c.out.clue),
    highlight: highlightQuote(c.inExcerpt, c.out.sourceQuote),
  };
}

export function riddleExample() {
  const r = raw.riddle;
  return { ...r, grounded: isGrounded(r.out.sourceQuote, r.inExcerpt), highlight: highlightQuote(r.inExcerpt, r.out.sourceQuote) };
}

export function tipsExample() {
  return raw.tips;
}
