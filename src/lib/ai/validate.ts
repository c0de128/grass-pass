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
 * numbers not in the source. Then the mix limits computed by
 * code are re-applied (extras beyond a section's max are dropped, in answer order).
 */
import { seasonProblem } from "@/lib/pool/season";
import { blockedBy, blockedWordIn } from "@/lib/safety/danger-taxa";
import type { PoolItem, Section } from "@/lib/pool/types";
import type { Mix } from "./prompt";
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
 * catches "Maximilian"). Null for multi-word names and words under 5 letters.
 */
export function nameStem(word: string): string | null {
  if (!/^\p{L}+$/u.test(word) || word.length < STEM_MIN_LETTERS) return null;
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
 */
const DOMAIN_RE = /\b[a-z0-9-]+\.(?:com|net|org|io|ly|gg|app|me|co|xyz|info|biz|us|tv|link|site|online|shop|store|club|live|fun)\b/i;
const HANDLE_RE = /(?:^|[^\p{L}\p{N}])@[\p{L}\p{N}_]{2,}/u;
const DIGITS_RE = /\d(?:[\s().-]*\d){6,}/;
export const hasUrlOrMarkup = (s: string) => MARKUP_RE.test(s) || DOMAIN_RE.test(s) || HANDLE_RE.test(s) || DIGITS_RE.test(s);

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
    used.add(item.id);
    kept.push({ item, clue: d.clue, lookWhere, difficulty: d.difficulty, sourceQuote });
  }

  // Re-check the mix limits computed by code.
  const perSection: Record<Section, number> = { park: 0, wild: 0, lucky: 0 };
  const items: ValidItem[] = [];
  for (const v of kept) {
    const s = v.item.section;
    if (perSection[s] >= mix.max[s]) {
      drop("over_section_max");
      continue;
    }
    perSection[s]++;
    items.push(v);
  }
  const belowMin = (Object.keys(perSection) as Section[]).filter((s) => perSection[s] < mix.min[s]);

  let parentNote = typeof draft.parentNote === "string" ? tidy(draft.parentNote).slice(0, PARENT_NOTE_MAX) : "";
  if (/\d/.test(parentNote) || hasUrlOrMarkup(parentNote) || blockedWordIn(parentNote)) parentNote = "";

  return {
    items,
    drops,
    returned: draft.items.length,
    parentNote,
    belowMin,
    hardCount: items.filter((i) => i.difficulty === "hard").length,
    lookWhereCleared,
    quotesRepaired,
  };
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
    parentNote: primary.parentNote || other.parentNote,
    belowMin: (Object.keys(perSection) as Section[]).filter((s) => perSection[s] < mix.min[s]),
    hardCount: items.filter((i) => i.difficulty === "hard").length,
  };
}
