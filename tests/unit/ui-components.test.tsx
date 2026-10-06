import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExplorerScene, Logo, TicketMark } from "@/components/art/BrandArt";
import { readFileSync } from "node:fs";
import {
  DIVIDER_HEIGHT,
  GRASS_LAYERS,
  GRASS_STRIP_FILES,
  GRASS_TILES,
  TILE,
  grassStripSvg,
} from "@/components/art/grass";
import { Hero } from "@/components/Hero";
import { SiteHeader } from "@/components/SiteHeader";
import { parseTheme } from "@/components/theme";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Chip, SECTION_LABELS, type SectionKind } from "@/components/ui/Chip";
import { GrassDivider } from "@/components/ui/GrassDivider";
import { TicketCard } from "@/components/ui/TicketCard";
import { siteUrl } from "@/lib/site-url";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Button", () => {
  it("is a real button (type=button by default) with a 44 px minimum target", () => {
    const out = html(<Button>Make my pass</Button>);
    expect(out).toMatch(/^<button type="button"/);
    expect(out).toContain("min-h-11");
    expect(out).toContain("min-w-11");
    expect(out).toContain("bg-primary text-on-primary");
    expect(out).toContain(">Make my pass</button>");
  });

  it("secondary has the 2 px line border, and submit type and disabled pass through", () => {
    const out = html(
      <Button variant="secondary" type="submit" disabled>
        Go
      </Button>,
    );
    expect(out).toContain('type="submit"');
    expect(out).toContain("disabled");
    expect(out).toContain("border-2 border-line bg-surface text-heading");
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
    expect(out).toMatch(/^<section class="relative rounded-ticket border-2 border-line bg-surface/);
    expect(out).toContain('aria-labelledby="t1"');
    expect(out.match(/data-notch="(left|right)"/g)).toEqual(['data-notch="left"', 'data-notch="right"']);
    expect(out.match(/data-notch="[a-z]+" class="[^"]*top-1\/2/g)).toHaveLength(2);
    expect(out).not.toContain("ticket-stub");
  });

  it("puts the notches on a dashed tear line above the stub", () => {
    const out = html(<TicketCard stub={<p>Parent stub</p>}>Kid pass</TicketCard>);
    expect(out).toContain('data-testid="ticket-stub" class="relative border-t-2 border-dashed border-line');
    const stub = out.slice(out.indexOf("ticket-stub"));
    expect(stub.match(/data-notch=/g)).toHaveLength(2);
    expect(stub).toContain("Parent stub");
    for (const m of out.match(/<span aria-hidden="true" data-notch/g) ?? []) expect(m).toContain("aria-hidden");
  });
});

describe("GrassDivider", () => {
  it("is decorative: an empty aria-hidden box drawn by the --grass-strip background, no inline SVG or text", () => {
    const out = html(<GrassDivider />);
    expect(out).toBe('<div aria-hidden="true" data-testid="grass-divider" class="grass-strip w-full"></div>');
  });

  it("tokens.css picks the light strip by default and the dark strip in both dark-mode blocks, 34 px tall", () => {
    const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");
    const urls = [...css.matchAll(/--grass-strip:\s*url\("\/([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls).toEqual([GRASS_STRIP_FILES.light, GRASS_STRIP_FILES.dark, GRASS_STRIP_FILES.dark]);
    const rule = css.match(/\.grass-strip\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(rule).toContain(`height: ${DIVIDER_HEIGHT}px`);
    expect(rule).toContain(`background: var(--grass-strip) left bottom / auto ${DIVIDER_HEIGHT}px repeat-x;`);
    expect(DIVIDER_HEIGHT).toBe(34); // option C, Kevin's pick
    // The footer strip shows a different stretch of lawn than the header.
    expect(css).toMatch(/\.grass-strip-alt\s*\{\s*background-position: -\d+px bottom;/);
    expect(html(<GrassDivider className="grass-strip-alt" />)).toContain('class="grass-strip w-full grass-strip-alt"');
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

describe("brand art", () => {
  it("Logo has the full name + tagline as alt text, with a dark-mode twin", () => {
    const out = html(<Logo />);
    expect(out.match(/alt="Grass Pass: your ticket to get outside"/g)).toHaveLength(2);
    expect(out).toContain('src="/logo-header.svg"');
    expect(out).toContain('src="/logo-header-dark.svg"');
    expect(out).toContain("only-light");
    expect(out).toContain("only-dark");
  });

  it("decorative Logo, TicketMark and ExplorerScene have empty alt text", () => {
    expect(html(<Logo decorative />).match(/alt=""/g)).toHaveLength(2);
    expect(html(<TicketMark />)).toContain('alt=""');
    const scene = html(<ExplorerScene />);
    expect(scene).toContain('alt=""');
    expect(scene).toContain('aria-hidden="true"');
    expect(scene).toContain('src="/brand/explorer-scene.svg"');
  });

  it("Hero gives the headline an h1 and hides the scene under 480 px", () => {
    const out = html(<Hero title="Pick a park" lead="Print a pass." />);
    expect(out).toContain('<h1 id="hero-title"');
    expect(out).toContain("Pick a park</h1>");
    expect(out).toContain('class="hidden min-[480px]:block"');
  });

  it("SiteHeader links home with a name, and holds the dark mode switch", () => {
    const out = html(<SiteHeader />);
    expect(out).toContain("<header");
    expect(out).toContain('aria-label="Grass Pass home"');
    expect(out).toContain(">Dark mode</span>");
  });
});

describe("theme", () => {
  it("only accepts light or dark from storage", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("blue")).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });

  it("toggle renders without a pressed state on the server (filled in after hydration)", () => {
    const out = html(<ThemeToggle />);
    expect(out).toMatch(/^<button type="button"/);
    expect(out).not.toContain("aria-pressed");
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
