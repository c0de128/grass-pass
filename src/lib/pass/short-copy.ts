/**
 * Audit R3-T1: when a park has some real data but not enough for a pass, the screen said "Each section
 * below says why" while a section with data (status "ok") said nothing (Veterans Memorial Park,
 * Richardson, judge round 3). This turns every "ok" section of such a short pass into a "No data
 * available" line with its real numbers, so each section really says why. Sections that are already
 * empty, unavailable or off keep their own reason (written where it happened: wild.ts, park.ts,
 * build-pass.ts). Pure: no I/O, no server-only imports.
 */
import { MIN_PASS_ITEMS } from "@/lib/ai/schema";
import type { PoolItem, SectionState } from "@/lib/pool/types";
import { AGE_BAND_INFO, type Pass } from "./schema";

type Sections = Pass["sections"];

const listOf = (words: readonly string[]) =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/** "1 kind of mapped thing (a bench)", "2 kinds of mapped things (bench and playground)". */
function parkShortMessage(parkName: string, items: readonly PoolItem[]): string {
  const kinds = [...new Set(items.map((i) => i.kind))];
  const what = kinds.length === 1 ? `1 kind of mapped thing (${kinds[0]})` : `${kinds.length} kinds of mapped things (${listOf(kinds)})`;
  return `No data available: OpenStreetMap has only ${what} inside ${parkName}, and a pass needs at least ${MIN_PASS_ITEMS} finds.`;
}

function wildShortMessage(items: readonly PoolItem[]): string {
  const n = items.length;
  const verb = n === 1 ? "is a safe, kid-friendly find" : "are safe, kid-friendly finds";
  return `No data available: only ${n} species seen within 1.5 km in the last 14 days on iNaturalist ${verb} with a description we can check, and a pass needs at least ${MIN_PASS_ITEMS} finds.`;
}

/**
 * The sections to show for a park whose pool can't fill a pass: "ok" sections get their real count as
 * the reason; every other section keeps its own message.
 */
export function explainShortSections(
  parkName: string,
  sections: Sections,
  pools: { park: readonly PoolItem[]; wild: readonly PoolItem[] },
): Sections {
  const park: SectionState = sections.park.status === "ok" ? { status: "empty", message: parkShortMessage(parkName, pools.park) } : sections.park;
  const wild: SectionState = sections.wild.status === "ok" ? { status: "empty", message: wildShortMessage(pools.wild) } : sections.wild;
  return { ...sections, park, wild };
}

/** The headline for a short pass: how many real finds there were against the minimum. */
export function shortPassMessage(parkName: string, found: number): string {
  const what = found === 0 ? "we found none" : found === 1 ? "we found 1" : `we found ${found}`;
  return `Not enough real data for a pass at ${parkName} right now: a pass needs at least ${MIN_PASS_ITEMS} finds, and ${what}. Each section below says why.`;
}

/**
 * Audit R4 (Q-4-04): ages 10-13 promise "8 finds, 2 of them hard"; a live pass printed 1 hard find and
 * said nothing. The grown-up's stub says so when fewer hard finds than the band promises made it through
 * the checks. Null when the band promises none or the pass has enough.
 */
export function hardShortNote(pass: Pick<Pass, "ageBand" | "items">): string | null {
  const promised = AGE_BAND_INFO[pass.ageBand].hardMin;
  const hard = pass.items.filter((i) => i.difficulty === "hard").length;
  if (promised === 0 || hard >= promised || pass.items.length === 0) return null;
  const what = hard === 0 ? "none of today's finds is" : hard === 1 ? "only 1 of today's finds is" : `only ${hard} of today's finds are`;
  return `${AGE_BAND_INFO[pass.ageBand].label} aim for ${promised} hard finds; ${what} marked hard, because fewer hard clues passed our checks.`;
}
