/**
 * Pass feedback (Kevin, 2026-10-08): a signed-in grown-up rates a pass (1-5 stars + tags, no free text).
 * - One rating per account per pass, the latest wins. Stored like item reports (src/lib/reports): ONE hash per park,
 *   field `<pass id>|<reporter id>` = `<yyyymmdd>|<stars>|<tag mask>`, where the reporter id is the per-park HMAC of
 *   the account (src/lib/accounts/key.ts `reporterId`), so ratings in two parks can't be linked to each other or to
 *   the account without the server secret. 1 store command per rating (FEEDBACK_SCRIPT).
 * - Ratings are deleted after FEEDBACK_KEEP_DAYS (90) days: the hash expires 90 days after its last write, and every
 *   write drops fields older than that.
 * - The shared judge demo account is only LOGGED (`feedback_judge`), never stored or counted, deduped per judge sign-in
 *   (browser) per pass per day, like judge item reports.
 * - Nothing is shown publicly: Kevin reads the counts with `pnpm feedback:report` (scripts/feedback/report.mts).
 */
import "server-only";
import type { Store } from "@/lib/cache/store";
import { REPORTER_ID_PATTERN, reporterId } from "@/lib/accounts/key";
import { log } from "@/lib/log";
import { localDay } from "@/lib/time";
import { FEEDBACK_KEEP_DAYS, FEEDBACK_TAGS, tagMask, tagsOf, type FeedbackStatus, type FeedbackTag } from "./kinds";

export * from "./kinds";

const DAY_MS = 24 * 3600 * 1000;
const dayNumber = (ms: number) => Number(localDay(ms).replace(/-/g, ""));

export const feedbackKeys = (parkId: string) => ({
  // One hash tag per park (like the report hash), so the single EVAL stays valid on a clustered store.
  hash: `fb:{${parkId}}:h`,
  judgeDedupe: (day: number, session: string, passId: string) => `fb:{${parkId}}:j:${day}:${session}:${passId}`,
});
/** The glob for every park's feedback hash (the report script). */
export const FEEDBACK_HASH_GLOB = "fb:{*}:h";

export type Rater = { key: string; judge: boolean; session?: string };

export async function recordFeedback(
  store: Store,
  r: { passId: string; parkId: string; stars: number; tags: readonly FeedbackTag[]; account: Rater; now: number },
): Promise<{ status: FeedbackStatus }> {
  const day = dayNumber(r.now);
  const keys = feedbackKeys(r.parkId);
  if (r.account.judge) {
    // Logged for Kevin, never counted. One per judge sign-in per pass per day (1 command).
    const n = await store.incr(keys.judgeDedupe(day, r.account.session ?? "none", r.passId), 1, 2 * 24 * 3600);
    if (n > 1) return { status: "duplicate" };
    log("feedback_judge", { park: r.parkId, pass: r.passId, stars: r.stars, tags: [...r.tags], judge: true, counted: false });
    return { status: "logged" };
  }
  if (!store.recordFeedback) throw new Error("this store can't keep feedback");
  const out = await store.recordFeedback({
    hashKey: keys.hash,
    field: `${r.passId}|${reporterId(r.account.key, r.parkId)}`,
    value: `${day}|${r.stars}|${tagMask(r.tags)}`,
    cutoff: dayNumber(r.now - (FEEDBACK_KEEP_DAYS - 1) * DAY_MS),
    ttlSec: FEEDBACK_KEEP_DAYS * 24 * 3600,
  });
  // Never the account key or anything about the person: the park, the pass, the stars and the tags.
  if (r.tags.includes("not_safe")) log("feedback_not_safe", { park: r.parkId, pass: r.passId, stars: r.stars }, "warn");
  return { status: out.replaced ? "updated" : "saved" };
}

export type FeedbackEntry = { passId: string; day: number; stars: number; tags: FeedbackTag[] };

/** The ratings kept in one park hash (within the keep window); anything malformed is skipped. */
export function feedbackFromHash(fields: Record<string, string>, now: number): FeedbackEntry[] {
  const since = dayNumber(now - (FEEDBACK_KEEP_DAYS - 1) * DAY_MS);
  const out: FeedbackEntry[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const [passId, reporter, extra] = field.split("|");
    if (!passId || extra !== undefined || !REPORTER_ID_PATTERN.test(reporter ?? "")) continue;
    const m = /^(\d{8})\|([1-5])\|(\d{1,3})$/.exec(value);
    if (!m) continue;
    const day = Number(m[1]);
    const mask = Number(m[3]);
    if (day < since || mask >= 1 << FEEDBACK_TAGS.length) continue;
    out.push({ passId, day, stars: Number(m[2]), tags: tagsOf(mask) });
  }
  return out;
}

export type ParkFeedbackSummary = {
  parkId: string;
  ratings: number;
  /** Mean stars, 1 decimal. */
  average: number;
  /** Ratings per star value, index 0 = 1 star. */
  stars: [number, number, number, number, number];
  tags: Record<FeedbackTag, number>;
  passes: number;
};

export function summarizeFeedback(parkId: string, entries: readonly FeedbackEntry[]): ParkFeedbackSummary {
  const stars: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const tags = Object.fromEntries(FEEDBACK_TAGS.map((t) => [t, 0])) as Record<FeedbackTag, number>;
  let sum = 0;
  for (const e of entries) {
    stars[e.stars - 1] += 1;
    sum += e.stars;
    for (const t of e.tags) tags[t] += 1;
  }
  const ratings = entries.length;
  return { parkId, ratings, average: ratings > 0 ? Math.round((sum / ratings) * 10) / 10 : 0, stars, tags, passes: new Set(entries.map((e) => e.passId)).size };
}

/** Every park's summary (the report script): one SCAN pass plus 1 HGETALL per park. */
export async function feedbackReport(store: Store, now: number): Promise<ParkFeedbackSummary[]> {
  if (!store.scanKeys || !store.hashGetAll) throw new Error("this store can't list feedback");
  const out: ParkFeedbackSummary[] = [];
  for (const key of (await store.scanKeys(FEEDBACK_HASH_GLOB)).sort()) {
    const m = /^fb:\{(.+)\}:h$/.exec(key);
    if (!m) continue;
    const entries = feedbackFromHash(await store.hashGetAll(key), now);
    if (entries.length > 0) out.push(summarizeFeedback(m[1], entries));
  }
  return out;
}
