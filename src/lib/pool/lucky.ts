/**
 * Lucky Finds (SPEC F8): "maybe" finds backed by Google visitor reviews, counted by code via SerpApi.
 *
 * Per park, at most 1 google_maps search (park -> place, cached 30 days) and 3 google_maps_reviews
 * searches, one per keyword from a fixed kid-safe list: dogs, bikes, and ducks (when the park has a pond
 * or lake on OpenStreetMap) or skateboards. It stops as soon as LUCKY_MAX keywords qualify. A keyword
 * qualifies with >= 3 reviews from the last 24 months whose own text mentions it. Code writes the count
 * and the newest month; review text is never shown, stored or sent to the model (the pool item's source
 * text is a fixed, code-written sentence per keyword). The finished result, including "nothing
 * qualified" and "no matching place", is cached per park for 30 days, so a cache hit costs 0 searches.
 * A lookup cut short by a cap, an error or the deadline is never cached for 30 days.
 *
 * Every way it can be off has its own on-screen reason (SPEC §5.4): not connected, the free search
 * limit reached today / this month, SerpApi refused or didn't answer, no matching place, no reviews
 * mention the keywords.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { createJsonCache, type Store } from "@/lib/cache";
import { dailyPaceState } from "@/lib/limits/budget";
import { log } from "@/lib/log";
import { APP_TIME_ZONE } from "@/lib/time";
import type { FetchLike } from "@/lib/sources/common";
import type { ParkFeatures } from "@/lib/sources/overpass-features";
import {
  countMentions,
  DATA_ID_RE,
  mapsParams,
  matchPlace,
  parsePlaces,
  reviewsParams,
  SerpapiError,
  serpapiGet,
  serpapiKey,
  WINDOW_MONTHS,
  windowStartMs,
  type NoMatchReason,
  type SerpapiFailure,
} from "@/lib/sources/serpapi";
import type { PoolItem, SectionState } from "./types";

type Env = Record<string, string | undefined>;

/** At most this many Lucky Finds on a pass (same as prompt.ts LUCKY_MAX). */
export const LUCKY_FINDS_MAX = 2;
/** A keyword needs at least this many recent reviews that mention it (SPEC F8). */
export const MIN_MENTIONS = 3;
/** At most this many review searches per park (SPEC F8). */
export const MAX_REVIEW_QUERIES = 3;
export const LUCKY_TTL_SEC = 30 * 24 * 3600;
export const LUCKY_SOURCE = "Google reviews via SerpApi" as const;

// ---------- the keyword list (fixed, kid-safe) ----------

export type LuckyKeyword = {
  id: "dog" | "bike" | "duck" | "skateboard";
  /** The text filter sent to SerpApi. */
  query: string;
  /** What a review's own text must contain to count (no "g" flag: `test` must not keep state). */
  mentions: RegExp;
  /** "dogs" in "N visitor reviews mention dogs". */
  plural: string;
  /** Answer key line. */
  answer: string;
  /** Code-written description the model may quote (no digits, no review text). */
  describe: string;
  /** Words a clue must not contain. */
  nameWords: string[];
  /** Fixed safety line, or null. It is printed on the kid's row, so it never names the thing. */
  safety: string | null;
};

export const LUCKY_KEYWORDS: Record<LuckyKeyword["id"], LuckyKeyword> = {
  dog: {
    id: "dog",
    query: "dog",
    mentions: /\b(dogs?|doggy|doggie|doggies|doggos?|pupp(y|ies)|pups?)\b/i,
    plural: "dogs",
    answer: "A dog out for a walk",
    describe: "A dog is a furry pet with four legs, floppy or pointy ears and a wagging tail. People walk dogs on a leash.",
    nameWords: ["dog", "dogs", "doggy", "doggie", "doggies", "doggo", "puppy", "puppies", "pup", "pups"],
    safety: "Never pet an animal you don't know.",
  },
  bike: {
    id: "bike",
    query: "bike",
    mentions: /\b(bikes?|biking|bikers?|bicycles?|bicycling|bicyclists?|cycling|cyclists?)\b/i,
    plural: "bikes",
    answer: "Someone riding a bike",
    describe: "A bike has two wheels, pedals and handlebars. Riders often wear a helmet and ring a bell to pass.",
    nameWords: ["bike", "bikes", "biking", "biker", "bikers", "bicycle", "bicycles", "cyclist", "cyclists", "cycling"],
    safety: "Step to the side of the path when riders pass.",
  },
  duck: {
    id: "duck",
    query: "ducks",
    mentions: /\b(ducks?|ducklings?)\b/i,
    plural: "ducks",
    answer: "A duck",
    describe: "A duck is a bird with webbed feet and a flat, wide bill. It floats on the water and dips its head under to eat.",
    nameWords: ["duck", "ducks", "duckling", "ducklings"],
    safety: "Stay with your grown-up near water.",
  },
  skateboard: {
    id: "skateboard",
    query: "skateboard",
    mentions: /\b(skateboards?|skateboarding|skateboarders?|skate ?parks?)\b/i,
    plural: "skateboards",
    answer: "Someone on a skateboard",
    describe: "A skateboard is a short flat board on four small wheels. Riders push with one foot and roll, and some do jumps.",
    nameWords: ["skateboard", "skateboards", "skateboarding", "skateboarder", "skateboarders", "skate", "skater", "skaters"],
    safety: null,
  },
};

/** The keywords to try for a park, in order: dogs, bikes, then ducks (a pond or lake on the map) or skateboards. */
export function keywordsFor(features: Pick<ParkFeatures, "features"> | null): LuckyKeyword[] {
  const third = features?.features.water ? LUCKY_KEYWORDS.duck : LUCKY_KEYWORDS.skateboard;
  return [LUCKY_KEYWORDS.dog, LUCKY_KEYWORDS.bike, third].slice(0, MAX_REVIEW_QUERIES);
}

// ---------- copy (SPEC §5.4) ----------

const listWords = (w: readonly string[]) => (w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} or ${w[w.length - 1]}`);

export const LUCKY_COPY = {
  notConnected: "Lucky Finds: not connected. This server has no SerpApi key, so there are no Lucky Finds from visitor reviews.",
  dailyCap: "Lucky Finds: off for today. Grass Pass has used its free search limit for visitor reviews (SerpApi); it resets at midnight Dallas time.",
  monthlyCap: "Lucky Finds: off until the free monthly searches reset. Grass Pass used its monthly search limit for visitor reviews (SerpApi).",
  storePace: "Lucky Finds: off for today. Grass Pass reached its daily share of its free storage service, so it skipped new visitor-review lookups; they come back tomorrow.",
  paused: "Lucky Finds: paused. The visitor-review service (SerpApi) asked us to wait, so we stopped asking for now.",
  auth: "Lucky Finds: off. The visitor-review service (SerpApi) did not accept this server's key.",
  down: "No data available: Google reviews (via SerpApi) didn't answer, so there are no Lucky Finds on this pass.",
  slow: "No data available: Google reviews (via SerpApi) were too slow when this pass was made.",
  noMatch: (park: string) => `No data available: we couldn't match ${park} to one place on Google Maps, so there are no Lucky Finds from visitor reviews.`,
  noEvidence: (keywords: readonly string[]) =>
    `No data available: no visitor reviews from the last ${WINDOW_MONTHS / 12} years mention ${listWords(keywords)} at least ${MIN_MENTIONS} times (Google reviews via SerpApi).`,
} as const;

function failureState(kind: SerpapiFailure): SectionState {
  switch (kind) {
    case "daily_cap":
      return { status: "off", message: LUCKY_COPY.dailyCap };
    case "monthly_cap":
      return { status: "off", message: LUCKY_COPY.monthlyCap };
    case "breaker":
    case "quota":
      return { status: "off", message: LUCKY_COPY.paused };
    case "auth":
      return { status: "off", message: LUCKY_COPY.auth };
    case "aborted":
      return { status: "unavailable", message: LUCKY_COPY.slow };
    default:
      return { status: "unavailable", message: LUCKY_COPY.down };
  }
}

// ---------- evidence ----------

const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, month: "short", year: "numeric" });
/** 1759622400000 -> "Oct 2025" (Chicago time). */
export const monthYear = (ms: number) => monthFmt.format(new Date(ms));

export const FindSchema = z.object({
  keyword: z.enum(["dog", "bike", "duck", "skateboard"]),
  count: z.number().int().min(0).max(1000),
  atLeast: z.boolean(),
  newestMs: z.number().nullable(),
});
export type Find = z.infer<typeof FindSchema>;

/** The evidence line's shape (evals/score.ts checks every printed Lucky Find against it): count, window, keyword. */
export const LUCKY_EVIDENCE_RE = /^(at least )?(\d+) visitor reviews? since [A-Z][a-z]{2} \d{4} mention (dogs|bikes|ducks|skateboards)\b/;

/** "14 visitor reviews since Oct 2024 mention dogs, newest Sep 2026 · Google reviews via SerpApi" (code-written). */
export function luckyEvidence(f: Find, checkedAtMs: number): string {
  const kw = LUCKY_KEYWORDS[f.keyword];
  const since = monthYear(windowStartMs(checkedAtMs));
  const newest = f.newestMs === null ? "" : `, newest ${monthYear(f.newestMs)}`;
  return `${f.atLeast ? "at least " : ""}${f.count} visitor ${f.count === 1 ? "review" : "reviews"} since ${since} mention ${kw.plural}${newest} · ${LUCKY_SOURCE}`;
}

/** The pool item for a qualifying keyword. Its source text is code-written: no counts, no review text. */
export function luckyItem(f: Find, checkedAtMs: number): PoolItem {
  const kw = LUCKY_KEYWORDS[f.keyword];
  return {
    id: `lucky-${kw.id}`,
    section: "lucky",
    kind: "maybe find (it comes and goes)",
    sourceText: `A maybe find: Google reviews of this park from the last two years mention ${kw.plural}, so you might see one today. ${kw.describe}`,
    answer: `${kw.answer} (maybe)`,
    evidence: luckyEvidence(f, checkedAtMs),
    source: LUCKY_SOURCE,
    nameWords: [...kw.nameWords],
    safety: kw.safety,
    stationary: false,
  };
}

// ---------- caches ----------

const PlaceSchema = z.union([
  z.object({ dataId: z.string().regex(DATA_ID_RE), title: z.string().max(120), distanceM: z.number().int().min(0) }),
  z.object({ none: z.enum(["no_results", "name", "distance", "type"]) }),
]);
const placeCache = createJsonCache({ name: "serpapi-place", schema: PlaceSchema, ttlSec: LUCKY_TTL_SEC, maxEntries: 5_000 });

const ResultSchema = z.object({
  /** Null when no Google place matched the park. */
  place: z.object({ title: z.string().max(120) }).nullable(),
  noMatch: z.enum(["no_results", "name", "distance", "type"]).optional(),
  searched: z.array(z.enum(["dog", "bike", "duck", "skateboard"])).max(MAX_REVIEW_QUERIES),
  finds: z.array(FindSchema).max(MAX_REVIEW_QUERIES),
});
type LuckyRecord = z.infer<typeof ResultSchema>;
const resultCache = createJsonCache({ name: "lucky", schema: ResultSchema, ttlSec: LUCKY_TTL_SEC, maxEntries: 5_000 });

// ---------- the lookup ----------

export type LuckyDeps = {
  store: Store;
  env: Env;
  now: () => number;
  fetchImpl?: FetchLike;
  /** Our pass deadline only (a sent search finishes even when every client has left; its answer is cached). */
  signal?: AbortSignal;
  /** Called right before a search is sent (charges the per-IP daily share). */
  onUpstream?: () => void;
};

export type LuckyResult = {
  items: PoolItem[];
  state: SectionState;
  /** When the counts were made (ISO), null when no search answered. */
  checkedAt: string | null;
  /** SerpApi searches sent for this pass (0 on a cache hit). */
  searches: number;
};

type Park = { id: string; name: string; lat: number; lng: number };

function fromRecord(rec: LuckyRecord, park: Park, checkedAtMs: number, searches: number, partial: SectionState | null): LuckyResult {
  const qualifying = rec.finds.filter((f) => f.count >= MIN_MENTIONS).slice(0, LUCKY_FINDS_MAX);
  const items = qualifying.map((f) => luckyItem(f, checkedAtMs));
  const checkedAt = new Date(checkedAtMs).toISOString();
  if (items.length > 0) return { items, state: { status: "ok" }, checkedAt, searches };
  if (partial) return { items, state: partial, checkedAt: searches > 0 ? checkedAt : null, searches };
  if (!rec.place) return { items, state: { status: "empty", message: LUCKY_COPY.noMatch(park.name) }, checkedAt, searches };
  return { items, state: { status: "empty", message: LUCKY_COPY.noEvidence(rec.searched.map((k) => LUCKY_KEYWORDS[k].plural)) }, checkedAt, searches };
}

/**
 * Lucky Finds for one park. Never throws for upstream trouble: every failure is an honest section state.
 * `features` picks the third keyword (ducks when the park has a pond or lake on the map).
 */
export async function loadLucky(park: Park, features: Pick<ParkFeatures, "features"> | null, deps: LuckyDeps): Promise<LuckyResult> {
  if (!serpapiKey(deps.env)) return { items: [], state: { status: "off", message: LUCKY_COPY.notConnected }, checkedAt: null, searches: 0 };
  const hit = await resultCache.get(park.id, deps.now());
  if (hit) return fromRecord(hit.value, park, hit.storedAt, 0, null);
  // SEC-3-03 daily store pace: a new lookup costs about 16 store commands (caps, breaker, caches), so none
  // starts once today's share of the storage budget is used (cached counts above still show).
  const paced = dailyPaceState(deps.now());
  if (paced.paced) {
    log("lucky_paused_daily_pace", { park: park.id, used: paced.used, pace: paced.pace }, "warn");
    return { items: [], state: { status: "off", message: LUCKY_COPY.storePace }, checkedAt: null, searches: 0 };
  }

  let searches = 0;
  const src = {
    store: deps.store,
    env: deps.env,
    fetchImpl: deps.fetchImpl,
    signal: deps.signal,
    now: deps.now,
    onStart: () => {
      searches++;
      deps.onUpstream?.();
    },
  };
  const failed = (err: unknown): LuckyResult => {
    if (!(err instanceof SerpapiError)) throw err;
    log("lucky_failed", { park: park.id, kind: err.kind, started: err.started, searches }, "warn");
    return { items: [], state: failureState(err.kind), checkedAt: null, searches };
  };

  // 1. park -> Google place (cached 30 days, a "no match" too).
  let place: { dataId: string; title: string } | null;
  let noMatch: NoMatchReason | undefined;
  const cachedPlace = await placeCache.get(park.id, deps.now());
  if (cachedPlace) {
    const v = cachedPlace.value;
    place = "dataId" in v ? { dataId: v.dataId, title: v.title } : null;
    noMatch = "none" in v ? v.none : undefined;
  } else {
    try {
      const m = matchPlace(park, parsePlaces(await serpapiGet(mapsParams(park), "maps", src)));
      if (m.ok) {
        place = { dataId: m.place.dataId, title: m.place.title };
        await placeCache.set(park.id, { dataId: m.place.dataId, title: m.place.title, distanceM: m.place.distanceM }, { now: deps.now() });
        log("lucky_place", { park: park.id, distanceM: m.place.distanceM, similarity: Math.round(m.place.similarity * 100) / 100 });
      } else {
        place = null;
        noMatch = m.why;
        await placeCache.set(park.id, { none: m.why }, { now: deps.now() });
        log("lucky_place", { park: park.id, none: m.why });
      }
    } catch (err) {
      if (err instanceof z.ZodError) return failed(new SerpapiError("bad_output", { started: true }));
      return failed(err);
    }
  }
  if (!place) {
    const rec: LuckyRecord = { place: null, noMatch, searched: [], finds: [] };
    await resultCache.set(park.id, rec, { now: deps.now() });
    return fromRecord(rec, park, deps.now(), searches, null);
  }

  // 2. up to 3 review searches, stopping once LUCKY_FINDS_MAX keywords qualify.
  const finds: Find[] = [];
  const searched: LuckyKeyword["id"][] = [];
  let partial: SectionState | null = null;
  for (const kw of keywordsFor(features)) {
    if (finds.filter((f) => f.count >= MIN_MENTIONS).length >= LUCKY_FINDS_MAX) break;
    try {
      const json = await serpapiGet(reviewsParams(place.dataId, kw.query), "reviews", src);
      const c = countMentions(json, kw.mentions, deps.now());
      searched.push(kw.id);
      finds.push({ keyword: kw.id, ...c });
    } catch (err) {
      if (err instanceof z.ZodError) err = new SerpapiError("bad_output", { started: true });
      if (!(err instanceof SerpapiError)) throw err;
      log("lucky_failed", { park: park.id, kind: err.kind, started: err.started, searches, keyword: kw.id }, "warn");
      partial = failureState(err.kind);
      break;
    }
  }
  const rec: LuckyRecord = { place: { title: place.title }, searched, finds };
  log("lucky_counts", { park: park.id, searches, finds: finds.map((f) => `${f.keyword}:${f.atLeast ? ">=" : ""}${f.count}`), complete: partial === null });
  // Only a complete lookup is kept for 30 days (a cut-short one would hide finds for a month).
  if (partial === null) await resultCache.set(park.id, rec, { now: deps.now() });
  return fromRecord(rec, park, deps.now(), searches, partial);
}
