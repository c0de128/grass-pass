/**
 * The text of Kevin's private feedback report (`pnpm feedback:report`, scripts/feedback/report.mts). Pure, so unit
 * tests check it. Counts only: the store holds no names, no emails and no text.
 */
import { FEEDBACK_KEEP_DAYS, FEEDBACK_TAG_LABELS, FEEDBACK_TAGS, type FeedbackTag } from "./kinds";
import type { ParkFeedbackSummary } from "./index";

export const NO_STORE_REPORT =
  "No data available: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not set (in the shell or .env.local), so there is no shared store to read. A local server without Upstash keeps ratings only in its own memory, which this script can't see.";
export const NO_RATINGS_REPORT = `No data available: no pass has been rated yet, or every rating is older than ${FEEDBACK_KEEP_DAYS} days.`;

const tagLine = (tags: Record<FeedbackTag, number>) => FEEDBACK_TAGS.map((t) => `${FEEDBACK_TAG_LABELS[t]} ${tags[t]}`).join(", ");
const starLine = (s: readonly number[]) => s.map((n, i) => `${i + 1}★ ${n}`).join("  ");

export function formatFeedbackReport(parks: readonly (ParkFeedbackSummary & { name?: string | null })[], when: string): string {
  const out = [`Grass Pass pass feedback, ${when} (Dallas time). Ratings are kept ${FEEDBACK_KEEP_DAYS} days; judge demo ratings are only logged, never stored.`, ""];
  if (parks.length === 0) return [...out, NO_RATINGS_REPORT].join("\n");
  const all = { ratings: 0, sum: 0, stars: [0, 0, 0, 0, 0], tags: Object.fromEntries(FEEDBACK_TAGS.map((t) => [t, 0])) as Record<FeedbackTag, number> };
  for (const p of [...parks].sort((a, b) => b.ratings - a.ratings || a.parkId.localeCompare(b.parkId))) {
    out.push(`${p.parkId}  ${p.name ?? "(park name not saved anymore)"}`);
    out.push(`  ${p.ratings} ${p.ratings === 1 ? "rating" : "ratings"} on ${p.passes} ${p.passes === 1 ? "pass" : "passes"}, average ${p.average.toFixed(1)} stars`);
    out.push(`  stars: ${starLine(p.stars)}`);
    out.push(`  tags:  ${tagLine(p.tags)}`);
    out.push("");
    all.ratings += p.ratings;
    p.stars.forEach((n, i) => {
      all.stars[i] += n;
      all.sum += n * (i + 1);
    });
    for (const t of FEEDBACK_TAGS) all.tags[t] += p.tags[t];
  }
  out.push(`All parks: ${all.ratings} ${all.ratings === 1 ? "rating" : "ratings"} in ${parks.length} ${parks.length === 1 ? "park" : "parks"}, average ${(all.sum / all.ratings).toFixed(1)} stars`);
  out.push(`  stars: ${starLine(all.stars)}`);
  out.push(`  tags:  ${tagLine(all.tags)}`);
  return out.join("\n");
}
