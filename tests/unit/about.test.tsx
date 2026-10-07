import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage from "@/app/about/page";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { privacyRows, UNIT_TESTS, aboutStatTiles, dataSources } from "@/lib/about/content";
import { EVAL_COLUMNS, EVAL_RESULTS_FILE, EVAL_SUMMARY_FILE, EVAL_TOTAL_USD, GEMMA_FAILED_FIRST_CALLS, GEMMA_FIRST_CALL_P50_S, GEMMA_FIRST_PROMPT_TOKENS, GEMMA_COST_RANGE, GEMMA_P50_EXACT_S, GEMMA_RUN_COUNTS, GEMMA_SHORT_PASSES, GEMMA_TOKENS_PER_S, GEMMA_VAGUE_CLUES, GEMMA_VAGUE_CLUES_TODAY, PREVIOUS_RUN } from "@/lib/about/eval-summary";
import { jargonProblem, triviaProblem } from "@/lib/ai/jargon";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { PASS_MAX_TOKENS } from "@/lib/ai/build-pass";
import { REPO_URL } from "@/lib/site-url";

const ROOT = resolve(__dirname, "../..");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

type Score = {
  model: string;
  runs: number;
  errors: Record<string, number>;
  m1: { violations: number };
  m2: { grounded: number; returned: number; rate: number };
  m3: { complete: number; dataRichRuns: number; rate: number };
  m4: { rate: number };
  m5: { medianGrade: number };
  m6: { rate: number; clueRate: number };
  m7: { p50Ms: number | null; p95Ms: number | null };
  m8: { costPerPass: number; costPerPassHigh?: number; unansweredCalls?: number };
  m10: { repeated: number; clues: number; rate: number | null };
  m11: { printedWrong: number; printedCountClues: number; rawWrong: number };
};
type RunRow = { model: string; slug: string; dataRich: boolean; kind: string; items: { section: string; clue: string }[]; n: number | null; parkName: string | null; calls?: { status: number | null; latencyMs: number; promptTokens?: number | null; completionTokens?: number | null; estPromptTokens?: number; maxTokens?: number }[] };
type Results = { meta: { day: string; ageBand: string; partial: boolean }; cases: unknown[]; runs: RunRow[]; scores: Score[]; spend: { usd: number } };

const results = JSON.parse(readFileSync(join(ROOT, EVAL_RESULTS_FILE), "utf8")) as Results;
const r1 = (x: number) => Math.round(x * 1000) / 10; // rate -> percent, 1 decimal
/** Linear-interpolated percentile, the same formula as evals/score.ts percentile(). */
const percentile = (values: number[], p: number) => {
  const s = [...values].sort((a, b) => a - b);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};

describe("about page numbers come from the committed eval run", () => {
  it("the hand-written figures on the page come from the results files too", () => {
    const gemma = results.scores.find((x) => x.model === "gemma-4-31B-it")!;
    expect(Math.round(gemma.m7.p50Ms! / 10) / 100).toBe(GEMMA_P50_EXACT_S); // "the typical call took 9.37 s"
    const firstCalls = results.runs
      .filter((r) => r.model === "gemma-4-31B-it")
      .flatMap((r) => (r.calls ?? []).slice(0, 1))
      .filter((c) => c.status === 200)
      .map((c) => c.latencyMs);
    expect(Math.round(percentile(firstCalls, 50) / 100) / 10).toBe(GEMMA_FIRST_CALL_P50_S); // "first calls alone took 10.2 s"
    const before = JSON.parse(readFileSync(join(ROOT, PREVIOUS_RUN.file), "utf8")) as Results;
    expect(before.meta.partial).toBe(false);
    const beforeGemma = before.scores.find((x) => x.model === "gemma-4-31B-it")!;
    expect(r1(beforeGemma.m10.rate!)).toBe(PREVIOUS_RUN.repeatPct); // run -6: 5.1%
    expect(r1(beforeGemma.m3.rate)).toBe(PREVIOUS_RUN.completePct); // "94.1% in the run before"
    expect(Math.round(beforeGemma.m7.p50Ms! / 100) / 10).toBe(PREVIOUS_RUN.p50s); // "the typical call took 12.0 s and missed"
    expect(Math.round(beforeGemma.m7.p95Ms! / 100) / 10).toBe(PREVIOUS_RUN.p95s);
    expect(Math.round(beforeGemma.m8.costPerPass * 1e5) / 1e5).toBe(PREVIOUS_RUN.costPerPass); // "up from $0.00097"
    // Q-5-02: "$0.00103 a pass ... up to $0.00105 if 1 timed-out call was billed in full ... $0.00102 if it was free".
    // Since run -7 the scorer's costPerPass prices a timed-out call at its prompt size; the high end adds max_tokens.
    {
      const price = { in: 0.18, out: 0.5 };
      const cost = (p: number, c: number) => (p * price.in + c * price.out) / 1e6;
      const ran = results.runs.filter((r) => r.model === "gemma-4-31B-it" && (r.calls ?? []).length > 0);
      let atZero = 0;
      let low = 0;
      let high = 0;
      let timedOut = 0;
      for (const r of ran) {
        for (const c of r.calls ?? []) {
          const answered = cost(c.promptTokens ?? 0, c.completionTokens ?? 0);
          atZero += answered;
          low += answered;
          high += answered;
          if (c.status !== null) continue;
          timedOut++;
          expect(c.maxTokens).toBe(PASS_MAX_TOKENS);
          low += cost(c.estPromptTokens!, 0);
          high += cost(c.estPromptTokens!, c.maxTokens!);
        }
      }
      const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
      expect(timedOut).toBe(GEMMA_COST_RANGE.timedOutCalls);
      expect(gemma.m8.unansweredCalls).toBe(GEMMA_COST_RANGE.timedOutCalls);
      expect(r5(atZero / ran.length)).toBe(GEMMA_COST_RANGE.atZero);
      expect(r5(low / ran.length)).toBe(EVAL_COLUMNS.find((c) => c.model === "gemma-4-31B-it")!.costPerPass);
      expect(r5(high / ran.length)).toBe(GEMMA_COST_RANGE.high);
      expect(r5(gemma.m8.costPerPassHigh!)).toBe(GEMMA_COST_RANGE.high);
      expect(GEMMA_COST_RANGE.maxTokens).toBe(PASS_MAX_TOKENS);
    }
    // "the prompt grew about 9%": mean prompt tokens of answered first calls, this run and the run before.
    {
      const meanFirstPrompt = (rr: RunRow[]) => {
        const p = rr
          .filter((r) => r.model === "gemma-4-31B-it")
          .flatMap((r) => (r.calls ?? []).slice(0, 1))
          .filter((c) => c.status === 200 && c.promptTokens)
          .map((c) => c.promptTokens!);
        return Math.round(p.reduce((a, b) => a + b, 0) / p.length);
      };
      expect(meanFirstPrompt(results.runs)).toBe(GEMMA_FIRST_PROMPT_TOKENS.now);
      expect(meanFirstPrompt(before.runs)).toBe(GEMMA_FIRST_PROMPT_TOKENS.before);
    }
    // "Some clues are still vague: 6 of 133 Wild Finds ... down from 27 of 126": our own checks on the printed clues.
    {
      const vague = (rr: RunRow[], band: "6-10") => {
        const wild = rr.filter((r) => r.model === "gemma-4-31B-it").flatMap((r) => r.items).filter((i) => i.section === "wild");
        return { flagged: wild.filter((i) => jargonProblem(i.clue, band) !== null || triviaProblem(i.clue, band) !== null).length, wild: wild.length };
      };
      expect(results.meta.ageBand).toBe("6-10");
      // r7 follow-ups: the page quotes what the checks of run -7 counted (6 and 27). Today's stricter checks (range and
      // habitat facts, two-word bare colours, plurals, numbered segments) count more on the same printed clues; both
      // are kept so the page number can be synced honestly at the next paid run (GEMMA_VAGUE_CLUES_TODAY).
      expect(vague(results.runs, "6-10")).toEqual({ flagged: GEMMA_VAGUE_CLUES_TODAY.flagged, wild: GEMMA_VAGUE_CLUES.wildPrinted });
      expect(vague(before.runs, "6-10")).toEqual({ flagged: GEMMA_VAGUE_CLUES_TODAY.before, wild: GEMMA_VAGUE_CLUES.beforeWildPrinted });
      expect(GEMMA_VAGUE_CLUES.flagged).toBeLessThanOrEqual(GEMMA_VAGUE_CLUES_TODAY.flagged);
      expect(GEMMA_VAGUE_CLUES.before).toBeLessThanOrEqual(GEMMA_VAGUE_CLUES_TODAY.before);
    }
    // RULES-5-03: "60 test runs (54 passes; 6 runs on the 2 no-data parks made none)"
    const gRuns = results.runs.filter((r) => r.model === "gemma-4-31B-it");
    expect(gRuns.filter((r) => r.kind === "pass")).toHaveLength(GEMMA_RUN_COUNTS.passes);
    const none = gRuns.filter((r) => r.kind !== "pass");
    expect(none).toHaveLength(GEMMA_RUN_COUNTS.noDataRuns);
    expect(none.every((r) => !r.dataRich)).toBe(true);
    expect(new Set(none.map((r) => r.slug)).size).toBe(GEMMA_RUN_COUNTS.noDataParks);
    // "2 of 51 test passes came out short ... on one park with a small pool of finds"
    const gemmaRuns = results.runs.filter((r) => r.model === "gemma-4-31B-it");
    const short = gemmaRuns.filter((r) => r.dataRich && !(r.kind === "pass" && r.items.length >= (r.n ?? 0) - 1));
    expect(short).toHaveLength(GEMMA_SHORT_PASSES.passes);
    expect(new Set(short.map((r) => r.slug)).size).toBe(GEMMA_SHORT_PASSES.parks);
    // "1 first call hit the 30 s limit and was retried ... 1 pass saved": no pass was lost
    expect(gemma.errors).toEqual({});
    const failed = gemmaRuns.flatMap((r) => (r.calls ?? []).map((c, i) => ({ i, c, r }))).filter(({ c }) => c.status !== 200);
    expect(failed.every(({ i }) => i === 0)).toBe(true);
    expect(failed.filter(({ c }) => c.status === null)).toHaveLength(GEMMA_FAILED_FIRST_CALLS.timeouts);
    expect(failed.filter(({ c }) => c.status === 403)).toHaveLength(GEMMA_FAILED_FIRST_CALLS.http403);
    const saved = failed.filter(({ r }) => r.kind === "pass" && r.items.length >= (r.n ?? 0) - 1 && (r.calls ?? []).length >= 2);
    expect(saved).toHaveLength(GEMMA_FAILED_FIRST_CALLS.rescued);
    // "DigitalOcean answered at 47.3 answer tokens a second; at 36.8 in the run before ..."
    const tps = (rr: RunRow[]) =>
      Math.round(
        percentile(
          rr
            .filter((r) => r.model === "gemma-4-31B-it")
            .flatMap((r) => r.calls ?? [])
            .filter((c) => c.status === 200 && c.completionTokens)
            .map((c) => c.completionTokens! / (c.latencyMs / 1000)),
          50,
        ) * 10,
      ) / 10;
    expect(tps(results.runs)).toBe(GEMMA_TOKENS_PER_S.now);
    expect(tps(before.runs)).toBe(GEMMA_TOKENS_PER_S.before);
  });

  it("is a full (not partial) run with a summary file next to it", () => {
    expect(results.meta.partial).toBe(false);
    expect(statSync(join(ROOT, EVAL_SUMMARY_FILE)).isFile()).toBe(true);
    expect(EVAL_TOTAL_USD).toBeCloseTo(results.spend.usd, 4);
  });

  it.each(EVAL_COLUMNS.map((c) => [c.model, c] as const))("%s matches the results JSON", (model, c) => {
    const s = results.scores.find((x) => x.model === model);
    expect(s, model).toBeDefined();
    if (!s) return;
    expect(c.runs).toBe(s.runs);
    expect(c.blockedPrinted).toBe(s.m1.violations);
    expect(c.grounded).toBe(s.m2.grounded);
    expect(c.returned).toBe(s.m2.returned);
    expect(c.groundedPct).toBe(r1(s.m2.rate));
    expect(c.complete).toBe(s.m3.complete);
    expect(c.dataRichRuns).toBe(s.m3.dataRichRuns);
    expect(c.completePct).toBe(r1(s.m3.rate));
    expect(c.honestEmptiesPct).toBe(r1(s.m4.rate));
    expect(c.fkGrade).toBe(Math.round(s.m5.medianGrade * 10) / 10);
    expect(c.nameLeakPct).toBe(r1(s.m6.rate));
    expect(c.clueLeakPct).toBe(r1(s.m6.clueRate));
    expect(c.p50s).toBe(s.m7.p50Ms === null ? null : Math.round(s.m7.p50Ms / 100) / 10);
    expect(c.p95s).toBe(s.m7.p95Ms === null ? null : Math.round(s.m7.p95Ms / 100) / 10);
    expect(c.timeouts).toBe(s.errors.MODEL_TIMEOUT ?? 0);
    expect(c.costPerPass).toBe(Math.round(s.m8.costPerPass * 1e5) / 1e5);
    expect(c.repeated).toBe(s.m10.repeated);
    expect(c.printedClues).toBe(s.m10.clues);
    expect(c.repeatPct).toBe(r1(s.m10.rate ?? NaN));
    expect(c.wrongCounts).toBe(s.m11.printedWrong);
    expect(c.countClues).toBe(s.m11.printedCountClues);
    expect(c.wrongCountsRemoved).toBe(s.m11.rawWrong);
  });
});

describe("/about", () => {
  const html = renderToStaticMarkup(<AboutPage />);
  const t = text(html);

  it("has one h1 and a heading for every part", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    for (const h of [
      "Measured, not promised.",
      "Open model. Real data. Rules in code.",
      "Gemma 4 writes the clues",
      "Safety by code",
      "Honest limits",
      "Why open: the full measured table",
      "What did not pass yet (current limitations)",
      "Privacy: what leaves your device",
      "Credits and licences",
      "Source code",
    ]) {
      expect(t).toContain(h);
    }
    // v3: headings never skip a level (h1 -> h2 -> h3).
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    levels.forEach((l, i) => i > 0 && expect(l - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1));
  });

  it("v3: links to the step-by-step page instead of repeating it, and keeps the key links", () => {
    expect(html).toMatch(/<a[^>]*href="\/how-it-works"[^>]*>See how a pass is made/);
    // SEC-3-01: every <Link> to / in the page source opts out of prefetch (the rendered <a> cannot show it).
    const src = readFileSync(join(ROOT, "src/app/about/page.tsx"), "utf8");
    const homeLinks = src.match(/<Link[^>]*href="\/"[^>]*>/g) ?? [];
    expect(homeLinks.length).toBeGreaterThan(0);
    for (const l of homeLinks) expect(l).toContain("prefetch={false}");
    for (const id of ["measured", "why-open", "privacy", "limits", "privacy-table", "limits-detail", "measured-table", "credits", "all-credits"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });

  it("v3: the stat tiles are the committed eval numbers, and the misses say Missed", () => {
    const tiles = aboutStatTiles();
    const g = EVAL_COLUMNS.find((c) => c.model === "gemma-4-31B-it")!;
    expect(tiles.map((x) => x.value)).toEqual(expect.arrayContaining(["97.2%", "0", "$0.00103", "Grade 2.5", "96.1%", "9.4 s", "2.8%", String(UNIT_TESTS.passed)]));
    expect(tiles.find((x) => x.value === "9.4 s")?.met).toBe(true); // run 2026-10-06-7: p50 9.4 s, p95 13.8 s
    expect(tiles.find((x) => x.value === "96.1%")?.met).toBe(true);
    expect(tiles.find((x) => x.value === "$0.00103")?.met).toBe(false); // over $0.001 (longer prompts)
    expect(tiles.find((x) => x.value === "$0.00103")?.label).toBe("per pass (list price; up to $0.00105 if 1 timed-out call was billed in full)");
    expect(tiles.filter((x) => x.met === false)).toHaveLength(1);
    expect(tiles.find((x) => x.value === `${g.repeatPct}%`)?.met).toBe(true);
    expect(tiles.find((x) => x.value === "0")?.met).toBe(true);
    const list = html.match(/<ul aria-label="Measured results"[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect((list.match(/<li /g) ?? []).length).toBe(tiles.length);
    expect((text(list).match(/Missed/g) ?? []).length).toBe(tiles.filter((x) => x.met === false).length);
    expect(t).toContain("run 2026-10-06-7 (2026-10-06)");
  });

  it("v3: the unit-test tile is dated, and its file count matches tests/unit (re-count when tests are added)", () => {
    const files = readdirSync(join(ROOT, "tests/unit")).filter((f) => /\.test\.tsx?$/.test(f));
    expect(files.length, "update UNIT_TESTS in src/lib/about/content.ts after re-running pnpm test").toBe(UNIT_TESTS.files);
  });

  it("v3: details are folded in closed <details> (keyboard-operable natively), and the visible copy stays short", () => {
    const details = html.match(/<details[^>]*>/g) ?? [];
    expect(details.length).toBeGreaterThanOrEqual(6);
    for (const d of details) expect(d).not.toMatch(/\sopen[\s=>]/);
    expect(html.match(/<summary/g)?.length).toBe(details.length);
    // What a judge sees before opening anything: everything outside the folded bodies.
    const visible = text(html.replace(/<\/summary>[\s\S]*?<\/details>/g, "</summary>"));
    // 650, +10 for the Q-5-02 cost caveat on the cost tile (honesty over brevity).
    expect(visible.split(" ").length).toBeLessThanOrEqual(660);
  });

  it("v3: every privacy row and every source is rendered from the shared data", () => {
    for (const r of privacyRows()) {
      expect(t).toContain(text(r.what));
      expect(t).toContain(text(r.where));
    }
    for (const s of dataSources()) {
      expect(html).toContain(`href="${s.url}"`);
      expect(t).toContain(s.licence);
    }
  });

  it("names the real sources, the model, its licence and where it runs", () => {
    for (const s of ["OpenStreetMap", "iNaturalist", "Wikipedia", "monarch", "gemma-4-31B-it", "Apache-2.0", "DigitalOcean serverless inference"]) {
      expect(t).toContain(s);
    }
    expect(t).toContain("September 15 to November 15");
  });

  it("quotes the measured numbers, failures included", () => {
    for (const s of [
      "97.2% (518/533)",
      "96.1% (49/51)",
      "2.8% (clue only 2.6%)",
      "9.4 s / 13.8 s",
      "$0.00103",
      "2.5",
      "3.2",
      "47.1% complete passes",
      "1 of its 20 test runs ended at its 60 s limit",
      "Gemma passes (2.8% of its clues",
      "Llama 4 Maverick does not (14.6%)",
      "Short passes: 2 of 51 still came out short.",
      "Complete passes meet the goal (Gemma 96.1%, 49 of 51; target 90% or more; 94.1% in the run before).",
      "1 pass saved",
      "The short ones were on one park with a small pool of finds",
      "Cost is just over the goal: Gemma $0.00103 a pass.",
      "up from $0.00097 in the run before (2026-10-06-6), because the prompt grew about 9%",
      "1 call timed out with no answer; it is priced at its prompt size, up to $0.00105 if 1 timed-out call was billed in full, and $0.00102 if it was free.",
      "A 10-13 pass in the small 10-13 check cost $0.00117.",
      "Some clues are still vague: 6 of 133 Wild Finds.",
      "down from 27 of 126 in the run before",
      "Peek at a bird that is yellow.",
      "a bird that is resident in the central United States",
      "2.8% (11/390)",
      "0 of 86 count clues (4 removed)",
      "Speed met the goal this run, thanks to a fast provider (9.4 s typical, 13.8 s slow).",
      "The typical call took 9.37 s; first calls alone took 10.2 s",
      "47.3 answer tokens a second; at 36.8 in the run before, the typical call took 12.0 s and missed",
      "1 first call hit the 30 s limit and was retried",
      "One to three calls per pass.",
      "and Lucky Finds (the test parks have no recorded Google Maps review counts",
    ]) {
      expect(t).toContain(s);
    }
    expect(t).toContain("No closed model was compared");
    expect(t).toContain("Find This Spot");
    // S6: Lucky Finds are built; the page states the free-plan limits and the review-text rule.
    expect(t).toContain("Lucky Finds run on a free plan.");
    expect(t).toContain("allows 250 searches a month");
    expect(t).toContain("stops at 12 searches a day and 200 a month");
    expect(t).toContain("We count mentions in Google Maps reviews via SerpApi; review text is never shown or sent to the AI");
    expect(t).toContain("Lucky Finds: Google Maps review counts via SerpApi");
    expect(t).not.toContain("not available yet");
    expect(t).not.toContain("known bug we are fixing");
    // Judge G1 (2026-10-06): self-hosting is measured now; the page gives the result, not "not measured".
    expect(t).not.toMatch(/not measured/i);
    expect(t).toContain("Self-hosting works, but slowly on a laptop.");
    expect(t).toContain("Self-hosted on a laptop CPU: $0, but slow.");
  });

  it("lists every blocked group from the safety code", () => {
    for (const b of BLOCKED_TAXA) expect(t).toContain(b.common);
  });

  it("tables have captions, column and row headers, and keyboard-reachable scroll regions", () => {
    expect(html.match(/<caption/g)).toHaveLength(2);
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html.match(/role="region"[^>]*tabindex="0"/g)).toHaveLength(2);
  });

  it("states the privacy facts honestly (no 'never leaves your device' claim)", () => {
    expect(t).toContain("about 1 km");
    expect(t).toContain("Saved in our storage (Upstash Redis) for 30 days");
    // SEC-1-03: the third-party storage and the hosting provider's request logs are named.
    expect(t).toContain("Upstash Redis");
    expect(t).toContain("request logs (Vercel)");
    expect(t).toContain("never the address itself");
    expect(t).not.toContain("Our server only");
    expect(t).toContain("so park facts and the age band leave your device");
    expect(t.toLowerCase()).not.toContain("never leaves your device");
    // Accounts exist now (sign-in to make a new pass): no "no accounts" claim anywhere on the page.
    expect(t).not.toMatch(/no accounts/i);
  });

  it("explains every results row in plain words, and keeps the numbers", () => {
    expect(t).toContain("In short:");
    expect(t).toContain("3 means a 3rd grader can read them");
    expect(t).toContain("a usual wait / a slow wait");
  });

  it("links to the GitHub repo", () => {
    expect(html).toContain(`href="${REPO_URL}"`);
    expect(html).toContain(`href="${REPO_URL}/blob/main/${EVAL_SUMMARY_FILE}"`);
  });

  it("R1-m11/m13: credits the Llama licence, the banner's origin and the reused pre-period code precisely", () => {
    expect(t).toContain("Eval comparison: Llama 4 Maverick (Llama 4 Community Licence)");
    expect(t).toContain("the original banner was made by Kevin with Google Gemini; the logo and scene are a traced, hand-cleaned SVG redraw of it.");
    expect(t).toContain("unpublished practice project, written on Oct 2, 2026, before the contest entry period");
    expect(t).toContain("Everything specific to Grass Pass was written from Oct 5, 2026.");
    // Default model is Gemma: no "Built with Llama" badge, only the explanation of when it shows.
    expect(html).not.toContain('data-testid="built-with-llama"');
  });
});

describe("/about with a Llama model configured", () => {
  it("shows 'Built with Llama' (Llama 4 Community Licence)", () => {
    const before = process.env.MODEL_ID;
    process.env.MODEL_ID = "llama-4-maverick";
    try {
      const html = renderToStaticMarkup(<AboutPage />);
      expect(html).toContain('data-testid="built-with-llama"');
      expect(text(html)).toContain("Built with Llama : this site is set to use a Llama model right now.");
    } finally {
      if (before === undefined) delete process.env.MODEL_ID;
      else process.env.MODEL_ID = before;
    }
  });
});

describe("site header and footer", () => {
  it("header links to /about", () => {
    const html = renderToStaticMarkup(<SiteHeader />);
    expect(html).toMatch(/<nav aria-label="Site"/);
    expect(html).toMatch(/<a[^>]*href="\/about"[^>]*>About<\/a>/);
  });

  it("footer: credits line, about link, repo link; never printed", () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    const t = text(html);
    expect(html).toMatch(/^<footer[^>]*print:hidden/);
    expect(t).toContain("OpenStreetMap contributors (ODbL)");
    expect(t).toContain("iNaturalist");
    expect(t).toContain("Apache-2.0");
    expect(html).toMatch(/<a[^>]*href="\/about"[^>]*>About<\/a>/);
    expect(html).toContain(`href="${REPO_URL}"`);
    // The pass page and park list own the "© OpenStreetMap contributors" link name (e2e looks it up).
    expect(html).not.toMatch(/>© OpenStreetMap contributors</);
  });
});

describe("fonts are self-hosted", () => {
  const fontsDir = join(ROOT, "src/app/fonts");

  it("ships the woff2 files and every OFL licence (v3 site fonts + the printed pass fonts)", () => {
    const files = readdirSync(fontsDir).sort();
    expect(files).toEqual([
      "OFL-BricolageGrotesque.txt",
      "OFL-DMSans.txt",
      "bricolage-grotesque-latin-wght-normal.woff2",
      "dm-sans-latin-wght-normal.woff2",
      "OFL-Fredoka.txt",
      "OFL-Nunito.txt",
      "fredoka-latin-600-normal.woff2",
      "fredoka-latin-700-normal.woff2",
      "nunito-latin-400-normal.woff2",
      "nunito-latin-600-normal.woff2",
      "nunito-latin-700-normal.woff2",
    ].sort());
    for (const f of files.filter((x) => x.endsWith(".woff2"))) {
      expect(readFileSync(join(fontsDir, f)).subarray(0, 4).toString("latin1"), f).toBe("wOF2");
    }
    for (const f of ["OFL-Fredoka.txt", "OFL-Nunito.txt", "OFL-BricolageGrotesque.txt", "OFL-DMSans.txt"]) {
      expect(readFileSync(join(fontsDir, f), "utf8")).toContain("SIL Open Font License, Version 1.1");
    }
  });

  it("the layout uses next/font/local with the same CSS variables, and nothing imports next/font/google", () => {
    const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('from "next/font/local"');
    // next/font/local names the family after the const (brand e2e checks document.fonts).
    expect(layout).toContain("const BricolageGrotesque = localFont(");
    expect(layout).toContain("const DMSans = localFont(");
    expect(layout).toContain('variable: "--font-bricolage"');
    expect(layout).toContain('variable: "--font-dm-sans"');
    // The printed pass keeps Fredoka + Nunito (print.css), not preloaded on screen pages.
    expect(layout).toContain("const Fredoka = localFont(");
    expect(layout).toContain("const Nunito = localFont(");
    expect(layout).toContain('variable: "--font-fredoka"');
    expect(layout).toContain('variable: "--font-nunito"');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    for (const f of walk(join(ROOT, "src")).filter((x) => /\.(ts|tsx|css)$/.test(x))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+["']next\/font\/google["']|@import[^;]*fonts\.googleapis/);
    }
  });
});

describe("audit rounds line (one constant)", () => {
  it("says five rounds, from AUDIT_ROUNDS", async () => {
    const { AUDIT_ROUNDS, auditRoundsLine } = await import("@/lib/about/content");
    expect(AUDIT_ROUNDS.done).toBe(5);
    expect(auditRoundsLine()).toBe("Five rounds so far (Oct 6, 2026).");
    expect(auditRoundsLine({ done: 1, day: "x" })).toBe("One round so far (x).");
    expect(auditRoundsLine({ done: 12, day: "x" })).toBe("12 rounds so far (x).");
  });
});
