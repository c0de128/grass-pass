import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { resetParksSearch } from "@/lib/parks/search";
import { ApiErrorSchema, ParksResultSchema } from "@/lib/parks/schema";
import * as route from "@/app/api/parks/route";
import { osmReplay } from "./support/osm-replay";

let n = 0;
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3123/api/parks", {
    method: "POST",
    headers: {
      host: "localhost:3123",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${++n % 250}`,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let replay: ReturnType<typeof osmReplay>;
let restoreLog: () => void;
beforeEach(() => {
  resetStores();
  resetParksSearch();
  replay = osmReplay();
  vi.stubGlobal("fetch", replay.fetchImpl);
  restoreLog = setLogSink(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreLog();
});

describe("POST /api/parks", () => {
  it("exports only POST plus runtime/maxDuration (no GET: typed text never goes in the URL)", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration", "runtime"]);
    expect(route.maxDuration).toBe(90);
  });

  it("Allen TX -> 200 with real parks, no-store", async () => {
    const res = await route.POST(post({ q: "Allen TX" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = ParksResultSchema.parse(await res.json());
    expect(body.parks).toHaveLength(10);
    expect(body.parks.map((p) => p.name)).toContain("Allen Station Park");
  });

  it("refuses cross-site requests and non-JSON bodies before any upstream call (403 / 415)", async () => {
    expect((await route.POST(post({ q: "Allen TX" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await route.POST(post({ q: "Allen TX" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await route.POST(post("q=Allen", { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    expect(replay.calls).toHaveLength(0);
  });

  it("oversized, non-JSON or unknown-field bodies -> 413 / 400, no upstream call", async () => {
    expect((await route.POST(post({ q: "x".repeat(3000) }))).status).toBe(413);
    expect((await route.POST(post("{not json"))).status).toBe(400);
    expect((await route.POST(post({ q: "Allen TX", extra: 1 }))).status).toBe(400);
    expect(replay.calls).toHaveLength(0);
  });

  it("bad input -> 400 naming the field, no upstream call", async () => {
    const res = await route.POST(post({ q: "a" }));
    expect(res.status).toBe(400);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.field).toBe("q");
    expect(body.error.message).toMatch(/at least 2/);
    const res2 = await route.POST(post({ lat: "north", lng: "1" }));
    expect(ApiErrorSchema.parse(await res2.json()).error.field).toBe("location");
    const res3 = await route.POST(post({}));
    expect(res3.status).toBe(400);
    expect(replay.calls).toHaveLength(0);
  });

  it("429 carries Retry-After", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < 10; i++) await route.POST(post({ q: "Allen TX" }, { "x-forwarded-for": ip }));
    const res = await route.POST(post({ q: "Allen TX" }, { "x-forwarded-for": ip }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("RATE_LIMITED");
  });
});
