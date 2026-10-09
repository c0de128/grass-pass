import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";

/**
 * SEC-11-03: an oversized CHUNKED body (no Content-Length) to a JSON POST answers 413 BODY_TOO_LARGE on the real
 * server, the same as a body with a big Content-Length (the stream is cut at the 2 KB cap; src/lib/http/guard.ts).
 */
function postChunked(baseURL: string, path: string, bytes: number): Promise<{ status: number; body: string }> {
  const url = new URL(path, baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "Content-Type": "application/json", Origin: url.origin, "Transfer-Encoding": "chunked" } },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    const chunk = `{"receipt":"${"x".repeat(1000)}`;
    let sent = 0;
    while (sent < bytes) {
      req.write(chunk);
      sent += chunk.length;
    }
    req.end('"}');
  });
}

test("an oversized chunked body is 413 on /api/free-pass and /api/feedback", async ({ baseURL }) => {
  for (const path of ["/api/free-pass", "/api/feedback"]) {
    const r = await postChunked(baseURL!, path, 100_000);
    expect(r.status, `${path}: ${r.body.slice(0, 120)}`).toBe(413);
    expect(r.body).toContain("BODY_TOO_LARGE");
  }
});
