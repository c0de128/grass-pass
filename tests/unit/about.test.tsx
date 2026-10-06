import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage from "@/app/about/page";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { EVAL_COLUMNS, EVAL_RESULTS_FILE, EVAL_SUMMARY_FILE, EVAL_TOTAL_USD } from "@/lib/about/eval-summary";
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
  m8: { costPerPass: number };
};
type Results = { meta: { day: string; ageBand: string; partial: boolean }; cases: unknown[]; scores: Score[]; spend: { usd: number } };

const results = JSON.parse(readFileSync(join(ROOT, EVAL_RESULTS_FILE), "utf8")) as Results;
const r1 = (x: number) => Math.round(x * 1000) / 10; // rate -> percent, 1 decimal

describe("about page numbers come from the committed eval run", () => {
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
  });
});

describe("/about", () => {
  const html = renderToStaticMarkup(<AboutPage />);
  const t = text(html);

  it("has one h1 and a heading for every part", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    for (const h of ["How a pass is made", "Why open", "What did not pass yet (current limitations)", "Privacy: what leaves your device", "Credits and licences", "Source code"]) {
      expect(t).toContain(h);
    }
  });

  it("names the real sources, the model, its licence and where it runs", () => {
    for (const s of ["OpenStreetMap", "iNaturalist", "Wikipedia", "monarch", "gemma-4-31B-it", "Apache-2.0", "DigitalOcean serverless inference"]) {
      expect(t).toContain(s);
    }
    expect(t).toContain("September 15 to November 15");
  });

  it("quotes the measured numbers, failures included", () => {
    for (const s of ["99.6%", "100% (51/51)", "10.5%", "6.7%", "8.9 s / 12.8 s", "$0.00064", "1.7", "5.8", "39.2 s typical", "41.2% complete passes", "Answers that name themselves: 10.5%"]) {
      expect(t).toContain(s);
    }
    expect(t).toContain("No closed model was compared");
    expect(t).toContain("Find This Spot");
    expect(t).toMatch(/Lucky Finds .*not available yet/);
    expect(t).not.toContain("known bug we are fixing");
    expect(t).toContain("We have not measured a self-hosted run for this app yet.");
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
    expect(t).toContain("the park facts and the age band do leave your device");
    expect(t.toLowerCase()).not.toContain("never leaves your device");
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
    expect(html).toMatch(/<nav aria-label="Site">/);
    expect(html).toMatch(/<a[^>]*href="\/about"[^>]*>About<\/a>/);
  });

  it("footer: credits line, about link, repo link; never printed", () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    const t = text(html);
    expect(html).toMatch(/^<footer[^>]*print:hidden/);
    expect(t).toContain("OpenStreetMap contributors (ODbL)");
    expect(t).toContain("iNaturalist");
    expect(t).toContain("Apache-2.0");
    expect(html).toMatch(/<a[^>]*href="\/about"[^>]*>About Grass Pass<\/a>/);
    expect(html).toContain(`href="${REPO_URL}"`);
    // The pass page and park list own the "© OpenStreetMap contributors" link name (e2e looks it up).
    expect(html).not.toMatch(/>© OpenStreetMap contributors</);
  });
});

describe("fonts are self-hosted", () => {
  const fontsDir = join(ROOT, "src/app/fonts");

  it("ships the five woff2 files and both OFL licences", () => {
    const files = readdirSync(fontsDir).sort();
    expect(files).toEqual([
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
    for (const f of ["OFL-Fredoka.txt", "OFL-Nunito.txt"]) {
      expect(readFileSync(join(fontsDir, f), "utf8")).toContain("SIL Open Font License, Version 1.1");
    }
  });

  it("the layout uses next/font/local with the same CSS variables, and nothing imports next/font/google", () => {
    const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('from "next/font/local"');
    // next/font/local names the family after the const: keep "Fredoka" / "Nunito" (brand e2e checks document.fonts).
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
