/**
 * "What's a pass?" (Kevin's option A "Show a real pass", 2026-10-08): the home section shows ONE real pinned pass,
 * printed-style, with numbered parts. Every line on it is read from the pinned file; a part the pass doesn't have is
 * labelled "When the data has it" in the list and never drawn; with no loadable pass the section says
 * "No data available".
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import raw from "@/data/pinned-examples/oak-point.json";
import { PassAnatomy } from "@/components/home/PassAnatomy";
import { anatomyOf, anatomySlug, kindsShown, partsOf, passAnatomy, passAnatomyFor } from "@/lib/home/pass-anatomy";
import { octoberHeadline } from "@/lib/october";
import { formatTime } from "@/lib/pass/format";
import { PassSchema, type Pass } from "@/lib/pass/schema";
import { pinnedPass, PINNED_FILES } from "@/lib/pinned";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const file = PassSchema.parse((raw as unknown as { pass: unknown }).pass);
// A day after every pinned pass (so present-tense reasons are said as of the pass's own day, like the pass page).
const LATER = "2026-10-09";

/** A real recorded pass WITH Lucky Finds (tests/ fixture, Arbor Hills, Gemma 4 + SerpApi), to prove the lucky rows render. */
function luckyPass(): Pass {
  const rec = JSON.parse(readFileSync(new URL("../fixtures/pass-arbor-hills-lucky-live.json", import.meta.url), "utf8")) as unknown;
  const find = (v: unknown): Pass | null => {
    const p = PassSchema.safeParse(v);
    if (p.success) return p.data;
    if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) { const f = find(x); if (f) return f; }
    return null;
  };
  const p = find(rec);
  if (!p) throw new Error("no pass in the lucky fixture");
  return p;
}

describe("which pinned pass", () => {
  it("is the pinned example with the most kinds of parts (Oak Point today: Park, Wild, Find This Spot, October)", () => {
    const counts = Object.keys(PINNED_FILES).map((s) => [s, kindsShown(pinnedPass(s)!)] as const);
    const best = Math.max(...counts.map(([, n]) => n));
    const slug = anatomySlug();
    expect(slug).not.toBeNull();
    expect(kindsShown(pinnedPass(slug!)!)).toBe(best);
    expect(slug).toBe("oak-point");
    expect(partsOf(file)).toEqual({ park: true, wild: true, lucky: false, spot: true, october: true, stub: true });
  });

  it("null when no pinned pass loads", () => {
    expect(anatomySlug(() => null)).toBeNull();
  });
});

describe("anatomy data is the real pinned pass", () => {
  const a = passAnatomy(pinnedPass("oak-point"), "oak-point", LATER)!;

  it("every find, number, answer and date comes from the file", () => {
    expect(a).not.toBeNull();
    expect(a.parkName).toBe(file.park.name);
    expect(a.madeAt).toBe(formatTime(file.generatedAt));
    expect(a.href).toBe(`/pass/${file.id}?example=1`);
    expect(a.total).toBe(file.items.length);
    expect([...a.park, ...a.wild, ...a.lucky].map((f) => f.clue)).toEqual(file.items.map((i) => i.clue));
    expect([...a.park, ...a.wild].map((f) => f.n)).toEqual(file.items.map((_, i) => i + 1));
    expect(a.answers).toEqual(file.items.map((i) => i.answer));
    expect(a.lucky).toEqual([]);
    expect(a.safetyFiltered).toBe(file.safetyFiltered);
    expect(a.spot?.riddle).toBe(file.spot?.status === "ok" ? file.spot.riddle : undefined);
    expect(a.october).toEqual(file.october);
    expect(a.sources.join(" ")).toContain(file.model.answered);
  });

  it("the missing Lucky Finds reason is the pass's own, said as of its day", () => {
    expect(a.luckyWhy).toMatch(/^Lucky Finds: not on this pass\. On Tue, Oct 6, the server that made it had no SerpApi key/);
    expect(a.notOnPass).toContain(a.luckyWhy);
  });

  it("null for no pass or a pass that isn't complete (never a half pass)", () => {
    expect(passAnatomy(null, "oak-point", LATER)).toBeNull();
    expect(passAnatomy({ ...file, items: file.items.slice(0, 3) }, "oak-point", LATER)).toBeNull();
  });

  it("passAnatomyFor() picks the same pass", () => {
    expect(passAnatomyFor(Date.parse("2026-10-09T15:00:00Z"))?.parkName).toBe(file.park.name);
  });
});

describe("the section", () => {
  const a = passAnatomy(pinnedPass("oak-point"), "oak-point", LATER)!;
  const html = renderToStaticMarkup(<PassAnatomy anatomy={a} />);
  const t = text(html);

  it("keeps the owner's eyebrow, heading and intro; one h2; the six parts as h3", () => {
    expect(t).toContain("What's a pass?");
    expect(html.match(/<h2\b/g)).toHaveLength(1);
    expect(html).toContain('id="pass-title"');
    expect(t).toContain("Proof in every clue.");
    expect(t).toContain("Every clue comes from a real, dated source, listed on the grown-up's stub. So nobody spends 40 minutes hunting for a heron that flew off in 2019.");
    const h3 = [...html.matchAll(/<h3\b[^>]*>([^<]*)/g)].map((m) => text(m[1]));
    expect(h3).toEqual(["Park Finds", "Wild Finds", "Lucky Finds", "Find This Spot", "October monarch box", "The grown-up's tear-off stub"]);
  });

  it("shows every real find, the real riddle, the real monarch numbers and the stub", () => {
    for (const i of file.items) expect(t).toContain(i.clue);
    expect(html.match(/data-testid="anatomy-find"/g)).toHaveLength(file.items.length);
    if (file.spot?.status === "ok") expect(t).toContain(file.spot.riddle);
    if (file.october?.status === "ok") {
      expect(t).toContain(octoberHeadline(file.october));
      expect(t).toContain(`${file.october.thisYear.count}`);
      expect(t).toContain(`${file.october.lastYear.count}`);
    }
    expect(t).toContain("For the grown-up: answer key");
    expect(html).toContain('data-testid="spot-map"');
    expect(t).toContain(`A real pass: ${file.park.name}, Plano, TX, made ${formatTime(file.generatedAt)}`);
  });

  it("keeps the honest facts: blocked groups never printed, word-for-word check, no proof = left off", () => {
    expect(t).toContain(`(${BLOCKED_TAXA.length} risky groups in all) are never printed`);
    expect(t).toContain("look, don't touch.");
    expect(t).toContain("Gemma quotes the source for each find, and code checks it word for word.");
    expect(t).toContain("No proof? The pass leaves them off and says why.");
    expect(t).toContain(`On this pass, ${file.safetyFiltered} nearby sightings were left off for safety.`);
  });

  it("a part the pass lacks says 'When the data has it' and is never drawn with a made-up clue", () => {
    expect(html.match(/data-testid="anatomy-when-data"/g)).toHaveLength(1);
    expect(html).toContain('data-legend="lucky" data-has="false"');
    expect(html).not.toContain('data-section="lucky"');
    // Its marker sits on the stub's real "Not on this pass" line instead.
    const region = html.slice(html.indexOf('data-region="lucky"'));
    expect(text(region)).toContain("Part 3, Lucky Finds (not on this pass): Not on this pass Lucky Finds: not on this pass.");
    for (const p of ["park", "wild", "spot", "october", "stub"]) expect(html).toContain(`data-legend="${p}" data-has="true"`);
  });

  it("with Lucky Finds on a real pass, its rows are drawn and the list says where", () => {
    const lucky = luckyPass();
    // The recorded Lucky pass is short (not complete), so the home never shows it: passAnatomy refuses it.
    expect(passAnatomy(lucky, "arbor-hills", LATER)).toBeNull();
    const b = anatomyOf(lucky, "arbor-hills", LATER);
    expect(b).not.toBeNull();
    if (!b) return;
    const h = renderToStaticMarkup(<PassAnatomy anatomy={b} />);
    const rows = lucky.items.filter((i) => i.section === "lucky");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(text(h)).toContain(r.clue);
    expect(h).toContain('data-legend="lucky" data-has="true"');
  });

  it("with no pinned pass: 'No data available' and why, no sheet, the list still explains each part", () => {
    const none = renderToStaticMarkup(<PassAnatomy anatomy={null} />);
    expect(text(none)).toContain("No data available: the saved example pass couldn't be loaded");
    expect(none).not.toContain('data-testid="anatomy-sheet"');
    expect(none).not.toContain('data-testid="anatomy-find"');
    expect(none.match(/data-testid="anatomy-when-data"/g)?.length).toBe(5);
  });

  it("markers are decorative; each region names itself for screen readers", () => {
    for (const [n, name] of [[1, "Park Finds"], [2, "Wild Finds"], [4, "Find This Spot"], [5, "October monarch box"], [6, "The grown-up's tear-off stub"]] as const) {
      expect(t).toContain(`Part ${n}, ${name}:`);
    }
    expect(html).toMatch(/<span aria-hidden="true" class="gp-mark /);
  });
});
