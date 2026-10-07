/**
 * Judge R7 T1 ("the examples are a daily lottery"): what counts as a COMPLETE example pass. Pure, client-safe.
 *
 * A pass is complete when it has every find its age band asks for (`items.length >= target`) and, when the park
 * has a Find This Spot map, the map carries a riddle the open model wrote (not the fixed "Follow the map from START
 * to the X" line). A park with no single landmark (spot status "none") can still be complete: that is a fact about
 * the park, not a weak pass. The home page only shows complete example passes (src/lib/prewarm.ts keeps the last
 * complete one per park), so a short re-make never replaces a good example.
 */
import type { Pass } from "./schema";

export type Completeness = { complete: boolean; items: number; target: number; riddle: "model" | "code" | "none" };

export function completeness(pass: Pick<Pass, "items" | "target" | "spot">): Completeness {
  const riddle = pass.spot?.status === "ok" ? pass.spot.riddleBy : "none";
  return { complete: pass.items.length >= pass.target && riddle !== "code", items: pass.items.length, target: pass.target, riddle };
}

export function isCompletePass(pass: Pick<Pass, "items" | "target" | "spot">): boolean {
  return completeness(pass).complete;
}
