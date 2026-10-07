import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExampleChips, shortParkName } from "@/components/home/ExampleChips";
import { HeroPassCard } from "@/components/home/HeroPassCard";
import { HomeHero } from "@/components/home/HomeHero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { PassAnatomy } from "@/components/home/PassAnatomy";
import { SampleParks } from "@/components/home/SampleParks";
import { TWO_PARKS_SOURCE, TwoParks } from "@/components/home/TwoParks";
import { AgePicker } from "@/components/pass/PassMaker";
import { cardFacts, HERO_EXAMPLE_ORDER, heroCard, heroFinds, isCountedParkFind, liveStatement, placeLabel, readyExamples, spotQuote } from "@/lib/home/showcase";
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

// Judge R7 T1: a COMPLETE real pass (8 of 8, a model riddle), made by the live builder on 2026-10-06 (Oak Point).
const recordedComplete = JSON.parse(
  readFileSync(new URL("../fixtures/pass-oak-point-complete-live.json", import.meta.url), "utf8"),
) as { pass: unknown };
function completePass(): Pass {
  return PassSchema.parse(recordedComplete.pass);
}

const byslug = (slug: string) => EXAMPLE_PARKS.find((e) => e.slug === slug)!;
const readyStatus = (slug: string, pass: Pass, fresh = true): ExampleStatus => ({
  example: byslug(slug),
  pass: { passId: pass.id, day: pass.day, generatedAt: pass.generatedAt },
  passData: pass,
  fresh,
  today: fresh,
  latest: { passId: pass.id, day: pass.day, generatedAt: pass.generatedAt },
  short: null,
  refreshing: false,
  missing: null,
});
const missingStatus = (slug: string, missing: string, refreshing = false): ExampleStatus => ({
  example: byslug(slug),
  pass: null,
  passData: null,
  fresh: false,
  today: false,
  latest: null,
  short: null,
  refreshing,
  missing,
});

describe("home showcase (v0 slots filled with real data)", () => {
  it("the recorded fixture is a real pass with finds", () => {
    expect(realPass().items.length).toBeGreaterThan(3);
  });

  it("hero card (judge R6): leads with a counted Park Find, then real finds in pass order, the listening clue left out", () => {
    const pass = realPass();
    // The recorded Arbor Hills pass: "Hunt for 4 roofs…", "Track 2 long outdoor seats…", the grill, the vine; its
    // "Stop and listen for running water…" clue is the 4th item but goes last, so it is not among the 3 shown (Kevin 2026-10-07: 3 finds so the picture shows).
    expect(heroFinds(pass).map((f) => f.clue)).toEqual([
      "Hunt for 4 roofs held up by poles with tables below them.",
      "Track 2 long outdoor seats for taking a break.",
      "Ready to find a metal box on a post used for cooking?",
    ]);
    // Judge R7 T1: that recorded pass has 7 of 8 finds, so it is never the hero card; a complete one is. (These tests
    // check the choice made WITHOUT a pinned hero pass: `null`; the pinned one is tested in pinned-examples.test.tsx.)
    expect(heroCard([readyStatus("arbor-hills", pass)], HERO_EXAMPLE_ORDER, null)?.kind).toBe("missing");
    const full = completePass();
    const card = heroCard([missingStatus("white-rock", "No data available yet: x."), readyStatus("arbor-hills", pass), readyStatus("oak-point", full)], HERO_EXAMPLE_ORDER, null);
    expect(card?.kind).toBe("ready");
    if (card?.kind !== "ready") throw new Error("not ready");
    expect(card.ex.example.slug).toBe("oak-point");
    expect(card.finds[0].clue).toBe("Count the 2 cold water spots that bubble up from a spout.");
    expect(card.finds.every((f) => full.items.includes(f))).toBe(true); // never invented, never edited
    const html = renderToStaticMarkup(<HeroPassCard card={card} />);
    for (const it of card.finds) {
      expect(html).toContain(renderToStaticMarkup(<>{it.clue}</>));
      expect(html).toContain(renderToStaticMarkup(<>{it.evidence}</>));
    }
    expect(html).toContain(`href="/pass/${full.id}?example=1"`);
    expect(html).toContain("Plano, TX");
    expect(html).toContain("Ages 6–10");
    // None of the v0 sample clues.
    for (const fake of ["Spot a monarch on the milkweed", "red-winged blackbird", "Count the trail benches", "9 seen", "14 seen"]) {
      expect(html).not.toContain(fake);
    }
  });

  it("hero card: a 'Count …' clue leads; the example with a counted Park Find wins, whatever the order (deterministic)", () => {
    const pass = realPass();
    const shelter = pass.items.find((i) => i.feature === "shelter")!;
    // The same real find, with the real clue Gemma wrote for it on Arbor Hills in eval smoke partial-1853.
    const counted: Pass = { ...pass, items: [pass.items[3], pass.items[1], { ...shelter, clue: "Count the 4 roofed areas with tables below for shade." }, ...pass.items.slice(4)] };
    const finds = heroFinds(counted);
    expect(finds[0].clue).toBe("Count the 4 roofed areas with tables below for shade.");
    // The listening clue was first on this pass; it goes last, so with 6 other finds it is not among the 4 shown.
    expect(finds.some((f) => /listen/.test(f.clue))).toBe(false);
    expect(isCountedParkFind(finds[0])).toBe(true);
    // Judge R7 T1: a short pass (7 of 8) never wins, even with a counted lead and first in HERO_EXAMPLE_ORDER; a complete one does.
    const full = completePass();
    for (const order of [
      [readyStatus("white-rock", counted), readyStatus("celebration", full)],
      [readyStatus("celebration", full), readyStatus("white-rock", counted)],
    ]) {
      const c = heroCard(order, HERO_EXAMPLE_ORDER, null);
      expect(c?.kind === "ready" && c.ex.example.slug).toBe("celebration");
    }
    // Two complete ones: the first in HERO_EXAMPLE_ORDER (White Rock first), whatever the input order.
    expect(HERO_EXAMPLE_ORDER[0]).toBe("white-rock");
    const plain = heroCard([readyStatus("oak-point", full), readyStatus("white-rock", full)], HERO_EXAMPLE_ORDER, null);
    expect(plain?.kind === "ready" && plain.ex.example.slug).toBe("white-rock");
    // A counted lead must name a thing to see ("Spot 2 spots" does not).
    expect(isCountedParkFind({ ...shelter, clue: "Spot 2 spots with metal bars for stretching." })).toBe(false);
  });

  it("hero card: falls back to another ready example, else says why (no link, no clues)", () => {
    const pass = completePass();
    const other = heroCard([readyStatus("white-rock", pass), missingStatus("oak-point", "No data available yet: it is being made right now (about 15-30 seconds).", true)], HERO_EXAMPLE_ORDER, null);
    expect(other?.kind === "ready" && other.ex.example.slug).toBe("white-rock");
    const none = heroCard([missingStatus("oak-point", "No data available yet: the last try didn't work because OpenStreetMap was busy.")], HERO_EXAMPLE_ORDER, null);
    expect(none).toEqual({ kind: "missing", name: byslug("oak-point").name, place: "Plano, TX", reason: "the last try didn't work because OpenStreetMap was busy." });
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
    const html = renderToStaticMarkup(<SampleParks statuses={[readyStatus("oak-point", pass)]} enabled />);
    expect(html).toContain(`${pass.items.length} finds to spot`);
    for (const label of ["Wild Pass", "Mixed Pass", "Built Pass"]) expect(html).not.toContain(label);
    for (const fake of ["50+", "30+", "20+", "40+", "google.com"]) expect(html).not.toContain(fake);
  });

  it("the live pill only claims what is true, and pulses only about today", () => {
    const pass = realPass();
    expect(liveStatement([readyStatus("oak-point", pass), readyStatus("celebration", pass)], true)).toEqual({ text: "2 example passes made today from live data", live: true });
    expect(liveStatement([readyStatus("oak-point", pass, false)], true)).toEqual({ text: "1 example pass ready (made on an earlier day)", live: false });
    expect(liveStatement([missingStatus("oak-point", "x", true)], true)).toEqual({ text: "Making today's example passes", live: true });
    expect(liveStatement([missingStatus("oak-point", "x")], true)).toEqual({ text: "Example passes not ready yet", live: false });
    expect(liveStatement([missingStatus("oak-point", "x")], false)).toEqual({ text: "Example passes are turned off", live: false });
    const html = renderToStaticMarkup(<SampleParks statuses={[missingStatus("oak-point", "No data available yet: no pass has been made for it today.")]} enabled />);
    expect(html).toContain('data-live="false"');
    expect(html).not.toContain("animate-ping");
    expect(html).not.toContain("Live park feeds");
  });

  it("sample cards: See the pass for a ready pass, real place, no distances, no v0 blurbs", () => {
    const pass = realPass();
    const html = renderToStaticMarkup(<SampleParks statuses={[readyStatus("oak-point", pass)]} enabled />);
    expect(html).toContain("See the pass");
    expect(html).not.toContain("Generate pass");
    expect(html).toContain(`href="/pass/${pass.id}?example=1"`);
    for (const fake of ["72 acres", "200 acres", "3.2 mi", "2.1 mi", "Blackland Prairie"]) expect(html).not.toContain(fake);
  });

  it("Find This Spot quote: only a riddle the model really wrote for a ready example", () => {
    const pass = realPass();
    const q = spotQuote([readyStatus("oak-point", pass)]);
    if (pass.spot?.status === "ok" && pass.spot.riddleBy === "model") expect(q?.riddle).toBe(pass.spot.riddle);
    else expect(q).toBeNull();
    expect(spotQuote([missingStatus("oak-point", "x")])).toBeNull();
    const html = renderToStaticMarkup(<PassAnatomy spot={null} />);
    expect(html).not.toContain("Something with a roof where people eat lunch");
    expect(html).toContain("No proof? The pass leaves them off and says why.");
    expect(html).toContain("Maybe-sightings, like dogs or bikes, mentioned in at least 3 Google Maps reviews from the last 2 years");
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
    const html = renderToStaticMarkup(<SampleParks statuses={[missingStatus("oak-point", "No data available yet: x.")]} enabled />);
    expect(html).toContain(photoCredit(PARK_PHOTOS["oak-point"]));
    // UX-6-04: the source page and licence links live in the full list on /about (one link from here).
    expect(html).toContain(`${PARK_PHOTOS.connemara.title} by ${PARK_PHOTOS.connemara.author}`);
    expect(html).toContain('href="/about#credits"');
    const band = renderToStaticMarkup(<TwoParks />);
    expect(band).toContain(photoCredit(PARK_PHOTOS.celebration));
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
    expect(shortParkName("Oak Point Park and Nature Preserve")).toBe("Oak Point");
    expect(shortParkName("Arbor Hills Nature Preserve")).toBe("Arbor Hills");
  });

  it("sits directly under the headline, before the lead paragraph (above the fold at 360x740 with Kevin's bigger h1)", () => {
    const statuses = [readyStatus("arbor-hills", realPass())];
    const html = renderToStaticMarkup(<HomeHero card={null} examples={readyExamples(statuses)}>{null}</HomeHero>);
    const h1End = html.indexOf("</h1>");
    const row = html.indexOf('aria-label="Open an example pass"');
    const lead = html.indexOf("Grass Pass turns your local park");
    expect(h1End).toBeGreaterThan(0);
    expect(row).toBeGreaterThan(h1End);
    expect(lead).toBeGreaterThan(row);
  });
});

describe("UX-6-04: the home photo credits are one Tab stop", () => {
  it("names every photo, author, date and licence as text, with one link to the full list on /about", async () => {
    const { PhotoCredits } = await import("@/components/home/PhotoCredits");
    const html = renderToStaticMarkup(<PhotoCredits />);
    const photos = Object.values(PARK_PHOTOS);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/about#credits"');
    expect(html).toContain("Photo credits and licences");
    for (const p of photos) {
      expect(html).toContain(`${p.title} by ${p.author} (${p.taken})`);
      expect(html).toContain(`(${p.licence})`);
    }
  });

  it("the two-parks photos carry a text credit, not a link", async () => {
    const src = (await import("node:fs")).readFileSync("src/components/home/TwoParks.tsx", "utf8");
    expect(src).not.toMatch(/href={pic.sourceUrl}/);
    expect(src).toContain("{photoCredit(pic)}");
  });
});
