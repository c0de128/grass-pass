import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HowItWorksPage from "@/app/how-it-works/page";
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
    expect(t).toContain("How Grass Pass works");
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
    expect(t).toContain(`${BLOCKED_TAXA.length} blocked groups`);
  });

  it("quotes the measured numbers of the full run and the newest smoke, and marks the misses", () => {
    const g = evalColumn("gemma-4-31B-it");
    expect(t).toContain(`$${g.costPerPass.toFixed(5)}`);
    expect(t).toContain("2026-10-06-3");
    expect(t).toContain("2026-10-06-partial-1015");
    expect(t).toContain(`$${SMOKE_10_13.costPerPass.toFixed(5)} per pass, which is over`);
    // Speed and repetition were missed in run 2026-10-06-3: the table must say so.
    const rows = [...html.matchAll(/<tr [^>]*><th scope="row"[^>]*>([^<]+)<\/th>(?:<td[^>]*>[^<]*<\/td>){2}<td[^>]*>(Met|Missed)<\/td>/g)].map((m) => [m[1], m[2]]);
    expect(rows).toContainEqual(["Model time per call, typical / slow", "Missed"]);
    expect(rows).toContainEqual(["Clues repeated across parks", "Missed"]);
    expect(rows).toContainEqual(["Blocked species printed", "Met"]);
    expect(g.repeatPct).toBeGreaterThan(EVAL_THRESHOLDS.repeatPct);
  });

  it("the 10-13 smoke numbers match the committed results JSON", () => {
    const j = JSON.parse(readFileSync(join(ROOT, SMOKE_10_13.file), "utf8")) as {
      meta: { day: string; ageBand: string; partial: boolean; settings: { cases: number[] } };
      scores: { model: string; m3: { complete: number }; m5: { medianGrade: number }; m6: { rate: number }; m7: { p50Ms: number; p95Ms: number }; m8: { costPerPass: number } }[];
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
  });

  it("links to the privacy table, the About page and the source code", () => {
    expect(html).toContain('href="/about#privacy"');
    expect(html).toContain(`href="${REPO_URL}"`);
    expect(t).toContain("Claude Code");
  });
});
