/**
 * Review 2026-10-08 MAJOR-3: a server-side estimate of how tall a pass's printed sheet is, so the home page's example
 * picker can prefer a pass that fits ONE Letter page (the browser's PrintFit.tsx is the real measure; this file never
 * replaces it, and the print page still says "2 pages" whenever PrintFit measures 2).
 *
 * What it models: the sheet as PrintFit measures it at its most compact (print scale MIN_FIT 0.91, every optional
 * line left out, data-compact=4), i.e. the kid half + tear line + grown-up stub, in CSS px, against the printable page
 * height (PRINT_HEIGHT_PX, 971 px).
 *
 * Calibration (measured 2026-10-08 in headless Chromium on the 7 live example print pages, all ages 6-10 with a
 * Find This Spot map): every find row is 30 px, 45 px when its hint line ("Look: ... (evidence)") wraps (it wrapped at
 * 118+ characters, never at 111 or fewer); the kid half adds 131 px of head and 200 px for the map block; the stub adds
 * 79 px of headings, 17 px per answer row (2 columns, +16 when an answer wraps past 60 characters), the Find This Spot
 * answer (16 px), the safety paragraph (16 px a line, about 130 characters a line), and the two bottom columns (30 px +
 * 14 px a line; about 60 characters a line for "Not on this pass", 86 for "Where this came from", 150 when it is
 * alone). Measured totals 885-984 px; this estimate was within 5 px of every one of them. The one sheet that printed on
 * 2 pages (White Rock, Oct 8: 984 px) estimates 983 px; the tallest 1-page sheet (943 px) estimates 941 px.
 *
 * Limits: calibrated on 6-10 sheets only (4-6 and 10-13 use the same kid layout; a 13+ sheet has its own fonts and a
 * 0.87 floor, so it is not estimated: `likelyOnePage` answers null). Character counts stand in for real text widths.
 */
import { LUCKY_MAYBE } from "@/components/pass/KidPass";
import { STUB_LOOK_ONLY } from "@/components/pass/ParentStub";
import { copyFor } from "./audience";
import { AGE_BAND_INFO, type Pass } from "./schema";
import { stubNotes } from "./stub-notes";
import { SAFETY_FOOTNOTE } from "@/lib/safety/danger-taxa";

/** Printable height of US Letter with 0.4 in margins (PrintFit.tsx PRINT_HEIGHT_PX), CSS px. */
export const PRINT_PAGE_PX = 10.2 * 96 - 8;
/** Room kept below the page height: an estimate above PRINT_PAGE_PX - this is treated as "may need 2 pages". */
export const PRINT_SAFETY_PX = 12;

const ROW_PX = 30;
const ROW_WRAP_PX = 15;
const HINT_ONE_LINE_CHARS = 114;
const CLUE_ONE_LINE_CHARS = 75;
const KID_HEAD_PX = 131;
const MAP_BLOCK_PX = 200;
const TEAR_PX = 23;
const STUB_HEADINGS_PX = 79;
const ANSWER_ROW_PX = 17;
const ANSWER_WRAP_PX = 16;
const ANSWER_ONE_LINE_CHARS = 60;
const SPOT_ANSWER_PX = 16;
const SAFETY_LINE_PX = 13;
const SAFETY_FIRST_LINE_PX = 16;
const SAFETY_LINE_CHARS = 130;
const HEAD_LINE_CHARS = 150;
const SMALL_LINE_PX = 14;
const COLS_HEAD_PX = 30;
const NOTES_LINE_CHARS = 60;
const SOURCES_LINE_CHARS = 86;
const SOURCES_ALONE_LINE_CHARS = 150;
/** The gaps PrintFit's measure includes between the kid half and the stub (measured total minus the parts). */
const SHEET_GAPS_PX = 10;

const linesOf = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));

/** The kid row's hint line exactly as KidPass prints it. */
function hintText(it: Pass["items"][number]): string {
  return `${it.lookWhere ? `Look: ${it.lookWhere}. ` : ""}${it.safety ? `${it.safety} ` : ""}(${it.evidence})`;
}

/** "Where this came from" lines, as ParentStub prints them (dates as "Oct 8, 10:28 AM CDT", 20 characters). */
function sourceLines(pass: Pass, passUrlLength: number): string[] {
  const date = "Oct 8, 10:28 AM CDT";
  const wiki = pass.items.some((it) => it.section === "wild");
  const lines = [`Map: © OpenStreetMap contributors (ODbL), checked ${date}.`];
  if (pass.dataCheckedAt.inat) {
    lines.push(
      `Wildlife: iNaturalist observers, research grade, within 1.5 km${pass.wildSince ? ", Sep 24 to Oct 8" : ""}; checked ${date}.${wiki ? " Species facts: Wikipedia (CC BY-SA), via iNaturalist." : ""}`,
    );
  } else if (wiki) lines.push("Species facts: Wikipedia (CC BY-SA), via iNaturalist.");
  if (pass.dataCheckedAt.lucky) lines.push(`Lucky Finds: counts of Google reviews via SerpApi (no review text), checked ${date}.`);
  lines.push(`Clues: ${pass.model.answered} (open model, Apache-2.0), made ${date}. Code wrote every number and date.`);
  lines.push(`Made with Grass Pass · ${"x".repeat(passUrlLength)}`);
  return lines;
}

/**
 * Estimated height (CSS px) of the printed sheet at its most compact (0.91 scale, optional lines left out), as
 * PrintFit measures it. `passUrlLength`: the printed "site/pass/<id>" address (default: grass-pass.vercel.app).
 */
export function estimatePrintPx(pass: Pass, passUrlLength: number = `grass-pass.vercel.app/pass/${pass.id}`.length): number {
  const rows = pass.items.reduce((sum, it) => {
    const clue = `${it.section === "lucky" ? `${LUCKY_MAYBE} ` : ""}${it.clue}`;
    return sum + ROW_PX + (hintText(it).length > HINT_ONE_LINE_CHARS ? ROW_WRAP_PX : 0) + (clue.length > CLUE_ONE_LINE_CHARS ? ROW_WRAP_PX : 0);
  }, 0);
  const spot = pass.spot?.status === "ok";
  const kid = KID_HEAD_PX + rows + (spot ? MAP_BLOCK_PX : 0);

  const answers = pass.items.map((it, i) => `${i + 1}. ${it.answer}`);
  const answerPx = ANSWER_ROW_PX * Math.ceil(answers.length / 2) + ANSWER_WRAP_PX * answers.filter((a) => a.length > ANSWER_ONE_LINE_CHARS).length;
  const copy = copyFor(pass.ageBand);
  const hasSafety = pass.items.some((it) => Boolean(it.safety));
  const safetyText = [STUB_LOOK_ONLY, ...(hasSafety ? [copy.stubEachLine] : []), ...(pass.safetyFiltered > 0 ? [SAFETY_FOOTNOTE] : [])].join(" ");
  const safetyPx = SAFETY_FIRST_LINE_PX + SAFETY_LINE_PX * (linesOf(safetyText, SAFETY_LINE_CHARS) - 1);
  const headPx = SMALL_LINE_PX * (linesOf(`Keep this part. ${pass.parentNote}`, HEAD_LINE_CHARS) - 1);
  const notes = stubNotes(pass);
  const sources = sourceLines(pass, passUrlLength);
  const notesLines = notes.reduce((n, t) => n + linesOf(t, NOTES_LINE_CHARS), 0);
  const sourcesLines = sources.reduce((n, t) => n + linesOf(t, notes.length > 0 ? SOURCES_LINE_CHARS : SOURCES_ALONE_LINE_CHARS), 0);
  const colsPx = COLS_HEAD_PX + SMALL_LINE_PX * Math.max(notesLines, sourcesLines);
  const stub = STUB_HEADINGS_PX + headPx + answerPx + (spot ? SPOT_ANSWER_PX : 0) + safetyPx + colsPx;

  return Math.round(kid + TEAR_PX + stub + SHEET_GAPS_PX);
}

/**
 * True when the sheet is estimated to fit one Letter page with room to spare, false when it may need 2 pages, null
 * when the estimate doesn't apply (a teens & adults 13+ sheet: own fonts and print floor, not calibrated).
 */
export function likelyOnePage(pass: Pass): boolean | null {
  if (AGE_BAND_INFO[pass.ageBand].audience === "adult") return null;
  return estimatePrintPx(pass) <= PRINT_PAGE_PX - PRINT_SAFETY_PX;
}

/** The pass page's line next to "Print pass" (kid bands). */
export const KID_PRINT_LINE = "One black-and-white page. Cut it in half: kids get the hunt, you get the answers.";
/** Review MAJOR-3: the same line when the sheet is estimated to need 2 pages (the print page then measures it). */
export const KID_PRINT_LINE_LONG = "This pass is long, so it may print on 2 black-and-white pages. Kids get the hunt, you get the answers.";

/** The pass page's print line: one page, or the honest "may print on 2 pages" when the estimate says so. */
export function passPagePrintLine(pass: Pass, adultLine: string): string {
  if (AGE_BAND_INFO[pass.ageBand].audience === "adult") return adultLine;
  return likelyOnePage(pass) === false ? KID_PRINT_LINE_LONG : KID_PRINT_LINE;
}

/** The print page's first words (print.css shows one of the two: the measured page count, else this estimate). */
export const PRINT_LEAD_ONE = "One black-and-white Letter page.";
export const PRINT_LEAD_TWO = "Two black-and-white Letter pages: this pass is long.";
