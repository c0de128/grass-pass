/**
 * The grown-up stub's "Not on this pass" lines (what is missing and why), shared by the stub itself
 * (components/pass/ParentStub.tsx) and the print-size estimate (./print-size.ts), so both always count the same text.
 * Pure: no I/O.
 */
import { HIDDEN_PARK_NOTE, safeParkName } from "@/lib/safety/contact";
import type { Pass, SectionId } from "./schema";
import { hardShortNote } from "./short-copy";

const SECTIONS: SectionId[] = ["park", "wild", "lucky"];

export function stubNotes(pass: Pass): string[] {
  const short = pass.target - pass.items.length;
  const missing = SECTIONS.flatMap((s) => {
    const st = pass.sections[s];
    // Round 9 (Q-9-05): an ok section can still say what is missing (Lucky Finds cut short after some searches).
    return st.status === "ok" ? (st.note ? [st.note] : []) : [st.message];
  });
  const { notGrounded, other } = pass.removed;
  const hardNote = hardShortNote(pass);
  return [
    // R2-m3: the park name was hidden on this pass; say why.
    ...(safeParkName(pass.park.name).hidden ? [HIDDEN_PARK_NOTE] : []),
    ...missing,
    // S5: why there is no Find This Spot map (the kid side shows nothing in that case).
    ...(pass.spot?.status === "none" ? [pass.spot.message] : []),
    ...(short > 0 ? [`No data available for ${short} more ${short === 1 ? "find" : "finds"}: ${short === 1 ? "its clue" : "their clues"} didn't pass our checks, so we left ${short === 1 ? "it" : "them"} off.`] : []),
    // Audit R4 (Q-4-04): fewer hard finds than the age band promises.
    ...(hardNote ? [hardNote] : []),
    ...(notGrounded > 0 ? [`${notGrounded} ${notGrounded === 1 ? "clue" : "clues"} removed: didn't match ${notGrounded === 1 ? "its" : "their"} source.`] : []),
    ...(other > 0 ? [`${other} ${other === 1 ? "clue" : "clues"} removed: gave away the answer or broke a rule.`] : []),
  ];
}
