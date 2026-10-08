/**
 * Trip tips ("How to make this a great trip", Kevin 2026-10-08): the stored shape on a pass and its fixed copy.
 * Client-safe (no server-only imports): the pass page renders it and the browser validates the streamed pass with it.
 *
 * Made ONCE with the pass, from real inputs only: the day's Open-Meteo forecast and weather.gov alerts, the park's
 * OpenStreetMap features and the iNaturalist sightings the pass already gathered (src/lib/tips/facts.ts). Written by
 * the open model and checked by code (src/lib/tips/check.ts), or, when the model can't help, a short code-written list
 * from the same facts (src/lib/tips/rules.ts), labelled as such. Screen only: the printed pass never shows it.
 */
import "@/lib/zod-config";
import { z } from "zod";

/** The fixed icon set (one small picture per tip). The model picks one; anything else is refused by the schema. */
export const TIP_ICONS = [
  "shoes",
  "hat",
  "water",
  "sunscreen",
  "jacket",
  "umbrella",
  "bugspray",
  "snack",
  "restroom",
  "shade",
  "layers",
  "time",
  "path",
  "pencil",
] as const;
export type TipIcon = (typeof TIP_ICONS)[number];
export const TipIconSchema = z.enum(TIP_ICONS);

/** A tip is short and imperative ("Wear closed-toe shoes: the creek bank is muddy"). */
export const TIP_MAX = 90;
/** The fact behind it, code-written from the input (never the model's words). */
export const WHY_MAX = 120;
export const MIN_TIPS = 3;
export const MAX_TIPS = 6;

export const TripTipSchema = z.object({
  tip: z.string().min(3).max(TIP_MAX),
  why: z.string().min(3).max(WHY_MAX),
  icon: TipIconSchema,
});
export type TripTip = z.infer<typeof TripTipSchema>;

/** Why the code-written list is shown instead of the model's (each is said honestly on the page). */
export const RULES_REASONS = ["no_answer", "failed_checks", "no_key", "budget"] as const;
export type RulesReason = (typeof RULES_REASONS)[number];

export const TripTipsSchema = z.object({
  source: z.enum(["model", "rules"]),
  /** The park-local day the forecast was for ("2026-10-08"); the pass day when there was no forecast. */
  forDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** False when no forecast was available: the tips then come from the park map (and sightings) only. */
  forecast: z.boolean(),
  items: z.array(TripTipSchema).min(1).max(MAX_TIPS),
  /** The model that answered (from the provider's answer, never a fixed label). Model tips only. */
  model: z.string().max(100).optional(),
  /** Rules tips only: why the model's tips are not shown. */
  reason: z.enum(RULES_REASONS).optional(),
  madeAt: z.string(),
});
export type TripTips = z.infer<typeof TripTipsSchema>;

/** Every fixed line of the section (tests and the page read these). */
export const TRIP_TIPS_COPY = {
  heading: "How to make this a great trip",
  /** An older pass, saved before this section existed. */
  beforeTips: "No trip tips for this pass: it was made before trip tips existed.",
  rulesLabel: "Basic tips from the forecast and park map",
  rulesWhy: {
    no_answer: "the AI didn't answer",
    failed_checks: "the AI's tips didn't pass our checks",
    no_key: "this server has no AI key",
    budget: "today's free AI budget was used up",
  } satisfies Record<RulesReason, string>,
  noForecast: "No forecast was available when these tips were made, so they come from the park map and sightings only.",
} as const;

/** "Gemma 4" for gemma-4-31B-it; otherwise the model id as the provider gave it (never a fixed label). */
export function modelShortName(id: string): string {
  const m = /^gemma[-_ ]?(\d+)/i.exec(id);
  if (m) return `Gemma ${m[1]}`;
  if (/llama/i.test(id)) return "Llama";
  if (/^qwen/i.test(id)) return "Qwen";
  return id;
}
