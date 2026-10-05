import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createCachePair,
  createInflight,
  createJsonCache,
  getStore,
  MemoryStore,
  normalizeKey,
  resetStores,
  StoreError,
  upstashConfig,
  UpstashStore,
  WaiterAbortedError,
  type Store,
} from "@/lib/cache";
import { setLogSink } from "@/lib/log";

afterEach(() => resetStores());

describe("MemoryStore", () => {
  it("expires entries and keeps the original expiry on incr", async () => {
    let t = 0;
    const s = new MemoryStore({ now: () => t });
    await s.set("a", "1", 10);
    expect(await s.get("a")).toBe("1");
    expect(await s.incr("n", 1, 10)).toBe(1);
    t = 9_000;
    expect(await s.incr("n", 2, 10)).toBe(3);
    t = 10_000;
    expect(await s.get("a")).toBeNull();
    expect(await s.get("n")).toBeNull(); // the second incr did not extend the TTL
  });

  it("is bounded: the oldest entry is evicted", async () => {
    const s = new MemoryStore({ maxEntries: 2 });
    await s.set("a", "1", 60);
    await s.set("b", "2", 60);
    await s.set("c", "3", 60);
    expect(await s.get("a")).toBeNull();
    expect(s.size).toBe(2);
  });
});

describe("getStore", () => {
  it("uses separate bounded memory stores per namespace without Upstash", async () => {
    const pos = getStore("cache:parks", { env: {}, maxEntries: 3 });
    const neg = getStore("cache:parks-neg", { env: {}, maxEntries: 2 });
    expect(pos.kind).toBe("memory");
    expect(pos).not.toBe(neg);
    for (let i = 0; i < 10; i++) await neg.set(`junk${i}`, "x", 60);
    await pos.set("good", "y", 60);
    for (let i = 0; i < 10; i++) await neg.set(`junk-more${i}`, "x", 60);
    expect(await pos.get("good")).toBe("y"); // junk in the negative cache can't evict good results
  });

  it("uses Upstash when its REST URL and token are set", () => {
    const s = getStore("x", { env: { UPSTASH_REDIS_REST_URL: "https://good-cat-1.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" } });
    expect(s.kind).toBe("upstash");
  });

  it("logs a misconfiguration once and falls back to memory (token never sent)", () => {
    const lines: string[] = [];
    const restore = setLogSink((_, l) => lines.push(l));
    try {
      const s = getStore("x", { env: { UPSTASH_REDIS_REST_URL: "https://evil.test", UPSTASH_REDIS_REST_TOKEN: "secret-token-value" } });
      expect(s.kind).toBe("memory");
    } finally {
      restore();
    }
    expect(lines.join("\n")).not.toContain("secret-token-value");
  });
});

describe("upstashConfig (token goes only to https://*.upstash.io)", () => {
  it.each([
    [{}, null],
    [{ UPSTASH_REDIS_REST_URL: "https://a-b-1.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }, { ok: true, url: "https://a-b-1.upstash.io", token: "t" }],
    [{ KV_REST_API_URL: "https://a.upstash.io", KV_REST_API_TOKEN: "t" }, { ok: true, url: "https://a.upstash.io", token: "t" }],
  ])("accepts %j", (env, expected) => {
    expect(upstashConfig(env)).toEqual(expected);
  });

  it.each([
    "http://a.upstash.io",
    "https://a.upstash.io.evil.test",
    "https://upstash.io.evil.test",
    "https://a.upstash.io:8443",
    "https://u:p@a.upstash.io",
    "not a url",
  ])("refuses %s", (url) => {
    expect(upstashConfig({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: "t" })).toMatchObject({ ok: false });
  });

  it("needs both URL and token", () => {
    expect(upstashConfig({ UPSTASH_REDIS_REST_URL: "https://a.upstash.io" })).toMatchObject({ ok: false });
  });
});

describe("UpstashStore (REST protocol)", () => {
  function fake(results: unknown[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      const r = results[Math.min(calls.length - 1, results.length - 1)];
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r), { status: (r as { error?: string }).error ? 400 : 200 });
    };
    return { fetch, calls };
  }

  it("sends commands as JSON arrays with the bearer token, no redirects, and a prefix", async () => {
    const f = fake([{ result: "OK" }, { result: "v" }, { result: 4 }]);
    const s = new UpstashStore({ url: "https://a.upstash.io", token: "tok", fetch: f.fetch });
    await s.set("k", "v", 30);
    expect(await s.get("k")).toBe("v");
    expect(await s.incr("n", 1, 60)).toBe(4);
    expect(f.calls.map((c) => JSON.parse(String(c.init.body)))).toEqual([
      ["SET", "gp:k", "v", "EX", 30],
      ["GET", "gp:k"],
      ["EVAL", expect.stringContaining("INCRBY"), 1, "gp:n", 1, 60],
    ]);
    for (const c of f.calls) {
      expect(c.url).toBe("https://a.upstash.io");
      expect(c.init.redirect).toBe("error");
      expect(new Headers(c.init.headers).get("authorization")).toBe("Bearer tok");
    }
  });

  it("throws StoreError on network failure and on an error answer", async () => {
    const lines: string[] = [];
    const restore = setLogSink((_, l) => lines.push(l));
    try {
      const down = new UpstashStore({ url: "https://a.upstash.io", token: "tok", fetch: fake([new TypeError("fetch failed")]).fetch });
      await expect(down.get("k")).rejects.toBeInstanceOf(StoreError);
      const refused = new UpstashStore({ url: "https://a.upstash.io", token: "tok", fetch: fake([{ error: "WRONGPASS invalid password" }]).fetch });
      await expect(refused.incr("k", 1, 5)).rejects.toBeInstanceOf(StoreError);
    } finally {
      restore();
    }
    expect(lines.length).toBe(2);
    expect(lines.join("\n")).not.toContain("tok\"");
  });
});

describe("createJsonCache", () => {
  const schema = z.object({ name: z.string() });

  it("stores the value with the time it was stored, and reports its age", async () => {
    const store = new MemoryStore();
    const c = createJsonCache({ name: "t", schema, ttlSec: 60, store });
    await c.set("k", { name: "Connemara Meadow Preserve" }, { now: 1_000 });
    expect(await c.get("k", 31_000)).toEqual({ value: { name: "Connemara Meadow Preserve" }, storedAt: 1_000, ageSec: 30 });
    expect(await c.get("missing")).toBeNull();
  });

  it("treats entries that fail the schema as a miss", async () => {
    const store = new MemoryStore();
    await store.set("c:t:k", JSON.stringify({ v: { nope: 1 }, at: 1 }), 60);
    await store.set("c:t:j", "{not json", 60);
    const c = createJsonCache({ name: "t", schema, ttlSec: 60, store });
    const restore = setLogSink(() => {});
    try {
      expect(await c.get("k")).toBeNull();
      expect(await c.get("j")).toBeNull();
    } finally {
      restore();
    }
  });

  it("a store outage is a miss on read and is ignored on write", async () => {
    const broken: Store = {
      kind: "upstash",
      get: () => Promise.reject(new StoreError("down")),
      set: () => Promise.reject(new StoreError("down")),
      del: () => Promise.reject(new StoreError("down")),
      incr: () => Promise.reject(new StoreError("down")),
    };
    const c = createJsonCache({ name: "t", schema, ttlSec: 60, store: broken });
    const restore = setLogSink(() => {});
    try {
      await expect(c.set("k", { name: "x" })).resolves.toBeUndefined();
      await expect(c.get("k")).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it("createCachePair keeps a separate negative cache with a 15-minute default TTL", async () => {
    const pair = createCachePair({ name: "parks", schema, negativeSchema: z.object({ reason: z.string() }), ttlSec: 3600 });
    await pair.negative.set("q", { reason: "not found" }, { now: 0 });
    expect(pair.negative.name).toBe("parks-neg");
    expect(await pair.positive.get("q")).toBeNull();
    expect((await pair.negative.get("q"))?.value).toEqual({ reason: "not found" });
  });
});

describe("normalizeKey", () => {
  it("trims, lower-cases and collapses spaces", () => {
    expect(normalizeKey("  Allen   TX ")).toBe("allen tx");
  });
  it("caps long keys with a hash so different long inputs don't collide", () => {
    const a = normalizeKey("x".repeat(300) + "a");
    const b = normalizeKey("x".repeat(300) + "b");
    expect(a.length).toBeLessThanOrEqual(200);
    expect(a).not.toBe(b);
  });
});

describe("createInflight", () => {
  it("collapses identical concurrent calls into one", async () => {
    const f = createInflight<number>();
    let calls = 0;
    const factory = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return 42;
    };
    const [a, b] = await Promise.all([f.run("k", factory), f.run("k", factory)]);
    expect([a, b, calls, f.size]).toEqual([42, 42, 1, 0]);
  });

  it("aborts the shared call when every waiter leaves, unless pinned", async () => {
    const f = createInflight<string>();
    let sharedAborted = false;
    const ctrl = new AbortController();
    const p = f.run(
      "k",
      (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => {
            sharedAborted = true;
            resolve("aborted");
          });
        }),
      ctrl.signal,
    );
    await Promise.resolve(); // let the factory start
    await Promise.resolve();
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(WaiterAbortedError);
    expect(sharedAborted).toBe(true);
  });

  it("a pinned (paid) call keeps running after the client leaves and its signal is never aborted", async () => {
    const f = createInflight<string>();
    let sharedSignal!: AbortSignal;
    let finish!: (v: string) => void;
    const ctrl = new AbortController();
    const p = f.run(
      "k",
      (signal, _emit, pin) => {
        sharedSignal = signal;
        pin();
        return new Promise<string>((r) => (finish = r));
      },
      ctrl.signal,
    );
    await Promise.resolve();
    await Promise.resolve();
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(WaiterAbortedError);
    expect(sharedSignal.aborted).toBe(false);
    expect(f.has("k")).toBe(true); // a new request can still join it
    const joined = f.run("k", async () => "should not run");
    finish("done");
    await expect(joined).resolves.toBe("done");
  });

  it("forwards progress steps to every waiter, including late joiners", async () => {
    const f = createInflight<number, string>();
    const seenA: string[] = [];
    const seenB: string[] = [];
    let go!: () => void;
    const a = f.run(
      "k",
      async (_s, emit) => {
        emit("Reading the park map...");
        await new Promise<void>((r) => (go = r));
        return 1;
      },
      undefined,
      (s) => seenA.push(s),
    );
    await Promise.resolve();
    await Promise.resolve();
    const b = f.run("k", async () => 2, undefined, (s) => seenB.push(s));
    go();
    expect(await Promise.all([a, b])).toEqual([1, 1]);
    expect(seenA).toEqual(["Reading the park map..."]);
    expect(seenB).toEqual(["Reading the park map..."]);
  });
});
