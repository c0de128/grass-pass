/**
 * Scoring for SPEC 6.4 (M1-M8; M9 is a human check) plus audit R2-M5's M10 (cross-park repetition)
 * and M11 (count accuracy). Pure functions over run records + the pool
 * each case really had, so they are unit-tested without any network.
 */
import { planRequest, refillPlan, type RequestPlan } from "@/lib/ai/prompt";
import { countProblem, isGrounded, nameLeak, ngrams, validateDraft, type DropReason, type ValidItem } from "@/lib/ai/validate";
import type { PoolItem, Section } from "@/lib/pool/types";
import { blockedBy, blockedWordIn } from "@/lib/safety/danger-taxa";
import type { CaseData } from "./fixture";

// ---------- prices (USD per 1M tokens, DigitalOcean serverless pricing page, ADR 0001, 2026-10-05) ----------

export const PRICES: Record<string, { in: number; out: number }> = {
  "gemma-4-31B-it": { in: 0.18, out: 0.5 },
  "llama-4-maverick": { in: 0.25, out: 0.87 },
};

/** Cost of one call. Prompt tokens are charged at the full input price (cache reads would be cheaper). */
export function callCost(model: string, promptTokens = 0, completionTokens = 0): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}

// ---------- reading level ----------

/** Syllables in one English word (vowel groups, silent final e/es/ed except after l, at least 1). */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  let s = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  if (s.length === 0) s = w;
  const groups = s.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function words(text: string): string[] {
  return text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
}

/** Flesch-Kincaid grade = 0.39 (words/sentences) + 11.8 (syllables/words) - 15.59. Null when no words. */
export function fkGrade(text: string): number | null {
  const w = words(text);
  if (w.length === 0) return null;
  const sentenceCount = Math.max(1, (text.match(/[.!?]+(?=\s|$)/g) ?? []).length);
  const syl = w.reduce((a, x) => a + x.split(/[-’']/).reduce((b, part) => b + countSyllables(part), 0), 0);
  return 0.39 * (w.length / sentenceCount) + 11.8 * (syl / w.length) - 15.59;
}

// ---------- stats ----------

/** Linear-interpolated percentile (p in 0..100). Null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
export const median = (v: readonly number[]) => percentile(v, 50);

// ---------- records ----------

export type RawItem = Record<string, unknown>;

export type CallRecord = {
  latencyMs: number;
  /** HTTP status, or null when no answer came back (timeout, network). */
  status: number | null;
  error: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  finishReason: string | null;
  answeredModel: string | null;
  /** The items array of the model's JSON answer (null when the answer had none or didn't parse). */
  rawItems: RawItem[] | null;
  /** The pool ids in the request schema equal the scoring pool (proves both used the same data). */
  poolMatches: boolean | null;
};

export type PrintedItem = { section: Section; clue: string; lookWhere: string; answer: string };

export type SectionStateRecord = { status: string; message?: string };

export type RunRecord = {
  caseN: number;
  slug: string;
  parkName: string | null;
  model: string;
  run: number;
  kind: "pass" | "empty" | "error" | "skipped";
  errorCode?: string;
  message?: string;
  sections: Partial<Record<Section, SectionStateRecord>>;
  /** Items asked for (mix.n), null when no pass was possible. */
  n: number | null;
  dataRich: boolean;
  items: PrintedItem[];
  calls: CallRecord[];
  removed?: { notGrounded: number; other: number };
  wallMs: number;
};

// ---------- per-case context (what the case really had) ----------

export type CaseContext = {
  caseN: number;
  parkName: string | null;
  pool: PoolItem[];
  n: number | null;
  dataRich: boolean;
  totalObservations: number;
  parkEmpty: boolean;
  wildEmpty: boolean;
  /** Lower-case labels/names of every hard-blocked species in the raw iNaturalist answer. */
  blockedNames: string[];
  /** The request the app makes for this pool (prompt pool, mix, asked-for mix), for replaying its checks. */
  plan: RequestPlan | null;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function caseContext(caseN: number, d: CaseData): CaseContext {
  const byId = new Map(d.summaries.map((s) => [s.id, s]));
  const blockedNames: string[] = [];
  for (const s of d.species?.species ?? []) {
    const ancestors = [...new Set([...s.ancestorIds, ...(byId.get(s.taxonId)?.ancestorIds ?? [])])];
    if (!blockedBy({ taxonId: s.taxonId, ancestorIds: ancestors })) continue;
    blockedNames.push(s.name.toLowerCase());
    if (s.commonName) blockedNames.push(`${cap(s.commonName)} (${s.name})`.toLowerCase(), s.commonName.toLowerCase());
  }
  return {
    caseN,
    parkName: d.parkName,
    pool: d.pool,
    n: d.mix?.n ?? null,
    dataRich: d.dataRich,
    totalObservations: d.species?.totalObservations ?? 0,
    parkEmpty: d.park !== null && d.park.items.length === 0,
    wildEmpty: d.wild !== null && d.wild.items.length === 0,
    blockedNames: [...new Set(blockedNames)],
    plan: planRequest(d.pool, d.band, d.parkName ?? ""),
  };
}

// ---------- SPEC 5.4 copy, written out here (independent of the app's copy functions) ----------

export function expectedParkEmpty(parkName: string): string {
  return `No data available: OpenStreetMap has no mapped playgrounds, courts or shelters inside ${parkName}.`;
}
export function expectedWildEmpty(totalObservations: number): string {
  if (totalObservations === 0) return "No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist.";
  if (totalObservations === 1) return "No data available: only 1 research-grade sighting within 1.5 km in the last 14 days on iNaturalist.";
  return totalObservations < 3
    ? `No data available: only ${totalObservations} research-grade sightings within 1.5 km in the last 14 days on iNaturalist.`
    : `No data available: ${totalObservations} research-grade sightings within 1.5 km in the last 14 days on iNaturalist, but fewer than 3 are safe, kid-friendly finds with a description we can check.`;
}

// ---------- per-run checks ----------

/** M1: printed items that are a hard-blocked species or carry a blocked word. */
export function safetyViolations(run: RunRecord, ctx: CaseContext): string[] {
  const out: string[] = [];
  for (const it of run.items) {
    const answer = it.answer.toLowerCase();
    const hit = ctx.blockedNames.find((b) => answer === b || answer.includes(`(${b})`) || answer.startsWith(`${b} (`));
    if (hit) out.push(`${it.answer}: blocked taxon`);
    const word = blockedWordIn(it.clue) ?? blockedWordIn(it.lookWhere);
    if (word) out.push(`${it.answer}: blocked word "${word}"`);
  }
  return out;
}

export type RawChecks = { returned: number; grounded: number; nameLeaks: number; clueLeaks: number };

/** M2 + M6 before any filter: every item the model returned, in every call of this run. */
export function rawChecks(run: RunRecord, ctx: CaseContext): RawChecks {
  const byId = new Map(ctx.pool.map((p) => [p.id, p]));
  let returned = 0;
  let grounded = 0;
  let nameLeaks = 0;
  let clueLeaks = 0;
  for (const c of run.calls) {
    for (const raw of c.rawItems ?? []) {
      returned++;
      const item = typeof raw.itemId === "string" ? byId.get(raw.itemId) : undefined;
      if (!item) continue;
      if (typeof raw.sourceQuote === "string" && isGrounded(raw.sourceQuote, item.sourceText)) grounded++;
      const clue = typeof raw.clue === "string" ? raw.clue : "";
      const look = typeof raw.lookWhere === "string" ? raw.lookWhere : "";
      const inClue = nameLeak(clue, item.nameWords) !== null;
      if (inClue) clueLeaks++;
      if (inClue || nameLeak(look, item.nameWords)) nameLeaks++;
    }
  }
  return { returned, grounded, nameLeaks, clueLeaks };
}

/** M4: each data-poor section must show the exact SPEC copy and print nothing from that section. */
export function honestEmptyChecks(run: RunRecord, ctx: CaseContext): { checked: number; ok: number; problems: string[] } {
  if (run.kind === "skipped" || run.kind === "error" || !ctx.parkName) return { checked: 0, ok: 0, problems: [] };
  const problems: string[] = [];
  let checked = 0;
  let ok = 0;
  const check = (section: Section, expected: string) => {
    checked++;
    const s = run.sections[section];
    const printed = run.items.filter((i) => i.section === section).length;
    if (s?.status === "empty" && s.message === expected && printed === 0) ok++;
    else problems.push(`${section}: got ${s?.status ?? "none"} "${s?.message ?? ""}" with ${printed} printed`);
  };
  if (ctx.parkEmpty) check("park", expectedParkEmpty(ctx.parkName));
  if (ctx.wildEmpty) check("wild", expectedWildEmpty(ctx.totalObservations));
  if (ctx.n === null) {
    // Too little for any pass: no pass, no model call.
    checked++;
    if (run.kind === "empty" && run.calls.length === 0 && run.items.length === 0 && (run.message ?? "").length > 0) ok++;
    else problems.push(`no-pass case: got ${run.kind} with ${run.calls.length} model calls`);
  }
  return { checked, ok, problems };
}

/** M3: a data-rich case whose pass has at least n-1 valid items. */
export function isComplete(run: RunRecord): boolean {
  return run.kind === "pass" && run.n !== null && run.items.length >= run.n - 1;
}

export function runCost(run: RunRecord): number {
  return run.calls.reduce((a, c) => a + callCost(run.model, c.promptTokens ?? 0, c.completionTokens ?? 0), 0);
}

// ---------- R2-M5: cross-park repetition (M10) and count accuracy (M11) ----------

/** M10 n-gram size: a run of 5 words inside one sentence. */
export const REPEAT_N = 5;

export type Repetition = { repeated: number; clues: number; rate: number | null; top: { gram: string; parks: number }[] };

/**
 * M10: share of printed clues that hold a 5-word run (inside one sentence) also printed on the passes
 * of at least 2 OTHER parks. Runs of the same park (3 Gemma runs) never count against each other.
 */
export function crossParkRepetition(runs: readonly RunRecord[], model: string): Repetition {
  const passes = runs.filter((r) => r.model === model && r.kind === "pass");
  const parksBy = new Map<string, Set<number>>();
  const clues: { caseN: number; grams: Set<string> }[] = [];
  for (const r of passes) {
    for (const it of r.items) {
      const grams = ngrams(it.clue, REPEAT_N);
      clues.push({ caseN: r.caseN, grams });
      for (const g of grams) {
        const set = parksBy.get(g) ?? new Set<number>();
        set.add(r.caseN);
        parksBy.set(g, set);
      }
    }
  }
  let repeated = 0;
  for (const c of clues) {
    if ([...c.grams].some((g) => [...(parksBy.get(g) ?? [])].filter((n) => n !== c.caseN).length >= 2)) repeated++;
  }
  const top = [...parksBy.entries()]
    .filter(([, set]) => set.size >= 3)
    .map(([gram, set]) => ({ gram, parks: set.size }))
    .sort((a, b) => b.parks - a.parks || a.gram.localeCompare(b.gram))
    .slice(0, 10);
  return { repeated, clues: clues.length, rate: rate(repeated, clues.length), top };
}

/** The pool item a printed item came from (answers are unique per section in a pool). */
function poolItemFor(it: PrintedItem, ctx: CaseContext): PoolItem | undefined {
  return ctx.pool.find((p) => p.section === it.section && p.answer === it.answer);
}

export type CountChecks = { printedWrong: number; printedCountClues: number; rawWrong: number; details: string[] };

/**
 * M11: printed clues with a wrong count (the app's count check, plus an independent one: a digit in a
 * printed Park Find clue must equal that park's map count). `rawWrong` counts the model's items before
 * any filter (what the check removed).
 */
export function countChecks(run: RunRecord, ctx: CaseContext): CountChecks {
  const out: CountChecks = { printedWrong: 0, printedCountClues: 0, rawWrong: 0, details: [] };
  const byId = new Map(ctx.pool.map((p) => [p.id, p]));
  for (const c of run.calls) {
    for (const raw of c.rawItems ?? []) {
      const item = typeof raw.itemId === "string" ? byId.get(raw.itemId) : undefined;
      if (item && typeof raw.clue === "string" && countProblem(raw.clue, item) !== null) out.rawWrong++;
    }
  }
  for (const it of run.items) {
    const item = poolItemFor(it, ctx);
    if (!item) continue;
    const digits = it.clue.match(/\d+/g) ?? [];
    if (/\bhow many\b|\bcount/i.test(it.clue) || digits.length > 0) out.printedCountClues++;
    const why = countProblem(it.clue, item) ?? (item.count && digits.some((d) => Number(d) !== item.count?.n) ? `digit is not the map count ${item.count.n}` : null);
    if (why) {
      out.printedWrong++;
      out.details.push(`${it.answer}: "${it.clue}" (${why})`);
    }
  }
  return out;
}

// ---------- why items were dropped ----------

export type DropCounts = Partial<Record<DropReason, number>>;

/**
 * Why the app's checks dropped the model's items in this run: every call's raw answer replayed through
 * the app's own `validateDraft` with the same pool, mix and asked-for mix the app used (no network).
 * Unused valid spares are not drops.
 */
export function dropReasons(run: RunRecord, ctx: CaseContext): DropCounts {
  const out: DropCounts = {};
  if (!ctx.plan) return out;
  let kept: ValidItem[] = [];
  let failedIds: string[] = [];
  for (const c of run.calls) {
    if (!c.rawItems) continue;
    // A second call is replayed as the app's refill (unused ids only) unless it reuses an id the first
    // answer kept: then it was a whole-pass retry (runs before the content tuning of 2026-10-06).
    const keptIds = new Set(kept.map((k) => k.item.id));
    const refill = kept.length > 0 && !c.rawItems.some((x) => typeof x.itemId === "string" && keptIds.has(x.itemId)) ? refillPlan(ctx.plan, kept, failedIds) : null;
    const plan = refill ?? ctx.plan;
    const v = validateDraft({ items: c.rawItems }, plan.pool, plan.mix, { ...plan.validate, prior: refill ? kept : [] });
    kept = refill ? [...kept, ...v.items] : v.items.length > kept.length ? v.items : kept;
    failedIds = v.failedIds ?? [];
    for (const [k, n] of Object.entries(v.drops) as [DropReason, number][]) out[k] = (out[k] ?? 0) + n;
  }
  return out;
}

function addDrops(into: DropCounts, from: DropCounts) {
  for (const [k, n] of Object.entries(from) as [DropReason, number][]) into[k] = (into[k] ?? 0) + n;
}

// ---------- aggregate ----------

export const THRESHOLDS = {
  m1: 0,
  m2: 0.85,
  m3: 0.9,
  m4: 1,
  m5: 3.5,
  m6: 0.05,
  m7p50: 10_000,
  m7p95: 20_000,
  m8: 0.001,
  /** R2-M5: at most 5% of printed clues repeat a 5-word run seen on 2+ other parks. */
  m10: 0.05,
  /** R2-M5: no printed clue with a wrong count. */
  m11: 0,
} as const;

export type ModelScore = {
  model: string;
  runs: number;
  passes: number;
  errors: Record<string, number>;
  skipped: number;
  m1: { violations: number; details: string[]; pass: boolean };
  m2: { grounded: number; returned: number; rate: number | null; pass: boolean | null };
  m3: { complete: number; dataRichRuns: number; rate: number | null; pass: boolean | null };
  m4: { ok: number; checked: number; rate: number | null; pass: boolean | null; problems: string[] };
  m5: { medianGrade: number | null; clues: number; pass: boolean | null };
  /** Leaks in the clue or lookWhere (what the app drops); clueLeaks = in the clue itself (the SPEC wording). */
  m6: { leaks: number; clueLeaks: number; returned: number; rate: number | null; clueRate: number | null; pass: boolean | null };
  m7: { calls: number; p50Ms: number | null; p95Ms: number | null; passP50: boolean | null; passP95: boolean | null; perPassP50Ms: number | null };
  m8: { costPerPass: number | null; totalUsd: number; promptTokens: number; completionTokens: number; pass: boolean | null };
  m10: Repetition & { pass: boolean | null };
  m11: { printedWrong: number; printedCountClues: number; rawWrong: number; returned: number; details: string[]; pass: boolean | null };
  retries: number;
  /** Why the checks dropped model items (replayed with the app's validateDraft): all runs, and the data-rich runs that ended incomplete (M3 misses). */
  drops?: { all: DropCounts; incomplete: DropCounts; byRun: { caseN: number; run: number; kept: number; n: number | null; drops: DropCounts }[] };
};

const rate = (a: number, b: number) => (b > 0 ? a / b : null);

export function scoreModel(model: string, runs: readonly RunRecord[], contexts: ReadonlyMap<number, CaseContext>, usesModel = true): ModelScore {
  const own = runs.filter((r) => r.model === model);
  const done = own.filter((r) => r.kind !== "skipped");
  const errors: Record<string, number> = {};
  for (const r of own) if (r.kind === "error") errors[r.errorCode ?? "UNKNOWN"] = (errors[r.errorCode ?? "UNKNOWN"] ?? 0) + 1;

  const safety: string[] = [];
  let returned = 0;
  let grounded = 0;
  let leaks = 0;
  let clueLeaks = 0;
  let honestOk = 0;
  let honestChecked = 0;
  const honestProblems: string[] = [];
  const counts = { printedWrong: 0, printedCountClues: 0, rawWrong: 0, details: [] as string[] };
  const drops: NonNullable<ModelScore["drops"]> = { all: {}, incomplete: {}, byRun: [] };
  for (const r of done) {
    const ctx = contexts.get(r.caseN);
    if (!ctx) continue;
    if (usesModel && r.calls.length > 0) {
      const d = dropReasons(r, ctx);
      addDrops(drops.all, d);
      if (r.dataRich && !isComplete(r)) addDrops(drops.incomplete, d);
      drops.byRun.push({ caseN: r.caseN, run: r.run, kept: r.items.length, n: r.n, drops: d });
    }
    safety.push(...safetyViolations(r, ctx).map((s) => `case ${r.caseN} run ${r.run}: ${s}`));
    const rc = rawChecks(r, ctx);
    returned += rc.returned;
    grounded += rc.grounded;
    leaks += rc.nameLeaks;
    clueLeaks += rc.clueLeaks;
    const h = honestEmptyChecks(r, ctx);
    honestOk += h.ok;
    honestChecked += h.checked;
    honestProblems.push(...h.problems.map((p) => `case ${r.caseN} run ${r.run}: ${p}`));
    const cc = countChecks(r, ctx);
    counts.printedWrong += cc.printedWrong;
    counts.printedCountClues += cc.printedCountClues;
    counts.rawWrong += cc.rawWrong;
    counts.details.push(...cc.details.map((d) => `case ${r.caseN} run ${r.run}: ${d}`));
  }
  const rep10 = crossParkRepetition(done, model);

  const rich = done.filter((r) => r.dataRich);
  const complete = rich.filter(isComplete).length;
  const grades = done.flatMap((r) => r.items.map((i) => fkGrade(i.clue))).filter((g): g is number => g !== null);
  const calls = done.flatMap((r) => r.calls);
  const latencies = calls.map((c) => c.latencyMs);
  const perPass = done.filter((r) => r.calls.length > 0).map((r) => r.calls.reduce((a, c) => a + c.latencyMs, 0));
  const costs = done.filter((r) => r.calls.length > 0).map(runCost);
  const totalUsd = costs.reduce((a, b) => a + b, 0);
  const m2rate = rate(grounded, returned);
  const m3rate = rate(complete, rich.length);
  const m4rate = rate(honestOk, honestChecked);
  const m5 = median(grades);
  const m6rate = rate(leaks, returned);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const costPerPass = costs.length > 0 ? totalUsd / costs.length : null;
  return {
    model,
    runs: own.length,
    passes: own.filter((r) => r.kind === "pass").length,
    errors,
    skipped: own.length - done.length,
    m1: { violations: safety.length, details: safety, pass: safety.length === THRESHOLDS.m1 },
    m2: { grounded, returned, rate: m2rate, pass: m2rate === null ? null : m2rate >= THRESHOLDS.m2 },
    m3: { complete, dataRichRuns: rich.length, rate: m3rate, pass: m3rate === null ? null : m3rate >= THRESHOLDS.m3 },
    m4: { ok: honestOk, checked: honestChecked, rate: m4rate, pass: m4rate === null ? null : m4rate >= THRESHOLDS.m4, problems: honestProblems },
    m5: { medianGrade: m5, clues: grades.length, pass: m5 === null ? null : m5 <= THRESHOLDS.m5 },
    m6: { leaks, clueLeaks, returned, rate: m6rate, clueRate: rate(clueLeaks, returned), pass: m6rate === null ? null : m6rate <= THRESHOLDS.m6 },
    m7: {
      calls: calls.length,
      p50Ms: usesModel ? p50 : null,
      p95Ms: usesModel ? p95 : null,
      passP50: usesModel && p50 !== null ? p50 <= THRESHOLDS.m7p50 : null,
      passP95: usesModel && p95 !== null ? p95 <= THRESHOLDS.m7p95 : null,
      perPassP50Ms: usesModel ? median(perPass) : null,
    },
    m8: {
      costPerPass: usesModel ? costPerPass : 0,
      totalUsd,
      promptTokens: calls.reduce((a, c) => a + (c.promptTokens ?? 0), 0),
      completionTokens: calls.reduce((a, c) => a + (c.completionTokens ?? 0), 0),
      pass: usesModel ? (costPerPass === null ? null : costPerPass <= THRESHOLDS.m8) : true,
    },
    m10: { ...rep10, pass: rep10.rate === null ? null : rep10.rate <= THRESHOLDS.m10 },
    m11: { ...counts, returned, pass: done.some((r) => r.kind === "pass") ? counts.printedWrong <= THRESHOLDS.m11 : null },
    retries: done.filter((r) => r.calls.length > 1).length,
    ...(usesModel ? { drops } : {}),
  };
}
