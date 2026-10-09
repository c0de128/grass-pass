/**
 * Round 11 (Q-11-01), the page side: after an answer that used the last free pass the wizard never retries by itself,
 * and a "no free pass left" answer right after a real failure keeps that failure's honest message and example link.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { failureShown, PassFailure } from "@/components/pass/PassMaker";
import { autoRetryFor, keepEarlierFailure, type PassState } from "@/components/pass/usePassRequest";

type Failed = Extract<PassState, { kind: "failed" }>;
const OSM: Failed = {
  kind: "failed",
  code: "OSM_UNAVAILABLE",
  message: "No data available: the OpenStreetMap server is busy. Try again shortly or pick an example park.",
  retryAfter: 15,
  example: { name: "Arbor Hills Nature Preserve", href: "/pass/w38113837-6to10-20261006-1?example=1" },
};
const USED: Failed = { kind: "failed", code: "FREE_PASS_USED", message: "You used today's free pass. Press Try as a judge to keep going. Saved passes and examples still work.", retryAfter: 3600 };
const signedOut = { signedIn: false, options: { configured: true, judge: true, providers: [] }, freeLeft: 0 } as unknown as Parameters<typeof failureShown>[1];

describe("Q-11-01: the wizard after a failed free pass", () => {
  it("a busy-map failure is retried once by itself, but never when the answer used the last free pass", () => {
    expect(autoRetryFor(OSM)).toBe(15_000);
    expect(autoRetryFor({ ...OSM, freeLeft: 0 })).toBeNull();
    expect(autoRetryFor({ ...OSM, freeLeft: 1 })).toBe(15_000);
  });

  it("FREE_PASS_USED right after a real failure keeps its honest message and example link", () => {
    const kept = keepEarlierFailure(USED, OSM);
    expect(kept).toMatchObject({ code: "FREE_PASS_USED", message: OSM.message, example: OSM.example, earlier: true });
    const shown = failureShown(kept, signedOut);
    expect(shown.message).toBe(OSM.message);
    const html = renderToStaticMarkup(<PassFailure state={shown} secondsToRetry={null} onTryAgain={() => {}} />);
    expect(html).toContain("OpenStreetMap server is busy");
    expect(html).toContain("See a ready example pass: Arbor Hills Nature Preserve");
    expect(html).not.toContain("No pass for this park and age was made today yet");
  });

  it("with no earlier failure (or an earlier refusal) the friendly sign-in line stays", () => {
    expect(keepEarlierFailure(USED, null)).toBe(USED);
    expect(keepEarlierFailure(USED, USED)).toBe(USED);
    expect(failureShown(USED, signedOut).message).toBe("No pass for this park and age was made today yet. Sign in above to make one.");
    // A real failure is never replaced by another real failure's text.
    expect(keepEarlierFailure(OSM, { ...OSM, message: "other" })).toBe(OSM);
  });
});
