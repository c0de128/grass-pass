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

/**
 * The excerpt split around the proof quote, or null when the quote isn't in it word for word. Case-insensitive, and any
 * run of whitespace matches any other: Wikipedia's "15 centimetres" has a no-break space where the model typed a plain
 * one (the app's own isGrounded check normalizes whitespace the same way). The marked text is the source's own characters.
 */
export function highlightQuote(text: string, quote: string): Highlighted {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const m = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i").exec(text);
  if (!m) return null;
  return { before: text.slice(0, m.index), quote: m[0], after: text.slice(m.index + m[0].length) };
}

export const AI_EXAMPLES = raw;

/** A short date like "Oct 6, 2026" (Dallas time) for a recording. */
export function recordedDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
}

/**
 * Job 1 (judge R11: show what the model adds): one Gemma clue from the committed eval run, next to the no-AI template's
 * clue for the same fact in the same run. Same park, same tree, same data; only the writer differs.
 */
export function clueExample() {
  const c = raw.clue;
  const printed = fixCommandQuestion(c.out.clue);
  return {
    ...c,
    grounded: isGrounded(c.out.sourceQuote, c.inExcerpt),
    printed,
    /** True when code printed the model's words unchanged (no "?" to "." edit). */
    printedAsWritten: printed === c.out.clue,
    /** The common name the answer key prints: "Osage-orange" from "Osage-orange (Maclura pomifera)". */
    answerName: c.answer.split(" (")[0],
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
