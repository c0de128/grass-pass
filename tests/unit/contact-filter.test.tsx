/**
 * R2-m3 (SEC-2-04): the contact filter catches any top-level domain and spelled-out dots, and the park
 * name printed on a pass goes through it too (a neutral label plus an honest note when it fails).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HIDDEN_PARK_LABEL, HIDDEN_PARK_NOTE, hasUrlOrMarkup, safeParkName } from "@/lib/ai/validate";
import { KidPass } from "@/components/pass/KidPass";
import { ParentStub } from "@/components/pass/ParentStub";
import { PassPreview } from "@/components/pass/PassPreview";
import { resetStores } from "@/lib/cache/store";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import type { Pass } from "@/lib/pass/schema";
import { PARKS, passReplay } from "./support/pass-replay";

vi.setConfig({ testTimeout: 30_000 });

describe("domains and spelled dots (R2-m3)", () => {
  it("blocks any TLD, upper or lower case, and spelled or bracketed dots", () => {
    for (const t of [
      "Win a prize at kidsprize.ru",
      "go to win.ai now",
      "kids.dev shelter",
      "VISIT KIDSPRIZE.COM",
      "prizes.co.uk",
      "kidsprize.travel",
      "kidsprize dot com",
      "kidsprize DOT net",
      "kidsprize (dot) org",
      "kidsprize [dot] ru",
      "kidsprize[.]ru",
      "kidsprize (.) xyz",
      "Prize at kidsprize.com Park",
    ]) {
      expect(hasUrlOrMarkup(t), t).toBe(true);
    }
  });

  it("leaves normal clue and fact text alone", () => {
    for (const t of [
      "It grows 5 to 8 m (16 to 26 ft) tall.",
      "It grows 5.5 m tall.",
      "e.g. near the bench",
      "Look at 9 a.m. or 4 p.m.",
      "Find the U.S. flag.",
      "Walk to St. Louis Street.",
      "Look by the pond.Look for ducks.",
      "Count the dots on a ladybug.",
      "A ladybug has a black dot. Count them!",
      "Quercus sp. leaves are lobed.",
      "Connemara Meadow Preserve",
      "Arbor Hills Nature Preserve",
      "Dr. Pepper Park",
    ]) {
      expect(hasUrlOrMarkup(t), t).toBe(false);
    }
  });

  it("SEC-3-07: full-width and ideographic dots, title-case and spaced TLDs, (at)", () => {
    for (const t of [
      "Kidsprize.Com",
      "kidsprize.Net prizes",
      "kidsprize . com",
      "kidsprize .com",
      "kidsprize. com",
      "KIDSPRIZE . NET",
      "kidsprize。com",
      "kidsprize．com",
      "＠kidsprize",
      "kidsprize(at)gmail",
      "kidsprize [at] gmail",
      "ｋｉｄｓ.com",
    ]) {
      expect(hasUrlOrMarkup(t), t).toBe(true);
    }
    // Still fine: a missing space before a word that is also a TLD, sentences, abbreviations.
    for (const t of [
      "Look by the pond.In the grass you may see ducks.",
      "Find the bench.To the left is a tree.",
      "etc. in the meadow",
      "Go down the slide. Me next!",
      "St. Mary's Park",
      "e.g. co-op garden",
      "Look at the hat on the statue",
      "Bring a cat (at home) toy",
    ]) {
      expect(hasUrlOrMarkup(t), t).toBe(false);
    }
  });

  it("safeParkName: a name with contact details becomes a neutral label", () => {
    expect(safeParkName("Celebration Park")).toEqual({ name: "Celebration Park", hidden: false });
    expect(safeParkName("Prize at kidsprize.ru Park")).toEqual({ name: HIDDEN_PARK_LABEL, hidden: true });
    expect(safeParkName("Text 214 555 0100 Park")).toEqual({ name: HIDDEN_PARK_LABEL, hidden: true });
    expect(safeParkName("@grasspass Park").hidden).toBe(true);
  });
});

describe("the printed park name (R2-m3)", () => {
  async function realPass(): Promise<Pass> {
    resetStores();
    resetPassMaking();
    const r = passReplay();
    const out = await makePass(
      { parkId: PARKS.celebration.id, ageBand: "6-10" },
      { ip: "192.0.2.11", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: { DO_INFERENCE_API_KEY: "test-key-not-real" } },
    );
    if (out.kind !== "pass") throw new Error(out.kind);
    return out.pass;
  }

  it("a vandalised OSM name is never printed; the kid side says 'This park' and the stub says why", async () => {
    const real = await realPass();
    const pass: Pass = { ...real, park: { ...real.park, name: "Prize at kidsprize.ru Park" } };
    for (const html of [
      renderToStaticMarkup(<KidPass pass={pass} />),
      renderToStaticMarkup(<ParentStub pass={pass} passUrl="localhost/pass/x" />),
      renderToStaticMarkup(<PassPreview pass={pass} />),
    ]) {
      expect(html).not.toContain("kidsprize");
    }
    expect(renderToStaticMarkup(<KidPass pass={pass} />)).toContain(`Park:</span> ${HIDDEN_PARK_LABEL}`);
    expect(renderToStaticMarkup(<ParentStub pass={pass} passUrl="localhost/pass/x" />)).toContain(HIDDEN_PARK_NOTE.replace("'", "&#x27;"));

    // A normal name prints as is, with no note.
    const ok = renderToStaticMarkup(<ParentStub pass={real} passUrl="localhost/pass/x" />);
    expect(ok).not.toContain("We hid this park");
    expect(renderToStaticMarkup(<KidPass pass={real} />)).toContain("Celebration Park");
  });
});
