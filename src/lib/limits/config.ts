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

export type LimitsConfig = {
  /** Model calls per Chicago day, all users together (~$0.20 at 400). */
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
  /** In-process pre-limiter (SEC-1-02): burst size and refill per second, per IP, per instance. */
  preLimitBurst: number;
  preLimitPerSec: number;
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
};

/** SerpApi free plan is 250 searches/month; never configure above it. */
export const SERPAPI_FREE_MONTHLY = 250;

export function limitsConfig(env: Env = process.env): LimitsConfig {
  const d = LIMIT_DEFAULTS;
  return {
    aiDailyCap: intFromEnv(env.AI_DAILY_CAP, d.aiDailyCap),
    passPerIpPerMin: intFromEnv(env.PASS_PER_IP_PER_MIN, d.passPerIpPerMin),
    passPerIpPerDay: intFromEnv(env.PASS_PER_IP_PER_DAY, d.passPerIpPerDay),
    parksPerIpPerMin: intFromEnv(env.PARKS_PER_IP_PER_MIN, d.parksPerIpPerMin),
    parksPerIpPerDay: intFromEnv(env.PARKS_PER_IP_PER_DAY, d.parksPerIpPerDay),
    parksDailyCap: intFromEnv(env.PARKS_DAILY_CAP, d.parksDailyCap),
    serpapiDailyCap: intFromEnv(env.SERPAPI_DAILY_CAP, d.serpapiDailyCap),
    serpapiMonthlyCap: Math.min(intFromEnv(env.SERPAPI_MONTHLY_CAP, d.serpapiMonthlyCap), SERPAPI_FREE_MONTHLY),
    aiReservePct: env.AI_RESERVE_PCT?.trim() === "0" ? 0 : Math.min(intFromEnv(env.AI_RESERVE_PCT, d.aiReservePct), 50),
    preLimitBurst: intFromEnv(env.PRELIMIT_BURST, d.preLimitBurst),
    preLimitPerSec: intFromEnv(env.PRELIMIT_PER_SEC, d.preLimitPerSec),
  };
}

/**
 * The AI_DAILY_CAP a request may use: the whole cap for the example parks and the server pre-warm,
 * the cap minus the reserved slice for everything else (SEC-1-05). Always at least 1.
 */
export function aiCapFor(cfg: Pick<LimitsConfig, "aiDailyCap" | "aiReservePct">, reserved: boolean): number {
  if (reserved) return cfg.aiDailyCap;
  return Math.max(1, cfg.aiDailyCap - Math.ceil((cfg.aiDailyCap * cfg.aiReservePct) / 100));
}
