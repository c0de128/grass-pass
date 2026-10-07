/**
 * Audit round 8, builder B (pass content): SEC-8-01 (contact instructions in code), Q-8-01 (13+ print room), Q-8-04
 * (13+ clue quality), judge C1 (water repeats), Q-8-05 / UX-8-05 (kid wording on 13+ pages).
 * The crafted bad clues are the auditor's own probes (audits/round-8/security.md); the real clues are from the recorded
 * fixtures, eval runs and the first live 13+ pass (tests/fixtures/pass-arbor-hills-13plus-full-live.json).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { caseDataOrNull, loadFixture, type CaseData } from "../../evals/fixture";
import { KidPass, passDensity } from "@/components/pass/KidPass";
import { ADULT_MIN_FIT, MIN_FIT, PRINT_TWO_PAGES, PRINT_TWO_PAGES_ADULT, minFitFor, printTwoPagesText } from "@/components/pass/PrintFit";
import { SpotMap } from "@/components/pass/SpotMap";
import { fixPlantWho, kidWordingProblem, triviaProblem } from "@/lib/ai/jargon";
import type { Mix } from "@/lib/ai/prompt";
import { DROP_REASONS, MAX_WATER_CLUES, validateDraft, validateSpot, waterRepeat } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { AUDIENCE_COPY } from "@/lib/pass/audience";
import { isCompletePass } from "@/lib/pass/complete";
import { E2E_FIXTURE_ENV, E2E_FIXTURE_FILES, e2eFixturePass } from "@/lib/pass/e2e-fixtures";
import { PassSchema, type Pass } from "@/lib/pass/schema";
import type { PoolItem } from "@/lib/pool/types";
import { handlingInstruction } from "@/lib/safety/handling";
import { SPOT_COPY } from "@/lib/spot/types";

const ROOT = join(__dirname, "..", "..");
const ARBOR_13: Pass = PassSchema.parse(JSON.parse(readFileSync(join(ROOT, "tests/fixtures/pass-arbor-hills-13plus-full-live.json"), "utf8")).pass);

describe("SEC-8-01: a contact instruction is caught in code", () => {
  it("catches the auditor's crafted clues and other ways to say it", () => {
    for (const t of [
      "Crush a leaf and smell the lemon scent to confirm this shrub.",
      "Run your fingers along the bark to feel its deep ridges.",
      "Pick one of the purple berries and look at the seed inside.",
      "Turn over a log to find this beetle.",
      "Taste the sweet nectar of this flower.",
      "Catch this green frog by the pond.",
      "Pet the fuzzy brown caterpillar.",
      "Find a leaf and crush it.",
      "Can you catch one?",
      "Try touching the soft moss.",
      "Gently hold the snail.",
      "Feel the bark of this tree.",
      "Collect 3 acorns from the ground.",
      "Eat the red berries.",
      "You can hold my shell.",
    ]) {
      expect(handlingInstruction(t), t).not.toBeNull();
    }
  });

  it("leaves safe uses alone (holding a rail or the pass, someone else eating, a glimpse, a size next to a hand)", () => {
    for (const t of [
      "Spot a bridge with rails to hold on to.",
      "You can hold my railings while you walk.",
      "Hold your pass up to the sky.",
      "Look, don't touch.",
      "Spot a place with a roof where people eat.",
      "Find a table to sit and eat.",
      "Watch dogs chase a ball.",
      "Catch a glimpse of a hawk.",
      "Feel the breeze on the hill.",
      "Feel the boards bounce under your feet.",
      "Spot a furry pet with a wagging tail.",
      "Find a leaf as big as your hand.",
      "Pick out the tallest tree.",
      "Turn left at the big oak.",
      "Find things to climb, slide and swing on.",
      "A touch of red on its wings.",
      "Notice a bird that eats seeds.",
    ]) {
      expect(handlingInstruction(t), t).toBeNull();
    }
  });

  /** Every recorded clue, hint and riddle in the repo (fixtures, eval runs, pinned examples). */
  function recordedTexts(): string[] {
    const out = new Set<string>();
    const walk = (o: unknown) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) {
          if ((k === "clue" || k === "lookWhere" || k === "riddle") && typeof v === "string") out.add(v);
          else if (typeof v === "string" && v.includes('"clue"')) {
            try {
              walk(JSON.parse(v));
            } catch {
              /* not JSON */
            }
          } else walk(v);
        }
      }
    };
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : f.endsWith(".json") ? [p] : [];
      });
    for (const d of ["tests/fixtures", "evals/results", "src/data"]) for (const f of files(join(ROOT, d))) walk(JSON.parse(readFileSync(f, "utf8")));
    return [...out];
  }

  it("no recorded clue, hint or riddle is flagged (no recorded find is lost to the new check)", () => {
    const texts = recordedTexts();
    expect(texts.length).toBeGreaterThan(5000);
    expect(texts.filter((t) => handlingInstruction(t) !== null)).toEqual([]);
  });

  it("is a drop reason explained on /how-it-works; a riddle that says it is refused", () => {
    expect(DROP_REASONS).toContain("handling");
    expect(DROP_REASON_INFO.handling.kind).toBe("always");
    expect(DROP_REASON_INFO.handling.plain).toMatch(/touch, pick/);
    const target = { id: "osm-shelter", sourceText: "A shelter has a roof on posts and tables under it.", nameWords: ["shelter"] };
    const spot = (riddle: string) => validateSpot({ targetId: "osm-shelter", riddle, sourceQuote: "a roof on posts and tables" }, target);
    expect(spot("Touch my posts and sit at my tables.")).toEqual({ ok: false, reason: "handling" });
    expect(spot("I have a roof on posts and tables under it.").ok).toBe(true);
  });
});

describe("validateDraft on real pool items", () => {
  const data: Record<string, CaseData> = {};
  beforeAll(async () => {
    for (const slug of ["arbor-hills-nature-preserve", "celebration-park"]) {
      const r = await caseDataOrNull(loadFixture(slug), "13+");
      if (!r.data) throw new Error(r.problem ?? slug);
      data[slug] = r.data;
    }
  }, 120_000);
  const item = (slug: string, test: (p: PoolItem) => boolean): PoolItem => {
    const it = data[slug].pool.find(test);
    if (!it) throw new Error(`no item in ${slug}`);
    return it;
  };
  const draft = (it: PoolItem, clue: string, lookWhere = "") => ({
    itemId: it.id,
    clue,
    lookWhere,
    sourceQuote: (it.sourceText.split(/[.;]/).find((s) => s.trim().split(/\s+/).length >= 3)?.trim() ?? it.sourceText).split(/\s+/).slice(0, 8).join(" "),
    difficulty: "medium",
  });
  const parkMix = (n: number): Mix => ({ n, min: { park: 1, wild: 0, lucky: 0 }, max: { park: n, wild: 0, lucky: 0 }, hardMin: 0 });

  it("drops a clue that says to touch (every band) and leaves out a hint that does, keeping the find", () => {
    const bench = item("celebration-park", (p) => p.id === "osm-bench");
    for (const band of ["6-10", "13+"] as const) {
      const out = validateDraft({ items: [draft(bench, "Touch the 4 long seats used for resting.")] }, data["celebration-park"].pool, parkMix(1), { hasMap: true, band });
      expect(out.drops.handling, band).toBe(1);
      expect(out.items).toHaveLength(0);
    }
    const hint = validateDraft({ items: [draft(bench, "Spot the long seats used for resting.", "touch the seat")] }, data["celebration-park"].pool, parkMix(1), { hasMap: true, band: "6-10" });
    expect(hint.items).toHaveLength(1);
    expect(hint.items[0].lookWhere).toBe("");
  });

  it("13+: a listening clue and kid wording go first when a spare can replace them; with no spare they print", () => {
    const pool = data["arbor-hills-nature-preserve"].pool;
    const creek = pool.find((p) => p.section === "park" && /splash|sound|rushing/i.test(p.sourceText));
    const bench = item("arbor-hills-nature-preserve", (p) => p.id === "osm-bench");
    if (!creek) throw new Error("no sounding water item");
    const listen = draft(creek, "What rushing sound does the running water make?");
    const plain = draft(bench, "Spot the long seats used for resting.");
    const withSpare = validateDraft({ items: [listen, plain] }, pool, parkMix(1), { hasMap: true, band: "13+", ask: parkMix(2) });
    expect(withSpare.items.map((v) => v.item.id)).toEqual(["osm-bench"]);
    expect(withSpare.drops.listening).toBe(1);
    const alone = validateDraft({ items: [listen] }, pool, parkMix(1), { hasMap: true, band: "13+" });
    expect(alone.items).toHaveLength(1);
    expect(alone.items[0].style).toBe("listening");
    // Kids: a single listening clue is still fine.
    expect(validateDraft({ items: [listen] }, pool, parkMix(1), { hasMap: true, band: "6-10" }).items[0].style).not.toBe("listening");
    expect(kidWordingProblem("Point to a ride with two wheels, pedals and handlebars that you might see today.")).toBe("a ride with");
    expect(kidWordingProblem("Notice a rider in a helmet passing on the trail, if you are lucky today.")).toBeNull();
  });
});

describe("Q-8-04: 13+ clue quality checks (validators, kid prompts unchanged)", () => {
  it("range trivia: 'from X to Y' with capitalised places, every band; map words and plain places are not", () => {
    for (const band of ["6-10", "10-13", "13+"] as const) {
      expect(triviaProblem("Peek for a bird of prey that breeds from Alaska to Panama.", band), band).not.toBeNull();
      expect(triviaProblem("A butterfly seen from Canada through Mexico.", band), band).not.toBeNull();
    }
    expect(triviaProblem("Follow the map from START to the X.", "13+")).toBeNull();
    expect(triviaProblem("Walk from the path to the pond to spot a heron.", "13+")).toBeNull();
  });

  it("'Who has ...?' becomes 'What has ...?' for every plant and fungus; animals and 'Who can find' stay", () => {
    const plant = { taxon: { taxonId: 51453, ancestorIds: [48460, 47126, 211194] }, kind: "plant" };
    const hawk = { taxon: { taxonId: 5212, ancestorIds: [48460, 1, 2, 355675, 3] }, kind: "bird" };
    expect(fixPlantWho("Who has large, intricate flowers with prominent styles and stamens?", plant)).toBe("What has large, intricate flowers with prominent styles and stamens?");
    expect(fixPlantWho("Who can find a vine with purple flowers?", plant)).toBe("Who can find a vine with purple flowers?");
    expect(fixPlantWho("Who has a rusty tail and soars in circles?", hawk)).toBe("Who has a rusty tail and soars in circles?");
    expect(fixPlantWho("Who has spiky orange cups?", { kind: "fungus or lichen" })).toBe("What has spiky orange cups?");
  });
});

describe("judge C1: water repeats", () => {
  const it_ = (id: string) => ({ id }) as Pick<PoolItem, "id">;
  it("a third water feature, or shine imagery twice, is flagged; a bridge over water is not a water feature", () => {
    const earlier = [
      { clue: "Count the 2 cold water spots that bubble up.", item: it_("osm-fountain") },
      { clue: "Notice the still water by the trail.", item: it_("osm-water") },
    ];
    expect(MAX_WATER_CLUES).toBe(2);
    expect(waterRepeat({ clue: "Spot the narrow line of moving water.", item: it_("osm-creek") }, earlier)).toBe("a third water feature");
    expect(waterRepeat({ clue: "Point to the paths that carry you across water.", item: it_("osm-bridge") }, earlier)).toBeNull();
    expect(waterRepeat({ clue: "Check for the water that glitters in the sun.", item: it_("osm-fountain") }, [{ clue: "Point to the water that looks like a mirror today." }])).toBe("shine imagery twice");
  });
});

describe("Q-8-01: 13+ sheets get room to print on one page", () => {
  it("the Arbor Hills 13+ fixture is the real full-feature pass (complete, model riddle, Lucky Finds, October box)", () => {
    expect(isCompletePass(ARBOR_13)).toBe(true);
    expect(ARBOR_13.ageBand).toBe("13+");
    expect(ARBOR_13.spot?.status === "ok" && ARBOR_13.spot.riddleBy).toBe("model");
    expect(ARBOR_13.items.filter((i) => i.section === "lucky")).toHaveLength(2);
    expect(ARBOR_13.october?.status).toBe("ok");
  });

  it("a 13+ sheet is marked adult, is never 'tight', and its print floor still prints the clue at 10 pt or more", () => {
    const html = renderToStaticMarkup(<KidPass pass={ARBOR_13} spot={<div />} october={<div />} />);
    expect(html).toContain('data-audience="adult"');
    expect(html).toContain('data-density="snug"');
    const long = ARBOR_13.items.map((i) => ({ ...i, clue: "x".repeat(120), lookWhere: "y".repeat(60) }));
    expect(passDensity(long, true, "kid")).toBe("tight");
    expect(passDensity(long, true, "adult")).toBe("snug");
    expect(minFitFor("adult")).toBe(ADULT_MIN_FIT);
    expect(minFitFor("kid")).toBe(MIN_FIT);
    expect(minFitFor(undefined)).toBe(MIN_FIT);
    // SPEC §8.4: the snug clue is 11.5 pt; 11.5 x 0.87 >= 10. The 8.3 mm checkbox stays >= 7 mm.
    expect(11.5 * ADULT_MIN_FIT).toBeGreaterThanOrEqual(10);
    expect(8.3 * ADULT_MIN_FIT).toBeGreaterThanOrEqual(7);
  });

  it("the 2-page line is band-aware (Q-8-05)", () => {
    expect(printTwoPagesText("kid")).toBe(PRINT_TWO_PAGES);
    expect(printTwoPagesText("adult")).toBe(PRINT_TWO_PAGES_ADULT);
    expect(PRINT_TWO_PAGES_ADULT).not.toMatch(/grown-up/);
  });

  it("the recorded print-test passes open only with GP_E2E_FIXTURE_PASSES=1", () => {
    expect(e2eFixturePass(ARBOR_13.id, {})).toBeNull();
    expect(e2eFixturePass(ARBOR_13.id, { [E2E_FIXTURE_ENV]: "0" })).toBeNull();
    expect(e2eFixturePass(ARBOR_13.id, { [E2E_FIXTURE_ENV]: "1" })?.id).toBe(ARBOR_13.id);
    expect(e2eFixturePass("w1-6to10-20200101-1", { [E2E_FIXTURE_ENV]: "1" })).toBeNull();
    for (const f of E2E_FIXTURE_FILES) {
      const raw = JSON.parse(readFileSync(join(ROOT, "tests/fixtures", f), "utf8")) as { _recording: { what: string }; pass: unknown };
      expect(raw._recording.what, f).toMatch(/real/i);
      expect(PassSchema.safeParse(raw.pass).success, f).toBe(true);
    }
  });
});

describe("Q-8-05 / UX-8-05: no kid wording on 13+ pages", () => {
  it("the report line and the not-safe confirm read right for each audience (kid wording unchanged)", () => {
    expect(AUDIENCE_COPY.kid.reportHelps).toBe("It helps the next family");
    expect(AUDIENCE_COPY.adult.reportHelps).toBe("It helps the next explorer");
    expect(AUDIENCE_COPY.kid.unsafeConfirmNote).toBe(" Grown-ups only, please.");
    expect(AUDIENCE_COPY.adult.unsafeConfirmNote).toBe("");
  });

  it("Find This Spot on screen says 'follow the map' once when the fixed code riddle is printed", () => {
    if (ARBOR_13.spot?.status !== "ok") throw new Error("no spot");
    const codeSpot = { ...ARBOR_13.spot, riddle: SPOT_COPY.codeRiddle(true), riddleBy: "code" as const };
    const code = renderToStaticMarkup(<SpotMap spot={codeSpot} parkName="Arbor Hills Nature Preserve" variant="screen" />);
    expect(code.match(/follow the map/gi)).toHaveLength(1);
    const model = renderToStaticMarkup(<SpotMap spot={ARBOR_13.spot} parkName="Arbor Hills Nature Preserve" variant="screen" />);
    expect(model).toContain("Start at START and follow the map to the X.");
  });
});
