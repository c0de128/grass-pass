/**
 * Pass feedback (Kevin, 2026-10-08): a signed-in grown-up rates a pass with 1-5 stars and tap-to-pick tags. No free text
 * at all (the request schema is strict: any other field is refused). Client-safe; the store side is ./index.ts.
 */
import "@/lib/zod-config";
import { z } from "zod";
import { PASS_ID_PATTERN } from "@/lib/pass/schema";

/** The tags, in the order shown (and the bit order in the stored mask: never reorder, only append). */
export const FEEDBACK_TAGS = ["too_easy", "too_hard", "kids_loved", "missing", "not_safe"] as const;
export const FeedbackTagSchema = z.enum(FEEDBACK_TAGS);
export type FeedbackTag = z.infer<typeof FeedbackTagSchema>;

export const FEEDBACK_TAG_LABELS: Record<FeedbackTag, string> = {
  too_easy: "Too easy",
  too_hard: "Too hard",
  kids_loved: "Kids loved it",
  missing: "Something was missing",
  not_safe: "Not safe",
};

/**
 * A 13+ pass is for teens and adults on their own (src/lib/pass/audience.ts): the same `kids_loved` tag reads "We loved
 * it" there. Stored and counted as the same tag.
 */
export function feedbackTagLabel(tag: FeedbackTag, adult: boolean): string {
  return adult && tag === "kids_loved" ? "We loved it" : FEEDBACK_TAG_LABELS[tag];
}

/** Ratings are deleted after this many days (like item reports). */
export const FEEDBACK_KEEP_DAYS = 90;

export const FeedbackRequestSchema = z
  .object({
    passId: z.string().regex(PASS_ID_PATTERN),
    stars: z.number().int().min(1).max(5),
    tags: z
      .array(FeedbackTagSchema)
      .max(FEEDBACK_TAGS.length)
      .refine((t) => new Set(t).size === t.length, { message: "each tag once" }),
  })
  .strict();
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

/** saved: a first rating; updated: replaced this account's earlier rating of the pass; logged: the judge demo (not counted). */
export const FEEDBACK_STATUSES = ["saved", "updated", "logged", "duplicate"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FeedbackResponseSchema = z.object({ status: z.enum(FEEDBACK_STATUSES), message: z.string().max(200) });

export const FEEDBACK_COPY = {
  heading: "How was this pass?",
  intro: "Pick 1 to 5 stars, and any tags that fit. It helps us make better passes.",
  signedOut: "Sign in to rate this pass",
  saved: "Thanks! Your rating is saved.",
  updated: "Thanks! Your rating is updated.",
  judgeLogged: "Thanks! Judge demo ratings are logged for review, but they aren't counted.",
  judgeDuplicate: "This browser already rated this pass today.",
  pickStars: "Pick 1 to 5 stars first.",
  privacy: `One rating per account per pass (the newest counts). We keep it with a scrambled ID for ${FEEDBACK_KEEP_DAYS} days. No email, no name.`,
} as const;

/** Tags as a bit mask (bit i = FEEDBACK_TAGS[i]) and back. */
export function tagMask(tags: readonly FeedbackTag[]): number {
  return tags.reduce((m, t) => m | (1 << FEEDBACK_TAGS.indexOf(t)), 0);
}
export function tagsOf(mask: number): FeedbackTag[] {
  return FEEDBACK_TAGS.filter((_, i) => (mask & (1 << i)) !== 0);
}
