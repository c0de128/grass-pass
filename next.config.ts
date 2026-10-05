import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const headers = securityHeaders({
  isDev: process.env.NODE_ENV === "development",
  // Only on Vercel (always HTTPS). On http://localhost it would break same-origin assets.
  upgradeInsecure: process.env.VERCEL === "1",
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
