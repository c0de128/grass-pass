/**
 * Runs once per server start (Next instrumentation). On a long-running server (local, self-hosted) it starts the
 * example-park warm-up in the background (src/lib/prewarm.ts) so the home page's example links open a real pass at once.
 * Never during `next build` (no upstream calls at build time), never on the edge runtime, and never on Vercel
 * (VERCEL set): there work outside a request is frozen between requests (preview deploy 2026-10-07: store timeouts
 * of 4-105 s), so the home page (one example per request, kept alive by after()) and the daily cron route warm the
 * examples instead. PREWARM_EXAMPLES=0 switches it off.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { prewarmEnabled, serverlessWarmup, warmExamples } = await import("./lib/prewarm");
  if (!prewarmEnabled() || serverlessWarmup()) return;
  // Not awaited: the server must not wait 1-2 minutes for four real passes before answering requests.
  void warmExamples().catch(() => undefined);
}
