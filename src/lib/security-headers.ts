// Security headers applied to every route via next.config.ts.
// CSP follows the "Without Nonces" recipe in node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
// 'unsafe-inline' for scripts is needed by Next's inline bootstrap scripts when no nonce middleware is used.
// No third-party scripts, fonts or images: fonts are self-hosted by next/font, all data is server-proxied.

export type Header = { key: string; value: string };

export function buildCsp(opts: { isDev: boolean; upgradeInsecure: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${opts.isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // Only on HTTPS deploys: on http://localhost it would upgrade same-origin assets to https and break them.
  if (opts.upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function securityHeaders(opts: { isDev: boolean; upgradeInsecure: boolean }): Header[] {
  return [
    { key: "Content-Security-Policy", value: buildCsp(opts) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // "Use my location" (F1) needs geolocation on our own origin only.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  ];
}
