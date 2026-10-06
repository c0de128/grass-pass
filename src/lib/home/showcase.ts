/**
 * What the v3 home page shows in the slots Kevin's v0 design filled with sample text (the hero pass card,
 * the sample park cards, the "live" pill, the Find This Spot riddle). Everything here is computed from the
 * real saved example passes (src/lib/prewarm.ts); when there is none, the result says why instead.
 * Pure functions, no I/O (unit tested in tests/unit/home-showcase.test.ts).
 */
import { formatTime } from "@/lib/pass/format";
import { AGE_BAND_INFO, type Pass, type PassItem, type SectionId } from "@/lib/pass/schema";
import type { ExamplePark, ExampleStatus } from "@/lib/prewarm";

/** The example the hero card prefers (Kevin's v0 card shows Connemara Meadow). */
export const HERO_EXAMPLE_SLUG = "connemara";
/** How many finds the hero card lists (v0 shows 4). */
export const HERO_FINDS = 4;

const SECTION_NAME: Record<SectionId, string> = { park: "Park Finds", wild: "Wild Finds", lucky: "Lucky Finds" };

export type ReadyExample = { example: ExamplePark; pass: Pass; href: string; madeAt: string };

/** "Allen TX" -> "Allen, TX" (our example config writes places without the comma). */
export function placeLabel(place: string): string {
  return place.replace(/([^,])\s+([A-Z]{2})$/, "$1, $2");
}

/** "Ages 6-10" -> "Ages 6–10" (an en dash, as in the v0 design). */
export function bandLabel(pass: Pass): string {
  return AGE_BAND_INFO[pass.ageBand].label.replace("-", "–");
}

function ready(s: ExampleStatus): ReadyExample | null {
  if (!s.pass || !s.passData) return null;
  return { example: s.example, pass: s.passData, href: `/pass/${s.pass.passId}?example=1`, madeAt: formatTime(s.pass.generatedAt) };
}

export type HeroCard =
  | { kind: "ready"; ex: ReadyExample; finds: PassItem[] }
  | { kind: "missing"; name: string; place: string; reason: string };

/**
 * The hero pass card: the preferred example's real pass (else the first ready one), with its first finds and
 * their real evidence lines. With no ready pass, the preferred example's own "No data available yet" reason.
 */
export function heroCard(statuses: readonly ExampleStatus[], preferred = HERO_EXAMPLE_SLUG): HeroCard | null {
  const order = [...statuses].sort((a, b) => Number(b.example.slug === preferred) - Number(a.example.slug === preferred));
  for (const s of order) {
    const ex = ready(s);
    if (ex) return { kind: "ready", ex, finds: ex.pass.items.slice(0, HERO_FINDS) };
  }
  const first = order[0];
  if (!first) return null;
  return {
    kind: "missing",
    name: first.example.name,
    place: placeLabel(first.example.place),
    reason: (first.missing ?? "No data available yet: no pass has been made for it today.").replace(/^No data available yet:\s*/, ""),
  };
}

/**
 * `count`: the real number of finds on the pass. Kevin 2026-10-06 (A2): no Wild / Mixed / Built label on the cards,
 * only the real "N finds to spot".
 */
export type CardFacts = { facts: string; tags: string[]; count: number };

/** Real facts for a sample park card, from that park's saved pass (counts by section, the map, the October box). */
export function cardFacts(pass: Pass): CardFacts {
  const count = (s: SectionId) => pass.items.filter((i) => i.section === s).length;
  const parts = (["wild", "park", "lucky"] as const)
    .map((s) => ({ s, n: count(s) }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${x.n === 1 ? SECTION_NAME[x.s].replace(/s$/, "") : SECTION_NAME[x.s]}`);
  const n = pass.items.length;
  const facts = n === 0 ? "No data available: none of the finds on this pass passed our checks." : `${parts.join(", ")}.`;

  // The sections are named in `facts`, so the tags list only the extras on the pass.
  const tags: string[] = [];
  if (pass.spot?.status === "ok") tags.push("Find This Spot map");
  if (pass.october?.status === "ok") tags.push("October monarch box");
  return { facts, tags, count: n };
}

export type LiveStatement = { text: string; live: boolean };

/**
 * The pill next to "See a real pass, right now" (v0: a pulsing "Live park feeds"). Only a computed, true
 * statement; it pulses only while it is literally about today (passes made today, or one being made now).
 */
export function liveStatement(statuses: readonly ExampleStatus[], enabled: boolean): LiveStatement {
  const readyOnes = statuses.filter((s) => s.pass);
  const today = statuses.filter((s) => s.pass && s.fresh).length;
  if (today > 0) return { text: `${today} example ${today === 1 ? "pass" : "passes"} made today from live data`, live: true };
  if (statuses.some((s) => s.refreshing)) return { text: "Making today's example passes", live: true };
  if (readyOnes.length > 0) {
    return { text: `${readyOnes.length} example ${readyOnes.length === 1 ? "pass" : "passes"} ready (made on an earlier day)`, live: false };
  }
  if (!enabled) return { text: "Example passes are turned off", live: false };
  return { text: "Example passes not ready yet", live: false };
}

export type SpotQuote = { riddle: string; park: string; madeAt: string };

/** A real Find This Spot riddle the open model wrote for a ready example pass (never the fixed fallback line). */
export function spotQuote(statuses: readonly ExampleStatus[]): SpotQuote | null {
  for (const s of statuses) {
    const ex = ready(s);
    const spot = ex?.pass.spot;
    if (ex && spot?.status === "ok" && spot.riddleBy === "model") return { riddle: spot.riddle, park: ex.example.name, madeAt: ex.madeAt };
  }
  return null;
}

/** Ready example passes, in display order. */
export function readyExamples(statuses: readonly ExampleStatus[]): ReadyExample[] {
  return statuses.map(ready).filter((r): r is ReadyExample => r !== null);
}

export { ready as readyExample };

/**
 * The state of one example card, as a data attribute for tests and tooling (never shown):
 * ready (links a real pass), off (PREWARM_EXAMPLES=0), making (a pass is being made now),
 * waiting (no pass yet and nothing running; the card says why).
 */
export type ExampleState = "ready" | "off" | "making" | "waiting";

export function exampleState(s: ExampleStatus, enabled: boolean): ExampleState {
  if (s.pass) return "ready";
  if (!enabled) return "off";
  return s.refreshing ? "making" : "waiting";
}
