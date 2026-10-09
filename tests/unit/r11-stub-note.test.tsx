/**
 * Round 11 (Q-11-03): a section that worked but was cut short says so on the pass page too, not only on the printed
 * stub. The pass is a recorded real pass (tests/fixtures/pass-celebration-lucky-live.json) with its Lucky Finds state set
 * here to the note partialLuckyState() writes when the SerpApi daily cap cut the lookup short (test-built, said so).
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PassPreview } from "@/components/pass/PassPreview";
import { stubNotes } from "@/lib/pass/stub-notes";
import { partialLuckyState } from "@/lib/pool/lucky";
import type { Pass } from "@/lib/pass/schema";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("Q-11-03: the pass page shows the same 'cut short' notes as the printed stub", () => {
  it("Lucky Finds cut short by the SerpApi cap: the note is on the screen and in stubNotes()", () => {
    const real = (JSON.parse(readFileSync("tests/fixtures/pass-celebration-lucky-live.json", "utf8")) as { pass: Pass }).pass;
    const lucky = partialLuckyState(
      { searched: ["dog"], finds: [] } as unknown as Parameters<typeof partialLuckyState>[0],
      { status: "off", message: "Lucky Finds: off for today. We hit the free SerpApi search limit, so no visitor reviews were checked." },
      1,
    );
    expect(lucky.status).toBe("ok");
    const pass: Pass = { ...real, sections: { ...real.sections, lucky } };
    const note = (lucky as { note: string }).note;
    expect(note).toMatch(/^Lucky Finds: only .+ checked\. The other visitor-review searches did not run: off for today\./);
    expect(stubNotes(pass)).toContain(note);
    const screen = text(renderToStaticMarkup(<PassPreview pass={pass} />));
    expect(screen).toContain(note.replace(/\s+/g, " "));
  });

  it("a pass with no notes shows none", () => {
    const real = (JSON.parse(readFileSync("tests/fixtures/pass-celebration-lucky-live.json", "utf8")) as { pass: Pass }).pass;
    expect(renderToStaticMarkup(<PassPreview pass={{ ...real, sections: { ...real.sections, lucky: { status: "ok" } } }} />)).not.toContain('data-testid="section-note"');
  });
});
