/**
 * Accounts (Kevin, 2026-10-06): the account key, the session cookie, which sign-in buttons exist, the
 * return-path allowlist, the sign-in gate on new passes, the 2-a-day account share (atomic, counted only when
 * a build really starts), the judge demo's shared cap, and the jwt/session callbacks (nothing but the key,
 * the provider and a first name).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authConfig, firstName, sessionToken } from "@/auth";
import { ACCOUNT_COPY, enabledOAuthProviders, judgeDailyCap, signInOptions } from "@/lib/accounts/config";
import { accountKey, judgeAccountKey, ACCOUNT_KEY_PATTERN } from "@/lib/accounts/key";
import { allowedReturnPath, safeRedirect } from "@/lib/accounts/redirect";
import { readAccount, sessionCookie } from "@/lib/accounts/session";
import { getStore, MemoryStore, resetStores } from "@/lib/cache/store";
import { reserveQuota } from "@/lib/limits";
import { setLogSink } from "@/lib/log";
import { resetPassMaking } from "@/lib/pass/make";
import { PassLineSchema, PassErrorResponseSchema, type PassLine } from "@/lib/pass/schema";
import { disableSavedOsmForTests, resetSavedOsm } from "@/lib/sources/osm-snapshot";
import { localDay } from "@/lib/time";
import * as route from "@/app/api/pass/route";
import { PARKS, passReplay } from "./support/pass-replay";
import { judgeCookie, newAccountCookie, TEST_AUTH_SECRET } from "./support/session";

const ENV = { AUTH_SECRET: TEST_AUTH_SECRET };

describe("account key (privacy by design)", () => {
  it("is an HMAC of provider + account id: stable, short, and different per provider, id and secret", () => {
    const a = accountKey("github", "12345", ENV);
    expect(a).toMatch(ACCOUNT_KEY_PATTERN);
    expect(accountKey("github", "12345", ENV)).toBe(a);
    expect(accountKey("google", "12345", ENV)).not.toBe(a);
    expect(accountKey("github", "12346", ENV)).not.toBe(a);
    expect(accountKey("github", "12345", { AUTH_SECRET: `${TEST_AUTH_SECRET}-other` })).not.toBe(a);
    // Nothing of the id is readable in the key.
    expect(a).not.toContain("12345");
    expect(a).not.toContain("github");
  });

  it("needs AUTH_SECRET, and refuses an empty account id", () => {
    expect(() => accountKey("github", "1", {})).toThrow(/AUTH_SECRET/);
    expect(() => accountKey("github", "  ", ENV)).toThrow();
  });

  it("every judge demo sign-in is the same account", () => {
    expect(judgeAccountKey(ENV)).toBe(accountKey("judge", "shared-demo", ENV));
  });
});

describe("jwt/session callbacks keep only the key, the provider and a first name", () => {
  it("drops email, avatar and everything else the provider sent", () => {
    const t = sessionToken(
      { provider: "github", providerAccountId: "777" },
      { name: "Kevin McKay", email: "someone@example.com", avatar_url: "https://avatars.example/x.png", login: "c0de128" },
    );
    expect(t).toEqual({ k: accountKey("github", "777"), p: "github", n: "Kevin" });
    expect(JSON.stringify(t)).not.toMatch(/example\.com|avatar|c0de128|McKay/);
  });

  it("Google: the given name; the judge: no name at all; unknown providers: no session", () => {
    expect(sessionToken({ provider: "google", providerAccountId: "g1" }, { given_name: "Ana", name: "Ana Ruiz", email: "a@example.com" })?.n).toBe("Ana");
    expect(sessionToken({ provider: "judge", providerAccountId: "anything" }, undefined)).toEqual({ k: judgeAccountKey(), p: "judge" });
    expect(sessionToken({ provider: "twitter", providerAccountId: "1" }, undefined)).toBeNull();
  });

  it("first names are cleaned and short; missing names stay missing", () => {
    expect(firstName({ name: "  Bob! Smith" }, "github")).toBe("Bob");
    expect(firstName({ name: "<script>x</script>" }, "github")).toBe("scriptxscript");
    expect(firstName({ name: null }, "github")).toBeUndefined();
    expect(firstName({ name: "x".repeat(80) }, "github")).toHaveLength(40);
    expect(firstName(undefined, "github")).toBeUndefined();
  });

  it("the session the browser sees has a first name and the provider, never the account key", async () => {
    const cfg = authConfig({ ...ENV, AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "s" });
    const token = { k: accountKey("github", "1"), p: "github", n: "Kevin" };
    const s = await cfg.callbacks!.session!({ session: { expires: "2026-11-01T00:00:00.000Z", user: {} }, token } as never);
    expect(s).toEqual({ expires: "2026-11-01T00:00:00.000Z", user: { name: "Kevin" }, provider: "github" });
    expect(JSON.stringify(s)).not.toContain(token.k);
  });

  it("a later jwt call keeps only our fields; a token without them signs the person out", async () => {
    const cfg = authConfig(ENV);
    const jwt = cfg.callbacks!.jwt!;
    const k = accountKey("github", "1");
    expect(await jwt({ token: { k, p: "github", email: "x@example.com", picture: "p", sub: "1" } } as never)).toEqual({ k, p: "github" });
    expect(await jwt({ token: { email: "x@example.com" } } as never)).toBeNull();
  });
});

describe("which sign-in buttons exist", () => {
  it("an OAuth provider only with BOTH its id and secret", () => {
    expect(enabledOAuthProviders({})).toEqual([]);
    expect(enabledOAuthProviders({ AUTH_GITHUB_ID: "x" })).toEqual([]);
    expect(enabledOAuthProviders({ AUTH_GITHUB_ID: "x", AUTH_GITHUB_SECRET: " " })).toEqual([]);
    expect(enabledOAuthProviders({ AUTH_GITHUB_ID: "x", AUTH_GITHUB_SECRET: "y" })).toEqual(["github"]);
    expect(enabledOAuthProviders({ AUTH_GITHUB_ID: "x", AUTH_GITHUB_SECRET: "y", AUTH_GOOGLE_ID: "a", AUTH_GOOGLE_SECRET: "b" })).toEqual(["github", "google"]);
  });

  it("the judge button is on by default, off with JUDGE_DEMO=0; nothing at all without AUTH_SECRET", () => {
    expect(signInOptions(ENV)).toEqual({ configured: true, providers: [], judge: true });
    expect(signInOptions({ ...ENV, JUDGE_DEMO: "0" }).judge).toBe(false);
    expect(signInOptions({ AUTH_GITHUB_ID: "x", AUTH_GITHUB_SECRET: "y" })).toEqual({ configured: false, providers: [], judge: false });
  });

  it("the Auth.js providers follow the same env (a missing provider is not registered)", () => {
    const ids = (env: Record<string, string>) =>
      authConfig(env)
        .providers.map((p) => (typeof p === "function" ? p() : p))
        .map((p) => (p as { options?: { id?: string } }).options?.id ?? (p as { id: string }).id);
    expect(ids(ENV)).toEqual(["judge"]);
    expect(ids({ ...ENV, AUTH_GOOGLE_ID: "a", AUTH_GOOGLE_SECRET: "b", JUDGE_DEMO: "0" })).toEqual(["google"]);
    expect(ids({ ...ENV, AUTH_GITHUB_ID: "a", AUTH_GITHUB_SECRET: "b" })).toEqual(["github", "judge"]);
  });

  it("JUDGE_DEMO_DAILY_CAP: default 20, bad values fall back", () => {
    expect(judgeDailyCap({})).toBe(20);
    expect(judgeDailyCap({ JUDGE_DEMO_DAILY_CAP: "5" })).toBe(5);
    expect(judgeDailyCap({ JUDGE_DEMO_DAILY_CAP: "-1" })).toBe(20);
  });

  it("session cookies: JWT strategy, Auth.js defaults are httpOnly + SameSite=Lax (+ Secure on https)", () => {
    const cfg = authConfig(ENV);
    expect(cfg.session?.strategy).toBe("jwt");
    // No custom cookie options: Auth.js sets httpOnly, sameSite "lax", path "/", and `secure` + the
    // __Secure- prefix whenever the site is served over https (src/lib/accounts/session.ts reads both names).
    expect(cfg.cookies).toBeUndefined();
    expect(cfg.trustHost).toBe(true);
  });
});

describe("return paths (no open redirects)", () => {
  const base = "https://grass-pass.example";
  it("allows only our own pages", () => {
    expect(allowedReturnPath("/", base)).toBe("/");
    expect(allowedReturnPath("/?resume=1", base)).toBe("/?resume=1");
    expect(allowedReturnPath("/pass/w306191453-6to10-20261006-1", base)).toBe("/pass/w306191453-6to10-20261006-1");
    expect(allowedReturnPath(`${base}/pass/w306191453-6to10-20261006-2`, base)).toBe("/pass/w306191453-6to10-20261006-2");
    expect(allowedReturnPath("/signin", base)).toBe("/signin");
  });

  it("refuses other origins, protocol-relative and odd paths", () => {
    for (const bad of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "javascript:alert(1)",
      "/pass/../api/report",
      "/pass/w1-6to10-20261006-1/print",
      "/?resume=1&x=https://evil.example",
      "/about",
      "https://grass-pass.example.evil.test/",
      "https://user:pw@grass-pass.example/",
      "",
    ]) {
      expect(allowedReturnPath(bad, base), bad).toBeNull();
    }
    expect(safeRedirect("https://evil.example/x", base)).toBe(`${base}/`);
    expect(safeRedirect("/?resume=1", base)).toBe(`${base}/?resume=1`);
  });
});

describe("the session cookie", () => {
  const k = () => accountKey("github", "42");
  const reqWith = (cookie: string, extra: Record<string, string> = {}) => new Request("http://localhost:3123/api/pass", { headers: { cookie, ...extra } });

  it("a valid cookie gives the account key and provider (http and https names)", async () => {
    expect(await readAccount(reqWith(await sessionCookie({ k: k(), p: "github" })))).toEqual({ key: k(), provider: "github", judge: false });
    expect(await readAccount(reqWith(await sessionCookie({ k: k(), p: "github" }, process.env, true)))).toEqual({ key: k(), provider: "github", judge: false });
    expect((await readAccount(reqWith((await judgeCookie()).cookie)))?.judge).toBe(true);
  });

  it("tampered, foreign-secret, malformed or oversized cookies are signed out; a Bearer header is ignored", async () => {
    const good = await sessionCookie({ k: k(), p: "github" });
    const [name, value] = good.split("=");
    expect(await readAccount(reqWith(`${name}=${value.slice(0, -4)}AAAA`))).toBeNull();
    expect(await readAccount(reqWith(await sessionCookie({ k: k(), p: "github" }, { AUTH_SECRET: "another-secret-entirely-0123456789" })))).toBeNull();
    expect(await readAccount(reqWith(`${name}=${"a".repeat(5000)}`))).toBeNull();
    expect(await readAccount(reqWith("other=1"))).toBeNull();
    expect(await readAccount(new Request("http://x/", { headers: { authorization: `Bearer ${value}` } }))).toBeNull();
    // A token we didn't write (no account key) is not a session.
    expect(await readAccount(reqWith(await sessionCookie({ k: "a:short", p: "github" } as never)))).toBeNull();
  });

  it("without AUTH_SECRET nobody is signed in", async () => {
    const c = await sessionCookie({ k: k(), p: "github" });
    expect(await readAccount(reqWith(c), {})).toBeNull();
  });
});

describe("the per-account share is atomic", () => {
  it("5 concurrent reserves for one account with a share of 2: exactly 2 succeed", async () => {
    const store = new MemoryStore();
    const now = Date.now();
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => reserveQuota(store, { name: "acct-new", key: "a:xxxxxxxxxxxxxxxxxxxxxx", perKey: 2, global: 1e9, period: { kind: "day" }, now })),
    );
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
  });
});

// ---------- the sign-in gate and the account share, through POST /api/pass ----------

let n = 0;
const nextIp = () => `198.18.0.${(++n % 250) + 1}`;
function post(body: unknown, cookie: string | null, ip = nextIp()) {
  return new Request("http://localhost:3123/api/pass", {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      host: "localhost:3123",
      origin: "http://localhost:3123",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}
async function outcome(res: Response): Promise<{ status: number; code?: string; message?: string; line?: PassLine }> {
  if ((res.headers.get("content-type") ?? "").includes("ndjson")) {
    const ls = (await res.text())
      .trim()
      .split("\n")
      .map((l) => PassLineSchema.parse(JSON.parse(l)));
    const last = ls[ls.length - 1];
    return { status: res.status, line: last, ...(last.type === "error" ? { code: last.error.code, message: last.error.message } : {}) };
  }
  const e = PassErrorResponseSchema.parse(await res.json());
  return { status: res.status, code: e.error.code, message: e.error.message };
}

const connemara = { parkId: PARKS.connemara.id, ageBand: "6-10" as const };
const today = () => localDay(Date.now());

describe("POST /api/pass: sign-in gate, 2 a day, judge cap", () => {
  let replay: ReturnType<typeof passReplay>;
  let restoreLog: () => void;
  let logs: string[];
  beforeAll(() => undefined);
  beforeEach(() => {
    resetStores();
    resetPassMaking();
    disableSavedOsmForTests();
    replay = passReplay();
    vi.stubGlobal("fetch", replay.fetchImpl);
    vi.stubEnv("DO_INFERENCE_API_KEY", "test-key-not-real");
    vi.stubEnv("MODEL_BASE_URL", "");
    vi.stubEnv("MODEL_ID", "");
    logs = [];
    restoreLog = setLogSink((_l, line) => logs.push(line));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetSavedOsm();
    restoreLog();
  });

  it("signed out: a new pass is 401 SIGN_IN_REQUIRED with no upstream call", async () => {
    const o = await outcome(await route.POST(post(connemara, null)));
    expect([o.status, o.code, o.message]).toEqual([401, "SIGN_IN_REQUIRED", ACCOUNT_COPY.signInToMake]);
    expect(replay.calls).toHaveLength(0);
  });

  it("signed out: today's saved pass for that park + age is still served (it costs nothing)", async () => {
    const a = await newAccountCookie();
    const made = await outcome(await route.POST(post(connemara, a.cookie)));
    expect(made.line?.type).toBe("result");
    const calls = replay.calls.length;
    const again = await outcome(await route.POST(post(connemara, null)));
    expect(again.line?.type === "result" && again.line.cached).toBe(true);
    expect(replay.calls.length).toBe(calls);
    // "Make a different pass" is a new pass: sign-in needed.
    const fresh = await outcome(await route.POST(post({ ...connemara, fresh: true }, null)));
    expect([fresh.status, fresh.code]).toEqual([401, "SIGN_IN_REQUIRED"]);
  });

  it("an account makes 2 new passes a day; the 3rd is refused with Kevin's copy and no upstream call", async () => {
    const a = await newAccountCookie();
    expect((await outcome(await route.POST(post(connemara, a.cookie)))).line?.type).toBe("result");
    expect((await outcome(await route.POST(post({ ...connemara, fresh: true }, a.cookie)))).line?.type).toBe("result");
    const calls = replay.calls.length;
    const third = await outcome(await route.POST(post({ ...connemara, fresh: true }, a.cookie)));
    expect([third.status, third.code, third.message]).toEqual([429, "ACCOUNT_DAILY_LIMIT", ACCOUNT_COPY.accountLimit]);
    expect(replay.calls.length).toBe(calls);
    expect(Number(await getStore("limits").get(`q:{acct-new:${today()}}:k:${a.key}`))).toBe(2);
    // Another account is not affected.
    const b = await newAccountCookie();
    expect((await outcome(await route.POST(post({ ...connemara, fresh: true }, b.cookie)))).line?.type).toBe("result");
  });

  it("counted only when a build really starts: a refusal before any upstream call gives the share back", async () => {
    const a = await newAccountCookie();
    // The global AI cap is already used up: the build is refused before any upstream call.
    vi.stubEnv("AI_DAILY_CAP", "1");
    vi.stubEnv("AI_RESERVE_PCT", "0");
    await getStore("limits").set(`q:{ai-calls:${today()}}:all`, "1", 3600);
    const o = await outcome(await route.POST(post(connemara, a.cookie)));
    expect([o.status, o.code]).toEqual([429, "DAILY_LIMIT"]);
    expect(replay.calls).toHaveLength(0);
    expect(Number(await getStore("limits").get(`q:{acct-new:${today()}}:k:${a.key}`)) || 0).toBe(0);
  });

  it("a failed build that DID call upstream still counts (the paid call happened)", async () => {
    const r = passReplay({ model: () => new Response("busy", { status: 503 }) });
    vi.stubGlobal("fetch", r.fetchImpl);
    const a = await newAccountCookie();
    const o = await outcome(await route.POST(post(connemara, a.cookie)));
    expect(o.code).toMatch(/^MODEL_/);
    expect(Number(await getStore("limits").get(`q:{acct-new:${today()}}:k:${a.key}`))).toBe(1);
  });

  it("the judge demo: no per-account 2, but the shared JUDGE_DEMO_DAILY_CAP for every judge together", async () => {
    vi.stubEnv("JUDGE_DEMO_DAILY_CAP", "3");
    const j = await judgeCookie();
    expect((await outcome(await route.POST(post(connemara, j.cookie)))).line?.type).toBe("result");
    expect((await outcome(await route.POST(post({ ...connemara, fresh: true }, j.cookie)))).line?.type).toBe("result");
    expect((await outcome(await route.POST(post({ ...connemara, fresh: true }, j.cookie)))).line?.type).toBe("result");
    expect(Number(await getStore("limits").get(`q:{judge-new:${today()}}:all`))).toBe(3);
    // Over the cap (a different park so the variant limit isn't what stops it).
    const o = await outcome(await route.POST(post({ parkId: PARKS.celebration.id, ageBand: "6-10" }, j.cookie)));
    expect([o.status, o.code, o.message]).toEqual([429, "JUDGE_DAILY_LIMIT", ACCOUNT_COPY.judgeLimit]);
  });

  it("the per-IP limits still apply to signed-in accounts (3 new passes a minute per IP)", async () => {
    const ip = nextIp();
    const parks = [connemara, { ...connemara, ageBand: "4-6" as const }, { ...connemara, ageBand: "10-13" as const }];
    for (const p of parks) expect((await outcome(await route.POST(post(p, (await newAccountCookie()).cookie, ip)))).line?.type).toBe("result");
    const o = await outcome(await route.POST(post({ parkId: PARKS.celebration.id, ageBand: "6-10" }, (await newAccountCookie()).cookie, ip)));
    expect([o.status, o.code]).toEqual([429, "RATE_LIMITED"]);
  });
});
