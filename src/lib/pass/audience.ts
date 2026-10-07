/**
 * Teens & adults (13+, Kevin 2026-10-07): the fixed, code-written words on a pass that depend on WHO holds it.
 * A kid pass is played with a grown-up ("Stay where your grown-up can see you.", "For the grown-up: answer key");
 * a 13+ pass is held by a teen or adult on their own, so the same lines read right for them. The kid wording is
 * exactly what it was before the 13+ band (tests/unit/age-13plus.test.ts). Safety stays: look, don't touch.
 */
import { AGE_BAND_INFO, type AgeBand, type Audience } from "./constants";
import { SAFETY_LINES } from "@/lib/safety/danger-taxa";

export type AudienceCopy = {
  /** Printed on every pass, next to the day and the age band (ADR 0003). */
  stayClose: string;
  /** The tear line between the hunt and the stub: its label for screen readers, and the printed words. */
  tearAria: string;
  /** The printed stub's heading. */
  stubTitle: string;
  /** Printed when finds carry their own safety line. */
  stubEachLine: string;
  /** The screen preview's stub heading and its answer-key summary. */
  previewStubTitle: string;
  answerKeySummary: string;
  /** The fixed water line printed on a find near water (SAFETY_LINES.water for kids). */
  waterLine: string;
  /** How the code-written tip says "be careful by the water" ("stay close" for a kid with a grown-up). */
  nearWaterTip: string;
  /** Q-8-05 / UX-8-05: who a find report helps, in the "Back from the park?" line on the pass page. */
  reportHelps: string;
  /** Q-8-05: added after "Report find N as not safe?" (a kid pass asks for a grown-up; a 13+ pass has none). */
  unsafeConfirmNote: string;
  /**
   * The printed tear-line words and the print hints on /pass/[id] and its print page are in those files (the Gemma
   * copy check, tests/unit/copy-check.test.ts, finds the kid wording there); the 13+ wording is here.
   */
};

export const AUDIENCE_COPY: Record<Audience, AudienceCopy> = {
  kid: {
    stayClose: "Stay where your grown-up can see you.",
    tearAria: "Cut or tear here: the kid keeps the top, the grown-up keeps the bottom",
    stubTitle: "For the grown-up: answer key",
    stubEachLine: "Read each find's safety line with your kid.",
    previewStubTitle: "For the grown-up",
    answerKeySummary: "Answer key (don't peek, kids!)",
    waterLine: SAFETY_LINES.water,
    nearWaterTip: "stay close",
    reportHelps: "It helps the next family",
    unsafeConfirmNote: " Grown-ups only, please.",
  },
  adult: {
    stayClose: "Stay on the paths. Tell someone where you will be.",
    tearAria: "Cut or fold here: the hunt is on top, the answer key is at the bottom",
    stubTitle: "Answer stub",
    stubEachLine: "Read each find's safety line before you go.",
    previewStubTitle: "Answer stub",
    answerKeySummary: "Answer key (no peeking until you're done)",
    waterLine: "Stay on the path near water.",
    nearWaterTip: "stay on the path",
    reportHelps: "It helps the next explorer",
    unsafeConfirmNote: "",
  },
};

/** 13+ only: the printed tear-line words and the print hints (the kid lines stay in their files, see AudienceCopy). */
export const ADULT_TEAR_TEXT = "cut or fold here: the hunt on top, the answers below";
export const ADULT_PRINT_LINE = "One black-and-white page. Cut or fold it in half: the hunt on top, the answers below.";
export const ADULT_PRINT_LEAD_END = "Cut on the dashed line: the hunt on top, the answer key below.";

/** The fixed copy for a band's pass (a band missing from the list reads as a kid pass, the safer default). */
export function copyFor(band: AgeBand | undefined): AudienceCopy {
  return AUDIENCE_COPY[band ? AGE_BAND_INFO[band]?.audience ?? "kid" : "kid"];
}

/**
 * A find's fixed safety line for this band: the grown-up water line becomes the 13+ one (in a combined line too,
 * "Look, don't touch. Stay with your grown-up near water."). Every other line is the same for every band.
 */
export function safetyForBand(line: string | null, band: AgeBand): string | null {
  if (!line) return line;
  const c = copyFor(band);
  return c.waterLine === SAFETY_LINES.water ? line : line.split(SAFETY_LINES.water).join(c.waterLine);
}
