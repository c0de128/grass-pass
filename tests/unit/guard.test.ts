import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkJsonContentType, checkSameOrigin, guardGet, guardJsonPost, MAX_BODY_BYTES, readBodyLimited } from "@/lib/http/guard";

const URL_ = "http://localhost:3123/api/pass";

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(URL_, {
    method: "POST",
    headers: { host: "localhost:3123", "content-type": "application/json", ...headers },
    body,
    // Needed for stream bodies in Node's Request.
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

/** A chunked body with no Content-Length. */
function chunked(chunks: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
      else c.close();
    },
  });
  return { stream, pulls: () => pulls };
}

describe("checkSameOrigin", () => {
  it("allows same-origin browser requests and non-browser clients", () => {
    expect(checkSameOrigin(post("{}", { origin: "http://localhost:3123", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(checkSameOrigin(post("{}"))).toBeNull(); // curl: no Origin, no Sec-Fetch-Site
    expect(checkSameOrigin(post("{}", { "sec-fetch-site": "none" }))).toBeNull();
  });

  it("refuses cross-site requests with 403", () => {
    expect(checkSameOrigin(post("{}", { "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(checkSameOrigin(post("{}", { "sec-fetch-site": "same-site" }))?.status).toBe(403);
    expect(checkSameOrigin(post("{}", { origin: "https://evil.test" }))?.code).toBe("CROSS_ORIGIN");
    expect(checkSameOrigin(post("{}", { origin: "null" }))?.status).toBe(403);
    expect(checkSameOrigin(post("{}", { origin: "http://localhost:3123.evil.test" }))?.status).toBe(403);
  });

  it("uses x-forwarded-host behind a proxy", () => {
    expect(checkSameOrigin(post("{}", { origin: "https://grass-pass.example", "x-forwarded-host": "grass-pass.example" }))).toBeNull();
  });

  it("guardGet applies the same rule", () => {
    const get = new Request("http://localhost:3123/api/parks?q=allen", { headers: { host: "localhost:3123", "sec-fetch-site": "cross-site" } });
    expect(guardGet(get)?.status).toBe(403);
  });
});

describe("checkJsonContentType", () => {
  it("accepts application/json (with charset) and refuses the rest with 415", () => {
    expect(checkJsonContentType(post("{}", { "content-type": "application/json; charset=utf-8" }))).toBeNull();
    for (const t of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""]) {
      expect(checkJsonContentType(post("{}", { "content-type": t }))?.status).toBe(415);
    }
  });
});

describe("readBodyLimited", () => {
  it("reads a small body", async () => {
    expect(await readBodyLimited(post('{"a":1}'))).toEqual({ ok: true, text: '{"a":1}' });
  });

  it("refuses a declared oversize body without reading it", async () => {
    const r = await readBodyLimited(post("{}", { "content-length": String(MAX_BODY_BYTES + 1) }));
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });

  it("stops a chunked body (no Content-Length) as soon as it passes the cap", async () => {
    const piece = "x".repeat(1000);
    const c = chunked(Array(100).fill(piece));
    const r = await readBodyLimited(post(c.stream));
    expect(r).toEqual({ ok: false, reason: "too_large" });
    expect(c.pulls()).toBeLessThan(10); // never buffered the 100 KB
  });

  it("reports empty and invalid UTF-8 bodies", async () => {
    expect(await readBodyLimited(post(null))).toEqual({ ok: false, reason: "empty" });
    expect(await readBodyLimited(post(new Uint8Array([0xff, 0xfe, 0xfd])))).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("guardJsonPost", () => {
  const schema = z.object({ parkId: z.string().min(1).max(40) });

  it("returns the validated data", async () => {
    const r = await guardJsonPost(post('{"parkId":"way/306191453"}', { origin: "http://localhost:3123" }), schema);
    expect(r).toEqual({ ok: true, data: { parkId: "way/306191453" } });
  });

  it.each([
    ["cross-site", post('{"parkId":"a"}', { "sec-fetch-site": "cross-site" }), 403],
    ["text/plain", post('{"parkId":"a"}', { "content-type": "text/plain" }), 415],
    ["oversize", post(JSON.stringify({ parkId: "a".repeat(MAX_BODY_BYTES) })), 413],
    ["not JSON", post("parkId=a"), 400],
    ["wrong shape", post('{"park":"a"}'), 400],
    ["empty", post(null), 400],
  ])("refuses %s", async (_, req, status) => {
    const r = await guardJsonPost(req, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.status).toBe(status);
  });
});
