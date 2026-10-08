/**
 * Round 9 polish: Q-9-03 (range trivia vs park directions), RULES-9-01 (the "What, not Who" sentence matches the code),
 * SEC-9-02 (fixture passes never on Vercel), Q-9-04 (ready text on the park step), Q-9-05 (a cut-short Lucky Finds
 * lookup), and the judge-visible fixes (dated Lucky Finds reasons on older passes; no limit line where it does not
 * apply to the viewer).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, prefetch: () => undefined }) }));

import HowItWorksPage from "@/app/how-it-works/page";
import { DifferentPassButton } from "@/components/pass/DifferentPassButton";
import { parkStepReadyText } from "@/components/pass/PassMaker";
import { fixPlantWho, fromToRange, triviaProblem } from "@/lib/ai/jargon";
import { dayLabel, luckyStateAsOf, passAsOf } from "@/lib/pass/as-of";
import { E2E_FIXTURE_ENV, e2eFixturePass } from "@/lib/pass/e2e-fixtures";
import { PassSchema, SectionStateSchema, type Pass } from "@/lib/pass/schema";
import { LUCKY_COPY, partialLuckyState } from "@/lib/pool/lucky";

const ROOT = join(__dirname, "..", "..");
const ARBOR_13: Pass = PassSchema.parse(JSON.parse(readFileSync(join(ROOT, "tests/fixtures/pass-arbor-hills-13plus-full-live.json"), "utf8")).pass);

describe("Q-9-03: range trivia, not park directions", () => {
  it("keeps 'from the Pond to the Bridge' style directions for every band", () => {
    for (const band of ["6-10", "10-13", "13+"] as const) {
      for (const t of [
        "Follow the path from the Pond to the Bridge.",
        "Look from the Rock Garden to the Bridge for a heron.",
        "Walk from the Nature Center to the Pavilion and count the benches.",
        "Follow the map from START to the X.",
        "Walk from the path to the pond to spot a heron.",
      ]) {
        expect(triviaProblem(t, band), `${band}: ${t}`).toBeNull();
      }
    }
  });

  it("still catches ranges on the globe, with a compass word, a range verb or a known place", () => {
    for (const band of ["6-10", "10-13", "13+"] as const) {
      for (const t of [
        "Peek for a bird of prey that breeds from Alaska to Panama.",
        "A hawk that nests from Alaska south to Mexico.",
        "A butterfly seen from Canada through Mexico.",
        "A warbler that ranges from Maine to Florida.",
        "A duck that winters from the Rocky Mountains to the Atlantic.",
        "A bird that spends summers from Alberta to Quebec.",
      ]) {
        expect(triviaProblem(t, band), `${band}: ${t}`).not.toBeNull();
      }
    }
    expect(fromToRange("A hawk that nests from Alaska south to Mexico.")).toBe("from Alaska south to Mexico");
  });
});

describe("RULES-9-01: the 'What, not Who' sentence says what the code does", () => {
  it("/how-it-works and the README say 'a plant, fungus or lichen', and fixPlantWho does exactly that", () => {
    const sentence = 'says "What", not "Who", for a plant, fungus or lichen.';
    const page = renderToStaticMarkup(HowItWorksPage()).replace(/&quot;/g, '"').replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(page).toContain(sentence);
    expect(page).not.toContain('"Who", for a lichen.');
    const readme = readFileSync(join(ROOT, "README.md"), "utf8").replace(/\s+/g, " ");
    expect(readme).toContain(sentence);
    expect(readme).not.toContain('"Who", for a lichen.');
    // The code: plants (Plantae 47126), fungi (Fungi 47170) and lichens; never an animal.
    const plant = { taxon: { taxonId: 51453, ancestorIds: [48460, 47126] } };
    const fungus = { taxon: { taxonId: 1, ancestorIds: [48460, 47170] } };
    const lichen = { kind: "fungus or lichen" };
    const bird = { taxon: { taxonId: 5212, ancestorIds: [48460, 1, 2, 355675, 3] } };
    expect(fixPlantWho("Who has purple flowers?", plant)).toBe("What has purple flowers?");
    expect(fixPlantWho("Who has a red cap?", fungus)).toBe("What has a red cap?");
    expect(fixPlantWho("Who has orange cups?", lichen)).toBe("What has orange cups?");
    expect(fixPlantWho("Who has a rusty tail?", bird)).toBe("Who has a rusty tail?");
  });
});

describe("SEC-9-02: fixture passes never on a Vercel deployment", () => {
  it("refuses on preview (VERCEL=1) as well as production", () => {
    expect(e2eFixturePass(ARBOR_13.id, { [E2E_FIXTURE_ENV]: "1" })?.id).toBe(ARBOR_13.id);
    expect(e2eFixturePass(ARBOR_13.id, { [E2E_FIXTURE_ENV]: "1", VERCEL: "1", VERCEL_ENV: "preview" })).toBeNull();
    expect(e2eFixturePass(ARBOR_13.id, { [E2E_FIXTURE_ENV]: "1", VERCEL_ENV: "production" })).toBeNull();
  });
  it("next.config.ts keeps tests/** out of the traced server files", () => {
    const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(cfg).toMatch(/outputFileTracingExcludes:\s*\{\s*"\*\*":\s*\["\.\/tests\/\*\*\/\*"\]/);
  });
});

describe("Q-9-04: the ready line on the park step", () => {
  it("names the park and says what picking a park does", () => {
    expect(parkStepReadyText("Celebration Park", false)).toBe("Your pass for Celebration Park is ready. Open it with the link below, or pick a park to make a new one.");
    expect(parkStepReadyText("Celebration Park", true)).toMatch(/^Someone already made this pass for Celebration Park today, and it is ready\./);
  });
});

describe("Q-9-05: a Lucky Finds lookup cut short after some searches", () => {
  it("finds kept: an ok section with a note; none kept: the reason plus what the answered searches found", () => {
    const cap = { status: "off" as const, message: LUCKY_COPY.dailyCap };
    const kept = partialLuckyState({ searched: ["dog"], finds: [{ keyword: "dog", count: 20, atLeast: true, newestMs: null }] }, cap, 1);
    expect(kept).toEqual({ status: "ok", note: "Lucky Finds: only dogs checked. The other visitor-review searches did not run: off for today. We hit the free SerpApi search limit for visitor reviews. It resets at midnight Dallas time." });
    expect(SectionStateSchema.safeParse(kept).success).toBe(true);
    // The live round-9 pass: dogs answered with 2 mentions (below 3), then bikes hit the cap.
    const none = partialLuckyState({ searched: ["dog"], finds: [{ keyword: "dog", count: 2, atLeast: false, newestMs: null }] }, cap, 0);
    expect(none).toEqual({ status: "off", message: `${LUCKY_COPY.dailyCap} Before that, we checked dogs: fewer than 3 visitor reviews from the last 2 years mention them.` });
    expect(partialLuckyState({ searched: [], finds: [] }, cap, 0)).toBe(cap);
  });
});

describe("judge R9: one true Lucky Finds reason on older passes", () => {
  it("present-tense reasons are said as of the pass's day; same-day passes and other reasons are unchanged", () => {
    expect(dayLabel("2026-10-06")).toBe("Tue, Oct 6");
    const noKey = { status: "off" as const, message: LUCKY_COPY.notConnected };
    const share = { status: "off" as const, message: LUCKY_COPY.warmupShare };
    expect(luckyStateAsOf(noKey, "2026-10-07", "2026-10-07")).toBe(noKey);
    expect(luckyStateAsOf(noKey, "2026-10-06", "2026-10-08")).toEqual({
      status: "off",
      message: "Lucky Finds: not on this pass. On Tue, Oct 6, the server that made it had no SerpApi key, so it could not read visitor reviews.",
    });
    const s = luckyStateAsOf(share, "2026-10-07", "2026-10-08");
    expect(s).toMatchObject({ status: "off" });
    expect("message" in s && s.message).toMatch(/^Lucky Finds: not on this example pass\. On Wed, Oct 7, the example passes had used their share of that day's/);
    expect("message" in s && s.message).not.toMatch(/\btoday\b/);
    // A suffix after the reason (a cut-short lookup) is kept.
    const cut = { status: "off" as const, message: `${LUCKY_COPY.dailyCap} Before that, we checked dogs: fewer than 3 visitor reviews from the last 2 years mention them.` };
    expect(luckyStateAsOf(cut, "2026-10-07", "2026-10-09")).toEqual({
      status: "off",
      message: "Lucky Finds: not on this pass. On Wed, Oct 7, Grass Pass had used that day's free SerpApi searches for visitor reviews. Before that, we checked dogs: fewer than 3 visitor reviews from the last 2 years mention them.",
    });
    const down = { status: "unavailable" as const, message: LUCKY_COPY.down };
    expect(luckyStateAsOf(down, "2026-10-06", "2026-10-08")).toBe(down);
    // The whole pass: only the Lucky Finds section changes.
    const old: Pass = { ...ARBOR_13, day: "2026-10-06", sections: { ...ARBOR_13.sections, lucky: noKey } };
    const shown = passAsOf(old, "2026-10-08");
    expect(shown.sections.lucky).not.toEqual(noKey);
    expect({ ...shown, sections: { ...shown.sections, lucky: noKey } }).toEqual(old);
    expect(passAsOf(ARBOR_13, "2026-10-09")).toBe(ARBOR_13);
  });
});

describe("judge R9: the 3-a-day line only where it applies", () => {
  const html = (props: Partial<Parameters<typeof DifferentPassButton>[0]>) =>
    renderToStaticMarkup(<DifferentPassButton parkId="way/188145317" ageBand="6-10" variant={3} {...props} />);
  it("today's 3rd pass on the visitor's own page: the line; on an example page: nothing; an older pass: the button", () => {
    expect(html({ madeToday: true })).toContain("Come back tomorrow for a new one.");
    expect(html({ madeToday: true, example: true })).toBe("");
    const older = html({ madeToday: false, example: true });
    expect(older).not.toContain("Come back tomorrow");
    expect(older).toContain("Make a different pass");
  });
});
