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

/** Audit R3-T1: says which service and that a retry may help (the short-pass screen shows it as the reason). */
export const WILD_DOWN_COPY =
  "No data available: iNaturalist (the wildlife sightings service) didn't answer when this pass was made. Trying again in a minute may help.";

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
 * Words that tell a child what to LOOK for: colours, textures, shapes, sizes and visible parts
 * (audit R2-M5). A summary without any ("X is a species of flowering plant native to ...") can only
 * give a generic clue ("Do you see a plant with flowers?"), which the server now drops.
 */
const LOOKS_RE =
  /\b(?:white|yellow|red|orange|purple|pink|blue|black|brown|grey|gray|golden|gold|silver|violet|scarlet|crimson|bright|dark|pale|glossy|shiny|hairy|fuzzy|woolly|spiny|spined|spines|thorny|thorns|prickly|striped|stripes?|spotted|spots|banded|round|rounded|oval|spherical|heart-shaped|lobed|lobes|toothed|feathery|bumpy|corky|tall|cm|mm|centimetres|centimeters|metres|meters|inches|wingspan|petals?|leaves|leaflets?|bark|wings?|tail|bill|beak|crest|cap|gills|shell|fur|feathers?|antennae|operculum|lumps)\b/gi;

/** How many different looks-like words a source text has (0 = nothing a clue can describe). */
export function looksScore(text: string): number {
  return new Set((text.match(LOOKS_RE) ?? []).map((w) => w.toLowerCase())).size;
}

/** LOOKS_RE for one whole token (its source is `\b(?:...)\b`). */
const LOOKS_WORD_RE = new RegExp(`^${LOOKS_RE.source.slice(2, -2)}$`, "i");

/**
 * Looks-like words in a summary that are NOT part of the species' names (content tuning, 2026-10-06):
 * "Black-and-white Warbler ... is a species of New World warbler" has "black" and "white" only in its
 * name, so a clue can't use them (name leak) and the summary says nothing else about its looks. A word
 * right before a name word ("white oak section" for bur oak, "red cedar" for eastern redcedar) is a
 * name too. Measured on the 20 eval parks: these species were where most generic clues were dropped.
 */
export function looksOutsideNames(text: string, nameWords: readonly string[]): number {
  const names = new Set(nameWords.flatMap((w) => w.toLowerCase().split(/[^\p{L}]+/u)).filter((w) => w.length >= 3));
  const toks = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (!LOOKS_WORD_RE.test(w) || names.has(w)) continue;
    const next = toks[i + 1] ?? "";
    if (next.length >= 3 && [...names].some((n) => n.includes(next) || next.includes(n))) continue;
    out.add(w);
  }
  return out.size;
}

/**
 * Describing words that `distinctiveWords` leaves out of a name on purpose (GENERIC_WORDS: colours,
 * patterns, sizes), plus colours a clue might use for a compound name word.
 */
const NAME_TRAIT_WORDS = new Set([
  "white", "black", "brown", "green", "yellow", "orange", "red", "blue", "purple", "golden", "gold", "amber", "silver",
  "grey", "gray", "pink", "scarlet", "crimson", "violet", "ruby", "rusty", "copper", "bronze", "tawny", "spotted",
  "dotted", "striped", "banded", "hairy", "little", "great", "greater", "lesser", "small", "large", "giant",
]);
/** Colours that start compound name words ("amberwing", "redcedar", "bluebonnet", "goldenrod", "blackberry"). */
const COLOUR_PREFIXES = ["amber", "black", "blue", "brown", "golden", "gold", "green", "grey", "gray", "orange", "pink", "purple", "red", "silver", "white", "yellow"];

/**
 * Audit R3 (example passes, 2026-10-06): describing words that are part of a species' own common name
 * are name words too. "Hunt for a plant with white flowers." for White Morning-glory and "orange or
 * amber wings" for Eastern Amberwing used only their own name as the trait: the child reads the
 * answer, and the clue fits nothing else in the source. Returns the name's colour, pattern and size
 * words, and the colour a compound word starts with ("amberwing" -> "amber"; at least 4 letters left).
 */
export function nameTraitWords(name: string): string[] {
  const out = new Set<string>();
  for (const w of name.toLowerCase().normalize("NFKC").split(/[^\p{L}]+/u).filter(Boolean)) {
    if (NAME_TRAIT_WORDS.has(w)) out.add(w);
    const pre = COLOUR_PREFIXES.filter((c) => w.startsWith(c) && w.length - c.length >= 4).sort((a, b) => b.length - a.length)[0];
    if (pre) out.add(pre);
  }
  return [...out];
}

/** 0 = two or more looks-like words outside the names, 1 = one, 2 = none: describable species go first in the prompt. */
const looksTier = (n: number) => (n >= 2 ? 0 : n === 1 ? 1 : 2);

/**
 * Step 2: build pool items from candidates that have a usable summary. The danger check runs
 * again with the ancestor list from the taxa call (it can be longer than the species_counts one).
 */
export function wildPool(
  list: SpeciesList,
  summaries: readonly TaxonSummary[],
  sinceDay: string,
  season?: WildSeasonInput,
  /** R2-M5: leave out species whose summary says nothing about how they look (default). Tests of older runs turn it off. */
  opts: { describableOnly?: boolean } = {},
): { items: PoolItem[]; state: SectionState; blocked: number } {
  const describableOnly = opts.describableOnly ?? true;
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
    // R2-M5: a summary with nothing a child can look for ("a species of flowering plant native to ...")
    // only makes generic clues, which the server drops. Such a species is not a find.
    if (describableOnly && looksScore(leadSentences(sum.summary)) === 0) continue;
    const label = s.commonName ? `${cap(s.commonName)} (${s.name})` : s.name;
    const plantSeason =
      season && s.iconic === "Plantae" ? seasonFrom(season.phenology?.taxa[String(s.taxonId)], season.month, season.phenology !== null) : undefined;
    // R1-M4 follow-up: the season fact is part of the SOURCE (a code-written sentence, quotable and true).
    const sourceText = `${label}. ${leadSentences(sum.summary)}${plantSeason ? ` ${seasonSentence(plantSeason)}` : ""}`;
    const nameWords = [
      ...new Set([
        ...(s.commonName ? [s.commonName.toLowerCase(), ...distinctiveWords(s.commonName)] : []),
        s.name.toLowerCase(),
        ...distinctiveWords(s.name),
        // Audit R3: Wikipedia's bolded other names ("mossycup oak" for bur oak) give the answer away too.
        ...(sum.names ?? []).flatMap((n) => distinctiveWords(n)),
        // Audit R3: a colour, pattern or size word of its own common name ("white" for White Morning-glory).
        ...(s.commonName ? nameTraitWords(s.commonName) : []),
        ...(sum.names ?? []).flatMap((n) => nameTraitWords(n)),
      ]),
    ];
    items.push({
      id: `inat-${s.taxonId}`,
      section: "wild",
      kind: KIND_BY_ICONIC[s.iconic ?? ""] ?? "animal",
      sourceText,
      answer: label,
      evidence: wildEvidence(s.count, sinceDay),
      source: "iNaturalist",
      nameWords,
      looks: looksOutsideNames(leadSentences(sum.summary), nameWords),
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
  // R2-M5: species whose summary says how they look go first (stable: most sightings first inside a tier),
  // so the model's pool (n + spares) holds things a clue can describe, not only "a species of ... native to ...".
  const tier = new Map(items.map((it) => [it, looksTier(it.looks ?? 0)]));
  const ordered = items.map((it, i) => ({ it, i })).sort((a, b) => tier.get(a.it)! - tier.get(b.it)! || a.i - b.i).map((x) => x.it);
  return { items: ordered.slice(0, WILD_PROMPT_MAX), state: { status: "ok" }, blocked };
}
