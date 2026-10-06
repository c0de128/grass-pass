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
import { blockedBy, blockedWordIn } from "@/lib/safety/danger-taxa";
import type { PoolItem, Section } from "@/lib/pool/types";
import { looksScore, namePart } from "@/lib/pool/wild";
import { PROMPT_EXAMPLE_TEXTS, STOCK_OPENINGS, type Mix } from "./prompt";
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
  "not_grounded",
  "name_leak",
  "name_trait",
  "mentions_map",
  "out_of_season",
  "number_not_in_source",
  "wrong_count",
  "broken_count",
  "silent_sound",
  "filler_only",
  "odd_wording",
  "riddle_frame",
  "generic_clue",
  "copies_example",
  "copies_source",
  "repeats_clue",
  "repeats_opening",
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
  "cut_off", "url_or_markup", "danger", "not_grounded", "name_leak", "mentions_map", "out_of_season", "number_not_in_source",
  "wrong_count", "broken_count", "silent_sound", "filler_only", "generic_clue", "copies_example", "repeats_clue",
]);

/**
 * Checks about style, not truth or safety: preferences on a low-data pass (and repeats_opening and
 * name_trait on every pass).
 */
export type StyleReason = Extract<DropReason, "copies_source" | "repeats_clue" | "repeats_opening" | "name_trait">;

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
  /** Clues already kept by an earlier call of this pass (the refill): repeats are checked against them too. */
  prior?: readonly Pick<ValidItem, "clue">[];
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
  const drop = (r: DropReason) => {
    drops[r] = (drops[r] ?? 0) + 1;
    if (current !== null && CONTENT_FAILS.has(r)) failed.add(current);
  };
  const used = new Set<string>();
  const kept: ValidItem[] = [];
  let lookWhereCleared = 0;
  let quotesRepaired = 0;
  let openersTrimmed = 0;
  let questionsFixed = 0;
  /** Content tuning: the source runs clues copied (the refill call is told not to use them). */
  const copied = new Set<string>();

  for (const raw of draft.items) {
    const parsed = PassItemDraft.safeParse(raw && typeof raw === "object" ? withCodeSection(tidyStrings(raw as Record<string, unknown>), byId) : raw);
    if (!parsed.success) {
      const id = raw && typeof raw === "object" ? (raw as Record<string, unknown>).itemId : undefined;
      drop(typeof id === "string" && !byId.has(id) ? "unknown_id" : "schema");
      continue;
    }
    current = parsed.data.itemId;
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
    const d = { ...parsed.data, clue: punctuated };
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
    if ((item.taxon && blockedBy(item.taxon)) || blockedWordIn(d.clue) || blockedWordIn(d.lookWhere)) {
      drop("danger");
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
    // Audit R4-C2: "Explore for a bug ..." is not English.
    if (oddWording(d.clue) !== null) {
      drop("odd_wording");
      continue;
    }
    // Audit R3-C1: "Listen for a bug! Is there one that is green with blue on its end?" (a damselfly).
    if (silentSoundProblem(`${d.clue} ${lookWhere}`, item) !== null) {
      drop("silent_sound");
      continue;
    }
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
    let style: StyleReason | undefined = traitHit ? "name_trait" : undefined;
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
    if (earlier.some((k) => sameOpening(k.clue, d.clue) || sameFirstWord(k.clue, d.clue))) {
      drop("repeats_opening");
      continue;
    }
    // Audit R4-C2: "Point to me; I am a board ...", "Scan for me; I am a metal cooker ..." on 6 of 8 clues.
    // One clue in which the thing talks as "I" is a riddle; a second one on the same pass is a tic.
    if (isRiddleFrame(d.clue) && earlier.some((k) => isRiddleFrame(k.clue))) {
      drop("riddle_frame");
      continue;
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
  for (const v of kept) {
    const s = v.item.section;
    if (perSection[s] >= ask.max[s]) {
      drop("over_section_max");
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
  const items = asked.filter((v) => chosen.has(v));
  let spares = 0;
  let styleKept = 0;
  for (const v of asked) {
    if (chosen.has(v)) {
      if (v.style) styleKept++;
    } else if (v.style) drop(v.style);
    else spares++;
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

export type SpotReason = "missing" | "schema" | "wrong_target" | "url_or_markup" | "danger" | "not_grounded" | "name_leak" | "number_not_in_source";

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
  if (blockedWordIn(d.riddle)) return { ok: false, reason: "danger" };
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
const ANY_COUNT_NOUNS = new Set(["place", "spot", "way", "area", "thing", "one"]);

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
  return sentencesOf(text)
    .flat()
    .map(singularWord)
    .filter((w) => w.length >= 3 && !TRAIT_STOP.has(w) && !RUN_STOP.has(w) && !/^\d+$/.test(w));
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

/** The stock opening a clue starts with ("can you find"), or null (prompt.ts STOCK_OPENINGS). */
export function stockOpening(clue: string): string | null {
  const start = `${firstWords(clue, 4)} `;
  return STOCK_OPENINGS.find((o) => start.startsWith(`${o} `)) ?? null;
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
  if (item.count && sentences.some((s) => isQuestion(s) && /^\s*(?:which|what|who)\b/iu.test(s) && hasNumber(s))) return "a which/what question that states the map count";
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
export function parentNoteFor(items: readonly Pick<ValidItem, "item" | "difficulty">[]): string {
  const ordered = items.map((v, i) => ({ v, i })).sort((a, b) => PRINT_ORDER[a.v.item.section] - PRINT_ORDER[b.v.item.section] || a.i - b.i);
  const tips: string[] = [];
  const nearWater = (v: Pick<ValidItem, "item">) => Boolean(v.item.safety && /water/i.test(v.item.safety));
  const startable = ({ v }: { v: Pick<ValidItem, "item" | "difficulty"> }) => v.difficulty === "easy" && v.item.stationary;
  // An easy find away from water first; an easy one by the water only when there is no other.
  let easy = ordered.findIndex((o) => startable(o) && !nearWater(o.v));
  if (easy < 0) easy = ordered.findIndex(startable);
  if (easy >= 0) {
    tips.push(nearWater(ordered[easy].v) ? `Start with find ${easy + 1}: it's easy and it stays put, but it's near water, so stay close.` : `Start with find ${easy + 1}: it's easy and it stays put.`);
  }
  const water = ordered.flatMap(({ v }, k) => (nearWater(v) && k !== easy ? [k + 1] : []));
  const movers = ordered.flatMap(({ v }, k) => (!v.item.stationary ? [k + 1] : []));
  if (water.length > 0) tips.push(`${water.length === 1 ? "Find" : "Finds"} ${listOf(water)} ${water.length === 1 ? "is" : "are"} near water: stay close.`);
  else if (movers.length > 0) tips.push(`${movers.length === 1 ? "Find" : "Finds"} ${listOf(movers)} can move away, so tick ${movers.length === 1 ? "it" : "them"} off when you see ${movers.length === 1 ? "it" : "them"}.`);
  return tips.join(" ").slice(0, PARENT_NOTE_MAX);
}
