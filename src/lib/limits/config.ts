/**
 * Limits and caps from env (SPEC §5.5, §7). Bad or missing values fall back to the
 * spec defaults; nothing here is a secret.
 */
type Env = Record<string, string | undefined>;

/** Parse a positive integer env var, falling back to `fallback`. */
export function intFromEnv(value: string | undefined, fallback: number): number {
  const v = value?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Like intFromEnv, but an explicit "0" means 0 (switched off). For caps where 0 is a real setting: before this,
 * SERPAPI_DAILY_CAP=0 silently became the default 12 and spent real searches (found by builder R1, audit round 4).
 */
export function capFromEnv(value: string | undefined, fallback: number): number {
  return value?.trim() === "0" ? 0 : intFromEnv(value, fallback);
}

export type LimitsConfig = {
  /**
   * Model calls per Chicago day, all users together (each pass makes 2-4 calls: 1-3 for the clues plus 1 for the trip tips; each call counts, so 400 is about 100-200 passes). SEC-5-03: at 400
   * calls a day that is about $0.28 typical ($0.0004-0.0009 a call) and at most about $0.55 (a ~4,000-token prompt +
   * 1,200 max output at $0.18/$0.50 per million). callModel may send one counted call twice on a network error or
   * 5xx (usually unbilled). The $10 prepaid DigitalOcean credit is the hard ceiling, not this cap.
   * SEC-5-02: AI_DAILY_CAP=0 switches new model passes off ("paused").
   */
  aiDailyCap: number;
  passPerIpPerMin: number;
  passPerIpPerDay: number;
  parksPerIpPerMin: number;
  /** Uncached park searches (Nominatim + Overpass) per IP per day. */
  parksPerIpPerDay: number;
  /** Uncached park searches per day, all users together. */
  parksDailyCap: number;
  serpapiDailyCap: number;
  serpapiMonthlyCap: number;
  /**
   * Percent of AI_DAILY_CAP kept for the example parks and the server pre-warm (SEC-1-05), so a flood of
   * new passes for other parks cannot use the whole day. 0 switches the reserve off; max 50.
   */
  aiReservePct: number;
  /** In-process pre-limiter (SEC-1-02): burst size and refill per second, per IP, per instance (/api/* requests). */
  preLimitBurst: number;
  preLimitPerSec: number;
  /**
   * Page requests (`/`, `/pass/*`) per IP: a burst, then this many per minute. SEC-3-01: a flood guard
   * only (120, then 120/min = 2/s): a real browser also sends RSC prefetches and a school or phone
   * carrier shares one address. The store-cost bucket below carries the monthly math.
   */
  preLimitPageBurst: number;
  preLimitPagePerMin: number;
  /**
   * SEC-2-01: store-cost units per IP: a burst, then this many per hour. A request is charged about the
   * shared-store commands it can cause (see ./prelimit.ts `requestCost`), so the steady rate bounds the
   * monthly Upstash commands one address can spend (math in ./prelimit.ts).
   */
  preLimitCostBurst: number;
  preLimitCostPerHour: number;
};

export const LIMIT_DEFAULTS: LimitsConfig = {
  aiDailyCap: 400,
  passPerIpPerMin: 3,
  passPerIpPerDay: 20,
  parksPerIpPerMin: 10,
  parksPerIpPerDay: 60,
  parksDailyCap: 2000,
  serpapiDailyCap: 12,
  serpapiMonthlyCap: 200,
  aiReservePct: 10,
  preLimitBurst: 40,
  preLimitPerSec: 4,
  preLimitPageBurst: 120,
  preLimitPagePerMin: 120,
  preLimitCostBurst: 60,
  preLimitCostPerHour: 45,
};

/** SerpApi free plan is 250 searches/month; never configure above it. */
export const SERPAPI_FREE_MONTHLY = 250;

export function limitsConfig(env: Env = process.env): LimitsConfig {
  const d = LIMIT_DEFAULTS;
  return {
    aiDailyCap: capFromEnv(env.AI_DAILY_CAP, d.aiDailyCap),
    passPerIpPerMin: intFromEnv(env.PASS_PER_IP_PER_MIN, d.passPerIpPerMin),
    passPerIpPerDay: intFromEnv(env.PASS_PER_IP_PER_DAY, d.passPerIpPerDay),
    parksPerIpPerMin: intFromEnv(env.PARKS_PER_IP_PER_MIN, d.parksPerIpPerMin),
    parksPerIpPerDay: intFromEnv(env.PARKS_PER_IP_PER_DAY, d.parksPerIpPerDay),
    parksDailyCap: intFromEnv(env.PARKS_DAILY_CAP, d.parksDailyCap),
    serpapiDailyCap: capFromEnv(env.SERPAPI_DAILY_CAP, d.serpapiDailyCap),
    serpapiMonthlyCap: Math.min(capFromEnv(env.SERPAPI_MONTHLY_CAP, d.serpapiMonthlyCap), SERPAPI_FREE_MONTHLY),
    aiReservePct: env.AI_RESERVE_PCT?.trim() === "0" ? 0 : Math.min(intFromEnv(env.AI_RESERVE_PCT, d.aiReservePct), 50),
    preLimitBurst: intFromEnv(env.PRELIMIT_BURST, d.preLimitBurst),
    preLimitPerSec: intFromEnv(env.PRELIMIT_PER_SEC, d.preLimitPerSec),
    preLimitPageBurst: intFromEnv(env.PRELIMIT_PAGE_BURST, d.preLimitPageBurst),
    preLimitPagePerMin: intFromEnv(env.PRELIMIT_PAGE_PER_MIN, d.preLimitPagePerMin),
    preLimitCostBurst: intFromEnv(env.PRELIMIT_COST_BURST, d.preLimitCostBurst),
    preLimitCostPerHour: intFromEnv(env.PRELIMIT_COST_PER_HOUR, d.preLimitCostPerHour),
  };
}

/**
 * The AI_DAILY_CAP a request may use: the whole cap for the example parks and the server pre-warm,
 * the cap minus the reserved slice for everything else (SEC-1-05). At least 1, unless the cap is 0 (switched off).
 */
export function aiCapFor(cfg: Pick<LimitsConfig, "aiDailyCap" | "aiReservePct">, reserved: boolean): number {
  if (cfg.aiDailyCap <= 0) return 0;
  if (reserved) return cfg.aiDailyCap;
  return Math.max(1, cfg.aiDailyCap - Math.ceil((cfg.aiDailyCap * cfg.aiReservePct) / 100));
}
