// Absolute site URL for share-image metadata (Open Graph needs absolute URLs).
// SITE_URL wins; on Vercel the production domain is used; locally it falls back to localhost.

export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  const candidates = [
    env.SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const url = new URL(c);
      if (url.protocol === "https:" || url.protocol === "http:") return new URL(url.origin);
    } catch {
      // ignore a malformed value and try the next one
    }
  }
  return new URL(`http://localhost:${env.PORT || "3000"}`);
}
