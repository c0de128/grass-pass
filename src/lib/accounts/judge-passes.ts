/**
 * SEC-4-02: the judge demo's pass pool. All judge sign-ins together may start JUDGE_DEMO_DAILY_CAP new passes
 * per Chicago day (default 60), and one connection (client IP; an IPv6 /48 2x) at most
 * JUDGE_PASSES_PER_IP_PER_DAY (3) of them. Reserved in src/lib/pass/make.ts with the same quota counters
 * read here, so the "N judge passes left today" on the sign-in card is the real number (1 MGET).
 */
import "server-only";
import type { Store } from "@/lib/cache/store";
import { periodOf } from "@/lib/limits/quota";
import { judgeDailyCap, JUDGE_PASSES_PER_IP_PER_DAY, type JudgePassesLeft } from "./config";

type Env = Record<string, string | undefined>;

/** The quota name of the judge pool (counters `q:{judge-new:<day>}:all` and `...:k:<ip>`). */
export const JUDGE_QUOTA = "judge-new";

export function judgeQuotaKeys(ip: string, now: number): { all: string; ip: string } {
  const { id } = periodOf({ kind: "day" }, now);
  return { all: `q:{${JUDGE_QUOTA}:${id}}:all`, ip: `q:{${JUDGE_QUOTA}:${id}}:k:${ip}` };
}

/** Judge passes left today, for everyone and for this connection. A store failure throws (StoreError). */
export async function judgePassesLeft(store: Store, ip: string, now: number, env: Env = process.env): Promise<JudgePassesLeft> {
  const keys = judgeQuotaKeys(ip, now);
  const [all, mine] = store.getMany ? await store.getMany([keys.all, keys.ip]) : [await store.get(keys.all), await store.get(keys.ip)];
  const cap = judgeDailyCap(env);
  const used = Math.max(0, Number(all) || 0);
  const usedHere = Math.max(0, Number(mine) || 0);
  return {
    cap,
    perConnection: JUDGE_PASSES_PER_IP_PER_DAY,
    left: Math.max(0, cap - used),
    leftForYou: Math.max(0, JUDGE_PASSES_PER_IP_PER_DAY - usedHere),
  };
}
