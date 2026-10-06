/**
 * Wild Finds pool (SPEC F3): research-grade iNaturalist species seen within 1.5 km of the park in the
 * last 14 days, minus every hard-blocked taxon (ADR 0003), each with its Wikipedia summary as the only
 * text a clue may quote. Counts, dates and safety lines are code-written.
 */
import { blockedBy, isStationary, safetyLineFor } from "@/lib/safety/danger-taxa";
import type { Species, SpeciesList, TaxonSummary } from "@/lib/sources/inat";
import { seasonFrom, seasonSentence, type PhenologyCount } from "./season";
import { distinctiveWords, type PoolItem, type SectionState } from "./types";

/** Fewer eligible species than this -> the section shows its "No data available" line (SPEC §5.4). */
export const WILD_MIN_ELIGIBLE = 3;
/** Species looked up for summaries (one iNat taxa call takes up to 30 ids). */
export const WILD_SUMMARY_CANDIDATES = 24;
/** Species offered to the model (keeps the prompt near 2k tokens). */
export const WILD_PROMPT_MAX = 16;
/** A summary shorter than this can't ground a clue. */
export const MIN_SUMMARY_CHARS = 60;
/**
 * Summary text offered to the model per species (S8b): whole sentences up to about this many
 * characters. The full summaries made prompts of 2.5-4.5k tokens; two or three sentences hold the
 * looks-like facts a clue needs. The clue's sourceQuote is checked against this same trimmed text.
 */
export const WILD_SOURCE_CHARS = 320;

/** Whole sentences from the start of `text`, up to `max` characters (the first sentence is cut at a word if it alone is longer). */
export function leadSentences(text: string, max: number = WILD_SOURCE_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/u);
  let out = "";
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space > max / 2 ? cut.slice(0, space) : cut;
}

const SPECIES_RANKS = new Set(["species", "subspecies", "variety", "form", "hybrid"]);

/** "2026-09-21" -> "Sep 21". */
export function shortDate(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function wildEvidence(count: number, sinceDay: string): string {
  const times = count === 1 ? "once" : `${count} times`;
  return `seen ${times} since ${shortDate(sinceDay)} · iNaturalist`;
}

/** SPEC §5.4 Wild Finds empty copy (N from the API; grammatical for 0 and 1, same meaning). */
export function wildEmptyCopy(totalObservations: number): string {
  if (totalObservations <= 0) {
    return "No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist.";
  }
  if (totalObservations === 1) {
    return "No data available: only 1 research-grade sighting within 1.5 km in the last 14 days on iNaturalist.";
  }
  if (totalObservations < WILD_MIN_ELIGIBLE) {
    return `No data available: only ${totalObservations} research-grade sightings within 1.5 km in the last 14 days on iNaturalist.`;
  }
  return `No data available: ${totalObservations} research-grade sightings within 1.5 km in the last 14 days on iNaturalist, but fewer than ${WILD_MIN_ELIGIBLE} are safe, kid-friendly finds with a description we can check.`;
}

export const WILD_DOWN_COPY = "No data available: iNaturalist didn't answer.";

const taxonOf = (s: Species) => ({ taxonId: s.taxonId, ancestorIds: s.ancestorIds });

/**
 * Step 1 (before any summary call): species-level taxa that are not blocked, best first
 * (most sightings, then things that stay put). `blocked` counts what was left off for safety.
 */
export function wildCandidates(list: SpeciesList): { candidates: Species[]; blocked: number } {
  let blocked = 0;
  const ok: Species[] = [];
  for (const s of list.species) {
    if (!SPECIES_RANKS.has(s.rank)) continue;
    if (blockedBy(taxonOf(s))) {
      blocked++;
      continue;
    }
    ok.push(s);
  }
  ok.sort(
    (a, b) =>
      b.count - a.count ||
      Number(isStationary(taxonOf(b))) - Number(isStationary(taxonOf(a))) ||
      a.taxonId - b.taxonId,
  );
  return { candidates: ok.slice(0, WILD_SUMMARY_CANDIDATES), blocked };
}

const KIND_BY_ICONIC: Record<string, string> = {
  Plantae: "plant",
  Fungi: "fungus or lichen",
  Aves: "bird",
  Mammalia: "mammal",
  Reptilia: "reptile",
  Amphibia: "amphibian",
  Insecta: "insect",
  Arachnida: "spider or relative",
  Mollusca: "snail or slug",
  Actinopterygii: "fish",
};

/** Plants among the summary candidates: the ids the season check asks iNaturalist about (R1-M4). */
export function plantCandidateIds(list: SpeciesList): number[] {
  return wildCandidates(list)
    .candidates.filter((s) => s.iconic === "Plantae")
    .map((s) => s.taxonId);
}

/**
 * Season evidence for the plants (R1-M4): the month and the phenology counts per taxon id, or
 * `phenology: null` when the lookup failed (then no plant's flowers or fruit count as in season).
 */
export type WildSeasonInput = { month: number; phenology: { taxa: Record<string, PhenologyCount> } | null };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Step 2: build pool items from candidates that have a usable summary. The danger check runs
 * again with the ancestor list from the taxa call (it can be longer than the species_counts one).
 */
export function wildPool(
  list: SpeciesList,
  summaries: readonly TaxonSummary[],
  sinceDay: string,
  season?: WildSeasonInput,
): { items: PoolItem[]; state: SectionState; blocked: number } {
  const { candidates, blocked: blockedFirst } = wildCandidates(list);
  const byId = new Map(summaries.map((s) => [s.id, s]));
  let blocked = blockedFirst;
  const items: PoolItem[] = [];
  for (const s of candidates) {
    const sum = byId.get(s.taxonId);
    const ancestors = [...new Set([...s.ancestorIds, ...(sum?.ancestorIds ?? [])])];
    const taxon = { taxonId: s.taxonId, ancestorIds: ancestors };
    if (blockedBy(taxon)) {
      blocked++;
      continue;
    }
    if (!sum?.summary || sum.summary.length < MIN_SUMMARY_CHARS) continue;
    const label = s.commonName ? `${cap(s.commonName)} (${s.name})` : s.name;
    const plantSeason =
      season && s.iconic === "Plantae" ? seasonFrom(season.phenology?.taxa[String(s.taxonId)], season.month, season.phenology !== null) : undefined;
    // R1-M4 follow-up: the season fact is part of the SOURCE (a code-written sentence, quotable and true).
    const sourceText = `${label}. ${leadSentences(sum.summary)}${plantSeason ? ` ${seasonSentence(plantSeason)}` : ""}`;
    items.push({
      id: `inat-${s.taxonId}`,
      section: "wild",
      kind: KIND_BY_ICONIC[s.iconic ?? ""] ?? "animal",
      sourceText,
      answer: label,
      evidence: wildEvidence(s.count, sinceDay),
      source: "iNaturalist",
      nameWords: [
        ...new Set([
          ...(s.commonName ? [s.commonName.toLowerCase(), ...distinctiveWords(s.commonName)] : []),
          s.name.toLowerCase(),
          ...distinctiveWords(s.name),
        ]),
      ],
      safety: safetyLineFor(taxon, sum.summary),
      stationary: isStationary(taxon),
      taxon,
      ...(plantSeason ? { season: plantSeason } : {}),
    });
  }
  const eligible = items.length;
  if (eligible < WILD_MIN_ELIGIBLE) {
    return { items: [], state: { status: "empty", message: wildEmptyCopy(list.totalObservations) }, blocked };
  }
  return { items: items.slice(0, WILD_PROMPT_MAX), state: { status: "ok" }, blocked };
}
