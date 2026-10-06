/**
 * Server-side checks on the model's answer (SPEC §6.2). Every failure drops ONE item and is counted
 * by reason (logs + footer + evals); the model never decides what is safe or true.
 *
 * Per item, in order: spec zod schema -> URL/markup -> unknown id -> duplicate id -> section
 * mismatch -> danger (blocked taxon, or a blocked word in the text) -> grounding (`sourceQuote` must
 * be a normalized substring of that item's sourceText) -> name leak (common/scientific name or a
 * distinctive part of it, plural too, in the clue; a leak only in `lookWhere` blanks that hint and keeps
 * the item) -> numbers not in the source. Then the mix limits computed by
 * code are re-applied (extras beyond a section's max are dropped, in answer order).
 */
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

/** True when `quote` (normalized) is a substring of `source` (normalized) and long enough to mean something. */
export function isGrounded(quote: string, source: string): boolean {
  const q = trimQuote(normalizeForMatch(quote));
  if (q.length < MIN_GROUNDING_CHARS) return false;
  return normalizeForMatch(source).includes(q);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first name word found in `text` (whole word, any case, simple plurals), or null. */
export function nameLeak(text: string, words: readonly string[]): string | null {
  const t = normalizeForMatch(text);
  for (const w of words) {
    const word = normalizeForMatch(w);
    if (word.length < 3) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}(s|es|'s)?(?=$|[^\\p{L}\\p{N}])`, "u");
    if (re.test(t)) return w;
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
export const hasUrlOrMarkup = (s: string) => MARKUP_RE.test(s);

/** Single-line plain text: control characters removed, spaces collapsed. */
const tidy = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

export function validateDraft(draft: PassDraftEnvelope, pool: readonly PoolItem[], mix: Mix): ValidationResult {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const drops: Partial<Record<DropReason, number>> = {};
  const drop = (r: DropReason) => {
    drops[r] = (drops[r] ?? 0) + 1;
  };
  const used = new Set<string>();
  const kept: ValidItem[] = [];
  let lookWhereCleared = 0;

  for (const raw of draft.items) {
    const parsed = PassItemDraft.safeParse(
      raw && typeof raw === "object"
        ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? tidy(v) : v]))
        : raw,
    );
    if (!parsed.success) {
      drop("schema");
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
    if (!isGrounded(d.sourceQuote, item.sourceText)) {
      drop("not_grounded");
      continue;
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
    if (numbersNotIn(`${d.clue} ${lookWhere}`, item.sourceText).length > 0) {
      drop("number_not_in_source");
      continue;
    }
    used.add(item.id);
    kept.push({ item, clue: d.clue, lookWhere, difficulty: d.difficulty, sourceQuote: d.sourceQuote });
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
  };
}

/** Fewer valid items than this -> one retry (SPEC §6.2: "< n-2 survive"). */
export function retryThreshold(n: number): number {
  return Math.max(1, n - 2);
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
    typeof raw === "object" ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? tidy(v) : v])) : raw,
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
