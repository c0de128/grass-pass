import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OctoberBox } from "@/components/pass/OctoberBox";
import { isOctoberDay } from "@/lib/october";
import { KID_STAY_CLOSE, KidPass, PRINT_LOGO_SRC, SNUG_LINE_BUDGET, TIGHT_LINE_BUDGET, estimatedLines, passDensity, rowIcon } from "@/components/pass/KidPass";
import { HoopIcon, MagnifierIcon, PinIcon } from "@/components/art/icons";
import { MAP_COL_IN, MAP_MIN_PRINTED_IN, MIN_FIT, PRINT_HEIGHT_PX, bestFit, fitFor, mapColumnFor } from "@/components/pass/PrintFit";
import { ParentStub, STUB_EACH_LINE, STUB_LOOK_ONLY, TearLine, shortDay } from "@/components/pass/ParentStub";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { PassPreview } from "@/components/pass/PassPreview";
import { BUILT_WITH_LLAMA, WIKIPEDIA_CREDIT, formatTime, isLlamaModel } from "@/lib/pass/format";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import { PASS_COPY, type Pass } from "@/lib/pass/schema";
import { SAFETY_FOOTNOTE } from "@/lib/safety/danger-taxa";
import { PARKS, passReplay } from "./support/pass-replay";

/** Real passes made by the app code from the live S3 recordings (no invented data); made once per park. */
const made = new Map<string, Promise<Pass>>();
function realPass(parkId: string): Promise<Pass> {
  if (!made.has(parkId)) made.set(parkId, makeRealPass(parkId));
  return made.get(parkId)!;
}

async function makeRealPass(parkId: string): Promise<Pass> {
  resetStores();
  resetPassMaking();
  const r = passReplay();
  const out = await makePass(
    { parkId, ageBand: "6-10" },
    { ip: "192.0.2.10", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: { DO_INFERENCE_API_KEY: "test-key-not-real" } },
  );
  if (out.kind !== "pass") throw new Error(out.kind);
  return out.pass;
}

// Real October passes also make the monarch + milkweed iNaturalist calls (1 request/s queue).
vi.setConfig({ testTimeout: 30_000 });

let restore: () => void;
beforeEach(() => {
  resetStores();
  resetPassMaking();
  restore = setLogSink(() => undefined);
});
afterEach(() => restore());

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const URL_TEXT = "grass-pass.test/pass/w306191453-6to10-20261005-1";

describe("KidPass (top of the printed sheet)", () => {
  it("Connemara: one numbered row per find with a checkbox, icon, clue, where, safety line and small-print evidence", async () => {
    const pass = await realPass(PARKS.connemara.id);
    const html = renderToStaticMarkup(<KidPass pass={pass} />);
    const t = text(html);

    expect(html.match(/class="gp-find"/g)).toHaveLength(pass.items.length);
    expect(html.match(/class="gp-box"/g)).toHaveLength(pass.items.length);
    expect(html.match(/class="gp-small"/g)).toHaveLength(pass.items.length);
    expect(html).toContain('class="gp-kid"');
    expect(html.match(/<svg[^>]*class="gp-icon"/g)).toHaveLength(pass.items.length);
    pass.items.forEach((it, i) => {
      expect(t).toContain(`Find ${i + 1}, ${it.section === "park" ? "Park Find" : "Wild Find"}: ${it.clue}`);
      expect(t).toContain(it.evidence);
      expect(t).toContain(`(${it.evidence})`);
      if (it.lookWhere) expect(t).toContain(`Look: ${it.lookWhere}.`);
      if (it.safety) expect(t).toContain(it.safety);
    });
    expect(t).toContain("Look, don't touch. It has sharp spines or thorns.");
    expect(t).toContain("seen 2 times since");
    // The kid half never carries the answers.
    for (const it of pass.items) expect(t).not.toContain(it.answer);
  });

  it("shows the park, the day, the age band and a handwriting name line; the logo is the 1-colour file by path", async () => {
    const pass = await realPass(PARKS.celebration.id);
    const html = renderToStaticMarkup(<KidPass pass={pass} />);
    const t = text(html);
    expect(html).toMatch(/<h1 id="kid-pass-title"><span class="gp-label">Park:<\/span> Celebration Park<\/h1>/);
    expect(t).toContain("Ages 6-10");
    expect(t).toContain("Name:");
    expect(html).toContain('class="gp-name-line" aria-hidden="true"');
    expect(html).toContain(`src="${PRINT_LOGO_SRC}"`);
    expect(html).toContain('alt="Grass Pass: your ticket to get outside"');
    expect(PRINT_LOGO_SRC).toBe("/logo-print-1c.svg");
    expect(t).toContain(`Find these ${pass.items.length} things. Tick a box when you find one!`);
    expect(t).toContain(KID_STAY_CLOSE);
  });

  it("the print logo file is pure black (no colour, no grey) so it survives a cheap printer", () => {
    const svg = readFileSync(new URL("../../public/logo-print-1c.svg", import.meta.url), "utf8");
    const colours = [...svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-f]{3,8}|[a-z]+)"/gi)].map((m) => m[1].toLowerCase());
    for (const c of colours) expect(["#000", "#000000", "#fff", "#ffffff", "none", "black", "white"]).toContain(c);
    expect(svg).not.toMatch(/opacity="0?\.\d/);
  });

  it("reserves the Find This Spot and October slots: nothing at all when absent, the given content when present", async () => {
    const pass = await realPass(PARKS.connemara.id);
    const without = renderToStaticMarkup(<KidPass pass={pass} />);
    expect(without).not.toContain("gp-extras");
    expect(without).not.toContain("data-slot");
    expect(without).toContain('data-extras="false"');

    const withSlots = renderToStaticMarkup(<KidPass pass={pass} spot={<p>spot slot</p>} october={<p>october slot</p>} />);
    expect(withSlots).toContain('data-extras="true"');
    expect(withSlots).toContain('<div data-slot="spot"><p>spot slot</p></div>');
    expect(withSlots).toContain('<div data-slot="october"><p>october slot</p></div>');
    expect(withSlots).toContain('data-density="snug"');

    const onlyOctober = renderToStaticMarkup(<KidPass pass={pass} october={<p>october slot</p>} />);
    expect(onlyOctober).not.toContain('data-slot="spot"');
  });

  it("the real October box (S7, print variant) fills the October slot as a row under the finds", async () => {
    const pass = await realPass(PARKS.connemara.id);
    expect(isOctoberDay(pass.day)).toBe(true);
    const html = renderToStaticMarkup(<KidPass pass={pass} october={<OctoberBox pass={pass} variant="print" headingLevel={2} />} />);
    expect(html).toContain('data-extras="true"');
    expect(html).toMatch(/<div data-slot="october"><section[^>]*data-variant="print"/);
    expect(text(html)).toContain("October special: monarch butterflies");
    expect(html).not.toContain('data-slot="spot"');
  });

  it("density: real passes print roomy; side slots print snug; near-maximum clues print tight", async () => {
    for (const park of [PARKS.connemara, PARKS.celebration]) {
      const pass = await realPass(park.id);
      expect(estimatedLines(pass.items)).toBeLessThanOrEqual(SNUG_LINE_BUDGET);
      expect(passDensity(pass.items, false)).toBe("roomy");
      expect(passDensity(pass.items, true)).toBe("snug");
    }
    const pass = await realPass(PARKS.celebration.id);
    // A real 8-item pass with every clue at the 120-character maximum the schema allows.
    const long = pass.items.map((it) => ({ ...it, clue: it.clue.padEnd(120, " x"), lookWhere: it.lookWhere.padEnd(60, " x") }));
    expect(estimatedLines(long)).toBeGreaterThan(TIGHT_LINE_BUDGET);
    expect(passDensity(long, false)).toBe("tight");
    expect(passDensity(long, true)).toBe("tight");
    // Connemara (7 finds since the R1 follow-up recording) with every clue just over one printed line and
    // four long hints lands in between.
    const connemara = await realPass(PARKS.connemara.id);
    expect(connemara.items).toHaveLength(7);
    const mid = connemara.items.map((it, i) => ({ ...it, clue: it.clue.padEnd(70, " x"), ...(i < 4 ? { lookWhere: it.lookWhere.padEnd(60, " x") } : {}) }));
    const lines = estimatedLines(mid);
    expect(lines).toBeGreaterThan(SNUG_LINE_BUDGET);
    expect(lines).toBeLessThanOrEqual(TIGHT_LINE_BUDGET);
    expect(passDensity(mid, false)).toBe("snug");
  });
});

describe("ParentStub (bottom of the printed sheet)", () => {
  it("Connemara: numbered answers with evidence, safety notes, sources with dates, the model that answered and when", async () => {
    const pass = await realPass(PARKS.connemara.id);
    const t = text(renderToStaticMarkup(<ParentStub pass={pass} passUrl={URL_TEXT} />));

    pass.items.forEach((it, i) => expect(t).toContain(`${i + 1}. ${it.answer}`));
    expect(t).toContain("Golden-eye Lichen (Teloschistes chrysophthalmus)");
    // The evidence is printed once, on the kid's rows (PM decision 2026-10-05), not again in the answers.
    for (const it of pass.items) expect(t).not.toContain(`(${it.evidence})`);
    expect(t).not.toContain("seen 2 times since");
    expect(t).toContain(`${STUB_LOOK_ONLY} ${STUB_EACH_LINE} ${SAFETY_FOOTNOTE}`);
    expect(t).toContain(`Map: © OpenStreetMap contributors (ODbL), checked ${formatTime(pass.dataCheckedAt.osm)}.`);
    expect(pass.wildSince).not.toBeNull();
    expect(t).toContain(
      `Wildlife: iNaturalist observers, research grade, within 1.5 km, ${shortDay(pass.wildSince!)} to ${shortDay(pass.day)}; checked ${formatTime(pass.dataCheckedAt.inat!)}.`,
    );
    expect(t).toContain(`Clues: gemma-4-31B-it (open model, Apache-2.0), made ${formatTime(pass.generatedAt)}. Code wrote every number and date.`);
    expect(t).toContain(`Made with Grass Pass · ${URL_TEXT}`);
    expect(t).toContain(`Keep this part. ${pass.parentNote}`);
    // Lucky Finds isn't connected in the recordings: the stub says so instead of hiding it.
    expect(t).toContain(PASS_COPY.luckyOff);
  });

  it("Celebration: the exact empty Wild Finds copy goes under 'Not on this pass'; no safety footnote when nothing was filtered", async () => {
    const pass = await realPass(PARKS.celebration.id);
    const t = text(renderToStaticMarkup(<ParentStub pass={pass} passUrl={URL_TEXT} />));
    expect(t).toContain("Not on this pass");
    expect(t).toContain("No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist.");
    expect(t).not.toContain(SAFETY_FOOTNOTE);
    // This live answer has no water find, so no find carries a safety line and the stub does not point
    // to any (Connemara's stub test covers the line when there are some).
    expect(pass.items.every((it) => it.safety === null)).toBe(true);
    expect(t).not.toContain(STUB_EACH_LINE);
  });

  it("missing and removed clues are stated honestly, never padded", async () => {
    const pass = await realPass(PARKS.celebration.id);
    const short: Pass = { ...pass, items: pass.items.slice(0, 5), removed: { notGrounded: 2, other: 1 } };
    const html = renderToStaticMarkup(<ParentStub pass={short} passUrl={URL_TEXT} />);
    const t = text(html);
    expect(t).toContain("No data available for 3 more finds: their clues didn't pass our checks, so we left them off.");
    expect(t).toContain("2 clues removed: didn't match their source.");
    expect(t).toContain("1 clue removed: gave away the answer or broke a rule.");
    expect(html.match(/<li>\d<!-- -->\. /g) ?? html.match(/<li>\d\. /g)).toHaveLength(5);
  });

  it("spot answer and October source slots render nothing when absent", async () => {
    const pass = await realPass(PARKS.connemara.id);
    const without = renderToStaticMarkup(<ParentStub pass={pass} passUrl={URL_TEXT} />);
    expect(without).not.toContain("data-slot");
    const withSlots = renderToStaticMarkup(
      <ParentStub pass={pass} passUrl={URL_TEXT} spotAnswer={<p>spot answer slot</p>} october={<span>october source slot</span>} />,
    );
    expect(withSlots).toContain('<div data-slot="spot-answer"><p>spot answer slot</p></div>');
    expect(withSlots).toContain('<p class="gp-small gp-stub-october" data-slot="october-source"><span>october source slot</span></p>');
  });

  it("R1-m11: credits Wikipedia (CC BY-SA) on paper only when the pass has a Wild Find", async () => {
    const wild = await realPass(PARKS.connemara.id);
    expect(wild.items.some((it) => it.section === "wild")).toBe(true);
    expect(text(renderToStaticMarkup(<ParentStub pass={wild} passUrl={URL_TEXT} />))).toContain(WIKIPEDIA_CREDIT);
    expect(text(renderToStaticMarkup(<PassPreview pass={wild} />))).toContain(WIKIPEDIA_CREDIT);
    expect(WIKIPEDIA_CREDIT).toBe("Species facts: Wikipedia (CC BY-SA), via iNaturalist.");

    const park = await realPass(PARKS.celebration.id);
    expect(park.items.some((it) => it.section === "wild")).toBe(false);
    expect(text(renderToStaticMarkup(<ParentStub pass={park} passUrl={URL_TEXT} />))).not.toContain("Wikipedia");
  });

  it("R1-m11: shows 'Built with Llama' on the printed stub and the screen pass only when a Llama model answered", async () => {
    const pass = await realPass(PARKS.connemara.id);
    for (const html of [renderToStaticMarkup(<ParentStub pass={pass} passUrl={URL_TEXT} />), renderToStaticMarkup(<PassPreview pass={pass} />)]) {
      expect(html).not.toContain(BUILT_WITH_LLAMA);
    }
    const llama: Pass = { ...pass, model: { ...pass.model, answered: "llama-4-maverick" } };
    const stub = text(renderToStaticMarkup(<ParentStub pass={llama} passUrl={URL_TEXT} />));
    expect(stub).toContain("Clues: llama-4-maverick (open model, Llama 4 Community Licence)");
    expect(stub).toContain("Built with Llama (Llama 4 Community Licence)");
    expect(renderToStaticMarkup(<PassPreview pass={llama} />)).toContain(`>${BUILT_WITH_LLAMA}</strong>`);
    expect(isLlamaModel("Llama-4-Maverick-17B-128E-Instruct")).toBe(true);
    expect(isLlamaModel("gemma-4-31B-it")).toBe(false);
  });

  it("tear line is a labelled separator with scissors", () => {
    const html = renderToStaticMarkup(<TearLine />);
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Cut or tear here: the kid keeps the top, the grown-up keeps the bottom"');
    expect(html).toContain('class="gp-scissors"');
    expect(html.match(/class="gp-tear-line"/g)).toHaveLength(2);
  });

  it("shortDay formats a calendar day without shifting it", () => {
    expect(shortDay("2026-09-21")).toBe("Sep 21");
    expect(shortDay("2026-10-05")).toBe("Oct 5");
    expect(shortDay("bad")).toBe("bad");
  });
});

describe("print.css (ADR 0004 rules)", () => {
  const css = readFileSync(new URL("../../src/styles/print.css", import.meta.url), "utf8");

  it("one US Letter page with 0.4 in margins", () => {
    expect(css).toMatch(/@page\s*\{\s*size:\s*letter;\s*margin:\s*0\.4in;\s*\}/);
  });

  it("only black and white colours, no greys", () => {
    const hex = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
    expect(hex.length).toBeGreaterThan(0);
    for (const h of hex) expect(["#000", "#fff"]).toContain(h);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/i);
    expect(css).not.toMatch(/opacity:/i);
  });

  it("checkboxes are at least 7 mm; body text at least 11 pt", () => {
    const box = /\.gp-box\s*\{[^}]*width:\s*([\d.]+)mm;[^}]*height:\s*([\d.]+)mm;/.exec(css);
    expect(box).not.toBeNull();
    expect(Number(box![1])).toBeGreaterThanOrEqual(7);
    expect(Number(box![2])).toBeGreaterThanOrEqual(7);
    const body = /\.gp-sheet\s*\{[^}]*font-size:\s*([\d.]+)pt;/.exec(css);
    expect(Number(body![1])).toBeGreaterThanOrEqual(11);
    const clue = [...css.matchAll(/\.gp-clue\s*\{[^}]*font-size:\s*([\d.]+)pt;/g)].map((m) => Number(m[1]));
    for (const size of clue) expect(size).toBeGreaterThanOrEqual(11);
  });

  it("hides the site header and the screen toolbar when printing the print route", () => {
    expect(css).toContain("body:has(.gp-print-page) > :not(.gp-print-page)");
    expect(css).toMatch(/\.gp-screen-only\s*\{\s*display:\s*none !important;/);
  });
});

describe("PrintFit (one-page safety net)", () => {
  it("keeps 1 when the sheet fits, shrinks just enough when it doesn't, never below the floor", () => {
    expect(PRINT_HEIGHT_PX).toBeCloseTo(971.2, 1);
    expect(fitFor(900)).toBe(1);
    expect(fitFor(PRINT_HEIGHT_PX)).toBe(1);
    expect(fitFor(1000)).toBe(0.97);
    expect(fitFor(1000) * 1000).toBeLessThanOrEqual(PRINT_HEIGHT_PX);
    expect(fitFor(1100)).toBe(0.88);
    expect(fitFor(5000)).toBe(MIN_FIT);
    expect(fitFor(0)).toBe(1);
    expect(fitFor(Number.NaN)).toBe(1);
  });

  it("bestFit starts from the ratio and steps up while the reflowed copy still fits", () => {
    // A sheet that is 1100 px tall and, because zoom gives lines more room, loses extra height:
    const height = (z: number) => 1100 * z * (z < 1 ? 0.95 : 1);
    const fit = bestFit(height)!;
    expect(fit).toBeGreaterThan(fitFor(1100));
    expect(height(fit)).toBeLessThanOrEqual(PRINT_HEIGHT_PX);
    expect(height(Math.round((fit + 0.01) * 100) / 100)).toBeGreaterThan(PRINT_HEIGHT_PX);
    expect(bestFit(() => 900)).toBe(1);
    expect(bestFit(() => null)).toBeNull();
    expect(bestFit(() => 50_000)).toBe(MIN_FIT);
  });

  it("bestFit steps DOWN from the ratio when a smaller scale makes the sheet taller (the wider map column)", () => {
    // 1000 px at 100%, but every step below 1 adds 30 px (a wider, taller map): the plain ratio (0.97) doesn't fit.
    const height = (z: number) => (1000 + (z < 1 ? 30 : 0)) * z;
    const fit = bestFit(height)!;
    expect(fit).toBeLessThan(fitFor(1000));
    expect(height(fit)).toBeLessThanOrEqual(PRINT_HEIGHT_PX);
    expect(height(Math.round((fit + 0.01) * 100) / 100)).toBeGreaterThan(PRINT_HEIGHT_PX);
    expect(bestFit((z) => (z < 1 ? 50_000 : 1100))).toBe(MIN_FIT);
  });

  it("the map column widens at a smaller print scale so the map always prints >= 3.1 in (lines >= 1 pt)", () => {
    expect(MAP_MIN_PRINTED_IN).toBeGreaterThanOrEqual(3.1);
    expect(mapColumnFor(1)).toBe(MAP_COL_IN);
    expect(mapColumnFor(0.96)).toBe(MAP_COL_IN);
    for (const fit of [0.95, 0.93, 0.92, 0.9, MIN_FIT]) {
      for (const kidZoom of [1, 0.86]) {
        const col = mapColumnFor(fit, kidZoom);
        expect(col).toBeGreaterThanOrEqual(MAP_COL_IN);
        expect(col * fit * kidZoom).toBeGreaterThanOrEqual(3.1);
      }
    }
    expect(mapColumnFor(0.92)).toBe(3.4);
    expect(mapColumnFor(0)).toBe(MAP_COL_IN);
    const printCss = readFileSync(new URL("../../src/styles/print.css", import.meta.url), "utf8");
    expect(printCss).toContain("grid-template-columns: var(--gp-map-col, 3.27in) minmax(0, 1fr);");
  });
});

describe("row icons (S8b: no basketball hoop on a bench or a pond)", () => {
  it("Park Finds get the neutral map pin unless the feature has its own icon", () => {
    expect(rowIcon({ section: "park", feature: "bench" })).toBe(PinIcon);
    expect(rowIcon({ section: "park", feature: "water" })).toBe(PinIcon);
    expect(rowIcon({ section: "park" })).toBe(PinIcon); // passes saved before S8b
    expect(rowIcon({ section: "park", feature: "basketball" })).toBe(HoopIcon);
    expect(rowIcon({ section: "wild" })).toBe(MagnifierIcon);
  });

  it("a real pass stores the feature kind of each Park Find", async () => {
    const pass = await realPass(PARKS.celebration.id);
    const park = pass.items.filter((i) => i.section === "park");
    expect(park.length).toBeGreaterThan(0);
    for (const it of park) expect(it.feature).toMatch(/^[a-z_]+$/);
    expect(pass.items.filter((i) => i.section !== "park").every((i) => i.feature === undefined)).toBe(true);
  });
});
