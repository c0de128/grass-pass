/**
 * Runs once per server start (Next instrumentation). Starts the example-park warm-up in the
 * background (src/lib/prewarm.ts) so the home page's example links open a real pass at once.
 * Never during `next build` (no upstream calls at build time) and never on the edge runtime.
 * PREWARM_EXAMPLES=0 switches it off.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { prewarmEnabled, warmExamples } = await import("./lib/prewarm");
  if (!prewarmEnabled()) return;
  // Not awaited: the server must not wait 1-2 minutes for four real passes before answering requests.
  void warmExamples().catch(() => undefined);
}
