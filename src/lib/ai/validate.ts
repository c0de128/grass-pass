/**
 * Server-side checks on the model's answer (SPEC §6.2). Every failure drops ONE item and is counted
 * by reason (logs + footer + evals); the model never decides what is safe or true.
 *
 * Per item, in order: spec zod schema -> URL/markup -> unknown id -> duplicate id -> section
 * mismatch -> danger (blocked taxon, or a blocked word in the text) -> grounding (`sourceQuote` must
 * be a normalized substring of that item's sourceText; S8c: a quote with the next JSON field glued on
 * is cut back at the field marker and must then be a real substring) -> name leak (common/scientific name or a
 * distinctive part of it, plural too, or a word built on a 5+ letter name word such as "Passifloraceae"
 * for Passiflora, in the clue; a leak only in `lookWhere` blanks that hint and keeps the item) -> map
 * (PM 1B: a colour/pattern/size word of the species' own name is only a preference, `name_trait`) -> map
 * (R1-m4: a pass without a Find This Spot map never says "map"; in lookWhere the hint is blanked) ->
 * season (R1-M4: a plant's flowers or fruit only when iNaturalist records show them this month) ->
 * numbers not in the source -> (audit R2-M5) a wrong count (a count clue must count exactly what the
 * map counts, with the map's number) -> a generic Wild Find clue (no trait from its own source) -> a
 * copy of a prompt example -> a near-repeat of a clue already kept on this pass. Then the mix limits
 * computed by code are re-applied (extras beyond a section's max are dropped, in answer order).
 * Content tuning (2026-10-06): a clue cut off mid-sentence is dropped first; style checks (a 4-word run
 * copied from its own source, a stock or repeated opening, and on a low-data pool a near-repeat) only
 * make an item the first to go when a spare can replace it (`StyleReason`).
 * The grown-up's note is code-written from the kept items (`parentNoteFor`), never the model's.
 */
import { seasonProblem } from "@/lib/pool/season";
import { hasUrlOrMarkup } from "@/lib/safety/contact";
import { blockedBy, blockedWordIn, dangerClueWord, SAFETY_LINES } from "@/lib/safety/danger-taxa";
import { isAdultBand, type AgeBand } from "@/lib/pass/constants";
import { otherFeatureWord } from "./feature-words";
import { fixPlantWho, jargonProblem, triviaKind, voiceProblem, wrongKindWord } from "./jargon";
import { handlingInstruction } from "@/lib/safety/handling";
import type { PoolItem, Section } from "@/lib/pool/types";
import { looksScore, namePart } from "@/lib/pool/wild";
import { PROMPT_EXAMPLE_TEXTS, STOCK_FRAMES, STOCK_OPENINGS, STOCK_PHRASES, type Mix } from "./prompt";
import { PARENT_NOTE_MAX, PassItemDraft, SpotDraft, type PassDraftEnvelope } from "./schema";

/**
 * Every reason a model item can be dropped (logs, the pass footer, the eval scorer's drop table).
 * SPEC 6.2 lists the same set (the PM keeps it in sync).
 */
export const DROP_REASONS = [
  "schema",
  "cut_off",
  "url_or_markup",
  "unknown_id",
  "duplicate_id",
  "section_mismatch",
  "danger",
  "handling",
  "not_grounded",
  "other_feature",
  "name_leak",
  "name_trait",
  "mentions_map",
  "out_of_season",
  "number_not_in_source",
  "wrong_count",
  "broken_count",
  "silent_sound",
  "listening",
  "filler_only",
  "odd_wording",
  "riddle_frame",
  "generic_clue",
  "jargon",
  "trivia",
  "wrong_kind",
  "copies_example",
  "copies_source",
  "repeats_clue",
  "repeats_opening",
  "stock_frame",
  "kid_wording",
  "over_section_max",
] as const;

export type DropReason = (typeof DROP_REASONS)[number];

export type ValidItem = {
  item: PoolItem;
  clue: string;
  lookWhere: string;
  difficulty: "easy" | "medium" | "hard";
  sourceQuote: string;
  /** Content tuning: the style preference this item failed (it is printed only when no spare can replace it). */
  style?: StyleReason;
};

/** Drops that say the model could not write a valid clue for THAT item (not an id or shape problem, not style). */
const CONTENT_FAILS: ReadonlySet<DropReason> = new Set<DropReason>([
  "cut_off", "url_or_markup", "danger", "not_grounded", "other_feature", "name_leak", "mentions_map", "out_of_season", "number_not_in_source",
  "wrong_count", "broken_count", "silent_sound", "filler_only", "generic_clue", "jargon", "copies_example", "repeats_clue",
  // r7 follow-ups: a wrong kind word ("a big bug" for a tarantula) and nothing-to-see trivia dropped on a pool with spares.
  "wrong_kind", "trivia",
  // Round 8 (SEC-8-01): a touch/pick/catch instruction.
  "handling",
]);

/**
 * Checks about style, not truth or safety: preferences on a low-data pass (and repeats_opening and
 * name_trait on every pass).
 */
export type StyleReason = Extract<DropReason, "copies_source" | "repeats_clue" | "repeats_opening" | "name_trait" | "trivia" | "stock_frame" | "kid_wording" | "listening">;

export type ValidationResult = {
  items: ValidItem[];
  drops: Partial<Record<DropReason, number>>;
  /** Items the model returned (before any check). */
  returned: number;
  parentNote: string;
  /** Sections that ended below their minimum (logged; the pass still prints what is valid). */
  belowMin: Section[];
  hardCount: number;
  /** Items kept with their lookWhere left out because it used a word of the answer's name. */
  lookWhereCleared: number;
  /** S8c: items whose quote had the next JSON field glued on and was cut back to its real source part. */
  quotesRepaired: number;
  /** Content tuning: 4-word runs that clues copied from their source (for the refill's feedback). */
  copied?: string[];
  /** Content tuning: pool ids whose clue failed a content check and that were not kept (the refill offers other items first). */
  failedIds?: string[];
  /** R2-M5: valid spare items not printed (the model is asked for up to ASK_EXTRA more than n). */
  spares?: number;
  /** Content tuning: printed items that failed a style preference (no spare was left to replace them). */
  styleKept?: number;
  /** Audit R3-C1: clues whose filler opening ("Quick!", "Psst,", "Ready to count?") code took off. */
  openersTrimmed?: number;
  /** Audit R3: commands whose "?" code turned into "." ("Track 3 areas for sports?"). */
  questionsFixed?: number;
  /** Completeness + M10: clues whose bolted-on count sentence ("Count the 2 of them.", "There are 2.") code took off. */
  trailersTrimmed?: number;
};

/** A grounding quote shorter than this proves nothing ("the", "tree"). */
export const MIN_GROUNDING_CHARS = 8;

/** Lower-case, strip HTML, decode the entities our prompt escaping adds, unify quotes/dashes, single spaces. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/<\/?(b|i|em|strong|a|span|sup|sub|small|u)\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?)])/g, "$1")
    .trim();
}

/** Strip wrapping quotes and a trailing ellipsis/period the model may add around a copied phrase. */
function trimQuote(q: string): string {
  let t = q.trim();
  t = t.replace(/^["'`]+|["'`]+$/g, "").trim();
  t = t.replace(/(\.\.\.|[.,;:!?])+$/g, "").trim();
  t = t.replace(/^(\.\.\.)+/g, "").trim();
  return t;
}

/** The normalized quote when it is a substring of the normalized source and long enough, else null. */
function exactMatch(quote: string, normSource: string): string | null {
  const q = trimQuote(normalizeForMatch(quote));
  if (q.length < MIN_GROUNDING_CHARS) return null;
  return normSource.includes(q) ? q : null;
}

/**
 * S8c: a decoding glitch seen in 3 of 56 Gemma 4 31B answers (2026-10-05-2) glues the start of the next
 * JSON field onto a correct quote: "...across the park.专项parentNote: Help the child...",
 * "...as well as TexasparentNote: ...", "...for resting.`, ", "...one-bench-sourceQuote: ...".
 * The marker is where the quote ends. Schema field names match anywhere (they come glued to a word);
 * any other camelCase "...Note:" key starting a word ("periodontalNote:") and JSON punctuation residue (a quote mark or backtick before , } ]) too.
 */
export const FIELD_MARKER_RE =
  /\s*[,;.…]*\s*(?:parentNote|lookWhere|sourceQuote|itemId|targetId)\s*[:=]?|(?:^|[^\p{L}])(?:clue|section|difficulty|riddle)\s*[:=]|(?<!\p{L})\p{Ll}+Note\s*[:=]|[`"]\s*[,}\]]/u;
/** A run of letters from a non-Latin script glued into an English quote ("park.专项"): the glitch, never source text here. */
const NON_LATIN_RE = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
/** After the cut, at most this many trailing junk words ("Spanish gold house") may be dropped. */
const MAX_JUNK_WORDS = 2;

/**
 * The part of a glued quote that is really in the source, or null. Only used when the model's quote
 * failed the exact check AND carries a field marker. The answer is always a real normalized substring
 * of the source (never invented text): the quote up to the marker, minus any non-Latin glitch run and
 * at most MAX_JUNK_WORDS trailing words.
 */
export function repairGluedQuote(quote: string, source: string): string | null {
  const m = FIELD_MARKER_RE.exec(quote);
  if (!m) return null;
  let head = quote.slice(0, m.index);
  const nl = NON_LATIN_RE.exec(head);
  if (nl) head = head.slice(0, nl.index);
  const normSource = normalizeForMatch(source);
  const words = head.trim().split(/\s+/);
  for (let drop = 0; drop <= MAX_JUNK_WORDS && words.length - drop > 0; drop++) {
    const hit = exactMatch(words.slice(0, words.length - drop).join(" "), normSource);
    if (hit) return hit;
  }
  return null;
}

/**
 * The grounded quote: the model's quote (normalized) when it is a substring of the source, else the
 * repaired part of a glued quote (S8c), else null.
 */
export function groundedQuote(quote: string, source: string): string | null {
  return exactMatch(quote, normalizeForMatch(source)) ?? repairGluedQuote(quote, source);
}

/** True when `quote` (normalized, or its repaired glued form) is a substring of `source` and long enough to mean something. */
export function isGrounded(quote: string, source: string): boolean {
  return groundedQuote(quote, source) !== null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Name words this long or longer also leak through words built on them (R1-m3). */
export const STEM_MIN_LETTERS = 5;

/**
 * The stem a derived word must start with: the whole word up to 6 letters, else the word minus its
 * last 2 letters ("passiflora" -> "passiflo" catches "Passifloraceae"; "maximiliani" -> "maximilia"
 * catches "Maximilian"). Null for multi-word names and words under 5 letters, and (R1 follow-up) for
 * describing words that end in "-ed" ("throated", "painted", "striped", "crested"): their stem is the
 * plain describing word a clue should use ("a bright throat" for a ruby-throated hummingbird was
 * flagged in run 4). The whole word itself ("throated") is still a leak.
 */
export function nameStem(word: string): string | null {
  if (!/^\p{L}+$/u.test(word) || word.length < STEM_MIN_LETTERS) return null;
  if (word.endsWith("ed")) return null;
  return word.length <= 6 ? word : word.slice(0, -2);
}

/**
 * The first name word found in `text`, or null: the whole word (any case, simple plurals), or (R1-m3)
 * any word of the text that starts with the stem of a single name word of 5+ letters.
 */
export function nameLeak(text: string, words: readonly string[]): string | null {
  const t = normalizeForMatch(text);
  const tokens = t.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const w of words) {
    const word = normalizeForMatch(w);
    if (word.length < 3) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}(s|es|'s)?(?=$|[^\\p{L}\\p{N}])`, "u");
    if (re.test(t)) return w;
    const stem = nameStem(word);
    if (stem && tokens.some((tok) => tok.startsWith(stem))) return w;
  }
  return null;
}

/** Round-6 Q-6-03 (c): the root length a clue word shares with a common-name word ("glob" of "globular" in "globe"). */
export const NAME_ROOT_LETTERS = 4;

/**
 * Round-6 Q-6-03 (c): a near give-away the stem check cannot see, or null: a clue word that starts with the first
 * NAME_ROOT_LETTERS letters of a word of 6+ letters in the COMMON name ("a shell that is like a globe" for Globular
 * Drop Snail, "climbs" for Climbing hempvine, "a wheel of fire" for Firewheel). Scientific names are left out
 * ("Track a small turtle" is not a leak of Trachemys), and so are "-ed" words, like `nameStem`. A preference
 * (`name_trait`): the item is the first to go when a spare can replace it; it is printed when none can.
 */
export function nameRootLeak(clue: string, answer: string): string | null {
  const common = /^(.*?) \(/.exec(answer)?.[1] ?? answer;
  const tokens = normalizeForMatch(clue).match(/\p{L}+/gu) ?? [];
  for (const w of normalizeForMatch(common).match(/\p{L}+/gu) ?? []) {
    if (w.length < 6 || w.endsWith("ed")) continue;
    const root = w.slice(0, NAME_ROOT_LETTERS);
    const hit = tokens.find((t) => t.length >= NAME_ROOT_LETTERS && t !== w && t.startsWith(root));
    if (hit) return hit;
  }
  return null;
}

/** A clue that talks about the thing's name ("a white name", "named after", "is called"). */
export const NAME_TALK_RE = /\b(?:names?|named|called|nicknamed?)\b/i;

/** A trait word and its part count as one phrase when at most this many words apart ("a red tail", "its tail is bright red"). */
export const TRAIT_PART_GAP = 3;

/**
 * Audit R4-C2: the name phrase a clue spells out, or null: the trait word of a name trait pair ("red")
 * within TRAIT_PART_GAP words of its part ("tail", "tails", "tailed"), in either order. "a bird with a red
 * tail" (Red-tailed Hawk) and "orange or amber wings" (Eastern Amberwing) are leaks; "a red patch on its
 * shoulder" for Red-tailed Hawk and "a white belly" are not.
 */
export function traitPartLeak(clue: string, pairs: readonly { trait: string; part: string }[]): string | null {
  if (pairs.length === 0) return null;
  const tokens = normalizeForMatch(clue).match(/\p{L}+/gu) ?? [];
  for (const { trait, part } of pairs) {
    const tPos = tokens.flatMap((t, i) => (t === trait ? [i] : []));
    if (tPos.length === 0) continue;
    const pPos = tokens.flatMap((t, i) => (namePart(t) === part ? [i] : []));
    if (tPos.some((i) => pPos.some((j) => j !== i && Math.abs(j - i) <= TRAIT_PART_GAP))) return `${trait} ${part}`;
  }
  return null;
}

/** Numbers written with digits in `text` that do not appear in `source`. */
export function numbersNotIn(text: string, source: string): string[] {
  const found = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (found.length === 0) return [];
  const have = new Set(source.match(/\d+(?:[.,]\d+)?/g) ?? []);
  return found.filter((n) => !have.has(n));
}

// R1-m7 / R2-m3 / SEC-3-07: the contact filter lives in a small client-safe module (also used on screen).
export { hasUrlOrMarkup, HIDDEN_PARK_LABEL, HIDDEN_PARK_NOTE, safeParkName } from "@/lib/safety/contact";

/** "map", "maps", "mapped" (R1-m4): only a pass with a Find This Spot map may point at one. */
const MAP_RE = /\bmap(?:s|ped)?\b/i;
export const mentionsMap = (s: string) => MAP_RE.test(s);

/** Single-line plain text: control characters removed, spaces collapsed. */
const tidy = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

const tidyStrings = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? tidy(v) : v]));

/**
 * S8c (M7): the request schema no longer asks the model for `section` (about 6 answer tokens per item);
 * code fills it from the pool item the id points to. An answer that does carry a section is still
 * checked against the pool (section_mismatch), so the SPEC 6.2 item schema is unchanged.
 */
function withCodeSection(o: Record<string, unknown>, byId: ReadonlyMap<string, PoolItem>): Record<string, unknown> {
  if (o.section !== undefined || typeof o.itemId !== "string") return o;
  const item = byId.get(o.itemId);
  return item ? { ...o, section: item.section } : o;
}

export type ValidateOptions = {
  /** The pass prints a Find This Spot map (R1-m4). Without one, no clue or hint may mention a map. */
  hasMap: boolean;
  /** R2-M5: the mix the model was asked for (with spares). Defaults to `mix` (no spares asked). */
  ask?: Mix;
  /**
   * Content tuning: a low-data pool (prompt.ts `planRequest`). Only style checks change: a near-repeat
   * becomes a preference, and a Wild Find whose describing word is in its own quote (which holds a
   * looks-like word) passes the generic check. Safety, grounding, name leaks, numbers and counts are
   * never relaxed.
   */
  lowData?: boolean;
  /** Eval baseline only: the no-AI template copies its source sentences by design, so the copy check is off for it. */
  allowSourceCopies?: boolean;
  /**
   * Eval baseline only (run 2026-10-06-5): every masked template sentence opens "____ is a ...", so the
   * repeated-opening drop (a style rule for the model's own words) is off for it, like the copy check.
   */
  allowRepeatedOpenings?: boolean;
  /** Clues already kept by an earlier call of this pass (the refill): repeats are checked against them too. */
  prior?: readonly (Pick<ValidItem, "clue"> & { item?: Pick<PoolItem, "id"> })[];
  /** Audit R5-C3: the pass's age band (the jargon and trivia checks allow a few more words for 10-13). */
  band?: AgeBand;
  /** Eval tooling (evals/replay.ts): told every drop with the item id and the clue (no effect on the result). */
  trace?: (drop: { reason: DropReason; itemId: string | null; clue: string | null }) => void;
};

export function validateDraft(
  draft: PassDraftEnvelope,
  pool: readonly PoolItem[],
  mix: Mix,
  opts: ValidateOptions = { hasMap: false },
): ValidationResult {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const drops: Partial<Record<DropReason, number>> = {};
  /** Content tuning: ids whose clue failed a content check (the refill offers other items first). */
  const failed = new Set<string>();
  let current: string | null = null;
  let currentClue: string | null = null;
  const drop = (r: DropReason, clue: string | null = currentClue) => {
    drops[r] = (drops[r] ?? 0) + 1;
    if (current !== null && CONTENT_FAILS.has(r)) failed.add(current);
    opts.trace?.({ reason: r, itemId: current, clue });
  };
  const used = new Set<string>();
  const kept: ValidItem[] = [];
  let lookWhereCleared = 0;
  let quotesRepaired = 0;
  let openersTrimmed = 0;
  let questionsFixed = 0;
  let trailersTrimmed = 0;
  /** Content tuning: the source runs clues copied (the refill call is told not to use them). */
  const copied = new Set<string>();

  for (const raw of draft.items) {
    current = null;
    currentClue = null;
    const parsed = PassItemDraft.safeParse(raw && typeof raw === "object" ? withCodeSection(tidyStrings(raw as Record<string, unknown>), byId) : raw);
    if (!parsed.success) {
      const id = raw && typeof raw === "object" ? (raw as Record<string, unknown>).itemId : undefined;
      drop(typeof id === "string" && !byId.has(id) ? "unknown_id" : "schema");
      continue;
    }
    current = parsed.data.itemId;
    currentClue = parsed.data.clue;
    // Audit R3-C1: a filler opening ("Quick!", "Psst,", "Shh.", "Ready to count?") is taken off by code;
    // a clue that was nothing but filler is dropped.
    const trimmed = trimFillerOpening(parsed.data.clue);
    if (trimmed === null) {
      drop("filler_only");
      continue;
    }
    if (trimmed !== parsed.data.clue) openersTrimmed++;
    const punctuated = fixCommandQuestion(trimmed);
    if (punctuated !== trimmed) questionsFixed++;
    // Completeness + M10 (run 2026-10-06-5): "Notice the long seats for a rest. Count the 2 of them." The
    // bolted-on count sentence is taken off (code only removes words; the count checks then see the rest).
    const untailed = fixCountOfThem(trimCountTrailer(punctuated));
    if (untailed !== punctuated) trailersTrimmed++;
    const d = { ...parsed.data, clue: untailed };
    // Content tuning: a clue cut off mid-sentence ("Hunt for a ", seen 4 times in one answer of the
    // 2026-10-06 smoke) is broken output, whatever else it says.
    if (isCutOff(d.clue)) {
      drop("cut_off");
      continue;
    }
    if (hasUrlOrMarkup(d.clue) || hasUrlOrMarkup(d.lookWhere)) {
      drop("url_or_markup");
      continue;
    }
    const item = byId.get(d.itemId);
    if (!item) {
      drop("unknown_id");
      continue;
    }
    if (used.has(item.id)) {
      drop("duplicate_id");
      continue;
    }
    if (d.section !== item.section) {
      drop("section_mismatch");
      continue;
    }
    // Audit R5-S1: also any danger word ("a poisonous perennial herb", "venomous", "stings") in the clue or hint.
    if (
      (item.taxon && blockedBy(item.taxon)) ||
      blockedWordIn(d.clue) ||
      blockedWordIn(d.lookWhere) ||
      dangerClueWord(d.clue) !== null ||
      dangerClueWord(d.lookWhere) !== null
    ) {
      drop("danger");
      continue;
    }
    // Round 8 (SEC-8-01): "Crush a leaf and smell it", "Run your fingers along the bark", "Catch this frog": a contact
    // instruction is removed in code, every band (the prompt rule alone was the only guard).
    if (handlingInstruction(d.clue) !== null) {
      drop("handling");
      continue;
    }
    const normSource = normalizeForMatch(item.sourceText);
    let sourceQuote = d.sourceQuote;
    if (!exactMatch(sourceQuote, normSource)) {
      const repaired = repairGluedQuote(sourceQuote, item.sourceText);
      if (!repaired) {
        drop("not_grounded");
        continue;
      }
      // S8c: keep only the part that is really in the source (the glued next field is cut off).
      sourceQuote = repaired;
      quotesRepaired++;
    }
    if (nameLeak(d.clue, item.nameWords)) {
      drop("name_leak");
      continue;
    }
    // Bench/shelter fix (2026-10-07): "Spot a place with a roof and pillars where people eat." for Benches (Celebration,
    // 2 complete warm-up passes). The roof and pillars were the picnic shelter's facts (the Find This Spot target); the
    // quote was a real bench phrase. A Park Find clue naming another feature's own thing that its SOURCE never says goes.
    if (otherFeatureWord(d.clue, item) !== null) {
      drop("other_feature");
      continue;
    }
    // PM decision 1B (2026-10-06): a colour, pattern or size word of the species' own name ("a plant with
    // white flowers" for White Morning-glory) is a preference, not a hard leak: the item is the first to go
    // when a spare can replace it (as a hard leak it cut complete first answers on low-data parks).
    const traits = item.nameTraits ?? [];
    const traitHit = traits.length > 0 && nameLeak(d.clue, traits) !== null;
    // ... but a clue that says the trait word is in its NAME ("Sneak up on a tree with a white name." for
    // American elm, also called white elm: builder N's live refill, 2026-10-06) gives the name away: a hard leak.
    // Audit R4-C2: a Wild Find clue about its NAME ("a tree with a name like a pencil" for pencil cedar, "flowers that
    // have a worm-like root name", builder R2 live smoke) is a name riddle, never something to see: a hard leak.
    if ((traitHit || item.section === "wild") && NAME_TALK_RE.test(d.clue)) {
      drop("name_leak");
      continue;
    }
    // Audit R4-C2: "Glance up for a bird with a red tail." for Red-tailed Hawk. The trait word together with
    // the part its name pins it to IS the name: a hard leak. (A lone colour word stays a preference.)
    if (traitPartLeak(d.clue, item.nameTraitParts ?? []) !== null) {
      drop("name_leak");
      continue;
    }
    // A name word only in lookWhere ("at the pond" for a pond): the clue is fine, so keep the item and
    // leave the hint out (S8b). lookWhere is optional on the pass; the answer is never printed for the kid.
    // A name trait word in the hint ("by the white flowers") is left out too.
    let lookWhere = d.lookWhere;
    // Round 8 (SEC-8-01): a hint that says to touch or pick something is left out (the clue is kept).
    if (lookWhere && handlingInstruction(lookWhere) !== null) {
      lookWhere = "";
      lookWhereCleared++;
    }
    if (nameLeak(lookWhere, item.nameWords) || (traits.length > 0 && nameLeak(lookWhere, traits)) || traitPartLeak(lookWhere, item.nameTraitParts ?? []) !== null) {
      lookWhere = "";
      lookWhereCleared++;
    }
    // Audit R4 (quality content note): "Look: on the ground" printed for a bridge railing and a picnic
    // shelter. A ground, sky, tree or bush hint says nothing about where a built Park Find is, and a water
    // hint for a pond or creek gives it away: the hint is left out (the clue is kept).
    if (lookWhere && item.section === "park" && parkLookProblem(lookWhere, item.id) !== null) {
      lookWhere = "";
      lookWhereCleared++;
    }
    // R1-m4: "Look: follow the map" on a pass that has no map.
    if (!opts.hasMap) {
      if (mentionsMap(d.clue)) {
        drop("mentions_map");
        continue;
      }
      if (lookWhere && mentionsMap(lookWhere)) {
        lookWhere = "";
        lookWhereCleared++;
      }
    }
    // R1-M4: a plant's flowers or fruit only when iNaturalist records show them this month.
    if (item.season && seasonProblem(`${d.clue} ${lookWhere}`, item.season)) {
      drop("out_of_season");
      continue;
    }
    if (numbersNotIn(`${d.clue} ${lookWhere}`, item.sourceText).length > 0) {
      drop("number_not_in_source");
      continue;
    }
    // R2-M5: "Count the goals ... There are 25." when the map counts 25 FIELDS; "There is 1." counts.
    if (countProblem(d.clue, item) !== null) {
      drop("wrong_count");
      continue;
    }
    // Audit R3-C1: "Guess how many 25 big grass areas have goals?" / "How many seats ...? There are 9."
    // A "how many" question that states a number gives its own answer away (and often reads broken).
    if (brokenCountQuestion(d.clue) !== null || questionCountMix(d.clue, item) !== null) {
      drop("broken_count");
      continue;
    }
    // Audit R4-C2: "Explore for a bug ..." is not English. Run -5: "Watch for a plant with white blooms. I am
    // poisonous!" switches from talking to the child to the thing talking.
    if (oddWording(d.clue) !== null || voiceSwitch(d.clue) !== null) {
      drop("odd_wording");
      continue;
    }
    // Audit R3-C1: "Listen for a bug! Is there one that is green with blue on its end?" (a damselfly).
    if (silentSoundProblem(`${d.clue} ${lookWhere}`, item) !== null) {
      drop("silent_sound");
      continue;
    }
    // Round 8 (Q-8-04): "What rushing sound does the running water make?" on the first live 13+ pass. The 13+ brief is
    // "detail a person can check by eye, no sound words": on a 13+ pass a listening clue is the first to go when a spare
    // can replace it (a hard drop would print 7 of 8 finds: 7 is above the refill threshold). Kids keep at most one.
    const listening = opts.band !== undefined && isAdultBand(opts.band) && isSoundClue(d.clue);
    // R2-M5: "Look for a tree with seeds or fruit." fits hundreds of species; "white flowers" proved by
    // "show it with flowers" was never checked.
    // Content tuning: on a low-data pool, a clue whose describing word is in its own quote, and that
    // quote holds a looks-like word, is not generic even when the quote is the name ("bright yellow"
    // proved by "yellow garden spider"). A trait the quote does not hold ("a round shell" for a quote
    // about an operculum) is still dropped: grounding is never relaxed.
    if (
      item.section === "wild" &&
      (isGenericClue(d.clue, item.sourceText) || quoteIsOnlyName(sourceQuote, item.answer)) &&
      !(opts.lowData && looksScore(sourceQuote) > 0 && !isGenericClue(d.clue, sourceQuote))
    ) {
      drop("generic_clue");
      continue;
    }
    // Judge R7 T1: "Spot a great distance." / "Spot 2 spots." name nothing to look for, in any section.
    if (nothingToSee(d.clue)) {
      drop("generic_clue");
      continue;
    }
    // Audit R5-C3 / Q-5-01: Wikipedia jargon ("a moth of the Crambidae family", "pale yellow hindtarsomere",
    // "a mass of 24-39.5 g") gives a child nothing to look for: always removed. A hint with jargon is left out.
    if (jargonProblem(d.clue, opts.band, item.section) !== null) {
      drop("jargon");
      continue;
    }
    // Round-6 Q-6-03: a hint that contradicts its clue ("a tree ..." with "Look: on bushes", leaves or fruit with
    // "Look: on tree trunks") is left out, like a jargon hint.
    if (lookWhere && (jargonProblem(lookWhere, opts.band, item.section) !== null || hintContradicts(d.clue, lookWhere))) {
      lookWhere = "";
      lookWhereCleared++;
    }
    // r7 follow-ups (run 2026-10-06-7): "Watch for a big bug with a dark brown body." (a tarantula), "a bug that is
    // black and gold" (a garden spider), "a water pet" (a wild sunfish), "a small fly" (a damselfly). Wrong facts.
    if (item.section === "wild" && wrongKindWord(d.clue, item.taxon) !== null) {
      drop("wrong_kind");
      continue;
    }
    // R2-M5: the prompt's example sentences came back word for word on every park.
    if (copiesPromptExample(d.clue) !== null) {
      drop("copies_example");
      continue;
    }
    // Content tuning (M10): style checks. A clue that copies a 4-word run of its own source ("things to
    // climb, slide and swing on" on 5 parks in run 2026-10-06-2) is the first to go when there is a
    // spare, never a hard drop: as a drop it cost 2 of 17 passes their completeness in a 1-run smoke
    // (Gemma kept copying in the refill too). The Park Finds facts now vary their words per park
    // (pool/park.ts chooseWords), so a copied phrase differs between parks. Near-repeats on the same
    // pass stay drops, except on a low-data pool.
    // Round-6 Q-6-03 (c): "a shell that is like a globe" for Globular Drop Snail is a near give-away: a preference too.
    let style: StyleReason | undefined = traitHit || (item.section === "wild" && nameRootLeak(d.clue, item.answer) !== null) ? "name_trait" : undefined;
    // Audit R5-C3 / Q-5-01: range trivia ("native to Texas and Oklahoma"), field-guide words ("an operculum",
    // "arboreal") and a bare colour ("a bird that is black"): the first to go when a spare can replace it.
    // r7 follow-ups (run 2026-10-06-7): a range or habitat fact ("resident in the central United States", "grows in
    // riparian zones") or a bare colour ("a flying animal that is red") gives nothing to look for. Unless the pool is
    // low-data it is dropped, so a spare or the refill (which offers other items first) takes its place.
    const trivia = item.section === "wild" ? triviaKind(d.clue, opts.band) : null;
    if (trivia?.kind === "nothing_to_see" && !opts.lowData) {
      drop("trivia");
      continue;
    }
    if (trivia) style ??= "trivia";
    const run = opts.allowSourceCopies ? null : copiedRun(d.clue, item.sourceText);
    if (run !== null) {
      copied.add(run);
      style ??= "copies_source";
    }
    const earlier = [...(opts.prior ?? []), ...kept];
    // R3: the same sentence frame twice on one pass ("Count them. There are 2." / "... There are 4.") is a repeat too.
    if (earlier.some((k) => trigramOverlap(k.clue, d.clue) >= COPY_OVERLAP || sharedFrame(k.clue, d.clue) !== null)) {
      if (!opts.lowData) {
        drop("repeats_clue");
        continue;
      }
      style ??= "repeats_clue";
    }
    // Audit R4-C2: the same first word as an earlier clue on this pass ("Glance at ...", "Glance up for ...")
    // reads machine-made on paper: a drop now (it was a preference, and most passes have no spare).
    if (!opts.allowRepeatedOpenings && earlier.some((k) => sameOpening(k.clue, d.clue) || sameFirstWord(k.clue, d.clue))) {
      drop("repeats_opening");
      continue;
    }
    // Round-6 judge C4: every example pass had a "listen for the water" clue. One sound clue per pass: a second one
    // goes like a near-repeat (dropped, a preference on a low-data pool).
    if (isSoundClue(d.clue) && earlier.some((k) => isSoundClue(k.clue))) {
      if (!opts.lowData) {
        drop("repeats_clue");
        continue;
      }
      style ??= "repeats_clue";
    }
    // Round 8 judge C1: "Count the 2 cold water spots…", "…paths that carry you across water", "Check the water that
    // glitters like a mirror" (3 of 3 hero lines). At most MAX_WATER_CLUES clues about water a pass, and the shine
    // imagery ("glitters", "like a mirror", "sparkles") once. A preference: the first to go when a spare can replace it.
    // As a hard drop it cut run -8's Celebration r1 (pond "like a mirror", fountain "glitters") from 8 to 7 finds, and 7
    // of 8 is above the refill threshold, so nothing would replace it.
    if (waterRepeat({ clue: d.clue, item }, earlier) !== null) style ??= "repeats_clue";
    if (listening) style ??= "listening";
    // Audit R4-C2: "Point to me; I am a board ...", "Scan for me; I am a metal cooker ..." on 6 of 8 clues.
    // One clue in which the thing talks as "I" is a riddle; a second one on the same pass is a tic.
    if (isRiddleFrame(d.clue) && earlier.some((k) => isRiddleFrame(k.clue))) {
      drop("riddle_frame");
      continue;
    }
    // M10 (run 2026-10-06-8): "Somewhere you will see a" opened printed clues on 5 parks although the prompt names it as
    // a start to avoid. A frame the prompt names (STOCK_FRAMES) goes first when a spare can take its place; one that is
    // still printed gets a plain first word on the finished pass (build-pass.ts, `rewriteStockFrame`). A hard drop was
    // tried first: on run -8's answers it made 8 more passes short, each needing a refill call (M3, M8).
    if (stockFrame(d.clue) !== null) style ??= "stock_frame";
    // Round 8 (Q-8-04): kid wording on a 13+ pass ("a ride with two wheels", "Who has …?", "!"): the first to go when a
    // spare can replace it. A plant's "Who" is checked as printed ("What", build-pass.ts fixPlantWho), so it is fine.
    // Kid voice (Kevin 2026-10-10): the same preference for wording that doesn't fit the band's reader: grown-up words on
    // a kid pass ("flat smooth areas", "strung across its center"), "Check for", a sentence piece, one word twice in a
    // clue ("low benches in low dugouts"), people who may not be there ("players waiting"). jargon.ts `voiceProblem`.
    if (voiceProblem(item.section === "wild" ? fixPlantWho(d.clue, item) : d.clue, opts.band, item.section) !== null) {
      style ??= "kid_wording";
    }
    // A stock opening ("Can you find ..."): only a preference.
    if (style === undefined && stockOpening(d.clue) !== null) {
      style = "repeats_opening";
    }
    used.add(item.id);
    kept.push({ item, clue: d.clue, lookWhere, difficulty: d.difficulty, sourceQuote, ...(style ? { style } : {}) });
  }

  // Re-check the mix limits computed by code (against what was asked, spares included).
  const ask = opts.ask ?? mix;
  const perSection: Record<Section, number> = { park: 0, wild: 0, lucky: 0 };
  const asked: ValidItem[] = [];
  current = null;
  for (const v of kept) {
    const s = v.item.section;
    if (perSection[s] >= ask.max[s]) {
      opts.trace?.({ reason: "over_section_max", itemId: v.item.id, clue: v.clue });
      drops.over_section_max = (drops.over_section_max ?? 0) + 1;
      continue;
    }
    perSection[s]++;
    asked.push(v);
  }
  // R2-M5: then keep at most mix.n of them inside the printed mix (spares that weren't needed are not drops).
  // Content tuning: items that failed a style preference go first when something has to go; the
  // printed items keep the answer's order. A style item left out counts as a drop for its reason.
  const preferred = [...asked.filter((v) => !v.style), ...asked.filter((v) => v.style)];
  const chosen = new Set(fitToMix(preferred, mix).items);
  // Round-6 Q-6-02: a printed find whose clue or hint says water gets the water line (and counts in the tip).
  const items = asked.filter((v) => chosen.has(v)).map(withWaterSafety);
  let spares = 0;
  let styleKept = 0;
  for (const v of asked) {
    if (chosen.has(v)) {
      if (v.style) styleKept++;
    } else if (v.style) {
      drops[v.style] = (drops[v.style] ?? 0) + 1;
      opts.trace?.({ reason: v.style, itemId: v.item.id, clue: v.clue });
    } else spares++;
  }
  for (const s of Object.keys(perSection) as Section[]) perSection[s] = items.filter((v) => v.item.section === s).length;
  const belowMin = (Object.keys(perSection) as Section[]).filter((s) => perSection[s] < mix.min[s]);

  // R2-M5: the model's parentNote (if an old-style answer carries one) is ignored; code writes the tip.
  const parentNote = parentNoteFor(items);

  return {
    items,
    drops,
    returned: draft.items.length,
    parentNote,
    belowMin,
    hardCount: items.filter((i) => i.difficulty === "hard").length,
    lookWhereCleared,
    quotesRepaired,
    copied: [...copied],
    failedIds: [...failed].filter((id) => !used.has(id)),
    spares,
    styleKept,
    openersTrimmed,
    questionsFixed,
    trailersTrimmed,
  };
}

/**
 * R2-M5: the valid items that fit the printed mix: at most mix.max per section (answer order), then,
 * while there are more than mix.n, the last item of a section that is above its minimum goes.
 * `spares` = valid items left over (the model was asked for spares; they are not counted as removed).
 */
export function fitToMix<T extends { item: { section: Section }; difficulty?: string }>(valid: readonly T[], mix: Mix): { items: T[]; spares: number } {
  const per: Record<Section, number> = { park: 0, wild: 0, lucky: 0 };
  const items: T[] = [];
  for (const v of valid) {
    if (per[v.item.section] >= mix.max[v.item.section]) continue;
    per[v.item.section]++;
    items.push(v);
  }
  capLucky(items, per, mix);
  // Audit R4 (Q-4-04): a "hard" item is the last to go while the pass has no more than hardMin of them
  // (ages 10-13 promise 2 hard finds; a live pass printed 1).
  let hard = items.filter((v) => v.difficulty === "hard").length;
  for (const keepHard of [true, false]) {
    for (let i = items.length - 1; i >= 0 && items.length > mix.n; i--) {
      const s = items[i].item.section;
      const isHard = items[i].difficulty === "hard";
      if (keepHard && isHard && hard <= mix.hardMin) continue;
      if (per[s] > mix.min[s]) {
        per[s]--;
        if (isHard) hard--;
        items.splice(i, 1);
      }
    }
  }
  while (items.length > mix.n) items.pop();
  return { items, spares: valid.length - items.length };
}

/**
 * R3 (Arbor Hills, 2026-10-06): Lucky Finds may not crowd out the sure finds. While Park Finds or Wild
 * Finds are below their minimum, at most ONE Lucky Find is printed (the live Arbor pass printed 2 Lucky
 * Finds and 1 Wild Find, minimum 2). The lucky item left out is a spare, not a removed clue; the pass
 * is then short, so the refill asks for the missing sure find (prompt.ts `refillPlan` offers no lucky).
 */
export function luckyLimit(per: Readonly<Record<Section, number>>, mix: Pick<Mix, "min" | "max">): number {
  const short = per.park < mix.min.park || per.wild < mix.min.wild;
  return short ? Math.min(1, mix.max.lucky) : mix.max.lucky;
}

/** Drops the last Lucky Finds of `items` (in place) beyond `luckyLimit`; updates `per`. */
function capLucky<T extends { item: { section: Section } }>(items: T[], per: Record<Section, number>, mix: Pick<Mix, "min" | "max">): void {
  const limit = luckyLimit(per, mix);
  for (let i = items.length - 1; i >= 0 && per.lucky > limit; i--) {
    if (items[i].item.section !== "lucky") continue;
    items.splice(i, 1);
    per.lucky--;
  }
}

/**
 * Fewer valid items than this -> one retry (SPEC §6.2 as changed in audit round 1, R1-m1: "< n-1
 * survive"), so the retry fires exactly when the pass would not count as complete for M3.
 */
export function retryThreshold(n: number): number {
  return Math.max(1, n - 1);
}

// ---------- Find This Spot riddle (S5) ----------

/** What the riddle is checked against: the code-picked target and its code-written fact sheet. */
export type SpotCheckTarget = { id: string; sourceText: string; nameWords: readonly string[] };

export type SpotReason = "missing" | "schema" | "wrong_target" | "url_or_markup" | "danger" | "handling" | "not_grounded" | "name_leak" | "number_not_in_source";

/**
 * The model's riddle for the X, with the same checks as a clue (SPEC 6.2): spec zod schema, the one
 * code-picked target id, no URL/markup, no blocked word, `sourceQuote` a normalized substring of the
 * target's fact sheet, no name of the thing, no number that isn't in the fact sheet.
 * A failed riddle is never printed; the pass uses the fixed code line instead.
 */
export function validateSpot(raw: unknown, target: SpotCheckTarget): { ok: true; riddle: string } | { ok: false; reason: SpotReason } {
  if (raw === undefined || raw === null) return { ok: false, reason: "missing" };
  const parsed = SpotDraft.safeParse(
    typeof raw === "object" ? tidyStrings(raw as Record<string, unknown>) : raw,
  );
  if (!parsed.success) return { ok: false, reason: "schema" };
  const d = parsed.data;
  if (d.targetId !== target.id) return { ok: false, reason: "wrong_target" };
  if (hasUrlOrMarkup(d.riddle)) return { ok: false, reason: "url_or_markup" };
  if (blockedWordIn(d.riddle) || dangerClueWord(d.riddle) !== null) return { ok: false, reason: "danger" };
  // Round 8 (SEC-8-01): the riddle never says to touch, pick or hold anything either (the fixed code line is printed).
  if (handlingInstruction(d.riddle) !== null) return { ok: false, reason: "handling" };
  if (!isGrounded(d.sourceQuote, target.sourceText)) return { ok: false, reason: "not_grounded" };
  if (nameLeak(d.riddle, target.nameWords)) return { ok: false, reason: "name_leak" };
  if (numbersNotIn(d.riddle, target.sourceText).length > 0) return { ok: false, reason: "number_not_in_source" };
  return { ok: true, riddle: d.riddle };
}

/**
 * S8b: when a second call was needed, keep the valid items of BOTH answers instead of only the
 * bigger one. Starts from `primary` (the better answer) and fills with the other answer's valid items
 * whose ids are not used yet, inside the code-computed section maxima and the pass size n.
 * Drop counts stay those of `primary` (the footer reports what was removed from that answer).
 */
export function mergeResults(primary: ValidationResult, other: ValidationResult, mix: Mix): ValidationResult {
  const items = [...primary.items];
  const used = new Set(items.map((v) => v.item.id));
  const perSection: Record<Section, number> = { park: 0, wild: 0, lucky: 0 };
  for (const v of items) perSection[v.item.section]++;
  // R3: the other answer's sure finds (park, wild) first, then its Lucky Finds inside `luckyLimit`.
  const others = [...other.items.filter((v) => v.item.section !== "lucky"), ...other.items.filter((v) => v.item.section === "lucky")];
  for (const v of others) {
    if (items.length >= mix.n) break;
    const s = v.item.section;
    if (used.has(v.item.id) || perSection[s] >= mix.max[s]) continue;
    if (s === "lucky" && perSection.lucky >= luckyLimit(perSection, mix)) continue;
    used.add(v.item.id);
    perSection[s]++;
    items.push(v);
  }
  capLucky(items, perSection, mix);
  return {
    ...primary,
    items,
    parentNote: parentNoteFor(items),
    belowMin: (Object.keys(perSection) as Section[]).filter((s) => perSection[s] < mix.min[s]),
    hardCount: items.filter((i) => i.difficulty === "hard").length,
  };
}

// ---------- R2-M5: clue variety and count accuracy ----------

/** Lower-case word tokens of one sentence-split text (normalized like the grounding check). */
function sentencesOf(text: string): string[][] {
  return normalizeForMatch(text)
    .split(/[.!?;:]+/)
    .map((s) => s.match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [])
    .filter((t) => t.length > 0);
}

/** Word n-grams inside sentences (never across a sentence end). */
export function ngrams(text: string, n: number): Set<string> {
  const out = new Set<string>();
  for (const t of sentencesOf(text)) for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n).join(" "));
  return out;
}

/** Share of `a`'s trigrams that are also in `b` (0..1); 0 when either has none. */
export function trigramShare(a: string, b: string): number {
  return sharedTrigrams(a, b).share;
}

function sharedTrigrams(a: string, b: string): { shared: number; share: number } {
  const ga = ngrams(a, 3);
  const gb = ngrams(b, 3);
  if (ga.size === 0 || gb.size === 0) return { shared: 0, share: 0 };
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return { shared, share: shared / ga.size };
}

/** A copy shares at least this many trigrams too (a 3-word opener like "find a place" alone is not a copy). */
export const COPY_MIN_SHARED = 3;

/** The larger share of either text's trigrams found in the other (0..1): two clues that are near repeats. */
export function trigramOverlap(a: string, b: string): number {
  return Math.max(trigramShare(a, b), trigramShare(b, a));
}

/** A clue this close to a prompt example (or to another clue on the same pass) is a copy. */
export const COPY_OVERLAP = 0.6;

/**
 * R2-M5: the clue copies one of the prompt's quoted examples: at least COPY_OVERLAP of the clue's
 * trigrams are in the example. (Only the clue side: "Find a plant with purple blooms." shares its
 * opener with the bad example "Find a plant with flowers." but is not a copy of it.)
 */
export function copiesPromptExample(clue: string, examples: readonly string[] = PROMPT_EXAMPLE_TEXTS): string | null {
  for (const ex of examples) {
    const { shared, share } = sharedTrigrams(clue, ex);
    if (share >= COPY_OVERLAP && shared >= COPY_MIN_SHARED) return ex;
  }
  return null;
}

/** Singular form for noun matching ("benches" -> "bench", "ways" -> "way", "berries" -> "berry"). */
export function singularWord(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(?:ch|sh|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

/** Number words a clue may use for a count ("one" is left out: "each one", "the one with ..."). */
const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const numberOf = (tok: string): number | null => (/^\d+$/.test(tok) ? Number(tok) : (NUMBER_WORDS[tok] ?? null));

/** Words that end a counted-noun run ("how many long seats CAN you find"). */
const RUN_STOP = new Set([
  "a", "an", "the", "of", "at", "in", "on", "for", "with", "to", "by", "from", "or", "and", "near", "into", "over", "under",
  "across", "around", "along", "beside", "behind", "next", "inside", "outside", "it", "its", "is", "are", "was", "were", "be",
  "can", "could", "do", "does", "did", "you", "your", "have", "has", "had", "there", "here", "that", "which", "who", "this",
  "these", "those", "them", "they", "all", "each", "every", "how", "many", "count", "up", "more", "than", "about", "i", "my",
  "me", "we", "will", "see", "spot", "find", "where", "what", "when", "so", "if", "but", "just", "only", "too",
]);

/**
 * The counted words after position i: the run of non-stop words (at most 4), singular, or null.
 * "how many seats hang from chains" -> [seat, hang]; "how many hoops on tall poles" -> [hoop].
 */
function headAfter(tokens: readonly string[], i: number): string[] | null {
  const run: string[] = [];
  for (let j = i; j < tokens.length && run.length < 4; j++) {
    if (RUN_STOP.has(tokens[j]) || numberOf(tokens[j]) !== null) break;
    run.push(singularWord(tokens[j]));
  }
  return run.length > 0 ? run : null;
}

/** Whole-thing words any count may use ("How many places to cook food...", "spots for resting"). */
// Run 2026-10-06-5: "4 open marked spaces used for games" (sports fields) and "2 spaces for kicking a ball"
// (soccer fields) were dropped as wrong counts; "space" names the whole thing like "area" does.
const ANY_COUNT_NOUNS = new Set(["place", "spot", "way", "area", "space", "thing", "one"]);

/** Counted nouns a clue names: after "how many", after "count (the|all the)", and after each number. */
function countedHeads(text: string): { heads: string[][]; numbers: { n: number; head: string[] | null }[]; isCount: boolean } {
  const heads: string[][] = [];
  const numbers: { n: number; head: string[] | null }[] = [];
  let isCount = false;
  for (const t of sentencesOf(text)) {
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "how" && t[i + 1] === "many") {
        isCount = true;
        const h = headAfter(t, i + 2);
        if (h) heads.push(h);
      } else if (t[i] === "count" || t[i] === "counting") {
        isCount = true;
        let j = i + 1;
        while (j < t.length && (t[j] === "the" || t[j] === "all" || t[j] === "up" || t[j] === "of")) j++;
        const h = headAfter(t, j);
        if (h) heads.push(h);
      }
      const n = numberOf(t[i]);
      if (n !== null) {
        const h = headAfter(t, i + 1);
        numbers.push({ n, head: h });
        if (h) heads.push(h);
      }
    }
  }
  return { heads, numbers, isCount: isCount || numbers.length > 0 };
}

/** The words within 4 places after each time `n` (digits or a number word) appears in the source, singular, no stop words. */
function sourceWordsAfter(source: string, n: number): Set<string> {
  const out = new Set<string>();
  for (const t of sentencesOf(source)) {
    for (let i = 0; i < t.length; i++) {
      if (numberOf(t[i]) !== n) continue;
      for (const w of t.slice(i + 1, i + 5)) if (!RUN_STOP.has(w)) out.add(singularWord(w));
    }
  }
  return out;
}

/**
 * R2-M5 count accuracy. Returns why a clue's count is wrong, or null.
 * - Park Finds (the source carries `count`): a count clue needs a map count of 2 or more; every number
 *   must be that count; every counted noun must be one the map count counts (fields, not goals).
 * - Other items: a number in the clue must be in the source (digits or a number word), and a noun
 *   right after it must also follow that number in the source ("5 petals" vs "5 cm").
 */
export function countProblem(clue: string, item: Pick<PoolItem, "section" | "sourceText" | "count">): string | null {
  const { heads, numbers, isCount } = countedHeads(clue);
  if (item.count) {
    if (!isCount) return null;
    if (item.count.n === null) return "count clue but the map has no count of 2 or more";
    const wrongN = numbers.find((x) => x.n !== item.count!.n);
    if (wrongN) return `says ${wrongN.n}, the map count is ${item.count.n}`;
    const allowed = new Set([...item.count.of.map(singularWord), ...ANY_COUNT_NOUNS]);
    const wrongHead = heads.find((h) => !h.some((w) => allowed.has(w)));
    if (wrongHead) return `counts "${wrongHead.join(" ")}", the map counts ${item.count.of.join("/")}`;
    return null;
  }
  for (const { n, head } of numbers) {
    const after = sourceWordsAfter(item.sourceText, n);
    const inSource = after.size > 0 || sentencesOf(item.sourceText).some((t) => t.some((w) => numberOf(w) === n));
    if (!inSource) return `${n} is not in the source`;
    if (head && !head.some((w) => after.has(w))) return `"${n} ${head.join(" ")}" is not in the source`;
  }
  return null;
}

/** Words that fit almost any find: a Wild Find clue needs at least one word beyond these that is also in its source. */
const TRAIT_STOP = new Set([
  "look", "find", "spot", "search", "see", "hunt", "notice", "check", "spy", "eye", "plant", "tree", "flower", "bloom", "blossom",
  "seed", "fruit", "berry", "pod", "petal", "leaf", "leave", "bush", "shrub", "grass", "vine", "weed", "herb", "stem", "bird", "bug",
  "insect", "animal", "creature", "critter", "thing", "kind", "type", "one", "small", "big", "little", "large", "tiny", "tall",
  "short", "pretty", "nice", "cool", "green", "near", "grow", "growing", "live", "living", "life", "park", "place", "area",
  "ground", "path", "nature", "here", "there", "where", "what", "who", "have", "with", "that", "this", "some", "many", "like",
  "color", "colour", "can", "you", "your", "its", "wild", "around", "outside", "today", "also", "very", "really", "sky", "the",
  "and", "for", "are", "has", "had", "was", "not", "but", "out", "get", "got", "how", "may", "might", "will", "make", "made",
  "lot", "lots", "watch", "sitting", "sit", "hide", "hiding", "hidden", "secret", "special", "trait", "detective", "ranger",
  "whisper", "dare", "riddle", "clue", "friend", "hello", "hey", "guess", "name", "called", "come", "comes", "from", "about",
  "into", "onto", "over", "under", "up", "down", "them", "they", "their", "she", "her", "him", "his", "our", "now", "when",
  // The code-written season sentence ("In October, iNaturalist photos from this area show it with flowers") is no trait.
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "month", "season", "year", "inaturalist", "photo", "show", "time", "day", "fall", "autumn", "spring", "summer", "winter",
  // Audit R3-C1: trivia, not something to see ("Who is the bird of prey that is common in North America?").
  "common", "native", "north", "south", "east", "west", "america", "american", "found", "known", "widespread", "species",
  "genus", "family", "range", "prey", "region", "world", "united", "state", "europe", "asia", "africa", "mexico", "canada",
  "continent", "country", "throughout", "worldwide",
  // R3 (example passes): what sort of thing it is, its size class and the clue's own command word are no
  // trait either. "Track a grass moth." passed on "moth"; "Sneak up on a medium-sized bird of prey." on "medium".
  "moth", "butterfly", "beetle", "fly", "bee", "wasp", "ant", "spider", "snake", "lizard", "frog", "toad", "turtle", "fish",
  "duck", "mushroom", "fungus", "fungi", "lichen", "moss", "fern", "snail", "slug", "worm", "dragonfly", "damselfly",
  "grasshopper", "cricket", "hawk", "owl", "sparrow", "warbler", "songbird", "mammal", "reptile", "amphibian", "sedge", "reed",
  "medium", "sized", "size", "average", "typical", "usual", "member", "group", "sort",
  "track", "sneak", "tiptoe", "wander", "explore", "glance", "discover", "seek", "scan", "squint", "peek", "point", "follow",
  // Run 2026-10-06-5 quick win: "Where is the tree animal that helps the forest grow?" (eastern gray squirrel, "natural
  // forest regenerator") passed on "forest": where it lives or what it does for nature is no trait a child can see.
  "forest", "forests", "woodland", "woods", "habitat", "ecosystem", "help", "role", "important",
  // Where to look is not what it looks like ("Somewhere you can spot ...").
  "somewhere", "anywhere", "nearby", "close", "closely",
  // Live check (builder T, 2026-10-06): "Who is the only one in its own family?" (yellow-breasted chat) passed on
  // "own"; "rare" is trivia too. Neither is something to see.
  "own", "rare",
]);

const traitStem = (w: string) => (w.length >= 5 ? w.slice(0, 4) : w);

/**
 * Content tuning: the word with a common ending taken off ("wades" and "wading" -> "wad", "spiny" and
 * "spines" -> "spin"), so a clue in the child's words still matches its source. Run 2026-10-06-2 dropped
 * "I am a big bird that wades in the wet areas." for a "large wading bird" as generic.
 */
export function suffixStem(w: string): string {
  for (const suf of ["ing", "ed", "es", "er", "ly", "s", "y", "e"]) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

/** The describing words of a text: no generic find words, no stop words, no digits (singular). */
export function traitWords(text: string): string[] {
  const stop = (w: string) => TRAIT_STOP.has(w) || RUN_STOP.has(w);
  // Completeness (live re-recording 2026-10-06): a stop word is checked before AND after the plural is taken
  // off. "this" became "thi" and matched the code-written season sentence ("photos from this area") in every
  // plant source, so "Somewhere you can spot fruit or seeds on this vine?" passed as not generic.
  return sentencesOf(text)
    .flat()
    .filter((w) => !stop(w))
    .map(singularWord)
    .filter((w) => w.length >= 3 && !stop(w) && !/^\d+$/.test(w));
}

/**
 * R2-M5: a Wild Find clue with no detail from its own source ("Look for a tree with seeds or fruit.",
 * "Do you see a plant with flowers that are a purple color?" when the source never says purple) fits
 * hundreds of species, or can't be checked. Generic = no word of the clue beyond the generic ones is
 * also in the item's source (same first 4 letters for longer words: "spiny" ~ "spines"; or the same
 * word with its ending taken off: "wades" ~ "wading").
 */
export function isGenericClue(clue: string, sourceText: string): boolean {
  const src = traitWords(sourceText);
  const first4 = new Set(src.map(traitStem));
  const stems = new Set(src.map(suffixStem));
  return !traitWords(clue).some((w) => first4.has(traitStem(w)) || stems.has(suffixStem(w)));
}

/**
 * Judge R7 T1: describing words that still name nothing a child can see ("Spot a great distance." for a viewpoint,
 * from the fact "From there you can see a great distance").
 */
const NOTHING_TO_SEE = new Set(["distance", "far", "away", "great", "spot", "place", "location", "point", "somewhere", "everywhere", "thing"]);

/**
 * Judge R7 T1: a clue with no seeable thing in it: every describing word is a placeholder ("Spot a great distance."),
 * or it asks to spot "spots" ("Spot 2 spots."). A clue with only stop words ("Find a place to sit") is not this check's
 * business (the other checks and the model's own source decide). Dropped as `generic_clue` for every section.
 */
export function nothingToSee(clue: string): boolean {
  const first = sentencesOf(clue)[0] ?? [];
  if (first[0] === "spot" && first.slice(1, 5).some((w) => singularWord(w) === "spot")) return true;
  const words = traitWords(clue);
  return words.length > 0 && words.every((w) => NOTHING_TO_SEE.has(w));
}

/** A copied run is this many words in a row (content tuning, M10). */
export const COPY_RUN = 4;

/**
 * Content tuning (M10): the first run of COPY_RUN words (inside one sentence) that the clue copies from
 * its own source, or null. A run with a number in it ("has 25 benches") or with fewer than 2 describing
 * words ("in the middle of") is not a copy. Run 2026-10-06-2: "climb, slide and swing on" (5 parks),
 * "a soft rushing sound" (5), "a roof on posts" (5) all came from the shared Park Finds facts.
 */
export function copiedRun(clue: string, source: string): string | null {
  const src = ngrams(source, COPY_RUN);
  for (const t of sentencesOf(clue)) {
    for (let i = 0; i + COPY_RUN <= t.length; i++) {
      const g = t.slice(i, i + COPY_RUN);
      if (g.some((w) => numberOf(w) !== null || /\d/.test(w))) continue;
      if (g.filter((w) => w.length >= 3 && !RUN_STOP.has(w)).length < 2) continue;
      const run = g.join(" ");
      if (src.has(run)) return run;
    }
  }
  return null;
}

/** Words a finished sentence never ends on. */
const DANGLING = new Set(["a", "an", "the", "with", "of", "to", "for", "and", "or", "but", "on", "in", "at", "by", "from", "its", "your", "my", "is", "are", "that"]);

/** A clue that stops mid-sentence: its last word is an article, a preposition or a joining word ("Hunt for a"). */
export function isCutOff(clue: string): boolean {
  const t = clue.trim();
  if (/[.!?)"'”]$/.test(t)) return false;
  const last = (t.match(/[\p{L}']+$/u)?.[0] ?? "").toLowerCase();
  return last === "" ? /[,;:\-]$/.test(t) : DANGLING.has(last);
}

/** The first words of a clue (lower case, letters and digits). */
const firstWords = (clue: string, k: number) => (sentencesOf(clue)[0] ?? []).slice(0, k).join(" ");

/**
 * Round-7 quality Q-7-02: frames the STOCK_FRAMES list (the prompt's "avoid" list) does not name but that are the same
 * worn-out start, matched here too. Each can be rewritten safely (below). "where can you count" becomes "Count".
 */
const EXTRA_FRAMES = [
  "somewhere you might see", "somewhere you may see", "somewhere you see", "somewhere you might find", "somewhere you will spot",
  "somewhere there are", "where can you count", "where can you spot", "where do you see",
  // Official eval 2026-10-10 (M10): "Where is the water that ..." on 3 parks although the prompt names it. Only its first
  // two words are rewritten ("Spot the water that pours into a bowl."), so the rest still says what to see.
  "where is the water that",
] as const;

/**
 * The banned frame a clue starts with ("somewhere you will see"; prompt.ts STOCK_FRAMES plus EXTRA_FRAMES), or null.
 * Q-7-02: ANY other clue whose first word is "Somewhere" is a stock start too ("somewhere"): a preference that a spare
 * replaces, never rewritten by code.
 */
export function stockFrame(clue: string): string | null {
  const start = `${firstWords(clue, 5)} `;
  const listed = [...STOCK_FRAMES.map((f) => f.toLowerCase()), ...EXTRA_FRAMES].sort((a, b) => b.length - a.length).find((f) => start.startsWith(`${f} `));
  if (listed) return listed;
  return start.startsWith("somewhere ") ? "somewhere" : null;
}

/** Frames that are a question or a "there is" (they become a plain command); "Hunt for a tree" and bare "somewhere" are not. */
const REWRITABLE_FRAMES: readonly string[] = [...STOCK_FRAMES.filter((f) => !f.startsWith("Hunt")).map((f) => f.toLowerCase()), ...EXTRA_FRAMES];
/** Plain first words for a rewritten frame, in order of preference (the first one not used on the pass wins). */
/**
 * Kid voice (Kevin 2026-10-10): "Notice", "Peek at" and "Check for" read stiff on paper; these fit every band (a kid's
 * pass and a teen's or adult's alike). "Spot" stays first (the /how-it-works example).
 */
export const FRAME_VERBS = ["Spot", "Find", "Look for", "Hunt for", "Search for"] as const;

/** Q-7-01: the rest of a rewritten clue must start with a noun phrase: one of these words within its first 3 words. */
const DETERMINERS = new Set(["a", "an", "the", "some", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "many", "lots", "one"]);
/** Q-7-01: ... and never start with one of these ("Spot far away from…", "Spot how high you are.", "Spot me."). */
const NOT_A_THING_START = new Set(["far", "how", "me", "what", "where", "if", "when", "why", "who", "it", "them", "there", "here", "up", "down", "out"]);
/** Q-7-01: a base-form verb after the noun ("a spray of water bob up", "the ducks swim"): the rest is a clause. */
const CLAUSE_VERB_RE = /\b(?:bob|leap|swim|fly|jump|splash|spurt|shine|sparkle|glitter|move|run|flow|fall|float|drift|sway|spin|turn|rise|pop|spray|spread|hop|dart|dive|land|perch|sit|hang|grow|crawl|climb|play|bounce)\b/i;
/** Words that open a relative clause: a verb after one of them belongs to that clause. */
const RELATIVE_RE = /\b(?:that|which|where|who|whose|when|to)\b/i;
/** First words that start a noun phrase with no article ("still water", "tall grass"). */
const BARE_NOUN_START = new Set(["water", "grass", "sand", "mud", "moss", "still", "tall", "big", "small", "little", "bright", "green", "red", "white", "black", "yellow", "blue", "brown", "wild", "wet", "shiny", "smooth", "flat", "round", "long"]);
/** Words ending in "s" that are not plural nouns. */
const NOT_PLURAL = new Set(["this", "is", "was", "has", "its", "his", "hers", "ours", "yours", "theirs", "always", "perhaps", "across", "towards", "plus"]);

/**
 * M10 (run 2026-10-06-8): a printed clue that starts with a banned frame gets a plain first word instead:
 * "Somewhere you will see a low dirt hill in the center." -> "Spot a low dirt hill in the center." (a frame that hears
 * becomes "Listen for"; "Where can you count the 2 courts?" becomes "Count the 2 courts."). Only the frame words change.
 * `taken` holds the first words of the pass's other clues (lower case), so the new word does not repeat one; a verb
 * that starts like a word of the answer ("Spot" for Spotted Sandpiper) is skipped.
 *
 * Round-7 quality Q-7-01 (the rewrite wrote "Spot a great distance." and "Spot 2 spots with metal bars"): the clue is
 * kept as the model wrote it (still a style preference, so a spare can replace it) unless the rest starts with a
 * findable noun phrase (an article, number or "some" in its first 3 words, not "far/how/me/what…"), does not hold the
 * verb's own word ("spot" in "spots"), and the new clue still names something to see (`nothingToSee`). A rest that is
 * a clause ("a spray of water bob up from a spout") gets "Watch" ("Watch a spray of water bob up…"), or stays.
 */
export function rewriteStockFrame(clue: string, taken: ReadonlySet<string>, answer: string): string {
  const frame = stockFrame(clue);
  if (frame === null || !REWRITABLE_FRAMES.includes(frame)) return clue;
  const words = frame === "where is the water that" ? 2 : frame.split(" ").length;
  const m = clue.trim().match(new RegExp(`^(?:\\S+\\s+){${words}}`));
  if (!m) return clue;
  let rest = clue.trim().slice(m[0].length);
  if (!rest) return clue;
  const firstEnd = rest.search(/[.?!]/);
  if (firstEnd >= 0 && rest[firstEnd] === "?") rest = `${rest.slice(0, firstEnd)}.${rest.slice(firstEnd + 1)}`;
  else if (firstEnd < 0) rest = `${rest}.`;
  const head = (sentencesOf(rest)[0] ?? []).slice(0, 3);
  const isNumber = (w: string) => /^\d+$/.test(w) || numberOf(w) !== null;
  // A sound needs no article ("Listen for water splashing"); a thing to see does.
  const hears = frame.includes("hear");
  // A bare plural or mass noun is a noun phrase too ("things to slide down", "still water with turtles").
  const bareNoun = (w: string) => BARE_NOUN_START.has(w) || (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !NOT_PLURAL.has(w));
  if (head.length === 0 || NOT_A_THING_START.has(head[0]) || (!hears && !head.some((w) => DETERMINERS.has(w) || isNumber(w)) && !bareNoun(head[0]))) return clue;
  const firstSentence = rest.split(/[.?!]/)[0] ?? rest;
  // A verb inside a relative clause ("3 flat tops where people sit", "2 seats that hang") does not make a clause.
  const verbAt = firstSentence.search(CLAUSE_VERB_RE);
  const clause = verbAt >= 0 && !RELATIVE_RE.test(firstSentence.slice(0, verbAt));
  const ans = answer.toLowerCase();
  // Judge R7: "Spot 2 spots with metal bars" (the rewrite's verb is also the clue's own noun): skip that verb.
  const restWords = new Set(sentencesOf(rest).flat().map(singularWord));
  const candidates = frame.includes("hear") ? ["Listen for"] : frame.endsWith("count") ? ["Count"] : clause ? ["Watch"] : [...FRAME_VERBS];
  const verb = candidates.find((v) => {
    const w = v.split(" ")[0].toLowerCase();
    return (!taken.has(w) || v === "Count") && !ans.includes(w.slice(0, 4)) && !restWords.has(w);
  });
  if (!verb) return clue;
  const out = `${verb} ${rest}`;
  return nothingToSee(out) ? clue : out;
}

/**
 * Live eval 2026-10-10-partial-0835 (M10 9.8%, 6-10): the kind first, then "with" / "that": "Spot a bird with a ...",
 * "Look for a plant with ...", "Search for a tree with bumpy ...", "Hunt for a bird that is ..." on 3+ parks each. A clue
 * whose first words are a verb (up to 2 words), "a/an" + a kind word and "with"/"that" is a stock opening (a preference).
 */
const KIND_FIRST_RE =
  /^(?:\p{L}+\s+){1,2}(?:a|an)\s+(?:(?:big|small|tiny|little|tall|short|large)\s+)?(?:bird|plant|tree|bug|insect|flower|vine|bush|shrub|animal|butterfly|moth|spider|lizard|frog|toad|fish|turtle|snake|mushroom|fungus|weed|grass|herb|beetle)s?\s+(?:with|that)\b/iu;
export function kindFirstOpening(clue: string): string | null {
  const m = KIND_FIRST_RE.exec(sentencesOf(clue)[0]?.join(" ") ?? "");
  return m ? m[0].toLowerCase() : null;
}

/** First words a kind-first clue may start with for `kindFirstRewrite` (the clue's own first word is kept). */
const KIND_FIRST_VERB = String.raw`(?:spot|find|look\s+for|hunt\s+for|search\s+for|watch\s+for|point\s+to)`;
const KIND_WORDS = String.raw`(?:bird|plant|tree|bug|insect|flower|vine|bush|shrub|butterfly|moth|spider|lizard|frog|toad|turtle|beetle|mushroom|weed|herb)`;
const KIND_FIRST_REWRITE_RE = new RegExp(
  String.raw`^(${KIND_FIRST_VERB})\s+(a|an)\s+((?:(?:big|small|tiny|little|tall|short|large)\s+)?${KIND_WORDS})\s+with\s+([^.!?;:]+?)\s*([.!])$`,
  "iu",
);
const KIND_THAT_IS_RE = new RegExp(
  String.raw`^(${KIND_FIRST_VERB})\s+(a|an)\s+((?:(?:big|small|tiny|little|tall|short|large)\s+)?${KIND_WORDS})\s+that\s+is\s+([^.!?;:,]+?)\s*([.!])$`,
  "iu",
);
/** Words that make "that is ..." more than describing words ("a large aquatic soaring kind", "about to land"). */
const NOT_DESCRIBING = new Set(["a", "an", "the", "kind", "type", "sort", "one", "not", "about", "very", "also", "often", "usually", "mostly", "all", "with"]);
/** Words that start a tail the moved trait can't carry ("... in the fall", "... shaped like a ball", "... that ..."). */
const TAIL_WORDS = new Set([
  "in", "on", "at", "near", "by", "when", "while", "that", "which", "who", "where", "as", "from", "under", "over", "above",
  "below", "during", "after", "before", "if", "to", "into", "along", "around", "like", "shaped", "looks", "looking", "you", "it",
  "its", "they", "this", "is", "are", "can", "will",
]);

/**
 * Live eval 2026-10-10-partial-0835 (M10 9.8%): "Spot a bird with a reddish-orange breast.", "Look for a plant with white
 * flowers." printed the same "<verb> a bird with a" start on 3+ parks, and with no spare the stock-opening preference
 * can't replace them. On the finished pass (build-pass.ts, like `rewriteStockFrame`) such a one-sentence clue leads with
 * its trait instead: "Spot a reddish-orange breast on a bird.", "Look for white flowers on a plant." Only the word order
 * changes (plus "on"); the first word, the trait and the kind stay. Returns the clue unchanged when the trait has a tail
 * ("... in the fall", "... shaped like a ball") or is longer than 6 words.
 */
export function kindFirstRewrite(raw: string): string {
  // Official eval 2026-10-10 (M10): "Walk to the place where ..." on 3 parks. "Walk to where kids use ladders ..." says
  // the same with two words fewer (only words are removed).
  const clue = raw.replace(/\bto the (?:place|spot) where\b/i, "to where");
  // "Look for a bird that is pale brown and grey." -> "Look for a pale brown and grey bird." (describing words only).
  const that = KIND_THAT_IS_RE.exec(clue.trim());
  if (that) {
    const [, verb, , kind, desc, end] = that;
    const words = desc.toLowerCase().match(/[\p{L}'-]+/gu) ?? [];
    if (words.length === 0 || words.length > 4 || words.some((w) => TAIL_WORDS.has(w) || NOT_DESCRIBING.has(w)) || /\d/.test(desc)) return clue;
    const article = /^[aeiou]/i.test(desc.trim()) ? "an" : "a";
    return `${verb} ${article} ${desc.trim()} ${kind}${end}`;
  }
  const m = KIND_FIRST_REWRITE_RE.exec(clue.trim());
  if (!m) return clue;
  const [, verb, article, kind, trait, end] = m;
  const words = trait.toLowerCase().match(/[\p{L}'-]+/gu) ?? [];
  if (words.length === 0 || words.length > 6 || words.some((w) => TAIL_WORDS.has(w)) || /\d/.test(trait)) return clue;
  return `${verb} ${trait.trim()} on ${article.toLowerCase()} ${kind}${end}`;
}

/** The stock opening a clue starts with ("can you find"), or null (prompt.ts STOCK_OPENINGS). */
export function stockOpening(clue: string): string | null {
  const start = `${firstWords(clue, 4)} `;
  const opening = STOCK_OPENINGS.find((o) => start.startsWith(`${o} `));
  if (opening) return opening;
  const all = ` ${sentencesOf(clue).flat().join(" ")} `;
  return STOCK_PHRASES.find((p) => all.includes(` ${p} `)) ?? kindFirstOpening(clue);
}

/** Two clues that start with the same 3 words. */
export function sameOpening(a: string, b: string): boolean {
  const fa = firstWords(a, 3);
  return fa.split(" ").length === 3 && fa === firstWords(b, 3);
}

/** A shared sentence frame needs at least this many words (all shared sentences together): "There are #." alone is not one. */
export const FRAME_MIN_WORDS = 4;

/**
 * R3 (Arbor Hills example, 2026-10-06): "Wander to a long seat for a rest. Count them. There are 2." and
 * "Track a place with a roof and tables below. Count them. There are 4." share no trigram run long
 * enough for the near-repeat check, but read machine-made side by side. Sentences are compared with
 * numbers replaced by "#"; whole sentences both clues have, together at least FRAME_MIN_WORDS words,
 * are a repeated frame. Returns the shared sentences, or null.
 */
export function sharedFrame(a: string, b: string): string | null {
  const frames = (t: string) => new Set(sentencesOf(t).map((s) => s.map((w) => (numberOf(w) !== null || /^\d/.test(w) ? "#" : w)).join(" ")));
  const fb = frames(b);
  const shared = [...frames(a)].filter((s) => fb.has(s));
  const words = shared.reduce((n, s) => n + s.split(" ").length, 0);
  return words >= FRAME_MIN_WORDS ? shared.join(" / ") : null;
}

/** Audit R3-C1: two clues that start with the same first word ("Peek ...", "Peek ..."). */
export function sameFirstWord(a: string, b: string): boolean {
  const fa = firstWords(a, 1);
  return fa.length > 0 && fa === firstWords(b, 1);
}

// ---------- Audit R3-C1: filler openers, broken count questions, sounds from silent things ----------

/**
 * Filler words a clue opened with in run 2026-10-06-3 (printed openers of 366 Gemma clues: "quick" 24,
 * "ready" 24, "wow" 20, "guess" 16, "shh" 13, "stop" 12, "listen" 12, "psst" 10, "hmm" 8). They only
 * count as filler when punctuation follows them ("Quick!", "Psst,", "Listen closely."), so "Look at the
 * bark" or "Listen for a gurgle" stay.
 * Audit R4 (UX-4-04): "Maybe! Track a ride with two wheels..." on a Lucky Find. "Maybe!" / "Perhaps," as
 * an opener is filler too; a Lucky Find says "might" or "maybe" inside its sentence (prompt.ts).
 */
const FILLER_WORDS =
  "maybe|perhaps|quick|quickly|psst+|pst|shh+|sh|hush|hey|hi|hello|ooh+|oh+|wow+|whoa|hmm+|yay|aha|ahoy|look|stop|listen|okay|ok|alright|ready|attention|guess what";
const FILLER_HEAD_RE = new RegExp(
  `^(?:(?:${FILLER_WORDS})(?:\\s+(?:closely|carefully|up|now|there|everyone|here))?\\s*[!?.,…:;]+\\s*)`,
  "iu",
);
/** "Ready to count? How many ...", "Ready to hear feet thump on planks? Count ...": a warm-up question before the clue. */
const READY_QUESTION_RE = /^ready\b[^.!?]{0,60}\?\s+(?=\S)/iu;
/** "Stop and listen for running water ..." -> "Listen for running water ...". */
const STOP_AND_RE = /^stop,?\s+and\s+(?=\p{L})/iu;
/** A clue left with fewer words than this after the filler is taken off is not a clue. */
const MIN_CLUE_WORDS = 3;

/**
 * Audit R3-C1: the clue without its filler opening ("Quick! Spot a bird ..." -> "Spot a bird ..."),
 * the first letter upper case. The clue unchanged when it has none; null when nothing but filler is
 * left (fewer than MIN_CLUE_WORDS words). Code only removes words, so no check is weakened.
 */
export function trimFillerOpening(clue: string): string | null {
  let t = clue.trim();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(FILLER_HEAD_RE, "").replace(READY_QUESTION_RE, "").replace(STOP_AND_RE, "").trim();
    if (next === t) break;
    t = next;
  }
  if (t === clue.trim()) return clue;
  const words = t.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < MIN_CLUE_WORDS) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** First words of a command ("Track ...", "Squint to see if ..."): such a sentence is not a question. */
const COMMAND_WORDS = new Set([
  "peek", "spy", "hunt", "tiptoe", "wander", "track", "sneak", "point", "squint", "scan", "watch", "follow", "notice", "seek",
  "explore", "glance", "discover", "check", "guess", "look", "find", "spot", "search", "count", "listen", "walk",
]);

/**
 * Audit R3 (10-13 smoke, 2026-10-06): a command that ends in a question mark ("Track 3 areas for
 * sports?", "Squint to see if any trees have a rounded crown?") reads machine-made. Its "?" becomes ".".
 * Only the punctuation changes; a real question ("Which tree has glossy leaves?") is left alone.
 */
export function fixCommandQuestion(clue: string): string {
  return clue
    .split(/(?<=[.!?])\s+/u)
    .map((s) => {
      const first = (s.match(/^[\p{L}']+/u)?.[0] ?? "").toLowerCase();
      return COMMAND_WORDS.has(first) && /\?$/u.test(s) ? `${s.slice(0, -1)}.` : s;
    })
    .join(" ");
}

/** Words after "how many" that show nothing is being counted ("Guess how many can you find?"). */
const NOT_A_COUNTED_THING = new Set(["can", "could", "do", "does", "did", "are", "is", "were", "was", "you", "there", "here", "will", "would", "more", "times"]);

/**
 * Audit R3-C1: a broken "how many" question, or null. Broken = the clue asks "how many" AND writes a
 * number anywhere ("Guess how many 25 big grass areas have goals?", "How many seats can you find?
 * There are 9.": it answers itself), or nothing countable follows "how many" ("Guess how many can you
 * find?"). A count TASK with its number ("Count the 4 walkways.") is not a question and stays.
 */
export function brokenCountQuestion(clue: string): string | null {
  const sentences = sentencesOf(clue);
  let asks = false;
  for (const t of sentences) {
    for (let i = 0; i + 1 < t.length; i++) {
      if (t[i] !== "how" || t[i + 1] !== "many") continue;
      asks = true;
      const next = t[i + 2];
      if (next === undefined || NOT_A_COUNTED_THING.has(next)) return `"how many" with nothing to count`;
    }
  }
  if (!asks) return null;
  const n = sentences.flat().find((w) => numberOf(w) !== null || /^\d/.test(w));
  return n === undefined ? null : `asks "how many" and also says ${n}`;
}

/**
 * Audit R4-C2: a question mixed with a count, or null. "Which roof held up by poles has tables below it?
 * Count 4 of them." asks one thing and then orders another; "Which long seat outdoors can you find 2 of?"
 * (a Park Find with a map count) hides the count inside a which/what question. A count task ("Count the
 * 4 seats by the path."), "Can you spot 4 long seats for resting?" and a question alone stay (checked on
 * every recorded clue of runs 2026-10-05 to 2026-10-06-4). Code may not rewrite the words, so it is dropped.
 */
export function questionCountMix(clue: string, item: Pick<PoolItem, "count">): string | null {
  const sentences = clue.trim().split(/(?<=[.!?])\s+/u).filter(Boolean);
  const isQuestion = (s: string) => /\?\s*["'”)]*$/u.test(s);
  const hasCount = (s: string) => /\bcount(?:ing)?\b/iu.test(s);
  const hasNumber = (s: string) => sentencesOf(s).flat().some((w) => numberOf(w) !== null || /^\d/.test(w));
  const firstQ = sentences.findIndex((s) => isQuestion(s) && !hasCount(s));
  if (firstQ >= 0 && sentences.slice(firstQ + 1).some((s) => !isQuestion(s) && hasCount(s))) return "a question, then a count task";
  // Run 2026-10-06-5: "Who can find 2 places of still water with fish or ducks?" is a challenge to the child,
  // not a question that answers itself: "Who can find/spot/count/see N ..." stays.
  const challenge = (s: string) => /^\s*who\s+can\s+(?:find|spot|count|see)\b/iu.test(s);
  if (item.count && sentences.some((s) => isQuestion(s) && /^\s*(?:which|what|who)\b/iu.test(s) && !challenge(s) && hasNumber(s))) return "a which/what question that states the map count";
  return null;
}

/**
 * Audit R4-C2: openings that are not English or read machine-made ("Explore for a bug ...", the opener
 * bank's old "Explore"; "Wander to find ..."). Returns the phrase, or null.
 */
const ODD_OPENING_RE = /^\s*(explore\s+(?:for|to\s+find)|wander\s+to\s+find|glance\s+(?:up\s+)?for|track\s+(?:a|an)\s+(?:ride|place|spot|seat))\b/iu;
export function oddWording(clue: string): string | null {
  return ODD_OPENING_RE.exec(clue)?.[1].toLowerCase().replace(/\s+/g, " ") ?? null;
}

/**
 * Audit R4-C2: a clue in which the thing talks as itself ("Point to me; I am a board ...", "Discover my
 * small arc of water"). One per pass is a riddle; more is a tic (validateDraft drops the second).
 */
export function isRiddleFrame(clue: string): boolean {
  return /(?:^|[^\p{L}'])(?:I|I'm|I've|I'll)(?![\p{L}'])/u.test(clue) || /\b(?:me|my|myself|mine)\b/iu.test(clue);
}

/**
 * Run 2026-10-06-5 quick win: a clue that first talks to the child and then lets the thing talk ("Watch for a
 * plant with white blooms. I am poisonous!", "Watch for a flying bug. I am the only one of my kind in my
 * genus!"). A riddle that talks as itself from its first sentence ("I have ...") or after a question ("Who
 * am I? I have ...", "Who has a red back? I am a true bug.") is not a switch.
 * Returns the sentence that switches, or null.
 */
export function voiceSwitch(clue: string): string | null {
  const sentences = clue.trim().split(/(?<=[.!?])\s+/u).filter(Boolean);
  // "Who has a red back? I am a true bug." and "Who is this? I have ..." are riddles: a question first, then the thing talks.
  if (sentences.length < 2 || isRiddleFrame(sentences[0]) || /\?\s*["'”)]*$/u.test(sentences[0])) return null;
  return sentences.slice(1).find((s) => isRiddleFrame(s)) ?? null;
}

const COUNT_WORD = `(?:\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;
/** A whole sentence that only adds a count: "Count them.", "Count the 2 of them.", "Count all 4.", "There are 2.". */
const COUNT_TRAILER_RE = new RegExp(
  `^(?:count\\s+(?:them|all\\s+of\\s+them|(?:the|all)\\s+${COUNT_WORD}(?:\\s+of\\s+them)?)|there\\s+(?:are|is)\\s+${COUNT_WORD}(?:\\s+of\\s+them)?)\\s*[.!]*$`,
  "iu",
);
/** A sentence that is itself a count task or question (then a "There are 2." after it is that count's number). */
const COUNT_TASK_RE = /\b(?:count(?:ing)?|how\s+many)\b/iu;

/**
 * Completeness + M10 (run 2026-10-06-5): the clue without its bolted-on count sentences ("Notice the long
 * seats for a rest. Count the 2 of them." -> "Notice the long seats for a rest.", "Where can you hear your
 * feet clomp on boards? Count them. There are 8." -> the question alone). Only when the rest is not a
 * count task itself ("Count the benches. There are 9." stays) and keeps at least MIN_CLUE_WORDS words.
 * "count the 2 of them" was on 4 parks' passes (M10). Code only removes words.
 */
/**
 * Live eval 2026-10-10-partial-0835: "Walk to the outdoor seats and count 25 of them." reads as if there were more. Inside
 * a sentence, "count 25 of them" becomes "count all 25" (only the words change; the number is the model's and the count
 * checks see the new text). "count 2 of the benches" is left alone.
 */
const COUNT_OF_THEM_RE = new RegExp(`\\b(count)\\s+(${COUNT_WORD})\\s+of\\s+them\\b`, "iu");
export function fixCountOfThem(clue: string): string {
  return clue.replace(COUNT_OF_THEM_RE, (_m, c: string, n: string) => `${c} all ${n}`);
}

export function trimCountTrailer(clue: string): string {
  const sentences = clue.trim().split(/(?<=[.!?])\s+/u).filter(Boolean);
  let cut = sentences.length;
  while (cut > 1 && COUNT_TRAILER_RE.test(sentences[cut - 1].trim())) cut--;
  if (cut === sentences.length) return clue;
  const head = sentences.slice(0, cut);
  if (head.some((s) => COUNT_TASK_RE.test(s))) return clue;
  const text = head.join(" ");
  if ((text.match(/[\p{L}\p{N}]+/gu) ?? []).length < MIN_CLUE_WORDS) return clue;
  return text;
}

/** Hints that say nothing about where a built thing stands (or point at a creature's place, not a park's). */
const PARK_LOOK_BAD_RE =
  /\b(?:on|in|under|up\s+in|at)\s+(?:the\s+)?(?:ground|sky|grass|tall\s+grass|soil|dirt|tree\s+trunks?|trees?|tree\s+bark|bark|bushes|leaves|plants|flowers)\b/iu;
/** Park Find kinds whose own nature is water: a water hint gives them away. */
const WATER_KIND_IDS: ReadonlySet<string> = new Set(["osm-water", "osm-creek"]);

/**
 * Audit R4 (quality content note): why a Park Find's hint is wrong, or null. "on the ground" for a bridge
 * or a picnic shelter (the nature hints of the prompt fit plants and bugs, not built things), and "near
 * the water" for a pond.
 */
export function parkLookProblem(lookWhere: string, itemId: string): string | null {
  if (PARK_LOOK_BAD_RE.test(lookWhere)) return "a nature hint for a built thing";
  if (WATER_KIND_IDS.has(itemId) && /\b(?:water|wet|watery)\b/iu.test(lookWhere)) return "a water hint for water";
  return null;
}

/** iNaturalist taxa that never make a sound a child can hear (verified on api.inaturalist.org 2026-10-06). */
const SILENT_TAXA: ReadonlySet<number> = new Set([
  47126, // kingdom Plantae
  47170, // kingdom Fungi (and lichens)
  47115, // phylum Mollusca (snails, slugs)
  47119, // class Arachnida (spiders and relatives)
  47178, // class Actinopterygii (ray-finned fish)
]);
/** class Insecta: silent unless in one of the SOUNDING_INSECTS groups. */
const INSECTA = 47158;
/** Insects a child may hear: Orthoptera (crickets, katydids), Cicadoidea (cicadas), Hymenoptera (bees buzz), Diptera (flies buzz). */
const SOUNDING_INSECTS: ReadonlySet<number> = new Set([47651, 50190, 47201, 47822]);
/** Pool kinds (wild.ts KIND_BY_ICONIC) that are silent, for an item whose taxon has no ancestor list. */
const SILENT_KINDS: ReadonlySet<string> = new Set(["plant", "fungus or lichen", "snail or slug", "spider or relative", "fish", "insect"]);

/**
 * True when the item's iNaturalist taxon is silent (a plant, fungus, snail, spider, fish, or an insect
 * that isn't a cricket, katydid, cicada, bee/wasp or fly: damselflies, dragonflies, butterflies and
 * beetles are silent). Uses the taxon's ancestor ids from iNaturalist; falls back to the pool kind.
 */
export function isSilentTaxon(item: Pick<PoolItem, "taxon" | "kind">): boolean {
  if (!item.taxon) return false;
  const lineage = new Set([item.taxon.taxonId, ...item.taxon.ancestorIds]);
  if ([...SILENT_TAXA].some((id) => lineage.has(id))) return true;
  if (lineage.has(INSECTA)) return ![...SOUNDING_INSECTS].some((id) => lineage.has(id));
  if (item.taxon.ancestorIds.length === 0) return SILENT_KINDS.has(item.kind);
  return false;
}

/** Round-6 judge C4: a clue that asks the child to listen (at most one per pass). */
export const isSoundClue = (clue: string) => SOUND_ASK_RE.test(clue);

/** A clue that asks the child to listen ("Listen for ...", "Can you hear ...", "makes a sound"). */
const SOUND_ASK_RE =
  /\b(?:listen\w*|hear|hears|heard|hearing|sounds?|noises?|noisy|buzz\w*|sing|sings|singing|songs?|chirp\w*|croak\w*|whistl\w*|quack\w*|hoot\w*|squawk\w*|honk\w*|trill\w*|hum|hums|humming)\b/iu;
/** A source that says the thing makes a sound (Wikipedia song/call; the Park Finds' code-written sound facts). */
const SOUND_SOURCE_RE =
  /\b(?:sound\w*|noise\w*|noisy|hear\w*|listen\w*|songs?|songbirds?|sing|sings|singing|singer|call|calls|calling|buzz\w*|chirp\w*|croak\w*|whistl\w*|quack\w*|hoot\w*|squawk\w*|honk\w*|trill\w*|drum\w*|vocal\w*|voice|hum|hums|humming|splash\w*|splish\w*|gurgl\w*|bubbl\w*|rushing|roar\w*|thump\w*|clomp\w*|barking|flaps?|snaps?|whoosh\w*|rustl\w*)\b/iu;

/**
 * Audit R3-C1: why a sound clue is wrong for this item, or null. A clue (or hint) that asks the child to
 * listen is dropped when the item is a silent taxon (`isSilentTaxon`), or when its SOURCE never says it
 * makes a sound ("Listen! I am a large wading bird." for a heron whose source is about its size).
 */
export function silentSoundProblem(text: string, item: Pick<PoolItem, "taxon" | "kind" | "sourceText">): string | null {
  if (!SOUND_ASK_RE.test(text)) return null;
  if (isSilentTaxon(item)) return "a sound clue for a silent living thing";
  if (!SOUND_SOURCE_RE.test(item.sourceText)) return "a sound clue, but its source names no sound";
  return null;
}

/**
 * R2-M5: a quote that is only the species' name ("Maximilian sunflower") proves no trait: the clue's
 * detail ("bright yellow flowers") was not checked against anything.
 */
export function quoteIsOnlyName(quote: string, answer: string): boolean {
  const q = trimQuote(normalizeForMatch(quote));
  return q.length > 0 && normalizeForMatch(answer).includes(q);
}

/** The order the pass prints its items in (build-pass.ts sorts by section, stable). */
const PRINT_ORDER: Record<Section, number> = { park: 0, wild: 1, lucky: 2 };

const listOf = (nums: number[]) => (nums.length === 1 ? `${nums[0]}` : `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`);

/**
 * R2-M5: the grown-up's line is written by code from the pass's real items (the model's notes were
 * filler: "Have fun exploring nature with your child!"). Up to two tips: which find to start with (an
 * easy one that stays put), and which finds are near water (or, if none, which ones can move away).
 * Numbers are the find numbers printed on the pass. Empty when no tip applies.
 */
/**
 * Round-6 quality Q-6-03 (Connemara example): "Which tree has bumpy, round fruit ...?" with "Look: on bushes" and
 * "Notice a tree with oval leaves ..." with "Look: on tree trunks". True when the hint sends the child to the wrong place.
 */
export function hintContradicts(clue: string, lookWhere: string): boolean {
  const c = clue.toLowerCase();
  const h = lookWhere.toLowerCase();
  if (/\btrees?\b/.test(c) && /\b(?:on|in|under)\s+(?:the\s+)?(?:bushes|bush|shrubs?)\b/.test(h)) return true;
  if (/\b(?:leaf|leaves|fruits?|berr(?:y|ies)|flowers?|blooms?|petals?|seeds?|pods?|nuts?|acorns?|cones?)\b/.test(c) && /\b(?:tree\s+)?trunks?\b/.test(h)) return true;
  return false;
}

/** Words that put a find by the water ("Look: near the water", "a walkway that goes high over water"). */
const WATER_WORD_RE = /\b(?:water|waters|pond|ponds|lake|lakes|creek|creeks|stream|streams|river|rivers|shore|shoreline|marsh|swamp)\b/i;

/** Round 8 judge C1: at most this many water-feature finds on one pass (a lake park still gets two). */
export const MAX_WATER_CLUES = 2;
/** Park Finds whose own nature is water (pool/park.ts WATER_KINDS): a bridge "over water" is not one of them. */
const WATER_FEATURE_IDS: ReadonlySet<string> = new Set(["osm-water", "osm-creek", "osm-fountain", "osm-pool"]);
/** Round 8 judge C1: the shine imagery that repeated on the example passes ("glitters like a mirror", "shines like a mirror"). */
const SHINE_RE = /\b(?:mirrors?|glitter\w*|sparkl\w*|shimmer\w*|glisten\w*|gleam\w*|shines?|shiny|shining)\b/i;

/**
 * Round 8 judge C1: why this find repeats the pass's water picture, or null: a third water-feature find (pond, creek,
 * fountain, pool), or shine imagery ("glitters", "like a mirror") when an earlier clue on the pass already has some.
 */
export function waterRepeat(
  v: { clue: string; item: Pick<PoolItem, "id"> },
  earlier: readonly (Pick<ValidItem, "clue"> & { item?: Pick<PoolItem, "id"> })[],
): string | null {
  if (WATER_FEATURE_IDS.has(v.item.id) && earlier.filter((k) => k.item && WATER_FEATURE_IDS.has(k.item.id)).length >= MAX_WATER_CLUES) return "a third water feature";
  if (SHINE_RE.test(v.clue) && earlier.some((k) => SHINE_RE.test(k.clue))) return "shine imagery twice";
  return null;
}

/**
 * Round-6 quality Q-6-02: the water line came only from water and creek Park Finds, so a bridge "high over water",
 * a bullfrog with "Look: near the water" or a lake-park find printed without it, and the grown-up's tip left them out.
 * Any printed find whose clue or hint names water now carries the line after its own (at most 120 characters).
 */
export function withWaterSafety<T extends Pick<ValidItem, "item" | "clue" | "lookWhere">>(v: T): T {
  // A drinking fountain's clue says water ("a swallow of cool water", live Trinity check 2026-10-06): not a water hazard.
  if (v.item.id === "osm-drinking-water") return v;
  if (!WATER_WORD_RE.test(`${v.clue} ${v.lookWhere}`)) return v;
  const own = v.item.safety;
  if (own && /water/i.test(own)) return v;
  const safety = own ? `${own} ${SAFETY_LINES.water}` : SAFETY_LINES.water;
  return { ...v, item: { ...v.item, safety: safety.length <= 120 ? safety : SAFETY_LINES.water } };
}

/** Judge R7: a Park Find the map counts this many times or more is easy to find, whatever the model said. */
export const COMMON_FEATURE_COUNT = 10;

/**
 * Judge R7 ("Where is the seat with elbow rests at both ends? Hard · 234 on the park map" on a 4-6 pass): a very
 * common Park Find is never "hard" for the younger bands: easy for ages 4-6, medium for 6-10. Ages 10-13 keep the
 * model's label (that band promises 2 hard finds, and a riddle can make a common thing hard to pin down); so do teens &
 * adults (13+, 3 hard finds).
 */
export function capDifficulty<T extends Pick<ValidItem, "item" | "difficulty">>(v: T, band: AgeBand): T {
  const n = v.item.section === "park" ? (v.item.count?.n ?? 0) : 0;
  if (band === "10-13" || band === "13+" || n < COMMON_FEATURE_COUNT || v.difficulty !== "hard") return v;
  return { ...v, difficulty: band === "4-6" ? "easy" : "medium" };
}

/**
 * Judge R7 T2: a listening clue never goes first (the grown-up's tip "Start with find 1" then pointed at a sound).
 * Items in print order (park, wild, lucky); when Find 1 is a sound clue, the first non-sound find of the same section
 * moves to the front. Nothing else moves.
 */
export function soundNotFirst<T extends Pick<ValidItem, "item" | "clue">>(items: readonly T[]): T[] {
  const out = [...items];
  if (out.length < 2 || !isSoundClue(out[0].clue)) return out;
  const i = out.findIndex((v) => v.item.section === out[0].item.section && !isSoundClue(v.clue));
  if (i > 0) out.unshift(...out.splice(i, 1));
  return out;
}

/**
 * The code-written tip. Teens & adults (13+): "stay on the path" instead of "stay close" (there is no grown-up to
 * stay close to); kid passes (no band) read exactly as before.
 */
export function parentNoteFor(items: readonly Pick<ValidItem, "item" | "difficulty">[], band?: AgeBand): string {
  const stay = band && isAdultBand(band) ? "stay on the path" : "stay close";
  const ordered = items.map((v, i) => ({ v, i })).sort((a, b) => PRINT_ORDER[a.v.item.section] - PRINT_ORDER[b.v.item.section] || a.i - b.i);
  const tips: string[] = [];
  const nearWater = (v: Pick<ValidItem, "item">) => Boolean(v.item.safety && /water/i.test(v.item.safety));
  const startable = ({ v }: { v: Pick<ValidItem, "item" | "difficulty"> }) => v.difficulty === "easy" && v.item.stationary;
  // An easy find away from water first; an easy one by the water only when there is no other.
  let easy = ordered.findIndex((o) => startable(o) && !nearWater(o.v));
  if (easy < 0) easy = ordered.findIndex(startable);
  if (easy >= 0) {
    tips.push(nearWater(ordered[easy].v) ? `Start with find ${easy + 1}: it's easy and it stays put, but it's near water, so ${stay}.` : `Start with find ${easy + 1}: it's easy and it stays put.`);
  }
  const water = ordered.flatMap(({ v }, k) => (nearWater(v) && k !== easy ? [k + 1] : []));
  const movers = ordered.flatMap(({ v }, k) => (!v.item.stationary ? [k + 1] : []));
  if (water.length > 0) tips.push(`${water.length === 1 ? "Find" : "Finds"} ${listOf(water)} ${water.length === 1 ? "is" : "are"} near water: ${stay}.`);
  else if (movers.length > 0) tips.push(`${movers.length === 1 ? "Find" : "Finds"} ${listOf(movers)} can move away, so tick ${movers.length === 1 ? "it" : "them"} off when you see ${movers.length === 1 ? "it" : "them"}.`);
  return tips.join(" ").slice(0, PARENT_NOTE_MAX);
}
