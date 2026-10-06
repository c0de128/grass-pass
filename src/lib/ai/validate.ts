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
 * (R1-m4: a pass without a Find This Spot map never says "map"; in lookWhere the hint is blanked) ->
 * season (R1-M4: a plant's flowers or fruit only when iNaturalist records show them this month) ->
 * numbers not in the source -> (audit R2-M5) a wrong count (a count clue must count exactly what the
 * map counts, with the map's number) -> a generic Wild Find clue (no trait from its own source) -> a
 * copy of a prompt example -> a near-repeat of a clue already kept on this pass. Then the mix limits
 * computed by code are re-applied (extras beyond a section's max are dropped, in answer order).
 * The grown-up's note is code-written from the kept items (`parentNoteFor`), never the model's.
 */
import { seasonProblem } from "@/lib/pool/season";
import { blockedBy, blockedWordIn } from "@/lib/safety/danger-taxa";
import type { PoolItem, Section } from "@/lib/pool/types";
import { PROMPT_EXAMPLE_TEXTS, type Mix } from "./prompt";
import { PARENT_NOTE_MAX, PassItemDraft, SpotDraft, type PassDraftEnvelope } from "./schema";

export type DropReason =
  | "schema"
  | "url_or_markup"
  | "unknown_id"
  | "duplicate_id"
  | "section_mismatch"
  | "danger"
  | "not_grounded"
  | "name_leak"
  | "mentions_map"
  | "out_of_season"
  | "number_not_in_source"
  | "wrong_count"
  | "generic_clue"
  | "copies_example"
  | "repeats_clue"
  | "over_section_max";

export type ValidItem = {
  item: PoolItem;
  clue: string;
  lookWhere: string;
  difficulty: "easy" | "medium" | "hard";
  sourceQuote: string;
};

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
  /** R2-M5: valid spare items not printed (the model is asked for up to ASK_EXTRA more than n). */
  spares?: number;
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

/** Numbers written with digits in `text` that do not appear in `source`. */
export function numbersNotIn(text: string, source: string): string[] {
  const found = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (found.length === 0) return [];
  const have = new Set(source.match(/\d+(?:[.,]\d+)?/g) ?? []);
  return found.filter((n) => !have.has(n));
}

const MARKUP_RE = /https?:|www\.|<|>|\]\(|\bjavascript:/i;
/**
 * R1-m7 (SEC-1-04): text printed for a child never carries a way to contact someone. Bare domains
 * ("kidsprize.com", "x.com"), @handles, and phone-like runs of 7+ digits (spaces, dots, dashes and
 * brackets between them allowed: "555 0100", "(214) 555-0100").
 * R2-m3 (SEC-2-04): any top-level domain, not a fixed list ("prize.ru", "win.ai", "kids.dev"): a word, a
 * dot, then 2-24 letters that are all lower case or all upper case ("pond.Look" from a missing space is
 * not a domain; "e.g." and "a.m." have one-letter parts). Also spelled or bracketed dots:
 * "kidsprize dot com", "kidsprize (dot) net", "kidsprize[.]ru".
 */
const DOMAIN_RE = /(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]*\.(?:\p{Ll}{2,24}|\p{Lu}{2,24})(?![\p{L}\p{N}])/u;
const COMMON_TLDS = "com|net|org|edu|gov|io|co|us|uk|ca|ru|cn|de|fr|in|ai|dev|app|me|info|biz|xyz|gg|tv|cc|to|ly|link|site|online|shop|store|club|live|fun|top|win|vip";
const SPELLED_DOT_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])[\\p{L}\\p{N}][\\p{L}\\p{N}-]*\\s*(?:[([{]\\s*(?:dot|\\.)\\s*[)\\]}]\\s*\\p{L}{2,24}|dot\\s+(?:${COMMON_TLDS}))(?![\\p{L}\\p{N}])`,
  "iu",
);
const HANDLE_RE = /(?:^|[^\p{L}\p{N}])@[\p{L}\p{N}_]{2,}/u;
const DIGITS_RE = /\d(?:[\s().-]*\d){6,}/;
export const hasUrlOrMarkup = (s: string) =>
  MARKUP_RE.test(s) || DOMAIN_RE.test(s) || SPELLED_DOT_RE.test(s) || HANDLE_RE.test(s) || DIGITS_RE.test(s);

/** Shown instead of a park name that fails `hasUrlOrMarkup` (R2-m3), together with HIDDEN_PARK_NOTE. */
export const HIDDEN_PARK_LABEL = "This park";
export const HIDDEN_PARK_NOTE = "We hid this park's name: on OpenStreetMap it looked like it had a web address, an @handle or a phone number in it.";

/**
 * R2-m3 (SEC-2-04): the park name from OpenStreetMap is printed on the pass, so it gets the same contact
 * check as every other printed text. An unsafe name becomes a neutral label (and the pass says why).
 */
export function safeParkName(name: string): { name: string; hidden: boolean } {
  return hasUrlOrMarkup(name) ? { name: HIDDEN_PARK_LABEL, hidden: true } : { name, hidden: false };
}

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
};

export function validateDraft(
  draft: PassDraftEnvelope,
  pool: readonly PoolItem[],
  mix: Mix,
  opts: ValidateOptions = { hasMap: false },
): ValidationResult {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const drops: Partial<Record<DropReason, number>> = {};
  const drop = (r: DropReason) => {
    drops[r] = (drops[r] ?? 0) + 1;
  };
  const used = new Set<string>();
  const kept: ValidItem[] = [];
  let lookWhereCleared = 0;
  let quotesRepaired = 0;

  for (const raw of draft.items) {
    const parsed = PassItemDraft.safeParse(raw && typeof raw === "object" ? withCodeSection(tidyStrings(raw as Record<string, unknown>), byId) : raw);
    if (!parsed.success) {
      const id = raw && typeof raw === "object" ? (raw as Record<string, unknown>).itemId : undefined;
      drop(typeof id === "string" && !byId.has(id) ? "unknown_id" : "schema");
      continue;
    }
    const d = parsed.data;
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
    // A name word only in lookWhere ("at the pond" for a pond): the clue is fine, so keep the item and
    // leave the hint out (S8b). lookWhere is optional on the pass; the answer is never printed for the kid.
    let lookWhere = d.lookWhere;
    if (nameLeak(lookWhere, item.nameWords)) {
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
    // R2-M5: "Look for a tree with seeds or fruit." fits hundreds of species; "white flowers" proved by
    // "show it with flowers" was never checked.
    if (item.section === "wild" && (isGenericClue(d.clue, item.sourceText) || quoteIsOnlyName(sourceQuote, item.answer))) {
      drop("generic_clue");
      continue;
    }
    // R2-M5: the prompt's example sentences came back word for word on every park.
    if (copiesPromptExample(d.clue) !== null) {
      drop("copies_example");
      continue;
    }
    if (kept.some((k) => trigramOverlap(k.clue, d.clue) >= COPY_OVERLAP)) {
      drop("repeats_clue");
      continue;
    }
    used.add(item.id);
    kept.push({ item, clue: d.clue, lookWhere, difficulty: d.difficulty, sourceQuote });
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
  const { items, spares } = fitToMix(asked, mix);
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
    spares,
  };
}

/**
 * R2-M5: the valid items that fit the printed mix: at most mix.max per section (answer order), then,
 * while there are more than mix.n, the last item of a section that is above its minimum goes.
 * `spares` = valid items left over (the model was asked for spares; they are not counted as removed).
 */
export function fitToMix<T extends { item: { section: Section } }>(valid: readonly T[], mix: Mix): { items: T[]; spares: number } {
  const per: Record<Section, number> = { park: 0, wild: 0, lucky: 0 };
  const items: T[] = [];
  for (const v of valid) {
    if (per[v.item.section] >= mix.max[v.item.section]) continue;
    per[v.item.section]++;
    items.push(v);
  }
  for (let i = items.length - 1; i >= 0 && items.length > mix.n; i--) {
    const s = items[i].item.section;
    if (per[s] > mix.min[s]) {
      per[s]--;
      items.splice(i, 1);
    }
  }
  while (items.length > mix.n) items.pop();
  return { items, spares: valid.length - items.length };
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
  for (const v of other.items) {
    if (items.length >= mix.n) break;
    if (used.has(v.item.id) || perSection[v.item.section] >= mix.max[v.item.section]) continue;
    used.add(v.item.id);
    perSection[v.item.section]++;
    items.push(v);
  }
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
  const ga = ngrams(a, 3);
  const gb = ngrams(b, 3);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / ga.size;
}

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
  for (const ex of examples) if (trigramShare(clue, ex) >= COPY_OVERLAP) return ex;
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
]);

const traitStem = (w: string) => (w.length >= 5 ? w.slice(0, 4) : w);

/**
 * R2-M5: a Wild Find clue with no detail from its own source ("Look for a tree with seeds or fruit.",
 * "Do you see a plant with flowers that are a purple color?" when the source never says purple) fits
 * hundreds of species, or can't be checked. Generic = no word of the clue beyond the generic ones is
 * also in the item's source (same first 4 letters for longer words: "spiny" ~ "spines").
 */
export function isGenericClue(clue: string, sourceText: string): boolean {
  const content = (text: string) =>
    sentencesOf(text)
      .flat()
      .map(singularWord)
      .filter((w) => w.length >= 3 && !TRAIT_STOP.has(w) && !RUN_STOP.has(w) && !/^\d+$/.test(w));
  const src = new Set(content(sourceText).map(traitStem));
  return !content(clue).some((w) => src.has(traitStem(w)));
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
  const easy = ordered.findIndex(({ v }) => v.difficulty === "easy" && v.item.stationary);
  if (easy >= 0) tips.push(`Start with find ${easy + 1}: it's easy and it stays put.`);
  const water = ordered.flatMap(({ v }, k) => (v.item.safety && /water/i.test(v.item.safety) ? [k + 1] : []));
  const movers = ordered.flatMap(({ v }, k) => (!v.item.stationary ? [k + 1] : []));
  if (water.length > 0) tips.push(`${water.length === 1 ? "Find" : "Finds"} ${listOf(water)} ${water.length === 1 ? "is" : "are"} near water: stay close.`);
  else if (movers.length > 0) tips.push(`${movers.length === 1 ? "Find" : "Finds"} ${listOf(movers)} can move away, so tick ${movers.length === 1 ? "it" : "them"} off when you see ${movers.length === 1 ? "it" : "them"}.`);
  return tips.join(" ").slice(0, PARENT_NOTE_MAX);
}
