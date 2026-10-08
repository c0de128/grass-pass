/**
 * Kevin, 2026-10-08: the 10-second winding-path explainer at the top of /how-it-works ("I want the judges to understand it
 * within 10 seconds. Be sure to include how/where AI is used along the way."). Real text in an ordered list, every
 * stop tagged with what does the work, the AI stops marked, the road decorative, and every number read from code.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HowItWorksPage from "@/app/how-it-works/page";
import { HowPath } from "@/components/how/HowPath";
import { MAX_MODEL_CALLS } from "@/lib/ai/build-pass";
import { PATH_MAX_MODEL_CALLS, PATH_STEPS, PATH_WHO } from "@/lib/how/path";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { WILD_WINDOW_DAYS } from "@/lib/sources/inat";

const ROOT = resolve(__dirname, "../..");
const html = renderToStaticMarkup(<HowPath />);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("/how-it-works winding path (Kevin, 2026-10-08)", () => {
  const list = html.match(/<ol aria-label="How Grass Pass works, in 8 stops"[\s\S]*?<\/ol>/)?.[0] ?? "";
  const items = list.match(/<li [\s\S]*?<\/li>/g) ?? [];

  it("is an ordered list of 8 text stops, each with a title, one short line and a badge", () => {
    expect(list).not.toBe("");
    expect(items).toHaveLength(PATH_STEPS.length);
    expect(PATH_STEPS).toHaveLength(8);
    PATH_STEPS.forEach((s, i) => {
      const li = text(items[i]);
      expect(li, s.id).toContain(s.title);
      expect(li, s.id).toContain(s.line);
      expect(li, s.id).toContain(PATH_WHO[s.who].badge);
      expect(s.line.split(/\s+/).length, s.id).toBeLessThanOrEqual(12);
      expect(items[i]).toMatch(/<h3[\s>]/);
    });
  });

  it("shows where the open model works (at least one AI stop, marked AI, Gemma 4) and ends on Touch grass", () => {
    const ai = PATH_STEPS.filter((s) => s.who === "ai");
    expect(ai.length).toBeGreaterThanOrEqual(1);
    expect(PATH_WHO.ai.badge).toBe("AI · Gemma 4");
    expect((list.match(/data-who="ai"/g) ?? []).length).toBe(ai.length);
    expect(PATH_STEPS.at(-1)?.title).toBe("Touch grass");
    // The 10-second read sits above the list: data in, the open model writes, code checks, paper out.
    expect(text(html)).toMatch(/Real data in .*Open model writes .*Code checks .*Paper out/);
    // "Open AI" would read as the company; the legend says "open model".
    expect(text(html)).not.toMatch(/Open ?AI/);
  });

  it("the road, stop numbers and grass are decorative; no images, no text inside the SVGs", () => {
    expect(html).not.toMatch(/<img/);
    for (const svg of html.match(/<svg[\s\S]*?<\/svg>/g) ?? []) {
      expect(svg).toMatch(/aria-hidden="true"/);
      expect(svg).not.toMatch(/<text/);
    }
  });

  it("every number on the path comes from code", () => {
    expect(PATH_MAX_MODEL_CALLS).toBe(MAX_MODEL_CALLS);
    const t = text(list);
    expect(t).toContain(`${WILD_WINDOW_DAYS} days of iNaturalist sightings`);
    expect(t).toContain(`removes ${BLOCKED_TAXA.length} groups`);
    expect(t).toContain(`at most ${MAX_MODEL_CALLS} calls`);
  });

  it("sits at the top of /how-it-works as #quick, right after the intro, and replaces the old four cards", () => {
    const page = renderToStaticMarkup(<HowItWorksPage />);
    const quick = page.indexOf('id="quick"');
    expect(quick).toBeGreaterThan(page.indexOf("<h1"));
    expect(quick).toBeLessThan(page.indexOf('id="steps"'));
    expect(page).toContain("How Grass Pass works, in 8 stops");
    expect(page).toContain(">The 10-second version<");
    expect(page).not.toContain("We read the park");
    // The road colours live in one globals.css block (easy to merge), with light and dark values.
    const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    const block = css.slice(css.indexOf("how-path (Kevin, 2026-10-08)"), css.indexOf("end how-path"));
    expect(block).toContain("--gp-how-end:");
    expect(block).toContain(':root[data-theme="dark"]');
    expect(block).toContain("prefers-reduced-motion: no-preference");
  });
});
