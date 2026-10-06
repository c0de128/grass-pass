/**
 * In-process pre-limiter (SEC-1-02, SEC-2-01): token buckets per client key, in memory, in front of every
 * page and route that touches the shared store (src/proxy.ts). Over any bucket it answers 429 without
 * any Upstash command.
 *
 * Three buckets per client (all must have room; nothing is taken when one is short):
 * - `api`: /api/* requests. A burst of 40, then 4/s (PRELIMIT_BURST, PRELIMIT_PER_SEC): floods only.
 * - `page`: `/` and `/pass/*`. A burst of 120, then 2/s (PRELIMIT_PAGE_*): floods only (SEC-3-01: the
 *   old 20 + 6/min locked out a normal visitor by the 6th page view, because Next `<Link>` RSC
 *   prefetches go through the proxy too; links to these pages now use prefetch={false}). It adds nothing
 *   to the monthly bound below: only the `cost` bucket does.
 * - `cost`: store-cost units. A burst of 60, then 45/hour (PRELIMIT_COST_*). Each request is charged
 *   `requestCost()`: at least the Upstash commands of its cheap path (a cache hit or a refusal), measured
 *   in tests/unit/store-cost.test.ts with the real UpstashStore and a command-counting stand-in.
 * An IPv6 client also fills one bucket per /48 with PRELIMIT_NET48_FACTOR x the burst and the refill,
 * so a routed /48 (65,536 /64s) gets 2 clients' worth, not 65,536.
 *
 * ## Per-month math (SEC-2-01, re-measured for SEC-3-02): one IPv4 address, one instance, a 31-day month
 * Measured 2026-10-06 (store-cost.test.ts, the real UpstashStore against a command-counting stand-in;
 * STORE_COST_REPORT=1 prints them): a new pass 111 commands with the budget bookkeeping (Connemara: 25
 * iNaturalist taxa; at most 30 are looked up), the same pass again 3, a per-IP refusal 0-1; a CACHED
 * FAILURE (not a park, too heavy, too slow, every Overpass mirror resting) 4, because one MGET reads every
 * features cache and breaker before anything is reserved (SEC-3-02; before: 9 and 14-15); an uncached park
 * search 15 with bookkeeping, a cached one 3; a saved-pass page 1 GET, then 0 while memoized; an impossible
 * pass id 0. So COSTS.apiPass = 4 covered every cheap /api/pass path.
 * Accounts (re-measured 2026-10-06): a new pass 113 (+ the account count and the report lookup), a signed-out
 * new-pass request 2, an account over its 2 a day 5 the first time (then 4 while the refusal is remembered), so
 * COSTS.apiPass = 5; a report 4 (a repeat 3, a not-safe that hides the item 4-5) = COSTS.apiReport 5; a signed-in
 * pass page 2 (the pass + the report counts) = passPage + passStats; a sign-in attempt 1.
 * Round 4 (re-measured 2026-10-06, SEC-4-07): a new pass that ALSO starts a fresh Lucky Finds lookup (SerpApi:
 * place + 3 review searches, each with its caps, breaker and caches): Celebration 55, Connemara (25 taxa, the
 * biggest test park) 118; a judge over its 3 per connection 5; a judge report (logged only) 4; GET
 * /api/judge-passes 1; GET /api/me 0. EXTRA.newPass is now 125 (was 120): 125 + COSTS.apiPass 5 = 130 leaves
 * 12 commands of room over the 118 measured, for parks with up to 30 taxa.
 * - Cheap paths, through the cost bucket: <= 60 + 45 x 744 = 33,540 commands.
 * - Expensive paths, beyond what the cost bucket already charged, bounded by the per-IP daily shares
 *   the shared store keeps (PASS_PER_IP_PER_DAY 20, PARKS_PER_IP_PER_DAY 60). Only a path that started
 *   an upstream call (and so spent its daily share) can be expensive:
 *   31 x (20 x EXTRA.newPass 125 + 60 x EXTRA.search 20) = 114,700 commands.
 * - The shared budget counters add 1 command per 10 (SEC-3-04): x 1.1.
 * - Total <= (33,540 + 114,700) x 1.1 = 163,064 = 32.6% of the free 500,000 (`monthlyCommandBound`).
 * Instance-wide, whatever the traffic or the number of addresses: the home page's example check is 4 GETs
 * per 5 min (src/app/page.tsx; every 30 s only while an example is being made), readyExample() (the
 * example offered after a map-data failure) is 4 GETs per 5 min (SEC-3-02), the example pass reads are
 * memoized 30 min (./pass-read.ts), and a new instance reads the counters once (1 MGET):
 * <= 4 x 8,928 x 2 + 4 x 1,488 = 77,376 commands (15.5%).
 * Across many addresses (SEC-3-03), the daily pace in ./budget.ts stops new passes and uncached searches
 * once a Chicago day has used 90% / days-in-month of the monthly budget (about 14,500 in October), so the
 * month cannot be used up in a few days. Limits of this bound: it is per instance (several Vercel
 * instances each have their own buckets; the daily pace and resting are shared through the store), and
 * an IPv6 /48 gets 2x. At 90% of UPSTASH_MONTHLY_COMMANDS the app rests read-only instead of failing at
 * 100% (./budget.ts).
 */
import { plausiblePassId } from "./pass-read";

type Bucket = { tokens: number; at: number };
type Holder = { buckets: Map<string, Bucket> };
const HOLDER = Symbol.for("grass-pass.prelimit");
export const PRELIMIT_MAX_KEYS = 20_000;
/** An IPv6 /48 shares one bucket of this many clients' worth (burst and refill). */
export const PRELIMIT_NET48_FACTOR = 2;

/**
 * Cost units per request: at least the Upstash commands of its cheap path (cache hit, refusal or cached
 * failure), measured in tests/unit/store-cost.test.ts. A pass id that can't exist costs 0 (no store read).
 */
export const COSTS = {
  home: 0,
  /** A saved pass page (screen or print): the pass read. */
  passPage: 1,
  /**
   * Accounts: a signed-in visitor's screen pass also reads the item report counts (1 HGETALL per park per
   * STATS_MEMO_MS per instance). Charged when a session cookie is present (an invalid one reads nothing).
   */
  passStats: 1,
  /**
   * Accounts: 5 (was 4). An account over its 2 a day is refused after 5 commands the first time (burst,
   * latest, per-IP minute, features MGET, the account reserve), then 4 while the refusal is remembered.
   */
  apiPass: 5,
  apiParks: 4,
  /** POST /api/report: 2 rate-limit EVALs + the pass read + the report EVAL + the hidden-item counter. */
  apiReport: 5,
  /** /api/auth/signin|callback/*: 1 rate-limit EVAL. The session and CSRF reads cost 0 (no store command). */
  apiAuth: 1,
  /** GET /api/me (SEC-4-04): the header's "who is signed in", cookie only: 0 store commands. */
  apiMe: 0,
  /** GET /api/judge-passes (SEC-4-02): 1 MGET of the judge pool counters. */
  apiJudgePasses: 1,
  apiOther: 1,
  /** A server action (sign in / sign out) posted to a page: the judge sign-in's rate-limit EVAL. */
  action: 1,
} as const;
/**
 * Upper bounds of the extra commands of the expensive paths, beyond COSTS (measured: a new pass with a fresh
 * Lucky Finds lookup 118 in all, SEC-4-07; a search 15; margins for 30 taxa, and for the Nominatim and
 * saved-index fallbacks of a search).
 */
export const EXTRA = { newPass: 125, search: 20 } as const;
/** The shared budget counters cost one command per BUDGET_FLUSH_EVERY (10, SEC-3-04). */
export const FLUSH_OVERHEAD = 11 / 10;

function buckets(): Map<string, Bucket> {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (g[HOLDER] ??= { buckets: new Map() }).buckets;
}

export type PreLimitResult = { ok: true } | { ok: false; retryAfter: number };
type Spec = { burst: number; perSec: number };

/** Tokens in a bucket at `now` (refilled, capped at the burst); a new bucket starts full. */
function level(prev: Bucket | undefined, spec: Spec, now: number): number {
  if (!prev) return spec.burst;
  return Math.min(spec.burst, prev.tokens + Math.max(0, ((now - prev.at) / 1000) * spec.perSec));
}

function store(m: Map<string, Bucket>, key: string, b: Bucket): void {
  m.delete(key); // re-insert: the Map's order is then least recently seen first
  m.set(key, b);
  while (m.size > PRELIMIT_MAX_KEYS) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}

/** Take `cost` from every bucket, or from none when one is short (then the longest wait). */
export function takeAll(wants: readonly { key: string; spec: Spec; cost: number }[], now: number): PreLimitResult {
  const m = buckets();
  const levels = wants.map((w) => level(m.get(w.key), w.spec, now));
  const short = wants.map((w, i) => (levels[i] >= w.cost ? 0 : Math.max(1, Math.ceil((w.cost - levels[i]) / w.spec.perSec))));
  const wait = Math.max(0, ...short);
  wants.forEach((w, i) => store(m, w.key, { tokens: wait > 0 ? levels[i] : levels[i] - w.cost, at: now }));
  return wait > 0 ? { ok: false, retryAfter: wait } : { ok: true };
}

/** One bucket of `cfg` per key (the /api request bucket; kept for older callers and tests). */
export function preLimit(key: string, now: number, cfg: { preLimitBurst: number; preLimitPerSec: number }): PreLimitResult {
  return takeAll([{ key, spec: { burst: cfg.preLimitBurst, perSec: cfg.preLimitPerSec }, cost: 1 }], now);
}

export type PreLimitConfig = {
  preLimitBurst: number;
  preLimitPerSec: number;
  preLimitPageBurst: number;
  preLimitPagePerMin: number;
  preLimitCostBurst: number;
  preLimitCostPerHour: number;
};

export type RequestKind = "api" | "page";

/** What a path is and what it costs (see COSTS). */
export function requestCost(pathname: string, now: number, opts: { action?: boolean; session?: boolean } = {}): { kind: RequestKind; cost: number } {
  if (pathname === "/api/pass") return { kind: "api", cost: COSTS.apiPass };
  if (pathname === "/api/parks") return { kind: "api", cost: COSTS.apiParks };
  if (pathname === "/api/report") return { kind: "api", cost: COSTS.apiReport };
  if (pathname === "/api/me") return { kind: "api", cost: COSTS.apiMe };
  if (pathname === "/api/judge-passes") return { kind: "api", cost: COSTS.apiJudgePasses };
  // Only an OAuth start or callback spends a store command; the session/CSRF reads (header, every page) don't.
  if (pathname.startsWith("/api/auth/")) return { kind: "api", cost: /^\/api\/auth\/(signin|callback)\//.test(pathname) ? COSTS.apiAuth : 0 };
  if (pathname.startsWith("/api/")) return { kind: "api", cost: COSTS.apiOther };
  const extra = opts.action ? COSTS.action : 0;
  const m = /^\/pass\/([^/]+)(\/.*)?$/.exec(pathname);
  if (m) {
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return { kind: "page", cost: extra }; // the page answers 404/400 without a store read
    }
    const screen = m[2] === undefined || m[2] === "/";
    return { kind: "page", cost: (plausiblePassId(id, now) ? COSTS.passPage + (screen && opts.session ? COSTS.passStats : 0) : 0) + extra };
  }
  return { kind: "page", cost: COSTS.home + extra };
}

/**
 * The proxy's check for one request: the request bucket of its kind (api or page) plus the cost bucket,
 * for the client key and, for IPv6, its /48 (`net48`, from networkKey()).
 */
export function preLimitRequest(input: {
  key: string;
  net48: string | null;
  pathname: string;
  now: number;
  cfg: PreLimitConfig;
  action?: boolean;
  session?: boolean;
}): PreLimitResult {
  const { key, net48, pathname, now, cfg } = input;
  const { kind, cost } = requestCost(pathname, now, { action: input.action, session: input.session });
  const req: Spec =
    kind === "api" ? { burst: cfg.preLimitBurst, perSec: cfg.preLimitPerSec } : { burst: cfg.preLimitPageBurst, perSec: cfg.preLimitPagePerMin / 60 };
  const costSpec: Spec = { burst: cfg.preLimitCostBurst, perSec: cfg.preLimitCostPerHour / 3600 };
  const scale = (s: Spec): Spec => ({ burst: s.burst * PRELIMIT_NET48_FACTOR, perSec: s.perSec * PRELIMIT_NET48_FACTOR });
  // The /api bucket keeps its old key (no prefix) so a deploy doesn't change who shares a bucket.
  const reqKey = kind === "api" ? key : `page|${key}`;
  const wants = [{ key: reqKey, spec: req, cost: 1 }];
  if (cost > 0) wants.push({ key: `cost|${key}`, spec: costSpec, cost });
  if (net48) {
    wants.push({ key: `${kind}|${net48}`, spec: scale(req), cost: 1 });
    if (cost > 0) wants.push({ key: `cost|${net48}`, spec: scale(costSpec), cost });
  }
  return takeAll(wants, now);
}

/**
 * The monthly bound above as a function of the config (tests assert it stays under ~30% of the free
 * plan with the defaults). Per IPv4 address, per instance.
 */
export function monthlyCommandBound(
  cfg: Pick<PreLimitConfig, "preLimitCostBurst" | "preLimitCostPerHour">,
  shares: { passPerIpPerDay: number; parksPerIpPerDay: number },
  days = 31,
): number {
  const cheap = cfg.preLimitCostBurst + cfg.preLimitCostPerHour * days * 24;
  const expensive = days * (shares.passPerIpPerDay * EXTRA.newPass + shares.parksPerIpPerDay * EXTRA.search);
  return Math.ceil((cheap + expensive) * FLUSH_OVERHEAD);
}

/** Tests: forget every bucket. */
export function resetPreLimit(): void {
  buckets().clear();
}
