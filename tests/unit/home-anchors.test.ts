import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CV_OFF_ATTR, isHomeSectionJump } from "@/components/home/HomeAnchors";

const home = { origin: "http://localhost:3560", pathname: "/" };

describe("HomeAnchors (Explore link fix, 2026-10-07)", () => {
  it("treats a section link on the open home page as a section jump", () => {
    for (const href of ["/#parks", "/#why", "/#pass", "#parks", "http://localhost:3560/#parks"]) {
      expect(isHomeSectionJump(href, home), href).toBe(true);
    }
  });

  it("ignores other pages, other sites, bare hashes and missing hrefs", () => {
    expect(isHomeSectionJump("/about", home)).toBe(false);
    expect(isHomeSectionJump("/about#sources", home)).toBe(false);
    expect(isHomeSectionJump("/", home)).toBe(false);
    expect(isHomeSectionJump("/#", home)).toBe(false);
    expect(isHomeSectionJump("https://example.org/#parks", home)).toBe(false);
    expect(isHomeSectionJump(null, home)).toBe(false);
    // On /about, "/#parks" is a page visit (next/link); the home mounts with the hash and its layout effect handles it.
    expect(isHomeSectionJump("/#parks", { ...home, pathname: "/about" })).toBe(false);
  });

  it("globals.css turns content-visibility off for a jump or a page opened with a hash", () => {
    const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
    expect(css).toContain(`.gp-home:is([${CV_OFF_ATTR}="real"], :has(:target)) > section:is(#why, #how, #pass)`);
    expect(css).toMatch(/:has\(:target\)\) > section:is\(#why, #how, #pass\) \{\s*content-visibility: visible;/);
  });
});
