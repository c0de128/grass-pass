import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroPassCard } from "@/components/home/HeroPassCard";
import { SampleParks } from "@/components/home/SampleParks";
import { exampleState, heroCard } from "@/lib/home/showcase";
import { ProgressSteps } from "@/components/pass/PassStatus";
import { CLIENT_CODES, CLIENT_COPY, CLIENT_TIMEOUT_MS } from "@/components/pass/usePassRequest";
import { PASS_DEADLINE_MS } from "@/lib/ai/build-pass";
import { memoize, resetMemo } from "@/lib/cache/memo";
import { EXAMPLE_PARKS, type ExampleStatus } from "@/lib/prewarm";

const ready: ExampleStatus = {
  example: EXAMPLE_PARKS[0],
  pass: { passId: "w306191453-6to10-20261005-1", day: "2026-10-05", generatedAt: "2026-10-05T23:00:00.000Z" },
  fresh: true,
  today: true,
  latest: { passId: "w306191453-6to10-20261005-1", day: "2026-10-05", generatedAt: "2026-10-05T23:00:00.000Z" },
  short: null,
  refreshing: false,
  missing: null,
};
const making: ExampleStatus = { example: EXAMPLE_PARKS[1], pass: null, fresh: false, today: false, latest: null, short: null, refreshing: true, missing: "It is being made right now." };
const waiting: ExampleStatus = { example: EXAMPLE_PARKS[2], pass: null, fresh: false, today: false, latest: null, short: null, refreshing: false, missing: "The last try didn't work." };

describe("example cards (R1-B2 data-state, UX m8 phone row)", () => {
  it("each card says its state for tests: ready / off / making / waiting", () => {
    expect(exampleState(ready, true)).toBe("ready");
    expect(exampleState(making, true)).toBe("making");
    expect(exampleState(waiting, true)).toBe("waiting");
    expect(exampleState(waiting, false)).toBe("off");
    const html = renderToStaticMarkup(<SampleParks statuses={[ready, making, waiting]} enabled />);
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('data-state="making"');
    expect(html).toContain('data-state="waiting"');
  });

  it("v3: with no example pass ready, the hero card says why and links nothing", () => {
    const html = renderToStaticMarkup(<HeroPassCard card={heroCard([making, waiting])} />);
    expect(html).toContain('data-state="missing"');
    expect(html).toContain("Example pass not ready yet:");
    expect(html).not.toContain("<a ");
  });
});

describe("long waits (R1 UX M2)", () => {
  it("lists the steps still to come outside the live region", () => {
    const html = renderToStaticMarkup(<ProgressSteps steps={[{ step: "map", text: "Reading the park map (OpenStreetMap)…" }]} />);
    const live = html.slice(html.indexOf('role="status"'), html.indexOf("Still to come"));
    expect(live).toContain("Reading the park map");
    expect(live).not.toContain("Write the clues");
    expect(html).toContain('aria-label="Still to come"');
    expect(html).toContain("Check recent wildlife sightings");
    expect(html).toContain("Write the clues");
    // A retry counts as the clue step.
    const retry = renderToStaticMarkup(
      <ProgressSteps
        steps={[
          { step: "map", text: "a" },
          { step: "wildlife", text: "b" },
          { step: "retry", text: "c" },
        ]}
      />,
    );
    expect(retry).not.toContain("Write the clues");
    expect(retry).toContain("Check every clue");
  });

  it("the page waits longer than the server's 85 s pass deadline (R2-M2), then says so clearly", () => {
    expect(CLIENT_TIMEOUT_MS).toBe(95_000);
    expect(CLIENT_TIMEOUT_MS).toBeGreaterThan(PASS_DEADLINE_MS + 5_000);
    expect(CLIENT_COPY.timeout).toMatch(/longer than a minute and a half/);
    expect(CLIENT_COPY.timeout).not.toMatch(/servers/);
    expect(CLIENT_COPY.timeout).toMatch(/Try again/);
    expect(CLIENT_CODES.timeout).toBe("CLIENT_TIMEOUT");
  });
});

describe("memoize (SEC-1-02: home page reads the store once per 30 s per instance)", () => {
  it("shares one load per ttl, reloads after it, and never keeps a failure", async () => {
    resetMemo();
    let loads = 0;
    const load = async () => ++loads;
    expect(await memoize("k", 1000, load, 0)).toBe(1);
    expect(await memoize("k", 1000, load, 999)).toBe(1);
    expect(await memoize("k", 1000, load, 1000)).toBe(2);
    let fail = true;
    const flaky = async () => {
      if (fail) throw new Error("down");
      return "ok";
    };
    await expect(memoize("f", 1000, flaky, 0)).rejects.toThrow("down");
    fail = false;
    expect(await memoize("f", 1000, flaky, 1)).toBe("ok");
  });
});
