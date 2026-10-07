import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DIVIDER_HEIGHT, GRASS_LAYERS, GRASS_TILES, TILE, grassStripSvg } from "@/components/art/grass";
import { Logo } from "@/components/site/Logo";
import { SiteFooter, footerColumns, footerParkLinks } from "@/components/SiteFooter";
import { pinnedPassById } from "@/lib/pinned";
import { REPO_URL } from "@/lib/site-url";
import { SiteHeader } from "@/components/SiteHeader";
import { parseTheme } from "@/components/theme";
import { ThemeToggle, themeToggleLabel } from "@/components/ThemeToggle";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Chip, SECTION_LABELS, type SectionKind } from "@/components/ui/Chip";
import { TicketCard } from "@/components/ui/TicketCard";
import { siteUrl } from "@/lib/site-url";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Button", () => {
  it("is a real button (type=button by default) with a 44 px minimum target", () => {
    const out = html(<Button>Make my pass</Button>);
    expect(out).toMatch(/^<button type="button"/);
    expect(out).toContain("min-h-12");
    expect(out).toContain("min-w-11");
    expect(out).toContain("bg-primary text-primary-foreground");
    expect(out).toContain(">Make my pass</button>");
  });

  it("v3: hover lift and the ink step shadow only move when motion is OK", () => {
    const cls = buttonClassName("primary");
    expect(cls).toContain("shadow-[0_4px_0_0_var(--gp-foreground)]");
    expect(cls).toContain("motion-safe:hover:-translate-y-0.5");
    expect(cls).not.toMatch(/(^| )hover:-translate/);
  });

  it("secondary has a 2 px line ring, and submit type and disabled pass through", () => {
    const out = html(
      <Button variant="secondary" type="submit" disabled>
        Go
      </Button>,
    );
    expect(out).toContain('type="submit"');
    expect(out).toContain("disabled");
    expect(out).toContain("bg-card text-foreground ring-2 ring-line");
  });

  it("never removes the focus outline", () => {
    expect(buttonClassName("primary")).not.toMatch(/outline-none|focus:outline-0/);
    expect(buttonClassName("secondary")).not.toMatch(/outline-none|focus:outline-0/);
  });
});

describe("Chip", () => {
  it.each(Object.keys(SECTION_LABELS) as SectionKind[])("%s chip shows its label and a hidden icon", (kind) => {
    const out = html(<Chip kind={kind} />);
    expect(out).toContain(`>${SECTION_LABELS[kind]}</span>`);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("bg-chip");
    expect(out).toContain("text-on-chip");
  });

  it("accepts custom text", () => {
    expect(html(<Chip kind="wild">3 Wild Finds</Chip>)).toContain(">3 Wild Finds</span>");
  });
});

describe("TicketCard", () => {
  it("draws two hidden notches at the middle when there is no stub", () => {
    const out = html(
      <TicketCard as="section" aria-labelledby="t1">
        <h2 id="t1">Pass</h2>
      </TicketCard>,
    );
    expect(out).toMatch(/^<section class="relative rounded-3xl bg-card text-card-foreground/);
    expect(out).toContain('aria-labelledby="t1"');
    expect(out.match(/data-notch="(left|right)"/g)).toEqual(['data-notch="left"', 'data-notch="right"']);
    expect(out.match(/data-notch="[a-z]+" class="[^"]*top-1\/2/g)).toHaveLength(2);
    expect(out).not.toContain("ticket-stub");
  });

  it("puts the notches on a perforated tear line above the stub", () => {
    const out = html(<TicketCard stub={<p>Parent stub</p>}>Kid pass</TicketCard>);
    expect(out).toContain('data-testid="ticket-stub" class="relative rounded-b-3xl bg-muted/60');
    expect(out).toContain('class="perforation absolute');
    const stub = out.slice(out.indexOf("ticket-stub"));
    expect(stub.match(/data-notch=/g)).toHaveLength(2);
    expect(stub).toContain("Parent stub");
    for (const m of out.match(/<span aria-hidden="true" data-notch/g) ?? []) expect(m).toContain("aria-hidden");
  });
});

// The lawn strip art (src/components/art/grass.ts) is no longer on the v3 site, but scripts/render-brand.mjs still
// draws it into the brand files (public/brand), so its geometry rules stay tested.
describe("lawn strip art (brand files)", () => {
  it("the v3 site no longer draws the strip (tokens.css has no --grass-strip)", () => {
    const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");
    expect(css).not.toContain("--grass-strip");
    expect(DIVIDER_HEIGHT).toBe(34); // option C, Kevin's pick
  });

  it("every blade is a single soft blade with its own root, never a fan (at most 3 blades per spot)", () => {
    let total = 0;
    for (const [name, blades] of Object.entries(GRASS_LAYERS)) {
      for (const b of blades) {
        const [x, h, dx, w] = b;
        total++;
        expect(h, name).toBeGreaterThan(3);
        expect(h, name).toBeLessThanOrEqual(DIVIDER_HEIGHT - 3); // the tip stays inside the strip
        expect(Math.abs(dx), name).toBeLessThan(h * 0.6); // leans well under 45 degrees
        expect(w, name).toBeGreaterThanOrEqual(2);
        expect(w, name).toBeLessThanOrEqual(6);
        // A cannabis-style leaf fans 5-9 pointed leaflets out of one point; the logo grass has at most 3 per tuft.
        const sharing = blades.filter((o) => o !== b && Math.abs(o[0] - x) < 1).length;
        expect(sharing, `${name} blade at x=${x}`).toBeLessThanOrEqual(2);
      }
    }
    expect(total).toBeGreaterThan(250); // a real meadow, not a handful of comb teeth
  });

  it("repeats seamlessly: blades poking past a tile edge are also drawn on the other side", () => {
    const widths = { paleFront: TILE.front, paleTall: TILE.tall, middle: TILE.middle, front: TILE.front, tall: TILE.tall };
    let wrapped = 0;
    for (const [name, blades] of Object.entries(GRASS_LAYERS)) {
      const W = widths[name as keyof typeof widths];
      for (const [x, h, dx, w] of blades) {
        const left = Math.min(x - w, x + dx - 1);
        const right = Math.max(x + w, x + dx + 1);
        const twin = (s: number) => blades.some((o) => Math.abs(o[0] - (x + s)) < 0.01 && o[1] === h && o[2] === dx);
        if (left < 0) {
          wrapped++;
          expect(twin(W), `${name} x=${x}`).toBe(true);
        }
        if (right > W) {
          wrapped++;
          expect(twin(-W), `${name} x=${x}`).toBe(true);
        }
      }
    }
    expect(wrapped).toBeGreaterThan(0); // the tiles really have edge-crossing blades, so this test checks something
  });

  it("stacks tiles of different widths (no visible repeat) with a rolling bank and 4 tiny finds per 1031 px", () => {
    expect(GRASS_TILES.map((t) => t.w)).toEqual([377, 787, 293, 377, 377, 787, 1031]);
    for (const theme of ["light", "dark"] as const) {
      const svg = grassStripSvg(theme);
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" aria-hidden="true" focusable="false" width="3840" height="34"/);
      expect(svg).not.toMatch(/<text|<script|<animate|<set|<image|href=|style=/);
      const finds = svg.match(/<pattern id="g6"[^>]*>([\s\S]*?)<\/pattern>/)?.[1] ?? "";
      expect(finds.match(/<ellipse/g)).toHaveLength(10); // two 5-petal flowers
      expect(finds.match(/stroke-width="0.5"><circle/g)).toHaveLength(1); // one clover (3 round leaflets)
      expect(finds.match(/r="0.75"/g)).toHaveLength(12); // one dandelion clock
      // The bank (pattern g3) is one closed path along the bottom edge.
      expect(svg).toMatch(/<pattern id="g3"[^>]*><path fill="#[0-9A-F]{6}" d="M-1 35L[^"]+Z"\/><\/pattern>/);
    }
  });
});

describe("v3 logo, header and footer", () => {
  it("Logo: a decorative ticket with a sprout, and the real wordmark text", () => {
    const out = html(<Logo />);
    expect(out).toContain('aria-hidden="true" data-testid="logo-ticket"');
    expect(out).toContain("bg-primary text-primary-foreground");
    expect(out).toContain(">Grass Pass</span>");
    expect(out).not.toContain("<img");
    expect(html(<Logo inverted />)).toContain("bg-sun text-sun-foreground");
  });

  it("SiteHeader links home with a name (never prefetched), the section anchors, How it works (/how-it-works), About and the dark mode switch", () => {
    const out = html(<SiteHeader />);
    expect(out).toContain("<header");
    expect(out).toContain('aria-label="Grass Pass home"');
    expect(out).toContain(">Switch to dark mode</span>");
    for (const a of ["/#why", "/#pass", "/#parks", "/how-it-works", "/about"]) expect(out).toContain(`href="${a}"`);
    // Kevin 2026-10-06: the How it works tab is its own page, shown at every width (not a lg-only anchor).
    expect(out).not.toContain('href="/#how"');
    expect(out).toMatch(/<li><a [^>]*href="\/how-it-works"[^>]*>How it works<\/a><\/li>/);
    // Shown at every width: the page tabs' list items carry no "hidden" class.
    expect(out).not.toMatch(/<li class="hidden lg:block"><a [^>]*href="\/how-it-works"/);
    // Kevin 2026-10-07: no "Make a pass" pill in the header.
    expect(out).not.toContain(">Make a pass");
  });

  it("SiteFooter keeps every credit and the real links", () => {
    const out = html(<SiteFooter />);
    for (const c of [
      "OpenStreetMap",
      "ODbL",
      "iNaturalist",
      "Wikipedia (CC BY-SA)",
      "SerpApi",
      "Gemma 4",
      "Apache-2.0",
      "Lucide (ISC)",
      "Bricolage Grotesque and DM Sans",
      "Fredoka and Nunito",
      "SIL OFL 1.1",
      "Hero illustration generated with v0 by Vercel",
      "Park photos: Robert Nunnally",
    ]) {
      expect(out, c).toContain(c);
    }
    expect(out).toContain('href="https://github.com/c0de128/grass-pass"');
    expect(out).toContain('href="/about"');
    expect(out).toContain('href="/how-it-works"');
  });

  it("SiteFooter (Kevin 2026-10-07): LEARN / EXPLORE / RESOURCES, his closing line word for word, a decorative landscape", () => {
    const out = html(<SiteFooter />);
    expect(out).toContain('<nav aria-label="Footer">');
    for (const h of ["Learn", "Explore", "Resources"]) expect(out).toMatch(new RegExp(`<h2 id="footer-${h.toLowerCase()}"[^>]*uppercase[^>]*>${h}</h2>`));
    const closing = out.match(/<p[^>]*data-testid="footer-closing"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(closing.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).toBe(
      "© 2026 Grass Pass. An AI-powered service dedicated to real-world family exploration. Pocket the pencil. Leave the phone. Touch Grass",
    );
    expect(out).toMatch(/<svg aria-hidden="true" focusable="false" data-testid="footer-landscape"/);
    expect(out).not.toContain("<img");
    expect(out).toMatch(/^<footer[^>]*print:hidden/);
  });

  it("SiteFooter links only to real places: every park link is a pinned (always available) example pass", () => {
    const cols = footerColumns();
    const hrefs = cols.flatMap((c) => c.links.map((l) => l.href));
    for (const h of ["/about", "/how-it-works", "/#pass", "/#why", "/how-it-works#why-open", "/#find", "/#parks", "/about#privacy", "/about#credits", REPO_URL]) {
      expect(hrefs).toContain(h);
    }
    const parks = footerParkLinks();
    expect(parks.length).toBeGreaterThan(0);
    for (const p of parks) {
      const id = p.href.match(/^\/pass\/([^?]+)\?example=1$/)?.[1];
      expect(id && pinnedPassById(id), p.href).toBeTruthy();
      expect(pinnedPassById(id!)!.park.name).toBe(p.label);
    }
    // A park with no pinned pass is left out, never a dead link.
    expect(footerParkLinks(["arbor-hills", "no-such-park"])).toEqual([]);
  });
});

describe("theme", () => {
  it("only accepts light or dark from storage", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("blue")).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });

  it("toggle is a plain button: a changing label and never aria-pressed", () => {
    const out = html(<ThemeToggle />);
    expect(out).toMatch(/^<button type="button"/);
    expect(out).not.toContain("aria-pressed");
    expect(out).toContain('title="Switch to dark mode"');
    const src = readFileSync(new URL("../../src/components/ThemeToggle.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/aria-pressed=\{/);
  });

  it("R2-m10: the label says what a press does", () => {
    expect(themeToggleLabel(false)).toBe("Switch to dark mode");
    expect(themeToggleLabel(true)).toBe("Switch to light mode");
  });
});

describe("siteUrl", () => {
  it("prefers SITE_URL, then the Vercel production domain, then localhost", () => {
    expect(siteUrl({ SITE_URL: "https://grass.example/path" }).href).toBe("https://grass.example/");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "grass-pass.vercel.app" }).href).toBe("https://grass-pass.vercel.app/");
    expect(siteUrl({ SITE_URL: "not a url", PORT: "3123" }).href).toBe("http://localhost:3123/");
    expect(siteUrl({ SITE_URL: "javascript:alert(1)" }).href).toBe("http://localhost:3000/");
  });
});
