/**
 * The self-host numbers the pages quote (SELFHOST in src/lib/about/eval-summary.ts) must match the two committed
 * self-host results files, so the site can never show a self-host number that was not measured.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { selfHostDetail } from "@/lib/about/content";
import { SELFHOST } from "@/lib/about/eval-summary";

const ROOT = resolve(__dirname, "../..");

type Run = { model: string; kind: string; errorCode?: string; items: unknown[]; n: number | null; calls: { error: string | null }[] };
type Score = {
  model: string;
  m1: { violations: number };
  m2: { rate: number };
  m3: { complete: number; dataRichRuns: number };
  m5: { medianGrade: number };
  m6: { rate: number };
  m7: { p50Ms: number; p95Ms: number; perPassP50Ms: number };
  m11: { printedWrong: number };
};
type Results = { meta: { partial: boolean; ageBand: string; settings: { models: string[]; cases: number[] }; notes: string[] }; runs: Run[]; scores: Score[]; spend: { usd: number } };

const load = (f: string) => JSON.parse(readFileSync(join(ROOT, f), "utf8")) as Results;
const r1 = (x: number) => Math.round(x * 10) / 10;

describe.each([
  ["app clock", SELFHOST.app.file, SELFHOST.app, false],
  ["patient clock", SELFHOST.patient.file, SELFHOST.patient, true],
] as const)("self-host %s", (_name, file, s, patient) => {
  const j = load(file);
  const score = j.scores.find((x) => x.model === SELFHOST.modelId)!;
  const runs = j.runs.filter((x) => x.model === SELFHOST.modelId);

  it("is a partial, $0, 5-park, 6-10 run of the self-hosted model only", () => {
    expect(j.meta.partial).toBe(true);
    expect(j.meta.ageBand).toBe("6-10");
    expect(j.meta.settings.models).toEqual([SELFHOST.modelId]);
    expect(j.meta.settings.cases).toEqual([1, 2, 3, 13, 15]);
    expect(j.meta.settings.cases).toHaveLength(SELFHOST.parks);
    expect(j.spend.usd).toBe(0);
    expect(j.meta.notes.some((n) => n.startsWith("PATIENT CLOCK"))).toBe(patient);
  });

  it("matches the quoted numbers", () => {
    expect(runs.filter((x) => x.kind === "pass")).toHaveLength(s.passes);
    expect(runs.filter((x) => x.errorCode === "MODEL_TIMEOUT")).toHaveLength(s.lost);
    expect(score.m3.complete).toBe(s.complete);
    expect(r1(score.m2.rate * 100)).toBe(s.groundedPct);
    expect(r1(score.m6.rate * 100)).toBe(s.nameLeakPct);
    expect(r1(score.m5.medianGrade)).toBe(s.fkGrade);
    expect(r1(score.m7.p50Ms / 1000)).toBe(s.p50s);
    expect(r1(score.m7.p95Ms / 1000)).toBe(s.p95s);
  });
});

describe("self-host patient-only figures", () => {
  const score = load(SELFHOST.patient.file).scores.find((x) => x.model === SELFHOST.modelId)!;
  it("per-pass time, safety and counts", () => {
    expect(r1(score.m7.perPassP50Ms / 1000)).toBe(SELFHOST.patient.perPassP50s);
    expect(score.m1.violations).toBe(SELFHOST.patient.blockedPrinted);
    expect(score.m11.printedWrong).toBe(SELFHOST.patient.wrongCounts);
  });

  it("the page paragraph says both results and the 70 s limit", () => {
    const d = selfHostDetail();
    expect(d).toContain("gemma4:e2b-it-qat, Apache-2.0");
    expect(d).toContain("70 s limit, 3 of 5 passes ran out of time and the other 2 came out short");
    expect(d).toContain("4 of 5 were complete");
    expect(d).toContain("$0");
  });
});
