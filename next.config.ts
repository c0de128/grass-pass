import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const headers = securityHeaders({
  isDev: process.env.NODE_ENV === "development",
  // Only on Vercel (always HTTPS). On http://localhost it would break same-origin assets.
  upgradeInsecure: process.env.VERCEL === "1",
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // v3 home illustrations (public/illustrations, WebP sources): served as AVIF/WebP at the size each slot needs.
  images: { formats: ["image/avif", "image/webp"] },
  // R2-M3: the saved per-park OpenStreetMap answers are read from disk (src/lib/sources/osm-snapshot.ts)
  // only when a pass needs one, so they must be traced into the functions that build passes.
  outputFileTracingIncludes: {
    "/api/pass": ["./src/data/osm/parks/**/*"],
    "/": ["./src/data/osm/parks/**/*"],
  },
  // Round 9 (SEC-9-02): src/lib/pass/e2e-fixtures.ts reads tests/fixtures (test-only, behind GP_E2E_FIXTURE_PASSES=1),
  // which made the tracer copy the whole tests/ tree into the server functions. Nothing under tests/ ships. The
  // Playwright server runs from the repo itself, so the keyless print tests still read the fixtures there.
  outputFileTracingExcludes: {
    "**": ["./tests/**/*"],
  },
  experimental: {
    // src/proxy.ts (the pre-limiter) makes Next buffer request bodies; keep that buffer small. Our POST
    // routes cap bodies at 2 KB themselves (src/lib/http/guard.ts), so anything over this is refused anyway.
    proxyClientMaxBodySize: "8kb",
  },
  async headers() {
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
