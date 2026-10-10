import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HowItWorksPage from "@/app/how-it-works/page";
import { howLimits } from "@/lib/about/content";
import { EVAL_THRESHOLDS, SMOKE_10_13, SMOKE_13PLUS, evalColumn } from "@/lib/about/eval-summary";
import { HARD_EXTRA } from "@/lib/ai/prompt";
import { DROP_REASONS } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
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

const html = renderToStaticMarkup(<HowItWorksPage />);
const t = text(html);

describe("/how-it-works (Kevin, 2026-10-06): the app and the AI process in detail, accurate to the code", () => {
  it("has one h1 and the Blueprint sections (Kevin 2026-10-09); #why-open still exists for the footer link", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(t).toContain("How a park becomes a pass.");
    for (const id of ["blueprint", "ai", "why-open", "numbers", "services", "fine-print", "limits", "privacy", "steps", "measured-detail", "built"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    // The diagram links each model job to its example card.
    for (const n of [1, 2, 3]) {
      expect(html).toContain(`href="#ai-job-${n}"`);
      expect(html).toContain(`id="ai-job-${n}"`);
    }
  });

  it("the folded walk-through is an ordered list of text steps, each saying who does it; the AI does exactly one", () => {
    const list = html.match(/<ol aria-label="How a pass is made, step by step"[\s\S]*?<\/ol>/)?.[0] ?? "";
    expect(list).not.toBe("");
    expect((list.match(/<li /g) ?? []).length).toBe(9);
    expect((list.match(/Done by the open model/g) ?? []).length).toBe(1);
    expect(list).not.toMatch(/<img/);
  });

  it("explains every drop reason the checks use, in plain words (a new reason fails the type check until it is added)", () => {
    for (const r of DROP_REASONS) {
      expect(html, r).toContain(`>${r}</code>`);
      expect(t, r).toContain(text(DROP_REASON_INFO[r].plain));
    }
    expect(DROP_REASON_INFO.name_trait.kind).toBe("preference");
    expect(DROP_REASON_INFO.name_leak.kind).toBe("always");
  });

  it("names the model really configured, where it runs, and what it is and isn't given", () => {
    expect(t).toContain("gemma-4-31B-it");
    expect(t).toContain("Apache-2.0");
    expect(t).toContain("DigitalOcean serverless inference");
    expect(t).toContain("There is no automatic switch to another model");
    expect(t).toContain("What it is NOT given: review text, reviewer names or review counts");
    expect(t).toContain(`removes ${BLOCKED_TAXA.length} groups of risky species`);
  });

  it("quotes the measured numbers of the full run and the newest smoke, and marks the misses", () => {
    const g = evalColumn("gemma-4-31B-it");
    expect(t).toContain(`$${g.costPerPass.toFixed(5)}`);
    expect(t).toContain("2026-10-10-3");
    expect(t).toContain("2026-10-06-partial-2320");
    expect(t).toContain(`about $${SMOKE_10_13.costPerFinishedPass.toFixed(5)}, which is over`);
    expect(t).toContain(`${SMOKE_10_13.complete} of ${SMOKE_10_13.parks} passes complete in ${SMOKE_10_13.calls} model calls`);
    // RULES-6-03: the smoke's speed and name-leak misses are labelled, like its cost.
    expect(SMOKE_10_13.p50s > EVAL_THRESHOLDS.p50s && SMOKE_10_13.nameLeakPct > EVAL_THRESHOLDS.nameLeakPct).toBe(true);
    // (`t` puts a space at each tag edge, so "(<strong>over" reads "( over" here.) Smoke partial-2320: only the typical
    // time is over; the slow one is under 20 s.
    expect(SMOKE_10_13.p95s).toBeLessThanOrEqual(EVAL_THRESHOLDS.p95s);
    expect(t).toMatch(new RegExp(`${SMOKE_10_13.p50s} s typical \\( ?over the ${EVAL_THRESHOLDS.p50s} s target\\) and ${SMOKE_10_13.p95s} s slow \\(under ${EVAL_THRESHOLDS.p95s} s\\)`));
    expect(t).toMatch(new RegExp(`${SMOKE_10_13.nameLeakPct}% of its clues named their answer \\( ?over the ${EVAL_THRESHOLDS.nameLeakPct}% target\\)`));
    // Run 2026-10-10-3 (after the Oct 10 wording rewrite): cost and speed (the slow calls) missed, complete passes and
    // repetition met; the table says so.
    const rows = [...html.matchAll(/<tr [^>]*><th scope="row"[^>]*>([^<]+)<\/th>(?:<td[^>]*>[^<]*<\/td>){2}<td[^>]*>(Met|Missed)<\/td>/g)].map((m) => [m[1], m[2]]);
    expect(rows).toContainEqual(["Model time per call, typical / slow", "Missed"]);
    expect(rows).toContainEqual(["Cost per pass for the clues (DigitalOcean list prices; trip tips add one more short call)", "Missed"]);
    expect(t).toContain("$0.00107 (up to $0.00111 if 4 timed-out calls were billed in full)");
    expect(rows).toContainEqual(["Complete passes (at most 1 find missing)", "Met"]);
    expect(t).toContain("Speed is met for a typical call and missed for the slow ones: the typical call took 9.47 s, first calls alone 11 s, with DigitalOcean answering at 44.8 answer tokens a second (39.5 the run before, when speed was missed)");
    expect(t).toContain("Time limits are sized to each call (up to 40 s for a first call). This is the first full run after the Oct 10 clue-wording rewrite; the run before is 2026-10-06-9.");
    expect(rows).toContainEqual(["Clues repeated across parks", "Met"]);
    expect(rows).toContainEqual(["Blocked species printed", "Met"]);
    expect(g.repeatPct).toBeLessThanOrEqual(EVAL_THRESHOLDS.repeatPct);
    expect(g.costPerPass).toBeGreaterThan(EVAL_THRESHOLDS.costPerPass);
    expect(SMOKE_10_13.hardKept).toBe(SMOKE_10_13.parks);
    expect(t).toContain(`all ${SMOKE_10_13.hardKept} with their 2 hard finds`);
    // RULES-7-01: every code edit to a printed clue is listed; no "only two edits".
    expect(t).not.toContain("only two edits");
    expect(t).toContain('swaps a worn-out opening ("Somewhere you will see a") for a plain word ("Spot a"), and says "What", not "Who", for a plant, fungus or lichen.');
    // RULES-7-06: the wait line went with the 10-second section (Kevin 2026-10-08); no shorter claim may replace it.
    expect(t).not.toContain("usually takes 10-30 seconds.");
    // RULES-7-02: the self-host numbers say "complete", not "finished in the app's normal time" (the card's short line
    // since the Blueprint, 2026-10-09; the numbers are in the folded limits).
    expect(t).toContain("On a laptop CPU it costs $0, but it is slow.");
    expect(t).toContain("0 of 5 passes were complete");
  });

  it("RULES-8-04: the open-model card says ages 6-10, and the 13+ check is quoted with its over-target label", () => {
    const g = evalColumn("gemma-4-31B-it");
    expect(t).toContain(`On 20 parks, ages 6-10: $${g.costPerPass.toFixed(5)} a pass for the clue calls (trip tips add one more short call), reading grade ${g.fkGrade.toFixed(1)}`);
    // (`t` puts a space at each tag edge: "partial-1617 ,".)
    expect(t).toMatch(/Teens and adults \(13\+\), a smaller partial check \(run 2026-10-07-partial-1617 ?, 2026-10-07, 3 parks, one run each,/);
    expect(t).toContain("3 of 3 passes complete (at most one find short; 2 printed every find) in 6 model calls, 2 of 3 with their 3 hard finds, 9.5 s typical and 11.8 s slow (within the 10 s / 20 s targets), 2.4% of clues named their answer before the checks (code removed them).");
    expect(t).toMatch(/A 13\+ pass cost about \$0\.00162, which is over the \$0\.00100 target\./);
    expect(t).toContain("Its clues read at grade 3.9; the grade 3.5 reading target is for kids and does not apply to 13+.");
    // The labels follow the numbers: speed and name leaks within target, cost over.
    expect(SMOKE_13PLUS.p50s).toBeLessThanOrEqual(EVAL_THRESHOLDS.p50s);
    expect(SMOKE_13PLUS.p95s).toBeLessThanOrEqual(EVAL_THRESHOLDS.p95s);
    expect(SMOKE_13PLUS.nameLeakPct).toBeLessThanOrEqual(EVAL_THRESHOLDS.nameLeakPct);
    expect(SMOKE_13PLUS.costPerPass).toBeGreaterThan(EVAL_THRESHOLDS.costPerPass);
  });

  it("RULES-8-07: the hard-find wording matches HARD_EXTRA (asked for one more than promised, as a spare)", () => {
    expect(HARD_EXTRA).toBe(1);
    expect(t).toContain("For the bands with hard finds, the model is asked for one more hard find than the pass promises (3 for 10-13, 4 for 13+), as a spare, so one dropped hard clue still leaves the promised number.");
  });

  it("RULES-8-01: the checks line describes what CI runs and where its result is, not that every change passed", () => {
    expect(t).not.toContain("Every change passes");
    expect(t).toContain("on every push to main. Each run's result, green or red, is public on the repo's Actions tab.");
  });

  it("the 13+ check numbers match the committed results JSON", () => {
    const j = JSON.parse(readFileSync(join(ROOT, SMOKE_13PLUS.file), "utf8")) as {
      meta: { day: string; ageBand: string; partial: boolean; settings: { cases: number[] } };
      scores: { model: string; errors: Record<string, number>; m3: { complete: number }; m5: { medianGrade: number }; m6: { rate: number }; m7: { calls: number; p50Ms: number; p95Ms: number }; m8: { costPerPass: number }; hard: { checked: number; met: number; hardMin: number | null }; drops: { byRun: { kept: number; n: number }[] } }[];
    };
    const s = j.scores.find((x) => x.model === "gemma-4-31B-it")!;
    expect(j.meta.partial).toBe(true);
    expect(j.meta.day).toBe(SMOKE_13PLUS.day);
    expect(j.meta.ageBand).toBe(SMOKE_13PLUS.ageBand);
    expect(j.meta.settings.cases).toHaveLength(SMOKE_13PLUS.parks);
    expect(s.errors).toEqual({});
    expect(s.m3.complete).toBe(SMOKE_13PLUS.complete);
    expect(s.drops.byRun.filter((r) => r.kept === r.n)).toHaveLength(SMOKE_13PLUS.full);
    expect(s.m7.calls).toBe(SMOKE_13PLUS.calls);
    expect(Math.round(s.m5.medianGrade * 10) / 10).toBe(SMOKE_13PLUS.fkGrade);
    expect(Math.round(s.m6.rate * 1000) / 10).toBe(SMOKE_13PLUS.nameLeakPct);
    expect(Math.round(s.m7.p50Ms / 100) / 10).toBe(SMOKE_13PLUS.p50s);
    expect(Math.round(s.m7.p95Ms / 100) / 10).toBe(SMOKE_13PLUS.p95s);
    expect(Math.round(s.m8.costPerPass * 1e5) / 1e5).toBe(SMOKE_13PLUS.costPerPass);
    expect(s.hard).toMatchObject({ checked: SMOKE_13PLUS.parks, met: SMOKE_13PLUS.hardKept, hardMin: SMOKE_13PLUS.hardMin });
  });

  it("the 10-13 smoke numbers match the committed results JSON", () => {
    const j = JSON.parse(readFileSync(join(ROOT, SMOKE_10_13.file), "utf8")) as {
      meta: { day: string; ageBand: string; partial: boolean; settings: { cases: number[] } };
      scores: { model: string; errors: Record<string, number>; m3: { complete: number }; m5: { medianGrade: number }; m6: { rate: number }; m7: { p50Ms: number; p95Ms: number }; m8: { costPerPass: number }; hard: { checked: number; met: number; hardMin: number | null } }[];
      runs: { model: string; kind: string; calls?: unknown[] }[];
      spend: { usd: number };
    };
    const s = j.scores.find((x) => x.model === "gemma-4-31B-it")!;
    expect(j.meta.partial).toBe(true);
    expect(j.meta.ageBand).toBe(SMOKE_10_13.ageBand);
    expect(j.meta.settings.cases).toHaveLength(SMOKE_10_13.parks);
    expect(s.m3.complete).toBe(SMOKE_10_13.complete);
    expect(Math.round(s.m5.medianGrade * 10) / 10).toBe(SMOKE_10_13.fkGrade);
    expect(Math.round(s.m6.rate * 1000) / 10).toBe(SMOKE_10_13.nameLeakPct);
    expect(Math.round(s.m7.p50Ms / 100) / 10).toBe(SMOKE_10_13.p50s);
    expect(Math.round(s.m7.p95Ms / 100) / 10).toBe(SMOKE_10_13.p95s);
    expect(Math.round(s.m8.costPerPass * 1e5) / 1e5).toBe(SMOKE_10_13.costPerPass);
    // Q-5-05: "all 3 with their 2 hard finds" (partial-2320)
    expect(s.hard).toMatchObject({ checked: SMOKE_10_13.parks, met: SMOKE_10_13.hardKept, hardMin: 2 });
    const finished = j.runs.filter((r) => r.model === "gemma-4-31B-it" && r.kind === "pass").length;
    expect(finished).toBe(3);
    expect(j.runs.filter((r) => r.model === "gemma-4-31B-it").reduce((a, r) => a + (r.calls ?? []).length, 0)).toBe(SMOKE_10_13.calls);
    expect(Math.round((j.spend.usd / finished) * 1e5) / 1e5).toBe(SMOKE_10_13.costPerFinishedPass);
    expect(j.scores.find((x) => x.model === "gemma-4-31B-it")!.errors).toEqual({});
    expect(SMOKE_10_13.timeouts).toBe(0);
  });

  it("Blueprint (2026-10-09): every detail is folded into closed disclosures; the visible page stays short", () => {
    for (const d of html.match(/<details[^>]*>/g) ?? []) expect(d).not.toMatch(/\sopen[\s=>]/);
    // The walk-through, the measured table and the limits are each inside a closed disclosure.
    const visibleHtml = html.replace(/<\/summary>[\s\S]*?<\/details>/g, "</summary>");
    expect(visibleHtml).not.toContain('aria-label="How a pass is made, step by step"');
    expect(visibleHtml).not.toContain("measured-caption");
    const visible = text(visibleHtml.replace(/<span class="sr-only">[^<]*<\/span>/g, " "));
    // Kevin asked for about 400 words (the old page showed 1,046 in the browser). The real examples and the services
    // table are quoted in full. This static count also sees the phone-only copy of each table cell and the arrows'
    // punctuation, so its cap is looser than the browser count in tests/e2e/how-blueprint.spec.ts.
    // Oct 9 (r11): + the "Runs on DigitalOcean" panel, the no-AI clue and the DigitalOcean row (browser count 788 -> 932).
    expect(visible.split(" ").length).toBeLessThanOrEqual(1050);
    // Every honest limit stays one click away, from the shared data.
    for (const l of howLimits()) expect(t).toContain(text(l.title));
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    levels.forEach((l, i) => i > 0 && expect(l - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1));
  });

  it("links to the privacy table, the About page and the source code", () => {
    expect(html).toContain('href="/about#privacy-table"');
    // SEC-3-01: every <Link> to / in the page source opts out of prefetch (the rendered <a> cannot show it).
    const src = readFileSync(join(ROOT, "src/app/how-it-works/page.tsx"), "utf8");
    const homeLinks = src.match(/<Link[^>]*href="\/"[^>]*>/g) ?? [];
    expect(homeLinks.length).toBeGreaterThan(0);
    for (const l of homeLinks) expect(l).toContain("prefetch={false}");
    expect(html).toContain(`href="${REPO_URL}"`);
    expect(t).toContain("Claude Code");
  });
});
