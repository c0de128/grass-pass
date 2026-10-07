import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HowItWorksPage from "@/app/how-it-works/page";
import { howLimits } from "@/lib/about/content";
import { EVAL_THRESHOLDS, SMOKE_10_13, evalColumn } from "@/lib/about/eval-summary";
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
  it("has one h1, the seven sections and an in-page index", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(t).toContain("How a park becomes a pass.");
    for (const id of ["quick", "steps", "ai-role", "why-open", "limits", "privacy", "built"]) {
      expect(html, id).toContain(`id="${id}"`);
      expect(html, id).toContain(`href="#${id}"`);
    }
  });

  it("the step diagram is an ordered list of text steps, each saying who does it; the AI does exactly one", () => {
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
    expect(t).toContain("2026-10-06-7");
    expect(t).toContain("2026-10-06-partial-1853");
    expect(t).toContain(`about $${SMOKE_10_13.costPerFinishedPass.toFixed(5)}, which is over`);
    expect(t).toContain(`${SMOKE_10_13.complete} of ${SMOKE_10_13.parks} passes complete in ${SMOKE_10_13.calls} model calls`);
    // Run 2026-10-06-7: cost missed; speed, repetition and complete passes met; the table must say so.
    const rows = [...html.matchAll(/<tr [^>]*><th scope="row"[^>]*>([^<]+)<\/th>(?:<td[^>]*>[^<]*<\/td>){2}<td[^>]*>(Met|Missed)<\/td>/g)].map((m) => [m[1], m[2]]);
    expect(rows).toContainEqual(["Model time per call, typical / slow", "Met"]);
    expect(rows).toContainEqual(["Cost per pass (DigitalOcean list prices)", "Missed"]);
    expect(t).toContain("$0.00103 (up to $0.00105 if 1 timed-out call was billed in full)");
    expect(rows).toContainEqual(["Complete passes (at most 1 find missing)", "Met"]);
    expect(t).toContain("Speed is met: the typical call took 9.37 s, first calls alone 10.2 s, with DigitalOcean answering at 47.3 answer tokens a second (36.8 the run before, when speed was missed)");
    expect(rows).toContainEqual(["Clues repeated across parks", "Met"]);
    expect(rows).toContainEqual(["Blocked species printed", "Met"]);
    expect(g.repeatPct).toBeLessThanOrEqual(EVAL_THRESHOLDS.repeatPct);
    expect(g.costPerPass).toBeGreaterThan(EVAL_THRESHOLDS.costPerPass);
    expect(t).toContain(`all ${SMOKE_10_13.hardKept} with their 2 hard finds`);
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
    // Q-5-05: "all 3 with their 2 hard finds"
    expect(s.hard).toMatchObject({ checked: SMOKE_10_13.parks, met: SMOKE_10_13.hardKept, hardMin: 2 });
    const finished = j.runs.filter((r) => r.model === "gemma-4-31B-it" && r.kind === "pass").length;
    expect(finished).toBe(3);
    expect(j.runs.filter((r) => r.model === "gemma-4-31B-it").reduce((a, r) => a + (r.calls ?? []).length, 0)).toBe(SMOKE_10_13.calls);
    expect(Math.round((j.spend.usd / finished) * 1e5) / 1e5).toBe(SMOKE_10_13.costPerFinishedPass);
    expect(j.scores.find((x) => x.model === "gemma-4-31B-it")!.errors).toEqual({});
    expect(SMOKE_10_13.timeouts).toBe(0);
  });

  it("v3: every step shows a short summary and folds its detail into a closed disclosure; visible copy stays short", () => {
    const list = html.match(/<ol aria-label="How a pass is made, step by step"[\s\S]*?<\/ol>/)?.[0] ?? "";
    expect((list.match(/<details/g) ?? []).length).toBe(9);
    for (const d of html.match(/<details[^>]*>/g) ?? []) expect(d).not.toMatch(/\sopen[\s=>]/);
    const visible = text(html.replace(/<\/summary>[\s\S]*?<\/details>/g, "</summary>"));
    expect(visible.split(" ").length).toBeLessThanOrEqual(1250);
    // Honest limits stay visible as titles, and every one comes from the shared data.
    for (const l of howLimits()) expect(text(visible)).toContain(l.title);
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
