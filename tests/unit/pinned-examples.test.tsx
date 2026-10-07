/**
 * Pinned example passes (Kevin, 2026-10-07; src/lib/pinned.ts): real, complete passes committed in the repo, never
 * edited, shown with their real date. The hero card always shows the same one; an example card with a pinned pass
 * never says "not ready"; the pass page opens it when the store doesn't have it.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HeroPassCard } from "@/components/home/HeroPassCard";
import { SampleParks } from "@/components/home/SampleParks";
import { createJsonCache } from "@/lib/cache";
import { resetStores } from "@/lib/cache/store";
import { heroCard, heroFinds, isCountedParkFind } from "@/lib/home/showcase";
import { isCompletePass } from "@/lib/pass/complete";
import { formatTime } from "@/lib/pass/format";
import { loadPass, resetPassMaking } from "@/lib/pass/make";
import { PassSchema } from "@/lib/pass/schema";
import { HERO_PINNED_SLUG, heroPinned, PINNED_FILES, pinnedPass, pinnedPassById } from "@/lib/pinned";
import { EXAMPLE_PARKS, exampleStatuses, prewarmIdle, readyExample, resetPrewarm } from "@/lib/prewarm";

const PIN_ID = "w556800335-6to10-20261006-1";
const WR_PIN_ID = "w460905359-6to10-20261007-1";
const DAY_MS = 24 * 3600 * 1000;

beforeEach(() => {
  resetStores();
  resetPassMaking();
  resetPrewarm();
  // No upstream call in these tests: the warm-up is off, so nothing is made.
  vi.stubEnv("PREWARM_EXAMPLES", "0");
});
afterEach(async () => {
  await prewarmIdle();
  vi.unstubAllEnvs();
});

describe("pinned files are real, complete and unedited", () => {
  it("every pinned pass is byte-for-byte its recorded source, complete, valid, and belongs to its example park", () => {
    // Pinned on 2026-10-07: Oak Point (Oct 6 recording), White Rock (Oct 7, the warm-up's first try) and Celebration (Oct 7,
    // after the other_feature check). Arbor Hills has no pinnable pass (reports/bench-shelter-2026-10-07.md in the factory repo).
    expect(Object.keys(PINNED_FILES).sort()).toEqual(["celebration", "oak-point", "white-rock"]);
    for (const [slug, raw] of Object.entries(PINNED_FILES)) {
      const file = z.object({ _source: z.object({ pinnedFrom: z.string(), recording: z.object({ live: z.literal(true) }).passthrough() }).passthrough(), pass: z.unknown() }).parse(raw);
      const source = JSON.parse(readFileSync(new URL(`../../${file._source.pinnedFrom}`, import.meta.url), "utf8")) as { pass: unknown };
      expect(JSON.stringify(file.pass), `${slug}: never edited`).toBe(JSON.stringify(source.pass));
      const pass = PassSchema.parse(file.pass);
      expect(isCompletePass(pass), `${slug}: complete`).toBe(true);
      const ex = EXAMPLE_PARKS.find((e) => e.slug === slug);
      expect(ex, `${slug}: is a home example`).toBeDefined();
      expect(pass.park.id).toBe(ex!.parkId);
      expect(pass.model.answered).toBe("gemma-4-31B-it");
      expect(pinnedPass(slug)?.id).toBe(pass.id);
      expect(pinnedPassById(pass.id)?.id).toBe(pass.id);
    }
    expect(pinnedPass("arbor-hills")).toBeNull(); // nothing complete and sound on disk for it yet
    expect(pinnedPassById("w1-6to10-20261006-1")).toBeNull();
  });
});

describe("the hero card is fixed", () => {
  it("always the pinned Oak Point pass, with its real date, a counted first Park Find and the model's riddle", async () => {
    const hero = heroPinned();
    expect(hero?.slug).toBe(HERO_PINNED_SLUG);
    const statuses = await exampleStatuses({ now: () => Date.now() });
    const a = heroCard(statuses);
    const b = heroCard([...statuses].reverse());
    expect(a).toEqual(b); // the same on every load, whatever else is saved
    if (a?.kind !== "ready") throw new Error("hero not ready");
    expect(a.ex.example.slug).toBe("oak-point");
    expect(a.ex.href).toBe(`/pass/${PIN_ID}?example=1`);
    expect(a.ex.madeAt).toBe(formatTime(hero!.pass.generatedAt));
    expect(isCountedParkFind(a.finds[0])).toBe(true);
    expect(a.finds).toEqual(heroFinds(hero!.pass));
    expect(hero!.pass.spot?.status === "ok" && hero!.pass.spot.riddleBy).toBe("model");
    const html = renderToStaticMarkup(<HeroPassCard card={a} />);
    expect(html).not.toContain("not ready");
    expect(html).toContain(`real pass, made ${a.ex.madeAt}`);
    expect(html).toContain(`href="/pass/${PIN_ID}?example=1"`);
  });
});

describe("example cards: today's complete -> the store's last complete -> pinned", () => {
  it("empty store: the Oak Point card shows the pinned pass with its real date, never 'not ready'", async () => {
    const now = Date.parse("2026-10-08T15:00:00Z");
    const statuses = await exampleStatuses({ now: () => now });
    const oak = statuses.find((s) => s.example.slug === "oak-point")!;
    expect(oak.pass).toEqual({ passId: PIN_ID, day: "2026-10-06", generatedAt: pinnedPass("oak-point")!.generatedAt });
    expect(oak.latest).toBeNull(); // nothing in the store
    expect(oak.today).toBe(false);
    expect(oak.missing).toBeNull();
    const html = renderToStaticMarkup(<SampleParks statuses={[oak]} enabled />);
    expect(html).toContain(`href="/pass/${PIN_ID}?example=1"`);
    expect(html).toContain("from that day&#x27;s data.");
    expect(html).not.toContain("No data available yet");
    expect(html).not.toContain("not ready");
    // White Rock's pinned pass shows the same way, with its own real date.
    const wr = statuses.find((s) => s.example.slug === "white-rock")!;
    const wrPin = pinnedPass("white-rock")!;
    expect(wr.pass).toEqual({ passId: WR_PIN_ID, day: "2026-10-07", generatedAt: wrPin.generatedAt });
    expect(wr.missing).toBeNull();
    expect(renderToStaticMarkup(<SampleParks statuses={[wr]} enabled />)).toContain(`href="/pass/${WR_PIN_ID}?example=1"`);
    // The other examples have nothing pinned: they still say why (honestly), with no link.
    const unpinned = statuses.filter((s) => !(s.example.slug in PINNED_FILES));
    expect(unpinned.map((s) => s.example.slug).sort()).toEqual(["arbor-hills"]);
    expect(unpinned.every((s) => s.pass === null && s.missing !== null)).toBe(true);
  });

  it("a complete pass saved in the store wins over the pinned one", async () => {
    // The store holds the same real pass as today's (saved as the warm-up saves it): the card then comes from the store.
    const pin = pinnedPass("oak-point")!;
    const t = Date.parse(pin.generatedAt) + 60_000;
    const passes = createJsonCache({ name: "pass", schema: PassSchema, ttlSec: 30 * 24 * 3600, maxEntries: 10 });
    const entries = createJsonCache({ name: "example-pass", schema: z.object({ passId: z.string(), day: z.string(), generatedAt: z.string() }), ttlSec: 60 * 24 * 3600, maxEntries: 10 });
    await passes.set(pin.id, pin, { now: t });
    await entries.set("oak-point", { passId: pin.id, day: pin.day, generatedAt: pin.generatedAt }, { now: t });
    const [oak] = await exampleStatuses({ now: () => t, examples: EXAMPLE_PARKS.filter((e) => e.slug === "oak-point") });
    expect(oak.latest?.passId).toBe(pin.id); // read from the store
    expect(oak.today).toBe(true);
  });

  it("the park-search fallback offers the pinned pass when nothing is saved", async () => {
    // The first pinned example in EXAMPLE_PARKS order (Arbor Hills has none, so White Rock).
    expect(await readyExample({ now: () => Date.now(), examples: EXAMPLE_PARKS })).toEqual({ name: "White Rock Lake Park", href: `/pass/${WR_PIN_ID}?example=1` });
    expect(await readyExample({ now: () => Date.now(), examples: EXAMPLE_PARKS.filter((e) => e.slug === "oak-point") })).toEqual({ name: "Oak Point Park and Nature Preserve", href: `/pass/${PIN_ID}?example=1` });
  });
});

describe("the pass page opens a pinned pass", () => {
  it("from the repo when the store doesn't have it, also after the 30-day store life; other ids stay 404", async () => {
    expect((await loadPass(PIN_ID, Date.parse("2026-10-08T15:00:00Z")))?.id).toBe(PIN_ID);
    expect((await loadPass(PIN_ID, Date.parse("2026-10-06T15:00:00Z") + 90 * DAY_MS))?.id).toBe(PIN_ID);
    expect(await loadPass("w556800335-6to10-20261006-2", Date.parse("2026-10-08T15:00:00Z"))).toBeNull();
    expect(await loadPass("not-an-id", Date.now())).toBeNull();
  });

  it("a pinned id opens the pinned pass even when the store holds a different pass with the same id", async () => {
    // Ids are park + band + day + the store's variant counter: the deployed store can make its own -1 on the same day.
    const pin = pinnedPass("white-rock")!;
    const t = Date.parse(pin.generatedAt) + 60_000;
    const other = { ...PassSchema.parse(pin), generatedAt: new Date(t - 30_000).toISOString(), items: pin.items.slice().reverse() };
    const passes = createJsonCache({ name: "pass", schema: PassSchema, ttlSec: 30 * 24 * 3600, maxEntries: 10 });
    await passes.set(WR_PIN_ID, other, { now: t });
    const opened = await loadPass(WR_PIN_ID, t);
    expect(opened?.generatedAt).toBe(pin.generatedAt);
    expect(opened?.items[0]?.clue).toBe(pin.items[0]?.clue);
  });
});
