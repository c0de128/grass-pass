import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const headers = securityHeaders({
  isDev: process.env.NODE_ENV === "development",
  // Only on Vercel (always HTTPS). On http://localhost it would break same-origin assets.
  upgradeInsecure: process.env.VERCEL === "1",
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
