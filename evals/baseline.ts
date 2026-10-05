/**
 * The no-AI template baseline (SPEC 6.4 / 6.5): what a pass looks like with code only, no model.
 * Same pool, same mix limits, same server checks (validateDraft). Each clue is one real sentence:
 *   - Park Finds: the fixed kid-level description of that kind ("A ____ court is a flat hard court...");
 *   - Wild Finds: the first sentence of the species' Wikipedia summary;
 * with every name word masked as "____". Grounded by construction (the quote is the source sentence).
 */
import type { Mix } from "@/lib/ai/prompt";
import { CLUE_MAX, QUOTE_MAX } from "@/lib/ai/schema";
import { validateDraft, type ValidationResult } from "@/lib/ai/validate";
import type { PoolItem, Section } from "@/lib/pool/types";

export const MASK = "____";
export const TEMPLATE_MODEL = "no-AI template";

/** Sentences of a text (split after . ! ? followed by a space and a capital, digit or quote). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=["'(\p{Lu}\p{N}])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace each name word (whole word, any case, simple plurals) with ____ . Longest names first. */
export function maskNames(text: string, words: readonly string[]): string {
  let out = text;
  for (const w of [...words].filter((x) => x.length >= 3).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}(s|es|'s)?(?=$|[^\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, `$1${MASK}`);
  }
  return out;
}

/** Cut to `max` chars at a word boundary (no ellipsis: the clue stays a plain sentence start). */
export function cutWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const i = cut.lastIndexOf(" ");
  return (i > 20 ? cut.slice(0, i) : s.slice(0, max)).replace(/[,;:\s]+$/, "");
}

/** The source sentence a template clue uses for one pool item. */
export function templateSentence(item: PoolItem): string {
  const all = sentences(item.sourceText);
  if (item.section === "park") {
    // Park sourceText = "<Park> has N <kind> on the map (OpenStreetMap). [Mapped names: ...] <describe>"
    return all[all.length - 1] ?? item.sourceText;
  }
  // Wild sourceText = "<Label>. <Wikipedia summary>": skip the label sentence(s) that are only the name.
  const label = `${item.answer}.`;
  const rest = item.sourceText.startsWith(label) ? item.sourceText.slice(label.length).trim() : item.sourceText;
  return sentences(rest)[0] ?? rest;
}

/** Pick items the way the mix allows: each section's minimum first (pool order), then fill up to n. */
export function templatePick(pool: readonly PoolItem[], mix: Mix): PoolItem[] {
  const picked: PoolItem[] = [];
  const count: Record<Section, number> = { park: 0, wild: 0, lucky: 0 };
  for (const s of ["park", "wild", "lucky"] as Section[]) {
    for (const p of pool) {
      if (count[s] >= mix.min[s]) break;
      if (p.section === s) {
        picked.push(p);
        count[s]++;
      }
    }
  }
  const order: Section[] = ["wild", "park", "lucky"];
  let progress = true;
  while (picked.length < mix.n && progress) {
    progress = false;
    for (const s of order) {
      if (picked.length >= mix.n) break;
      if (count[s] >= mix.max[s]) continue;
      const next = pool.find((p) => p.section === s && !picked.includes(p));
      if (!next) continue;
      picked.push(next);
      count[s]++;
      progress = true;
    }
  }
  return picked;
}

export type TemplateDraft = {
  items: { itemId: string; section: Section; clue: string; lookWhere: string; sourceQuote: string; difficulty: "medium" }[];
  parentNote: string;
};

export function templateDraft(pool: readonly PoolItem[], mix: Mix): TemplateDraft {
  const items = templatePick(pool, mix).map((p) => {
    const sentence = templateSentence(p);
    return {
      itemId: p.id,
      section: p.section,
      clue: cutWords(maskNames(sentence, p.nameWords), CLUE_MAX),
      lookWhere: "",
      sourceQuote: cutWords(sentence, QUOTE_MAX),
      difficulty: "medium" as const,
    };
  });
  return { items, parentNote: "" };
}

/** The baseline pass after the same server checks the model's answer gets. */
export function templatePass(pool: readonly PoolItem[], mix: Mix): { draft: TemplateDraft; result: ValidationResult } {
  const draft = templateDraft(pool, mix);
  return { draft, result: validateDraft(draft, pool, mix) };
}
