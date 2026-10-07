import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HowItWorks, HOW_STEPS } from "@/components/home/HowItWorks";
import { DROP_REASONS } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { WILD_RADIUS_KM, WILD_WINDOW_DAYS } from "@/lib/sources/inat";

/** Kevin 2026-10-07: "How it works" as a diagram (data in -> AI -> paper out). Real text, real numbers, one ordered list. */
describe("home: How it works diagram", () => {
  const html = renderToStaticMarkup(<HowItWorks />);

  it("has only the big \"How it works\" heading, sized like the hero (Kevin 2026-10-07 removed the three-line headline and the link)", () => {
    expect(html).toMatch(/<h2 id="how-title"[^>]*><span[^>]*>How it works<\/span><\/h2>/);
    for (const line of ["Real park data in.", "Advanced", "Screen-free adventure out.", "The full story for curious grown-ups"]) expect(html).not.toContain(line);
  });

  it("is one ordered list of 8 steps, each an h3 with its step number for screen readers", () => {
    const ol = html.match(/<ol aria-label="How a pass is made, in 8 steps"[\s\S]*<\/ol>/)?.[0] ?? "";
    expect(ol).not.toBe("");
    expect(ol.match(/<h3/g)).toHaveLength(8);
    for (let n = 1; n <= 8; n++) expect(ol).toContain(`Step ${n}: </span>`);
  });

  it("shows every original step card (title and body) in the diagram", () => {
    for (const s of HOW_STEPS) {
      expect(html).toContain(s.title.replace("&", "&amp;"));
      expect(html).toContain(s.body.replace(/&/g, "&amp;"));
    }
  });

  it("reads its numbers from code, not hard-coded copy", () => {
    const hard = DROP_REASONS.filter((r) => DROP_REASON_INFO[r].kind === "always").length;
    expect(html).toContain(`within ${WILD_RADIUS_KM} km, last ${WILD_WINDOW_DAYS} days`);
    expect(html).toContain(`Code removes ${BLOCKED_TAXA.length} groups of risky species`);
    expect(html).toContain(`one of ${hard} hard rules`);
  });

  it("the arc art is decorative and the only animation is motion-safe", () => {
    expect(html).toMatch(/<svg aria-hidden="true" focusable="false" viewBox="0 0 1216 780"/);
    expect(html).not.toMatch(/(^|[" ])animate-pulse/);
    expect(html).toContain("gp-how-flow");
  });
});
