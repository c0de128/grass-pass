/**
 * Audit round 3 (judge C1 + T1): machine-made clues and the short-pass copy.
 *
 * Every clue here is a real Gemma 4 31B clue: from evals/results/2026-10-06-3.json (raw model items of
 * the full eval run, printed or not), or quoted by the round-3 judge from the live example passes
 * (audits/round-3/judge.md). Pools come from the recorded eval fixtures (tests/fixtures/evals), built
 * with the app's own pool code. Nothing is invented.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { caseDataOrNull, loadFixture, type CaseData } from "../../evals/fixture";
import { CLUE_VOICES, OPENER_BANK, computeMix, openersFor, planRequest, systemPrompt, type Mix } from "@/lib/ai/prompt";
import {
  brokenCountQuestion,
  fixCommandQuestion,
  isGenericClue,
  isSilentTaxon,
  sameFirstWord,
  silentSoundProblem,
  trimFillerOpening,
  validateDraft,
} from "@/lib/ai/validate";
import { MIN_PASS_ITEMS } from "@/lib/ai/schema";
import { explainShortSections, shortPassMessage } from "@/lib/pass/short-copy";
import { boldNames } from "@/lib/sources/inat";
import type { PoolItem } from "@/lib/pool/types";

const RUN_FILE = path.join(__dirname, "..", "..", "evals", "results", "2026-10-06-3.json");
type RawItem = { itemId: string; clue: string; lookWhere: string; sourceQuote: string; difficulty: string };
type Run = { slug: string; model: string; calls: { rawItems?: RawItem[] }[] };
const runs = (JSON.parse(readFileSync(RUN_FILE, "utf8")) as { runs: Run[] }).runs.filter((r) => r.model.startsWith("gemma"));
const rawItems = runs.flatMap((r) => r.calls.flatMap((c) => (c.rawItems ?? []).map((it) => ({ ...it, slug: r.slug }))));
/** A real raw clue from run 2026-10-06-3 (fails the test if it isn't really there). */
function realClue(slug: string, clue: string): RawItem {
  const hit = rawItems.find((it) => it.slug === slug && it.clue === clue);
  if (!hit) throw new Error(`not in run 2026-10-06-3: ${slug} "${clue}"`);
  return hit;
}

const data: Record<string, CaseData> = {};
beforeAll(async () => {
  for (const slug of ["white-rock-lake-park", "bethany-lakes-park", "arbor-hills-nature-preserve", "bob-woodruff-park", "erwin-park", "celebration-park"]) {
    const r = await caseDataOrNull(loadFixture(slug), "6-10");
    if (!r.data) throw new Error(`${slug}: ${r.problem}`);
    data[slug] = r.data;
  }
}, 120_000);
const item = (slug: string, id: string): PoolItem => {
  const p = data[slug].pool.find((x) => x.id === id);
  if (!p) throw new Error(`${slug}: no pool item ${id}`);
  return p;
};

describe("C1: filler openers are taken off by code", () => {
  it("128 of the 441 raw Gemma clues of run 2026-10-06-3 opened with filler", () => {
    expect(rawItems).toHaveLength(441);
    expect(rawItems.filter((it) => trimFillerOpening(it.clue) !== it.clue)).toHaveLength(128);
  });

  it("real clues lose only the filler; the clue itself stays word for word", () => {
    const cases: [string, string, string][] = [
      ["connemara-meadow-preserve", "Quick! See a plant with white flowers?", "See a plant with white flowers?"],
      ["connemara-meadow-preserve", "Shh. Do you see a plant with seeds?", "Do you see a plant with seeds?"],
      ["connemara-meadow-preserve", "Stop! Does this tree have thick, corky lumps on the bark?", "Does this tree have thick, corky lumps on the bark?"],
      ["connemara-meadow-preserve", "Wow! Can you spot a bumpy, bright yellow-green ball?", "Can you spot a bumpy, bright yellow-green ball?"],
      ["bob-woodruff-park", "Ready to count? How many open-sided roofs are here? There are 2.", "How many open-sided roofs are here? There are 2."],
      ["arbor-hills-nature-preserve", "Stop and listen for running water that makes a gurgling sound.", "Listen for running water that makes a gurgling sound."],
      ["white-rock-lake-park", "Listen closely. Can you hear water splashing?", "Can you hear water splashing?"],
      ["frisco-commons", "Wow, you can hear water splish-splashing!", "You can hear water splish-splashing!"],
      ["towne-lake-park", "Quick! Listen for the gentle rushing sound of moving water.", "Listen for the gentle rushing sound of moving water."],
      ["spring-creek-forest-preserve", "Listen! I am a large wading bird.", "I am a large wading bird."],
    ];
    for (const [slug, clue, want] of cases) expect(trimFillerOpening(realClue(slug, clue).clue), clue).toBe(want);
  });

  it("clues that start with a real word are unchanged", () => {
    for (const [slug, clue] of [
      ["connemara-meadow-preserve", "Sneak up on some orange growths with spiny projections?"],
      ["connemara-meadow-preserve", "Which tree has glossy dark green leaves?"],
      ["bob-woodruff-park", "Wander to the paths. How many wooden crossings are there? There are 4."],
      ["arbor-hills-nature-preserve", "Guess how many flat spots for eating are here. There are 3."],
    ] as const) {
      expect(trimFillerOpening(realClue(slug, clue).clue)).toBe(clue);
    }
    expect(trimFillerOpening("Look at the bark")).toBe("Look at the bark");
  });

  it("a clue that is only filler is dropped (filler_only); a trimmed clue is counted", () => {
    expect(trimFillerOpening("Quick! Psst!")).toBeNull();
    const shelter = item("bob-woodruff-park", "osm-shelter");
    const mix: Mix = { n: 1, min: { park: 1, wild: 0, lucky: 0 }, max: { park: 1, wild: 0, lucky: 0 }, hardMin: 0 };
    const q = shelter.sourceText.slice(-30);
    expect(validateDraft({ items: [{ itemId: shelter.id, clue: "Quick! Psst!", lookWhere: "", sourceQuote: q, difficulty: "easy" }] }, [shelter], mix).drops).toEqual({ filler_only: 1 });
  });
});

describe("C1: broken count questions", () => {
  it("judge round 3, live example passes: a 'how many' question that says its own number", () => {
    expect(brokenCountQuestion("Guess how many 25 big grass areas have goals?")).toMatch(/also says 25/); // Celebration, Find 5
    expect(brokenCountQuestion("Guess how many long outdoor seats are here for a break. There are 2.")).toMatch(/also says 2/); // Arbor Hills, Find 3
  });

  it("run 2026-10-06-3: answers itself, or has nothing to count", () => {
    expect(brokenCountQuestion(realClue("bob-woodruff-park", "Ready? How many seats can you find? There are 9.").clue)).toMatch(/also says 9/);
    expect(brokenCountQuestion(realClue("central-park", "Hmm, how many flat courts with a ring on a tall pole are there? Is it 5?").clue)).toMatch(/also says 5/);
    expect(brokenCountQuestion(realClue("white-rock-lake-park", "Guess how many can you find? There are 2 that splash water!").clue)).toMatch(/nothing to count/);
  });

  it("a count task with its number, and a 'how many' question without one, are fine", () => {
    expect(brokenCountQuestion("Count the 4 walkways.")).toBeNull();
    expect(brokenCountQuestion("Stop and count the flat courts with a low net. There are 4.")).toBeNull();
    expect(brokenCountQuestion("How many wooden crossings can you find?")).toBeNull();
    expect(brokenCountQuestion("Which tree has glossy dark green leaves?")).toBeNull();
  });

  it("validateDraft drops it as broken_count (Bob Woodruff's real benches clue)", () => {
    const bench = item("bob-woodruff-park", "osm-bench");
    const raw = realClue("bob-woodruff-park", "Ready? How many seats can you find? There are 9.");
    expect(raw.itemId).toBe("osm-bench");
    const mix: Mix = { n: 1, min: { park: 1, wild: 0, lucky: 0 }, max: { park: 1, wild: 0, lucky: 0 }, hardMin: 0 };
    expect(validateDraft({ items: [raw] }, [bench], mix).drops).toEqual({ broken_count: 1 });
  });
});

describe("C1: 'listen' only for things that make a sound", () => {
  it("taxon data: damselflies and plants are silent; birds, frogs and wasps are not", () => {
    expect(isSilentTaxon(item("white-rock-lake-park", "inat-70191"))).toBe(true); // Rambur's Forktail, Odonata
    expect(isSilentTaxon(item("arbor-hills-nature-preserve", "inat-54781"))).toBe(true); // Bur oak, Plantae
    expect(isSilentTaxon(item("white-rock-lake-park", "inat-4937"))).toBe(false); // Little Blue Heron, Aves
    expect(isSilentTaxon(item("bob-woodruff-park", "inat-12727"))).toBe(false); // American Robin
    expect(isSilentTaxon(item("bob-woodruff-park", "osm-bench"))).toBe(false); // no taxon: a Park Find
  });

  it("run 2026-10-06-3: 'Listen for a bug' for a silent damselfly is dropped", () => {
    const forktail = item("white-rock-lake-park", "inat-70191");
    const raw = realClue("white-rock-lake-park", "Listen for a bug with blue on its tail segments 8 and 9?");
    expect(raw.itemId).toBe("inat-70191");
    expect(silentSoundProblem(raw.clue, forktail)).toMatch(/silent living thing/);
  });

  it("a Park Find may ask for a sound only when its fact sheet names one", () => {
    const playground = item("bethany-lakes-park", "osm-playground");
    expect(silentSoundProblem(realClue("bethany-lakes-park", "Listen for kids on ladders as they reach the top of the play set.").clue, playground)).toMatch(/names no sound/);
    const fountain = item("celebration-park", "osm-fountain");
    // Round-6 C4: Celebration's fountain facts are things to see now (the sound fact is 1 of 5 in the bank) ...
    expect(fountain.sourceText).not.toMatch(/\bhear\b/);
    expect(silentSoundProblem("Can you hear water splashing?", fountain)).toMatch(/names no sound/);
    // ... and a fountain whose facts hold the sound fact (built: the bank's own sentence added) may still ask for it.
    const heard = { ...fountain, sourceText: `${fountain.sourceText} You can hear its water splashing as you get close.` };
    expect(silentSoundProblem("Can you hear water splashing?", heard)).toBeNull();
  });

  it("a bird whose source names its song may get a listening clue; one whose source doesn't may not", () => {
    const robin = item("bob-woodruff-park", "inat-12727");
    expect(robin.sourceText).toMatch(/\b(song|sing|call)/i);
    expect(silentSoundProblem("Listen for a bird song in the trees.", robin)).toBeNull();
    const heron = item("white-rock-lake-park", "inat-4937");
    expect(silentSoundProblem("Listen for a bird by the water.", heron)).toMatch(/names no sound/);
    expect(silentSoundProblem("Spot a small blue bird by the water.", heron)).toBeNull(); // not a sound clue
  });
});

describe("C1: one-word opener repeats and trivia", () => {
  it("sameFirstWord marks a repeated opening (a style preference)", () => {
    expect(sameFirstWord("Peek at the bark.", "Peek under a leaf.")).toBe(true);
    expect(sameFirstWord("Peek at the bark.", "Spy a red bird.")).toBe(false);
  });

  it("judge round 3: 'common in North America' is trivia, not a trait a child can see", () => {
    const hawk = item("arbor-hills-nature-preserve", "inat-5212"); // Red-tailed Hawk
    expect(isGenericClue("Who is the bird of prey that is common in North America?", hawk.sourceText)).toBe(true);
  });
});

describe("10-13 smoke (evals/results/2026-10-06-partial-0859.json): what reading the clues found", () => {
  const SMOKE = path.join(__dirname, "..", "..", "evals", "results", "2026-10-06-partial-0859.json");
  const smoke = (JSON.parse(readFileSync(SMOKE, "utf8")) as { meta: { ageBand: string }; runs: Run[] });
  const smokeClue = (slug: string, clue: string): RawItem => {
    const hit = smoke.runs.flatMap((r) => (r.slug === slug ? r.calls.flatMap((c) => c.rawItems ?? []) : [])).find((it) => it.clue === clue);
    if (!hit) throw new Error(`not in the smoke: ${clue}`);
    return hit;
  };

  it("the smoke is the 10-13 band", () => {
    expect(smoke.meta.ageBand).toBe("10-13");
  });

  it("a command ending in '?' gets a full stop; a real question keeps its '?'", () => {
    expect(fixCommandQuestion(smokeClue("white-rock-lake-park", "Track 3 areas for sports? Is there a dirt mound in the middle of each?").clue)).toBe(
      "Track 3 areas for sports. Is there a dirt mound in the middle of each?",
    );
    expect(fixCommandQuestion(realClue("connemara-meadow-preserve", "Squint to see if any trees have a rounded crown?").clue)).toBe("Squint to see if any trees have a rounded crown.");
    expect(fixCommandQuestion("Which tree has glossy dark green leaves?")).toBe("Which tree has glossy dark green leaves?");
    expect(fixCommandQuestion("Who has a leg span of more than four inches?")).toBe("Who has a leg span of more than four inches?");
  });

  it("Wikipedia's bolded other names are name words: 'called mossycup' for a bur oak is a leak", () => {
    const oak = item("arbor-hills-nature-preserve", "inat-54781");
    expect(boldNames("This plant is also called <b>mossycup oak</b> and <b>mossycup white oak</b>.")).toEqual(["mossycup oak", "mossycup white oak"]);
    expect(oak.nameWords).toContain("mossycup");
    const raw = smokeClue("arbor-hills-nature-preserve", "Near a plant with fruit or seeds that is called mossycup.");
    const mix: Mix = { n: 1, min: { park: 0, wild: 1, lucky: 0 }, max: { park: 0, wild: 1, lucky: 0 }, hardMin: 0 };
    expect(validateDraft({ items: [raw] }, [oak], mix).drops).toEqual({ name_leak: 1 });
  });
});

describe("C1: the prompt no longer hands the model filler openers", () => {
  const FILLER = /^(psst|quick|shh|wow|hmm|ready|stop|listen|guess|here|near|follow)$/i;
  it("the opener bank and every park's openers are real first words", () => {
    expect(OPENER_BANK.filter((w) => FILLER.test(w))).toEqual([]);
    for (const park of ["Arbor Hills Nature Preserve", "White Rock Lake Park", "Celebration Park", "Connemara Meadow Preserve"]) {
      expect(openersFor(park, 9).filter((w) => FILLER.test(w))).toEqual([]);
    }
    expect(CLUE_VOICES.join(" ")).not.toMatch(/secret|hear/);
  });

  it("the system prompt states the filler, sound and 'how many' rules", () => {
    const sys = systemPrompt("10-13", computeMix({ park: 10, wild: 8, lucky: 0 }, "10-13")!, null, { month: 10, openers: ["Peek"] });
    expect(sys).toContain("Never open with a filler word");
    // r7 follow-ups (M8) shortened these lines; round-6 C4 added "at most ONE" listening clue and "what the child can see" for water.
    expect(sys).toContain("Ask the child to listen ONLY when the item's SOURCE says it makes a sound");
    expect(sys).toContain("in at most ONE clue per pass. For water, say what the child can see.");
    expect(sys).toContain('never a "How many", "Which" or "What" question with the number in it');
  });

  it("a real 10-13 request for Arbor Hills plans 8 finds with 2 hard ones", () => {
    const d = data["arbor-hills-nature-preserve"];
    const plan = planRequest(d.pool, "10-13", d.parkName!)!;
    expect([plan.mix.n, plan.mix.hardMin]).toEqual([8, 2]);
  });
});

describe("T1: a short pass says why per section", () => {
  it("Erwin Park (2 mapped kinds, no sightings): the Park Finds line gives the real count, Wild keeps its reason", () => {
    const d = data["erwin-park"];
    expect(d.mix).toBeNull(); // the real no-pass case of the eval
    const sections = explainShortSections(d.parkName!, { park: d.park!.state, wild: d.wild!.state, lucky: { status: "off", message: "x" } }, { park: d.park!.items, wild: d.wild!.items });
    expect(d.park!.state.status).toBe("ok");
    const kinds = d.park!.items.map((p) => p.kind);
    expect(kinds).toHaveLength(2);
    expect(sections.park).toEqual({
      status: "empty",
      message: `No data available: OpenStreetMap has only 2 kinds of mapped things (${kinds[0]} and ${kinds[1]}) inside Erwin Park, and a pass needs at least ${MIN_PASS_ITEMS} finds.`,
    });
    expect(sections.wild).toEqual(d.wild!.state);
    expect(sections.wild).toMatchObject({ status: "empty", message: expect.stringMatching(/^No data available: no research-grade sightings/) });
    expect(sections.lucky).toEqual({ status: "off", message: "x" });
  });

  it("one mapped kind and one usable species read in the singular", () => {
    const bench = item("bob-woodruff-park", "osm-bench");
    const robin = item("bob-woodruff-park", "inat-12727");
    const s = explainShortSections("P", { park: { status: "ok" }, wild: { status: "ok" }, lucky: { status: "off", message: "x" } }, { park: [bench], wild: [robin] });
    expect(s.park).toMatchObject({ message: expect.stringContaining("only 1 kind of mapped thing (bench) inside P") });
    expect(s.wild).toMatchObject({ message: expect.stringContaining("only 1 species seen within 1.5 km in the last 14 days on iNaturalist is a safe, kid-friendly find") });
  });

  it("the headline gives the real count against the minimum", () => {
    expect(shortPassMessage("Erwin Park", 2)).toBe(
      `Not enough real data for a pass at Erwin Park right now: a pass needs at least ${MIN_PASS_ITEMS} finds, and we found 2. Each section below says why.`,
    );
    expect(shortPassMessage("P", 1)).toContain("and we found 1.");
  });
});
