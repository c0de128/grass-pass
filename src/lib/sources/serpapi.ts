/**
 * SerpApi (HF26 partner) for Lucky Finds (SPEC F8, ADR 0002). Server only. Two engines, verified live
 * 2026-10-06 (recordings in tests/fixtures/serpapi/):
 *   - `google_maps` (type=search, q=<park name>, ll=@lat,lng,15z): one park comes back as `place_results`
 *     (Arbor Hills: `type` is an ARRAY there), several as `local_results` (Celebration Park: the park, its
 *     own tennis courts and fields, and a same-name park in Lucas 13 km away). Both carry `title`,
 *     `data_id`, `gps_coordinates` and `type`/`types`. A nonsense name still came back with ONE far-away
 *     place (a preserve in Illinois), so a result is never trusted without our own name + distance + type check.
 *   - `google_maps_reviews` (data_id, sort_by=newestFirst, query=<word>, num=20): up to 20 reviews whose
 *     text Google matched, newest first by LAST EDIT; each has `snippet`, `iso_date` (first posted) and
 *     `iso_date_of_last_edit`; `serpapi_pagination.next_page_token` when more exist. The first page
 *     WITHOUT a query has `topics` (keyword + mentions), but those counts have no dates and "dog" was not
 *     among Arbor Hills' 10 topics, so they can't meet the 24-month rule and are not used.
 *
 * Key rules: SERPAPI_API_KEY is read here only, sent only to https://serpapi.com/search.json (a fixed
 * URL, never configurable, no redirects followed), and never logged, cached, thrown or sent to the
 * browser. SerpApi takes the key as a query parameter, so the request URL is never logged either.
 * Review text stays inside `countMentions`: only a keyword, a count and a month leave this file.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import type { Store } from "@/lib/cache/store";
import { distanceM, type LatLng } from "@/lib/geo";
import { reserveSearch, tripSerpapi, type SearchRefusal } from "@/lib/limits/serpapi";
import { log } from "@/lib/log";
import { fetchText, parseRetryAfter, SourceError, type FetchLike } from "./common";

type Env = Record<string, string | undefined>;

export const SERPAPI_SOURCE = "serpapi";
/** The only URL the key is ever sent to. */
export const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
/** Measured 2026-10-06: 0.4-2.8 s, one cold nonsense query 6.8 s. */
export const SERPAPI_TIMEOUT_MS = 12_000;
/** A reviews page of 20 was 30-60 KB; a maps answer about 40 KB. */
export const SERPAPI_MAX_BYTES = 1_500_000;
/** SerpApi's own maximum page size for google_maps_reviews (docs, 2026-10-06). */
export const REVIEWS_PAGE = 20;
/** Breaker after a bad key (401/403): an hour. After 429 (plan or hourly limit): Retry-After, else an hour. After 5xx/timeout: a minute. */
export const AUTH_OPEN_SEC = 3600;
export const QUOTA_OPEN_SEC = 3600;
export const ERROR_OPEN_SEC = 60;

/** A Google Maps data id, e.g. "0x864c24be898ce109:0xc3d18322006a4923" (the only shape we pass on). */
export const DATA_ID_RE = /^0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16}$/i;

// ---------- the key ----------

const KEY_RE = /^[A-Za-z0-9]{32,128}$/;

/** The SerpApi key, or null when it is missing or not key-shaped (a placeholder, a pasted URL). Never logged. */
export function serpapiKey(env: Env = process.env): string | null {
  const k = env.SERPAPI_API_KEY?.trim();
  return k && KEY_RE.test(k) ? k : null;
}

// ---------- requests ----------

export type SearchParams = Record<string, string>;

/** The google_maps search for a park: its name near its OpenStreetMap centre (zoom 15, about 1.5 km across). */
export function mapsParams(park: { name: string; lat: number; lng: number }): SearchParams {
  const name = park.name.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) throw new RangeError("park name is empty");
  if (!Number.isFinite(park.lat) || !Number.isFinite(park.lng) || Math.abs(park.lat) > 90 || Math.abs(park.lng) > 180) throw new RangeError("bad point");
  return { engine: "google_maps", type: "search", q: name, ll: `@${park.lat.toFixed(5)},${park.lng.toFixed(5)},15z`, hl: "en", gl: "us" };
}

/** One reviews page: the newest 20 reviews whose text Google matched to `query`. */
export function reviewsParams(dataId: string, query: string): SearchParams {
  if (!DATA_ID_RE.test(dataId)) throw new RangeError("bad data_id");
  if (!/^[a-z ]{2,30}$/.test(query)) throw new RangeError("bad query");
  return { engine: "google_maps_reviews", data_id: dataId, sort_by: "newestFirst", query, num: String(REVIEWS_PAGE), hl: "en" };
}

/** Why a search gave no answer. Every kind has its own honest copy (src/lib/pool/lucky.ts). */
export type SerpapiFailure =
  /** Not sent: a cap or the breaker (SearchRefusal). */
  | SearchRefusal
  /** SerpApi refused the key (401/403). */
  | "auth"
  /** SerpApi said the plan or the hourly limit is used up (429). */
  | "quota"
  /** 5xx, network, timeout. */
  | "down"
  /** Our own pass deadline stopped it. */
  | "aborted"
  /** 200 but not the shape we know, or an error message we don't know. */
  | "bad_output";

export class SerpapiError extends Error {
  static [Symbol.hasInstance](x: unknown): boolean {
    return x instanceof Error && x.name === "SerpapiError";
  }
  readonly kind: SerpapiFailure;
  /** True when the request was sent (it counted against our caps). */
  readonly started: boolean;
  readonly status?: number;
  constructor(kind: SerpapiFailure, opts: { started: boolean; status?: number }) {
    // Never the URL (it holds the key) and never the cause (a fetch error may quote the URL).
    super(`serpapi: ${kind}${opts.status ? ` (HTTP ${opts.status})` : ""}`);
    this.name = "SerpapiError";
    this.kind = kind;
    this.started = opts.started;
    this.status = opts.status;
  }
}

export type SerpapiDeps = {
  store: Store;
  env?: Env;
  fetchImpl?: FetchLike;
  /** The pass deadline only (never a client-gone signal: a sent search is paid for, so it finishes and is cached). */
  signal?: AbortSignal;
  now?: () => number;
  /** Called right before a request is sent (charges the caller's per-IP daily share). */
  onStart?: () => void;
  /** The server's example warm-up: also limited to its share of the daily cap (src/lib/limits/serpapi.ts). */
  warmup?: boolean;
};

/** "No results" answers come back as HTTP 200 with this error text (SerpApi docs); they mean an honest zero. */
const NO_RESULTS_RE = /hasn't returned any results/i;

/**
 * One SerpApi GET. Reserves a search on the daily + monthly caps first (refused -> SerpapiError with the
 * refusal, nothing sent), commits it the moment the request is sent, and maps every failure to a kind.
 * Returns the parsed JSON, or null for SerpApi's honest "no results".
 */
export async function serpapiGet(params: SearchParams, what: "maps" | "reviews", deps: SerpapiDeps): Promise<unknown | null> {
  const key = serpapiKey(deps.env);
  if (!key) throw new SerpapiError("auth", { started: false });
  const now = deps.now ?? (() => Date.now());
  const slot = await reserveSearch(deps.store, { env: deps.env, now: now(), warmup: deps.warmup });
  if (!slot.ok) throw new SerpapiError(slot.reason, { started: false });
  if (deps.signal?.aborted) {
    await slot.ticket.release();
    throw new SerpapiError("aborted", { started: false });
  }

  const u = new URL(SERPAPI_ENDPOINT);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("api_key", key);

  slot.ticket.commit();
  deps.onStart?.();
  const base = { source: SERPAPI_SOURCE, what };
  let res;
  try {
    res = await fetchText(SERPAPI_SOURCE, u.toString(), { method: "GET", headers: { Accept: "application/json" } }, {
      timeoutMs: SERPAPI_TIMEOUT_MS,
      fetchImpl: deps.fetchImpl,
      signal: deps.signal,
      maxBytes: SERPAPI_MAX_BYTES,
    });
  } catch (err) {
    const code = err instanceof SourceError ? err.code : "network";
    if (code === "aborted") {
      log("upstream_call", { ...base, outcome: "aborted" }, "warn");
      throw new SerpapiError("aborted", { started: true });
    }
    if (code === "bad_output") {
      log("upstream_call", { ...base, outcome: "too_large" }, "warn");
      throw new SerpapiError("bad_output", { started: true });
    }
    await tripSerpapi(deps.store, now(), ERROR_OPEN_SEC);
    log("upstream_call", { ...base, outcome: code }, "warn");
    throw new SerpapiError("down", { started: true });
  }

  const at = { ...base, status: res.status, latencyMs: res.latencyMs };
  if (res.status === 401 || res.status === 403) {
    await tripSerpapi(deps.store, now(), AUTH_OPEN_SEC);
    log("upstream_call", { ...at, outcome: "auth" }, "error");
    throw new SerpapiError("auth", { started: true, status: res.status });
  }
  if (res.status === 429) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now()) ?? QUOTA_OPEN_SEC;
    await tripSerpapi(deps.store, now(), retryAfter);
    log("upstream_call", { ...at, outcome: "quota", retryAfter }, "error");
    throw new SerpapiError("quota", { started: true, status: res.status });
  }
  if (res.status >= 500) {
    await tripSerpapi(deps.store, now(), ERROR_OPEN_SEC);
    log("upstream_call", { ...at, outcome: "busy" }, "warn");
    throw new SerpapiError("down", { started: true, status: res.status });
  }
  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    log("upstream_call", { ...at, outcome: "bad_output" }, "warn");
    throw new SerpapiError("bad_output", { started: true, status: res.status });
  }
  const error = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
  if (typeof error === "string") {
    if (res.status === 200 && NO_RESULTS_RE.test(error)) {
      log("upstream_call", { ...at, outcome: "no_results" });
      return null;
    }
    log("upstream_call", { ...at, outcome: "error_message" }, "warn");
    throw new SerpapiError("bad_output", { started: true, status: res.status });
  }
  if (res.status !== 200) {
    log("upstream_call", { ...at, outcome: "bad_status" }, "warn");
    throw new SerpapiError("bad_output", { started: true, status: res.status });
  }
  log("upstream_call", { ...at, outcome: "ok" });
  return json;
}

// ---------- park -> place ----------

const PlaceCandidate = z.object({
  title: z.string().min(1).max(300),
  data_id: z.string().regex(DATA_ID_RE),
  gps_coordinates: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  type: z.union([z.string(), z.array(z.string())]).optional(),
  types: z.array(z.string()).optional(),
  reviews: z.number().int().min(0).optional(),
});
type PlaceCandidate = z.infer<typeof PlaceCandidate>;

const MapsBody = z.object({ place_results: z.unknown().optional(), local_results: z.array(z.unknown()).optional() });

/** Every well-formed place in a google_maps answer (a single `place_results` or the `local_results` list). */
export function parsePlaces(json: unknown): PlaceCandidate[] {
  if (json === null) return [];
  const body = MapsBody.parse(json);
  const raw = [...(body.place_results !== undefined ? [body.place_results] : []), ...(body.local_results ?? [])];
  return raw.flatMap((r) => {
    const p = PlaceCandidate.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

/** Words that say what kind of place it is, not which one ("Connemara Meadow Preserve" = "Connemara Meadow Nature Preserve"). */
const PLACE_FILLER = new Set([
  "park", "parks", "preserve", "reserve", "nature", "natural", "area", "city", "municipal", "county", "state",
  "recreation", "rec", "center", "centre", "the", "of", "and", "at", "a", "tx", "texas",
]);

/** Lower-case words of a place name, accents and punctuation removed, "&" read as "and". */
export function nameWords(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/** The words that name THIS place (filler removed; all words when the name is only filler, e.g. "City Park"). */
function coreWords(name: string): Set<string> {
  const all = nameWords(name);
  const core = all.filter((w) => !PLACE_FILLER.has(w));
  return new Set(core.length > 0 ? core : all);
}

/** How alike two place names are: shared core words / all core words (Jaccard), 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const A = coreWords(a);
  const B = coreWords(b);
  if (A.size === 0 || B.size === 0) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

/** Google place types that are a park (not a court, a field or a shop inside one). */
const PARK_TYPE_RE = /\b(park|preserve|reserve|nature|garden|gardens|hiking|trail|greenway|greenbelt|wildlife|arboretum|recreation|refuge|forest|lake|playground|open space)\b/i;
/** Types of a place INSIDE a park; a candidate whose types are only these is never the park. */
const PART_TYPE_RE = /\b(court|field|pool|parking|restroom|pavilion|stadium|school|store|restaurant)\b/i;

export function placeTypes(p: Pick<PlaceCandidate, "type" | "types">): string[] {
  const t = Array.isArray(p.type) ? p.type : p.type ? [p.type] : [];
  return [...new Set([...t, ...(p.types ?? [])])];
}

export function isParkLike(types: readonly string[]): boolean {
  return types.some((t) => PARK_TYPE_RE.test(t) && !PART_TYPE_RE.test(t));
}

/** A name at least this alike counts as the same place. "Celebration Park Tennis Courts" vs "Celebration Park" is 1/3. */
export const MIN_NAME_SIMILARITY = 0.6;
/** The place must be within this distance of our OpenStreetMap centre ... */
export const MATCH_RADIUS_M = 1_000;
/** ... or this far when its core name is exactly ours (a big park's pin can sit 1-2 km from its centre). */
export const EXACT_NAME_RADIUS_M = 2_500;

export type PlaceMatch = { dataId: string; title: string; distanceM: number; similarity: number };
export type NoMatchReason = "no_results" | "name" | "distance" | "type";
export type MatchResult = { ok: true; place: PlaceMatch } | { ok: false; why: NoMatchReason };

/**
 * The google_maps result that really is our park: name similarity >= 0.6, a park-like type, and within
 * 1 km of our centre (2.5 km for an exact name). Best = most alike name, then most reviews, then nearest.
 * No candidate passes -> no match, and the reason of the closest miss.
 */
export function matchPlace(park: { name: string } & LatLng, candidates: readonly PlaceCandidate[]): MatchResult {
  if (candidates.length === 0) return { ok: false, why: "no_results" };
  let why: NoMatchReason = "name";
  const ok: (PlaceMatch & { reviews: number })[] = [];
  for (const c of candidates) {
    const similarity = nameSimilarity(park.name, c.title);
    const d = distanceM(park, { lat: c.gps_coordinates.latitude, lng: c.gps_coordinates.longitude });
    if (similarity < MIN_NAME_SIMILARITY) continue;
    if (d > (similarity === 1 ? EXACT_NAME_RADIUS_M : MATCH_RADIUS_M)) {
      why = "distance";
      continue;
    }
    if (!isParkLike(placeTypes(c))) {
      if (why !== "distance") why = "type";
      continue;
    }
    ok.push({ dataId: c.data_id, title: c.title.slice(0, 120), distanceM: Math.round(d), similarity, reviews: c.reviews ?? 0 });
  }
  if (ok.length === 0) return { ok: false, why };
  ok.sort((a, b) => b.similarity - a.similarity || b.reviews - a.reviews || a.distanceM - b.distanceM);
  const { reviews: _r, ...place } = ok[0];
  void _r;
  return { ok: true, place };
}

// ---------- counting mentions ----------

const Review = z.object({
  snippet: z.string().optional(),
  extracted_snippet: z.object({ original: z.string().optional() }).partial().optional(),
  iso_date: z.string().optional(),
  iso_date_of_last_edit: z.string().optional(),
});
const ReviewsBody = z.object({
  reviews: z.array(z.unknown()).optional(),
  serpapi_pagination: z.object({ next_page_token: z.string().optional() }).optional(),
});

/** Reviews count for this many months back from "now" (SPEC F8: the last 24 months). */
export const WINDOW_MONTHS = 24;

/** The same moment WINDOW_MONTHS earlier (UTC calendar; day clamped to the month's length). */
export function windowStartMs(nowMs: number, months = WINDOW_MONTHS): number {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

export type MentionCount = {
  /** Reviews on the page whose own text names the thing AND were written (or last edited) in the window. */
  count: number;
  /** True when more matching reviews in the window may exist past this page (so the count is a minimum). */
  atLeast: boolean;
  /** Newest of the counted reviews (ms), null when none. */
  newestMs: number | null;
};

/**
 * Count the reviews that mention a thing, from one google_maps_reviews page (newest first, by last edit).
 * A review counts only when its OWN text matches `mentions` (Google's text filter is not trusted alone)
 * and its date (last edit, else first posted) is inside the 24-month window and not in the future.
 * The text is only tested here; it is never returned, stored, logged or sent anywhere.
 * `atLeast`: the page was full, a next page exists, and its oldest review is still inside the window.
 */
export function countMentions(json: unknown, mentions: RegExp, nowMs: number): MentionCount {
  if (json === null) return { count: 0, atLeast: false, newestMs: null };
  const body = ReviewsBody.parse(json);
  const from = windowStartMs(nowMs);
  const latest = nowMs + 24 * 3600 * 1000;
  let count = 0;
  let newestMs: number | null = null;
  let oldestMs = Infinity;
  const raw = body.reviews ?? [];
  for (const r of raw) {
    const p = Review.safeParse(r);
    if (!p.success) continue;
    const at = Date.parse(p.data.iso_date_of_last_edit ?? p.data.iso_date ?? "");
    if (!Number.isFinite(at)) continue;
    oldestMs = Math.min(oldestMs, at);
    const text = p.data.snippet ?? p.data.extracted_snippet?.original ?? "";
    if (at < from || at > latest || !mentions.test(text)) continue;
    count++;
    newestMs = newestMs === null ? at : Math.max(newestMs, at);
  }
  const more = Boolean(body.serpapi_pagination?.next_page_token) && raw.length >= REVIEWS_PAGE;
  return { count, atLeast: more && oldestMs >= from, newestMs };
}
