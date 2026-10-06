/**
 * In-process pre-limiter (SEC-1-02, SEC-2-01): token buckets per client key, in memory, in front of every
 * page and route that touches the shared store (src/proxy.ts). Over any bucket it answers 429 without
 * any Upstash command.
 *
 * Three buckets per client (all must have room; nothing is taken when one is short):
 * - `api`: /api/* requests. A burst of 40, then 4/s (PRELIMIT_BURST, PRELIMIT_PER_SEC): floods only.
 * - `page`: `/` and `/pass/*`. A burst of 20, then 6/min = 0.1/s (PRELIMIT_PAGE_*). A person reading
 *   passes never needs more.
 * - `cost`: store-cost units. A burst of 60, then 45/hour (PRELIMIT_COST_*). Each request is charged
 *   `requestCost()`: at least the Upstash commands of its cheap path (a cache hit or a refusal), measured
 *   in tests/unit/store-cost.test.ts with the real UpstashStore and a command-counting stand-in.
 * An IPv6 client also fills one bucket per /48 with PRELIMIT_NET48_FACTOR x the burst and the refill,
 * so a routed /48 (65,536 /64s) gets 2 clients' worth, not 65,536.
 *
 * ## Per-month math (SEC-2-01): one IPv4 address, one instance, a 31-day month (744 hours)
 * Measured (store-cost.test.ts): a new pass 103 commands (Connemara: 25 iNaturalist taxa; at most 30
 * are looked up), the same pass again <= 4, a refusal <= 1; an uncached park search 13, a cached one 3;
 * a saved-pass page 1 GET, then 0 while memoized; an impossible pass id 0.
 * - Cheap paths, through the cost bucket: <= 60 + 45 x 744 = 33,540 commands.
 * - Expensive paths, beyond what the cost bucket already charged, bounded by the per-IP daily shares
 *   the shared store keeps (PASS_PER_IP_PER_DAY 20, PARKS_PER_IP_PER_DAY 60):
 *   31 x (20 x EXTRA.newPass 120 + 60 x EXTRA.search 20) = 111,600 commands.
 * - The monthly budget counter adds 1 command per 50: x 1.02.
 * - Total <= (33,540 + 111,600) x 1.02 = 148,043 = 29.6% of the free 500,000 (`monthlyCommandBound`).
 * Instance-wide, whatever the traffic or the number of addresses: the home page's example check is 4 GETs
 * per 5 min (src/app/page.tsx; every 30 s only while an example is being made) and the example pass reads
 * are memoized 30 min (./pass-read.ts): <= 4 x 8,928 + 4 x 1,488 = 41,664 commands (8.3%).
 * Limits of this bound: it is per instance (several Vercel instances each have their own buckets; the
 * README's optional Vercel Firewall rule is the cross-instance backstop), and an IPv6 /48 gets 2x. At 95%
 * of UPSTASH_MONTHLY_COMMANDS the app rests read-only instead of failing at 100% (./budget.ts).
 */
import { plausiblePassId } from "./pass-read";

type Bucket = { tokens: number; at: number };
type Holder = { buckets: Map<string, Bucket> };
const HOLDER = Symbol.for("grass-pass.prelimit");
export const PRELIMIT_MAX_KEYS = 20_000;
/** An IPv6 /48 shares one bucket of this many clients' worth (burst and refill). */
export const PRELIMIT_NET48_FACTOR = 2;

/**
 * Cost units per request: at least the Upstash commands of its cheap path (cache hit or refusal),
 * measured in tests/unit/limits-r2.test.ts. A pass id that can't exist costs 0 (no store read).
 */
export const COSTS = { home: 0, passPage: 1, apiPass: 4, apiParks: 4, apiOther: 1 } as const;
/**
 * Upper bounds of the extra commands of the expensive paths, beyond COSTS (measured 99 and 9; margins for
 * 30 taxa, and for the Nominatim and saved-index fallbacks of a search).
 */
export const EXTRA = { newPass: 120, search: 20 } as const;
/** The monthly budget counter costs one command per BUDGET_FLUSH_EVERY (50). */
export const FLUSH_OVERHEAD = 51 / 50;

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
export function requestCost(pathname: string, now: number): { kind: RequestKind; cost: number } {
  if (pathname === "/api/pass") return { kind: "api", cost: COSTS.apiPass };
  if (pathname === "/api/parks") return { kind: "api", cost: COSTS.apiParks };
  if (pathname.startsWith("/api/")) return { kind: "api", cost: COSTS.apiOther };
  const m = /^\/pass\/([^/]+)(?:\/|$)/.exec(pathname);
  if (m) {
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return { kind: "page", cost: 0 }; // the page answers 404/400 without a store read
    }
    return { kind: "page", cost: plausiblePassId(id, now) ? COSTS.passPage : 0 };
  }
  return { kind: "page", cost: COSTS.home };
}

/**
 * The proxy's check for one request: the request bucket of its kind (api or page) plus the cost bucket,
 * for the client key and, for IPv6, its /48 (`net48`, from networkKey()).
 */
export function preLimitRequest(input: { key: string; net48: string | null; pathname: string; now: number; cfg: PreLimitConfig }): PreLimitResult {
  const { key, net48, pathname, now, cfg } = input;
  const { kind, cost } = requestCost(pathname, now);
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
