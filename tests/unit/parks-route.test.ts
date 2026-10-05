import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { resetParksSearch } from "@/lib/parks/search";
import { ApiErrorSchema, ParksResultSchema } from "@/lib/parks/schema";
import * as route from "@/app/api/parks/route";
import { osmReplay } from "./support/osm-replay";

let n = 0;
function get(query: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3123/api/parks?${query}`, {
    headers: { host: "localhost:3123", "sec-fetch-site": "same-origin", "x-forwarded-for": `198.51.100.${++n % 250}`, ...headers },
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

describe("GET /api/parks", () => {
  it("exports only the handler plus runtime/maxDuration (maxDuration covers 2 Overpass attempts)", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "maxDuration", "runtime"]);
    expect(route.maxDuration).toBe(90);
  });

  it("Allen TX -> 200 with real parks, no-store", async () => {
    const res = await route.GET(get("q=Allen%20TX"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = ParksResultSchema.parse(await res.json());
    expect(body.parks).toHaveLength(10);
    expect(body.parks.map((p) => p.name)).toContain("Allen Station Park");
  });

  it("refuses cross-site requests before any upstream call (403)", async () => {
    const res = await route.GET(get("q=Allen%20TX", { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    const res2 = await route.GET(get("q=Allen%20TX", { origin: "https://evil.example" }));
    expect(res2.status).toBe(403);
    expect(replay.calls).toHaveLength(0);
  });

  it("bad input -> 400 naming the field, no upstream call", async () => {
    const res = await route.GET(get("q=a"));
    expect(res.status).toBe(400);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.field).toBe("q");
    expect(body.error.message).toMatch(/at least 2/);
    const res2 = await route.GET(get("lat=north&lng=1"));
    expect(ApiErrorSchema.parse(await res2.json()).error.field).toBe("location");
    expect(replay.calls).toHaveLength(0);
  });

  it("429 carries Retry-After", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < 10; i++) await route.GET(get("q=Allen%20TX", { "x-forwarded-for": ip }));
    const res = await route.GET(get("q=Allen%20TX", { "x-forwarded-for": ip }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("RATE_LIMITED");
  });
});
