/**
 * /how-it-works "Blueprint" (Kevin, 2026-10-09): the architecture diagram names every real service, each service is
 * really used by the code it points at, and every model example on the page is a byte-for-byte copy of a committed
 * real recording (tests/fixtures). Nothing on this page may be typed in.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HowItWorksPage from "@/app/how-it-works/page";
import { UNIT_TESTS } from "@/lib/about/content";
import { evalColumn } from "@/lib/about/eval-summary";
import { MAX_MODEL_CALLS } from "@/lib/ai/build-pass";
import { DROP_REASONS } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { AI_EXAMPLES, clueExample, highlightQuote, riddleExample, tipsExample } from "@/lib/how/ai-examples";
import { services } from "@/lib/how/services";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const json = (f: string) => JSON.parse(read(f));
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const html = renderToStaticMarkup(<HowItWorksPage />);
const blueprint = html.match(/<div data-testid="blueprint"[\s\S]*?<\/ol>[\s\S]*?Runs on[\s\S]*?<\/ul>/)?.[0] ?? "";

/** The text of one <source id="..."> in a recorded prompt, and its kind attribute. */
function sourceIn(fixture: { request: { messages: { content: string }[] } }, id: string) {
  const m = fixture.request.messages[1].content.match(new RegExp(`<source id="${id}"[^>]*kind="([^"]*)"[^>]*>([^<]*)</source>`));
  return m ? { kind: m[1], text: m[2] } : null;
}

describe("the model examples are verbatim copies of real recordings", () => {
  it("job 1 (clue + proof quote): the Connemara answer for Hercules' club", () => {
    const c = AI_EXAMPLES.clue;
    const f = json(c.fixture);
    expect(f._recording.recordedAt).toBe(c.recordedAt);
    expect(f._recording.ageBand).toBe(c.ageBand);
    expect(f.response.model).toBe(c.model);
    const src = sourceIn(f, c.factId)!;
    expect(src.kind).toBe(c.factKind);
    // The excerpt is one whole sentence of the fact the model was given.
    expect(src.text.split(/(?<=\.) /)).toContain(c.inExcerpt);
    const answer = JSON.parse(f.response.choices[0].message.content) as { items: { itemId: string; clue: string; sourceQuote: string; difficulty: string }[] };
    const item = answer.items.find((i) => i.itemId === c.factId)!;
    expect({ clue: item.clue, sourceQuote: item.sourceQuote, difficulty: item.difficulty }).toEqual(c.out);
    expect(answer.items).toHaveLength(c.answerReturned);
    // Kept / dropped counts are pinned by the replay in tests/unit/ai-pass.test.ts (see the Blueprint line there).
  });

  it("job 1: what the page says code did is computed by the app's own checks", () => {
    const c = clueExample();
    expect(c.grounded).toBe(true);
    // The same printed clue the replay test pins (ai-pass.test.ts: "Notice the thick, corky lumps on this tree's bark.").
    expect(c.printed).toBe("Notice the thick, corky lumps on this tree's bark.");
    expect(c.highlight?.quote).toBe(c.out.sourceQuote);
    expect(highlightQuote("abc", "zzz")).toBeNull();
  });

  it("job 2 (riddle): the Celebration answer, checked by validateSpot in the replay", () => {
    const r = AI_EXAMPLES.riddle;
    const f = json(r.fixture);
    expect(f._recording.recordedAt).toBe(r.recordedAt);
    expect(f.response.model).toBe(r.model);
    const src = sourceIn(f, r.factId)!;
    expect(src.kind).toBe(r.factKind);
    expect(src.text.split(/(?<=\.) /)).toContain(r.inExcerpt);
    const answer = JSON.parse(f.response.choices[0].message.content) as { spot: { riddle: string; sourceQuote: string; targetId: string } };
    expect(answer.spot.targetId).toBe(r.factId);
    expect({ riddle: answer.spot.riddle, sourceQuote: answer.spot.sourceQuote }).toEqual(r.out);
    expect(riddleExample().grounded).toBe(true);
  });

  it("job 3 (trip tips): the White Rock answer, and the tips code kept", () => {
    const t = tipsExample();
    const f = json(t.fixture);
    expect(f._recording.recordedAt).toBe(t.recordedAt);
    expect(f._recording.model).toBe(t.model);
    expect(f.facts.parkName).toBe(t.park);
    expect(f.facts.band).toBe(t.ageBand);
    const fact = f.facts.facts.find((x: { id: string }) => x.id === t.factId);
    expect(fact.text).toBe(t.inExcerpt);
    expect(f.request.messages[1].content).toContain(`<fact id="${t.factId}" group="weather">${t.inExcerpt}</fact>`);
    const tip = f.response.tips.find((x: { factId: string }) => x.factId === t.factId);
    expect({ tip: tip.tip, factId: tip.factId }).toEqual(t.out);
    expect(f.response.tips).toHaveLength(t.returned);
    expect(f.tripTips.items).toHaveLength(t.kept);
    expect(f.tripTips.items.map((i: { tip: string }) => i.tip)).toContain(t.out.tip);
  });

  it("the page shows each example exactly as recorded, with a link to its raw file", () => {
    const page = decode(html);
    const c = AI_EXAMPLES.clue;
    expect(page).toContain(c.out.clue);
    expect(page).toContain(c.out.sourceQuote);
    expect(page).toContain(AI_EXAMPLES.riddle.out.riddle);
    expect(page).toContain(AI_EXAMPLES.tips.out.tip);
    expect(page).toContain(AI_EXAMPLES.tips.inExcerpt);
    for (const f of [c.fixture, AI_EXAMPLES.riddle.fixture, AI_EXAMPLES.tips.fixture]) expect(page).toContain(`/blob/main/${f}`);
  });
});

describe("the services list is true to the code", () => {
  it("each service names a file that exists and really talks to it", () => {
    const all = services();
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(existsSync(join(ROOT, s.code.file)), s.code.file).toBe(true);
      expect(read(s.code.file), `${s.id}: ${s.code.file}`).toContain(s.code.contains);
    }
    // The model is the configured open model (default gemma-4-31B-it) on DigitalOcean.
    expect(all.filter((s) => s.group === "model")).toHaveLength(1);
    expect(read("vercel.json")).toContain('"crons"');
    expect(read("package.json")).toContain('"next-auth"');
  });

  it("the diagram names every service, the safety-filter size, the hard-rule count and the call cap", () => {
    expect(blueprint).not.toBe("");
    for (const s of services()) {
      expect(blueprint, s.name).toContain(`data-service="${s.id}"`);
      expect(decode(blueprint), s.name).toContain(s.name);
    }
    expect(blueprint).toContain(`${BLOCKED_TAXA.length} risky species groups`);
    const hard = DROP_REASONS.filter((r) => DROP_REASON_INFO[r].kind === "always").length;
    expect(blueprint).toContain(`${hard} hard rules`);
    expect(blueprint).toContain(`1-${MAX_MODEL_CALLS} clue calls + 1 tips call a pass`);
    expect(blueprint).toContain("gemma-4-31B-it");
    // A real text flow for screen readers: one ordered list of five stages, each with a heading.
    expect(blueprint).toContain('aria-label="How data flows into a pass, in 5 stages"');
    expect((blueprint.match(/data-stage=/g) ?? []).length).toBe(5);
  });

  it("the services table has one row per service", () => {
    const table = html.match(/<table[^>]*data-testid="services-table"[\s\S]*?<\/table>/)?.[0] ?? "";
    for (const s of services()) expect(table, s.id).toContain(`data-service-row="${s.id}"`);
    expect((table.match(/data-service-row=/g) ?? []).length).toBe(services().length);
  });
});

describe("the numbers strip quotes its sources", () => {
  it("shows the eval run's values and the dated unit-test count, with misses as misses", () => {
    const g = evalColumn("gemma-4-31B-it");
    const strip = html.match(/data-stat="grounded"[\s\S]*?data-stat="tests"[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(strip).toContain(`${g.groundedPct}%`);
    expect(strip).toContain(`$${g.costPerPass.toFixed(5)}`);
    expect(strip).toContain(UNIT_TESTS.passed.toLocaleString("en-US"));
    // Cost is over its target in this run: the tile must say "Missed".
    expect(strip.match(/data-stat="cost"[\s\S]*?<\/li>/)?.[0]).toContain(">Missed<");
    // One dot per test run, none for a risky species printed.
    expect((strip.match(/data-stat="blocked"[\s\S]*?<\/li>/)?.[0].match(/aspect-square/g) ?? []).length).toBe(g.runs);
  });
});
