import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExplorerScene, Logo, TicketMark } from "@/components/art/BrandArt";
import { DIVIDER_TILE, dividerPath } from "@/components/art/grass";
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
  it("is decorative and uses short blades with rounded tips", () => {
    const out = html(<GrassDivider />);
    expect(out).toMatch(/^<svg aria-hidden="true" focusable="false"/);
    const id = out.match(/<pattern id="([^"]+)"/)?.[1];
    expect(id).toMatch(/^grass-[a-zA-Z0-9_-]+$/);
    expect(out).toContain(`fill="url(#${id})"`);
    const d = dividerPath(1);
    expect(d.match(/A0\.7 0\.7/g)).toHaveLength(DIVIDER_TILE.length);
  });

  it("has 5-9 blades per 40 px with heights 6-14 px (SPEC §8.3)", () => {
    expect(DIVIDER_TILE.length).toBeGreaterThanOrEqual(5);
    expect(DIVIDER_TILE.length).toBeLessThanOrEqual(9);
    for (const [, h] of DIVIDER_TILE) {
      expect(h).toBeGreaterThanOrEqual(6);
      expect(h).toBeLessThanOrEqual(14);
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
