/**
 * Trip tips inside a real pass build (makePass): Celebration Park and Connemara with every input replayed from live
 * recordings (support/pass-replay.ts). Those recordings are from Oct 5-6 and hold no forecast and no tips answer, so the
 * replay fails both like a network error: the pass must still be made, with the honest rules list (no forecast), one
 * extra AI_DAILY_CAP slot, and the clue calls unchanged. (The model's own tips are tested in trip-tips.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import { resetWeather } from "@/lib/weather/park-weather";
import { TripTipsSchema } from "@/lib/tips/schema";
import { isClueCall, isTipsCall, isWeatherCall, PARKS, passReplay } from "./support/pass-replay";

const ENV = { DO_INFERENCE_API_KEY: "test-key-not-real" };

let lines: string[];
let restore: () => void;
beforeEach(() => {
  resetStores();
  resetPassMaking();
  resetWeather();
  lines = [];
  restore = setLogSink((_l, line) => lines.push(line));
});
afterEach(() => restore());

describe("trip tips in a pass build", () => {
  it("Celebration: the pass is made; its tips are the rules list from the park map (no forecast, the AI didn't answer)", async () => {
    const r = passReplay();
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "192.0.2.150", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: ENV });
    if (out.kind !== "pass") throw new Error(out.kind);
    const t = TripTipsSchema.parse(out.pass.tripTips);
    expect(t).toMatchObject({ source: "rules", reason: "no_answer", forecast: false, forDate: out.pass.day });
    expect(t.items.length).toBeGreaterThanOrEqual(3);
    // No weather word without a forecast; every why is a park-map or pass fact.
    for (const i of t.items) expect(i.why).toMatch(/park map|pass has|picnic shelter|pond|lake/);
    // The tips asked once (and once more after the network-style failure, inside callModel); the forecast was asked.
    expect(r.calls.filter(isTipsCall).length).toBeGreaterThanOrEqual(1);
    expect(r.calls.filter(isTipsCall).length).toBeLessThanOrEqual(2);
    expect(r.calls.filter(isWeatherCall).length).toBeGreaterThanOrEqual(1);
    // The tips request carries the escaped park name and facts, never the clue pool.
    const sent = r.calls.find(isTipsCall)!.body!;
    expect(sent).toContain('"name":"trip_tips"');
    expect(sent).toContain("<fact id=\\\"x-pass\\\" group=\\\"pass\\\">Your pass has 8 finds to check off</fact>");
    expect(sent).not.toContain("POOL:");
    // The clue call is the recorded one, unchanged.
    expect(r.calls.filter(isClueCall)).toHaveLength(1);
    expect(lines.some((l) => l.includes('"event":"trip_tips"') && l.includes('"source":"rules"'))).toBe(true);
  });

  it("the tips take their own AI_DAILY_CAP slot AFTER the clue call: with one slot left the pass is made and the tips say 'budget'", async () => {
    const r = passReplay();
    const out = await makePass(
      { parkId: PARKS.celebration.id, ageBand: "6-10" },
      { ip: "192.0.2.151", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: { ...ENV, AI_DAILY_CAP: "1" } },
    );
    if (out.kind !== "pass") throw new Error(out.kind);
    expect(out.pass.tripTips).toMatchObject({ source: "rules", reason: "budget" });
    expect(r.calls.filter(isTipsCall)).toHaveLength(0);
  });

  it("no tips when the build stops before the first clue call (a pass that isn't made spends nothing on tips)", async () => {
    const r = passReplay();
    const out = await makePass({ parkId: PARKS.celebration.id, ageBand: "6-10" }, { ip: "192.0.2.152", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: {} });
    expect(out.kind).toBe("error");
    expect(r.calls.filter(isTipsCall)).toHaveLength(0);
  });
});
