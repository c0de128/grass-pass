/**
 * Round 8 (wizard + home) helpers. The browser behaviour is in tests/e2e/wizard-r8.spec.ts; here the pure rules:
 * which finished pass may open by itself (Q-8-03), what the live region says when it is ready (UX-8-02/07), when a
 * focused home block counts as off screen (UX-8-01/06), and the Explore "No data available" copy (Q-8-06).
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { outsideView } from "@/components/home/FadeInOnScroll";
import { FOCUS_PASS_KEY } from "@/components/pass/FocusPassHeading";
import { matchesChoice, readyAnnouncement } from "@/components/pass/PassMaker";
import { noExamplesText } from "@/lib/home/showcase";

describe("Q-8-03: only a pass for the current choice opens by itself", () => {
  const run = { parkId: "way/188145317", parkName: "Celebration Park", band: "6-10" as const };
  it("same park and age: yes", () => {
    expect(matchesChoice(run, { id: "way/188145317" }, "6-10")).toBe(true);
  });
  it("another park, another age, or no request: no", () => {
    expect(matchesChoice(run, { id: "way/556800335" }, "6-10")).toBe(false);
    expect(matchesChoice(run, { id: "way/188145317" }, "10-13")).toBe(false);
    expect(matchesChoice(null, { id: "way/188145317" }, "6-10")).toBe(false);
    expect(matchesChoice(run, null, "6-10")).toBe(false);
  });
});

describe("UX-8-02 / UX-8-07: the ready announcement", () => {
  it("names the park and says how to stop the auto-open", () => {
    expect(readyAnnouncement("Celebration Park", false, true)).toBe("Your pass for Celebration Park is ready. Opening it now. Press Stay here to stop.");
  });
  it("once stopped (or not opening by itself) it says the pass waits", () => {
    expect(readyAnnouncement("Celebration Park", false, false)).toBe("Your pass for Celebration Park is ready. Open it when you like.");
  });
  it("a pass someone already made today says so", () => {
    expect(readyAnnouncement("Oak Point", true, true)).toMatch(/^Someone already made this pass for Oak Point today\. Opening it now\./);
  });
  it("the pass page focuses its h1 only after the wizard opened it (one-time sessionStorage flag)", () => {
    expect(FOCUS_PASS_KEY).toBe("grass-pass:focus-pass-h1");
    const page = readFileSync("src/app/pass/[id]/page.tsx", "utf8");
    expect(page).toContain("<FocusPassHeading />");
  });
});

describe("UX-8-01 / UX-8-06: when a focused element is off screen", () => {
  const H = 844;
  const header = 96;
  it("below the window or under the sticky header: off screen", () => {
    expect(outsideView({ top: 1026, bottom: 1575 }, H, header)).toBe(true);
    expect(outsideView({ top: 0, bottom: 549 }, H, header)).toBe(true);
    expect(outsideView({ top: 60, bottom: 120 }, H, header)).toBe(true);
  });
  it("fully visible: on screen", () => {
    expect(outsideView({ top: 200, bottom: 749 }, H, header)).toBe(false);
  });
  it("cut off at the bottom: off screen if it would fit, on screen if it is taller than the visible area", () => {
    expect(outsideView({ top: 600, bottom: 900 }, H, header)).toBe(true);
    expect(outsideView({ top: 120, bottom: 1000 }, H, header)).toBe(false);
  });
});

describe("Q-8-06: the Explore 'No data available' line says the real reason", () => {
  it("warm-up switched off: no 'try again'", () => {
    const t = noExamplesText([{ refreshing: false }], false);
    expect(t).toMatch(/^No data available: example passes are turned off on this server/);
    expect(t).not.toMatch(/try again|minute/i);
  });
  it("passes being made right now: reload in a minute or two", () => {
    expect(noExamplesText([{ refreshing: false }, { refreshing: true }], true)).toMatch(/^No data available: the example passes are being made from live park data right now\. Reload/);
  });
  it("none ready and none being made: says none came out complete", () => {
    const t = noExamplesText([{ refreshing: false }], true);
    expect(t).toMatch(/^No data available: no example pass is ready right now\./);
    expect(t).toContain("none has come out complete yet");
    expect(t).not.toMatch(/try again in a minute/);
  });
  it("SampleParks renders that line (turned off)", async () => {
    const { SampleParks } = await import("@/components/home/SampleParks");
    const { EXAMPLE_PARKS } = await import("@/lib/prewarm");
    const html = renderToStaticMarkup(
      <SampleParks
        statuses={[{ example: EXAMPLE_PARKS[0], pass: null, passData: null, fresh: false, today: false, latest: null, short: null, refreshing: false, missing: "x" }]}
        enabled={false}
      />,
    );
    expect(html).toContain("No data available: example passes are turned off on this server");
  });
});
