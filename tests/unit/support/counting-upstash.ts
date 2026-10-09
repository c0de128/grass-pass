/**
 * SEC-2-01: a stand-in for the Upstash REST API that counts commands. It answers GET/SET/DEL and the
 * EVAL scripts of src/lib/cache/store.ts (and HGETALL for item reports) from a MemoryStore, so the app's real UpstashStore code
 * runs unchanged and every command it would send to Upstash is counted.
 */
import { FEEDBACK_SCRIPT, MemoryStore, REPORT_SCRIPT } from "@/lib/cache/store";

export const FAKE_UPSTASH_URL = "https://counting-test.upstash.io";
export const FAKE_UPSTASH_TOKEN = "counting-test-token-not-real"; // gitleaks:allow

export function countingUpstash() {
  const mem = new MemoryStore({ maxEntries: 1_000_000 });
  const counts = { total: 0, budget: 0, byCmd: new Map<string, number>() };
  /** Commands so far without the budget bookkeeping. */
  const work = () => counts.total - counts.budget;

  async function run(args: unknown[]): Promise<unknown> {
    const [cmd, ...rest] = args.map((a) => (typeof a === "number" ? a : String(a)));
    if (cmd === "GET") return mem.get(String(rest[0]));
    if (cmd === "MGET") return Promise.all(rest.map((k) => mem.get(String(k))));
    if (cmd === "SET") {
      await mem.set(String(rest[0]), String(rest[1]), Number(rest[3]));
      return "OK";
    }
    if (cmd === "HGETALL") {
      const h = await mem.hashGetAll(String(rest[0]));
      return Object.entries(h).flat();
    }
    if (cmd === "DEL") {
      await mem.del(String(rest[0]));
      return 1;
    }
    // Kevin's private feedback report only (one page: cursor 0 back at once).
    if (cmd === "SCAN") return ["0", await mem.scanKeys(String(rest[2]))];
    if (cmd === "EVAL") {
      const script = String(rest[0]);
      const n = Number(rest[1]);
      const keys = rest.slice(2, 2 + n).map(String);
      if (script === REPORT_SCRIPT) {
        const a = rest.slice(2 + n).map(String);
        const r = await mem.recordReport({
          dedupeKey: keys[0],
          hashKey: keys[1],
          unsafeKey: keys[2],
          dedupeTtlSec: Number(a[0]),
          field: a[1],
          unsafe: a[2] === "1",
          member: a[3],
          hideAt: Number(a[4]),
          hideField: a[5],
          day: Number(a[6]),
          cutoff: Number(a[7]),
          ttlSec: Number(a[8]),
          otherField: a[9] ?? "",
        });
        return [r.counted ? 1 : 0, r.unsafeAccounts, r.newlyHidden ? 1 : 0];
      }
      if (script === FEEDBACK_SCRIPT) {
        const a = rest.slice(2 + n).map(String);
        const r = await mem.recordFeedback({ hashKey: keys[0], field: a[0], value: a[1], cutoff: Number(a[2]), ttlSec: Number(a[3]) });
        return r.replaced ? 1 : 0;
      }
      const argv = rest.slice(2 + n).map(Number);
      if (script.startsWith("local v = redis.call('INCRBY'")) return mem.incr(keys[0], argv[0], argv[1]);
      // The budget flush (SEC-3-03/04): monthly + daily counters at once.
      if (script.startsWith("local m = redis.call('INCRBY'")) return [await mem.incr(keys[0], argv[0], argv[1]), await mem.incr(keys[1], argv[0], argv[2])];
      if (script.startsWith("local c = redis.call('INCRBY'")) {
        const r = await mem.rateHit(keys[0], keys[1], argv[0], argv[1], argv[2]);
        return [r.allowed ? 1 : 0, r.current, r.previous];
      }
      if (script.startsWith("local n = #KEYS")) {
        const r = await mem.reserve(keys, argv.slice(0, n), argv[n]);
        return r.failed > 0 ? [r.failed] : [0, ...r.counts];
      }
    }
    throw new Error(`counting-upstash: unsupported command ${String(cmd)}`);
  }

  /** Wrap another fetch: Upstash calls are answered and counted here, everything else goes to `next`. */
  function fetchWith(next: (input: string, init?: RequestInit) => Promise<Response>) {
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(FAKE_UPSTASH_URL)) return next(url, init);
      const args = JSON.parse(String(init?.body)) as unknown[];
      counts.total++;
      // SEC-3-04: the budget bookkeeping (the flush every 10 commands, the once-per-process counter read),
      // kept apart so a per-request count can leave it out (it is the FLUSH_OVERHEAD term of the math).
      if (String(args[0]) === "EVAL" && String(args[1]).startsWith("local m = redis.call('INCRBY'")) counts.budget++;
      if (String(args[0]) === "MGET" && String(args[1]).includes("meta:commands")) counts.budget++;
      // Command plus its first key, long hashes shortened (for debugging a count).
      const name = `${String(args[0]) === "EVAL" ? `EVAL:${String(args[1]).slice(0, 18)}` : String(args[0])} ${String(args[0]) === "EVAL" ? String(args[3]) : String(args[1])}`.replace(/[A-Za-z0-9_-]{20,}/g, "#");
      counts.byCmd.set(name, (counts.byCmd.get(name) ?? 0) + 1);
      return Response.json({ result: await run(args) });
    };
  }

  return { counts, work, fetchWith, mem };
}
