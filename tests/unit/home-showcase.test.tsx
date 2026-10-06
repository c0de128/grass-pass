import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExampleChips, shortParkName } from "@/components/home/ExampleChips";
import { HeroPassCard } from "@/components/home/HeroPassCard";
import { HowItWorks } from "@/components/home/HowItWorks";
import { PassAnatomy } from "@/components/home/PassAnatomy";
import { SampleParks } from "@/components/home/SampleParks";
import { TWO_PARKS_SOURCE, TwoParks } from "@/components/home/TwoParks";
import { AgePicker } from "@/components/pass/PassMaker";
import { cardFacts, heroCard, liveStatement, placeLabel, readyExamples, spotQuote } from "@/lib/home/showcase";
import { PARK_PHOTOS, photoCredit } from "@/data/photo-credits";
import { HERO_ILLUSTRATION } from "@/lib/illustrations";
import { PassSchema, type Pass } from "@/lib/pass/schema";
import { EXAMPLE_PARKS, type ExampleStatus } from "@/lib/prewarm";

// A real pass recorded from the live builder (Arbor Hills, Gemma 4 + Lucky Finds), tests/ fixture only.
const recorded = JSON.parse(
  readFileSync(new URL("../fixtures/pass-arbor-hills-lucky-live.json", import.meta.url), "utf8"),
) as unknown;

function realPass(): Pass {
  const found = findPass(recorded);
  if (!found) throw new Error("no pass in the recorded fixture");
  return found;
}
function findPass(v: unknown): Pass | null {
  const p = PassSchema.safeParse(v);
  if (p.success) return p.data;
  if (v && typeof v === "object") {
    for (const x of Object.values(v as Record<string, unknown>)) {
      const f = findPass(x);
      if (f) return f;
    }
  }
  return null;
}

const byslug = (slug: string) => EXAMPLE_PARKS.find((e) => e.slug === slug)!;
const readyStatus = (slug: string, pass: Pass, fresh = true): ExampleStatus => ({
  example: byslug(slug),
  pass: { passId: pass.id, day: pass.day, generatedAt: pass.generatedAt },
  passData: pass,
  fresh,
  refreshing: false,
  missing: null,
});
const missingStatus = (slug: string, missing: string, refreshing = false): ExampleStatus => ({
  example: byslug(slug),
  pass: null,
  passData: null,
  fresh: false,
  refreshing,
  missing,
});

describe("home showcase (v0 slots filled with real data)", () => {
  it("the recorded fixture is a real pass with finds", () => {
    expect(realPass().items.length).toBeGreaterThan(3);
  });

  it("hero card: prefers Connemara, shows its first 4 real finds with their evidence, links its pass", () => {
    const pass = realPass();
    const card = heroCard([missingStatus("arbor-hills", "No data available yet: x."), readyStatus("connemara", pass)]);
    expect(card?.kind).toBe("ready");
    const html = renderToStaticMarkup(<HeroPassCard card={card} />);
    for (const it of pass.items.slice(0, 4)) {
      expect(html).toContain(renderToStaticMarkup(<>{it.clue}</>));
      expect(html).toContain(renderToStaticMarkup(<>{it.evidence}</>));
    }
    if (pass.items[4]) expect(html).not.toContain(renderToStaticMarkup(<>{pass.items[4].clue}</>));
    expect(html).toContain(`href="/pass/${pass.id}?example=1"`);
    expect(html).toContain("Allen, TX");
    expect(html).toContain("Ages 6–10");
    // None of the v0 sample clues.
    for (const fake of ["Spot a monarch on the milkweed", "red-winged blackbird", "Count the trail benches", "9 seen", "14 seen"]) {
      expect(html).not.toContain(fake);
    }
  });

  it("hero card: falls back to another ready example, else says why (no link, no clues)", () => {
    const pass = realPass();
    const other = heroCard([readyStatus("white-rock", pass), missingStatus("connemara", "No data available yet: it is being made right now (about 15-30 seconds).", true)]);
    expect(other?.kind === "ready" && other.ex.example.slug).toBe("white-rock");
    const none = heroCard([missingStatus("connemara", "No data available yet: the last try didn't work because OpenStreetMap was busy.")]);
    expect(none).toEqual({ kind: "missing", name: byslug("connemara").name, place: "Allen, TX", reason: "the last try didn't work because OpenStreetMap was busy." });
    const html = renderToStaticMarkup(<HeroPassCard card={none} />);
    expect(html).toContain("Example pass not ready yet: the last try didn&#x27;t work because OpenStreetMap was busy.");
    expect(html).not.toContain("<a ");
  });

  it("sample card facts come from the pass sections, the map and the October box", () => {
    const pass = realPass();
    const f = cardFacts(pass);
    expect(f.count).toBe(pass.items.length);
    const wild = pass.items.filter((i) => i.section === "wild").length;
    if (wild > 0) expect(f.facts).toContain(`${wild} Wild Find`);
    expect(f.tags).not.toContain("Wild Finds");
    if (pass.spot?.status === "ok") expect(f.tags).toContain("Find This Spot map");
    const empty = cardFacts({ ...pass, items: [] });
    expect(empty.facts).toMatch(/^No data available/);
    expect(empty.count).toBe(0);
    expect(empty.tags).toEqual([...(pass.spot?.status === "ok" ? ["Find This Spot map"] : []), ...(pass.october?.status === "ok" ? ["October monarch box"] : [])]);
  });

  it("A2 (Kevin 2026-10-06): the card shows only the real number of finds, no Wild / Mixed / Built label", () => {
    const pass = realPass();
    const html = renderToStaticMarkup(<SampleParks statuses={[readyStatus("connemara", pass)]} enabled />);
    expect(html).toContain(`${pass.items.length} finds to spot`);
    for (const label of ["Wild Pass", "Mixed Pass", "Built Pass"]) expect(html).not.toContain(label);
    for (const fake of ["50+", "30+", "20+", "40+", "google.com"]) expect(html).not.toContain(fake);
  });

  it("the live pill only claims what is true, and pulses only about today", () => {
    const pass = realPass();
    expect(liveStatement([readyStatus("connemara", pass), readyStatus("celebration", pass)], true)).toEqual({ text: "2 example passes made today from live data", live: true });
    expect(liveStatement([readyStatus("connemara", pass, false)], true)).toEqual({ text: "1 example pass ready (made on an earlier day)", live: false });
    expect(liveStatement([missingStatus("connemara", "x", true)], true)).toEqual({ text: "Making today's example passes now", live: true });
    expect(liveStatement([missingStatus("connemara", "x")], true)).toEqual({ text: "Example passes not ready yet", live: false });
    expect(liveStatement([missingStatus("connemara", "x")], false)).toEqual({ text: "Example passes are switched off on this server", live: false });
    const html = renderToStaticMarkup(<SampleParks statuses={[missingStatus("connemara", "No data available yet: no pass has been made for it today.")]} enabled />);
    expect(html).toContain('data-live="false"');
    expect(html).not.toContain("animate-ping");
    expect(html).not.toContain("Live park feeds");
  });

  it("sample cards: See the pass for a ready pass, real place, no distances, no v0 blurbs", () => {
    const pass = realPass();
    const html = renderToStaticMarkup(<SampleParks statuses={[readyStatus("connemara", pass)]} enabled />);
    expect(html).toContain("See the pass");
    expect(html).not.toContain("Generate pass");
    expect(html).toContain(`href="/pass/${pass.id}?example=1"`);
    for (const fake of ["72 acres", "200 acres", "3.2 mi", "2.1 mi", "Blackland Prairie"]) expect(html).not.toContain(fake);
  });

  it("Find This Spot quote: only a riddle the model really wrote for a ready example", () => {
    const pass = realPass();
    const q = spotQuote([readyStatus("connemara", pass)]);
    if (pass.spot?.status === "ok" && pass.spot.riddleBy === "model") expect(q?.riddle).toBe(pass.spot.riddle);
    else expect(q).toBeNull();
    expect(spotQuote([missingStatus("connemara", "x")])).toBeNull();
    const html = renderToStaticMarkup(<PassAnatomy spot={null} />);
    expect(html).not.toContain("Something with a roof where people eat lunch");
    expect(html).toContain("No proof, no Lucky Finds");
    expect(html).toContain("at least 3 Google Maps reviews from the last 2 years");
    expect(html).not.toMatch(/printed as .look, don/);
  });

  it("place labels add the comma our config leaves out", () => {
    expect(placeLabel("Plano TX")).toBe("Plano, TX");
    expect(placeLabel("Dallas, TX")).toBe("Dallas, TX");
  });
});

describe("home copy checked against the app", () => {
  it("two-parks band keeps SPEC §1 numbers with a dated source line", () => {
    const html = renderToStaticMarkup(<TwoParks />);
    for (const n of [">70<", ">25<"]) expect(html).toContain(n);
    expect(TWO_PARKS_SOURCE).toMatch(/^Measured Oct 5, 2026: iNaturalist .* OpenStreetMap/);
    expect(html).toContain(TWO_PARKS_SOURCE);
  });

  it("how it works: real wait time (10-30 s, as PASS_WAIT_COPY), not v0's 10-20 s", () => {
    const html = renderToStaticMarkup(<HowItWorks />);
    expect(html).toContain("Usually 10–30 seconds");
    expect(html).not.toContain("10–20 seconds");
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toMatch(/(^|[" ])animate-pulse/);
  });

  it("the hero picture is labelled as an AI illustration (alt text and visible caption)", () => {
    expect(HERO_ILLUSTRATION.alt).toMatch(/^AI-generated illustration/);
    expect(HERO_ILLUSTRATION.caption).toBe("AI illustration");
  });

  it("every example park has a REAL photo of that park under a free licence, credited on the card", () => {
    for (const ex of EXAMPLE_PARKS) {
      const p = PARK_PHOTOS[ex.slug];
      expect(p, ex.slug).toBeDefined();
      expect(p.licence).toMatch(/^(CC0 1\.0|CC BY 2\.0)$/);
      expect(p.licenceUrl).toMatch(/^https:\/\/creativecommons\.org\/(licenses\/by\/2\.0|publicdomain\/zero\/1\.0)\/$/);
      expect(p.sourceUrl).toMatch(/^https:\/\/(commons\.wikimedia\.org\/wiki\/File:|www\.flickr\.com\/photos\/)/);
      expect(p.src).toMatch(/^\/photos\/[a-z-]+\.webp$/);
      expect(p.alt).not.toMatch(/illustration/i);
      // The source title names the park (checked by hand on the source page; kept honest here).
      const word = ex.name.split(" ")[0];
      expect(`${p.title} ${p.alt}`).toContain(word);
    }
    const html = renderToStaticMarkup(<SampleParks statuses={[missingStatus("connemara", "No data available yet: x.")]} enabled />);
    expect(html).toContain(photoCredit(PARK_PHOTOS.connemara));
    expect(html).toContain(`href="${PARK_PHOTOS.connemara.sourceUrl}"`);
    expect(html).toContain(`href="${PARK_PHOTOS.connemara.licenceUrl}"`);
    const band = renderToStaticMarkup(<TwoParks />);
    expect(band).toContain(`href="${PARK_PHOTOS.celebration.sourceUrl}"`);
    expect(band).not.toContain("AI illustration");
  });

  it("Explorer age picker: three real radios, 6-10 named 'most kids', the hint text is true to the age band", () => {
    const html = renderToStaticMarkup(<AgePicker band="6-10" onChange={() => {}} legendId="t" />);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain("Explorer age</legend>");
    expect(html).toContain("(most kids)");
    expect(html).toContain("6 finds, you read aloud");
    expect(html).toContain("8 finds, 2 brain-benders");
  });
});

describe("phone example row (R1 UX m8 kept in the v3 layout)", () => {
  it("links only ready passes, phones only, and is absent when none is ready", () => {
    const pass = realPass();
    const statuses = [readyStatus("arbor-hills", pass), missingStatus("celebration", "x")];
    const html = renderToStaticMarkup(<ExampleChips examples={readyExamples(statuses)} />);
    expect(html).toContain('aria-label="Open an example pass"');
    expect(html).toContain("sm:hidden");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(">Arbor Hills</a>");
    expect(renderToStaticMarkup(<ExampleChips examples={readyExamples([missingStatus("celebration", "x")])} />)).toBe("");
    expect(shortParkName("White Rock Lake Park")).toBe("White Rock Lake");
    expect(shortParkName("Connemara Meadow Preserve")).toBe("Connemara Meadow");
  });
});
