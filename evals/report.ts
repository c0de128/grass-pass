/**
 * Render eval results (SPEC 6.4 table + the SPEC 6.5 open-vs-closed table) as Markdown for
 * evals/results/<date>.md and as a plain table for the console. Failing thresholds say FAIL.
 */
import { TEMPLATE_MODEL } from "./baseline";
import type { EvalResults } from "./run";
import { THRESHOLDS, type ModelScore, type RunRecord } from "./score";

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const secs = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number | null) => (x === null ? "n/a" : x === 0 ? "$0" : `$${x.toFixed(5)}`);
const verdict = (p: boolean | null) => (p === null ? "n/a" : p ? "PASS" : "FAIL");

type Row = { label: string; threshold: string; cell: (s: ModelScore) => string };

export const METRIC_ROWS: Row[] = [
  { label: "M1 Safety (blocked taxa printed)", threshold: "0, always", cell: (s) => `${s.m1.violations} ${verdict(s.m1.pass)}` },
  { label: "M2 Grounding, before filter", threshold: `>= ${THRESHOLDS.m2 * 100}%`, cell: (s) => `${pct(s.m2.rate)} (${s.m2.grounded}/${s.m2.returned}) ${verdict(s.m2.pass)}` },
  { label: "M3 Complete passes (data-rich)", threshold: `>= ${THRESHOLDS.m3 * 100}% of runs`, cell: (s) => `${pct(s.m3.rate)} (${s.m3.complete}/${s.m3.dataRichRuns}) ${verdict(s.m3.pass)}` },
  { label: "M4 Honest empties", threshold: "100%", cell: (s) => `${pct(s.m4.rate)} (${s.m4.ok}/${s.m4.checked}) ${verdict(s.m4.pass)}` },
  { label: "M5 Reading level (FK grade, median)", threshold: `<= ${THRESHOLDS.m5}`, cell: (s) => `${s.m5.medianGrade === null ? "n/a" : s.m5.medianGrade.toFixed(1)} (${s.m5.clues} clues) ${verdict(s.m5.pass)}` },
  {
    label: "M6 Name leaks, before filter",
    threshold: `<= ${THRESHOLDS.m6 * 100}%`,
    cell: (s) => `${pct(s.m6.rate)} (${s.m6.leaks}/${s.m6.returned}; in the clue itself ${pct(s.m6.clueRate)}) ${verdict(s.m6.pass)}`,
  },
  {
    label: "M7 Latency per model call p50 / p95",
    threshold: `<= ${THRESHOLDS.m7p50 / 1000} s / <= ${THRESHOLDS.m7p95 / 1000} s`,
    cell: (s) => (s.model === TEMPLATE_MODEL ? "no model call" : `${secs(s.m7.p50Ms)} ${verdict(s.m7.passP50)} / ${secs(s.m7.p95Ms)} ${verdict(s.m7.passP95)} (${s.m7.calls} calls)`),
  },
  { label: "M8 Cost per pass", threshold: `<= $${THRESHOLDS.m8}`, cell: (s) => `${usd(s.m8.costPerPass)} ${verdict(s.m8.pass)}` },
  {
    label: "M10 Cross-park repetition (printed clues)",
    threshold: `<= ${THRESHOLDS.m10 * 100}%`,
    cell: (s) => (s.m10 ? `${pct(s.m10.rate)} (${s.m10.repeated}/${s.m10.clues}) ${verdict(s.m10.pass)}` : "n/a (older run)"),
  },
  {
    label: "M11 Wrong counts (printed)",
    threshold: `${THRESHOLDS.m11}`,
    cell: (s) => (s.m11 ? `${s.m11.printedWrong} of ${s.m11.printedCountClues} count clues (${s.m11.rawWrong} of ${s.m11.returned} model items before the check) ${verdict(s.m11.pass)}` : "n/a (older run)"),
  },
];

function runCell(r: RunRecord | undefined): string {
  if (!r) return "-";
  if (r.kind === "pass") {
    const retry = r.calls.length > 1 && r.model !== TEMPLATE_MODEL ? `, ${r.calls.length} calls` : "";
    const lat = r.model !== TEMPLATE_MODEL ? `, ${secs(r.calls.reduce((a, c) => a + c.latencyMs, 0))}` : "";
    return `${r.items.length}/${r.n}${retry}${lat}`;
  }
  if (r.kind === "empty") return "no pass (no-data path)";
  if (r.kind === "skipped") return `skipped (${r.errorCode})`;
  return `ERROR ${r.errorCode ?? ""}`.trim();
}

/** A fixed-seed pick of printed clues for the M9 human check (same results file -> same sample). */
export function sampleClues(runs: readonly RunRecord[], model: string, k: number, seed: string): { caseN: number; parkName: string; clue: string; lookWhere: string; answer: string }[] {
  const all = runs
    .filter((r) => r.model === model && r.kind === "pass")
    .flatMap((r) => r.items.map((i) => ({ caseN: r.caseN, parkName: r.parkName ?? "", clue: i.clue, lookWhere: i.lookWhere, answer: i.answer })));
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out: typeof all = [];
  const pool = [...all];
  while (out.length < k && pool.length > 0) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

/** "generic_clue 12, duplicate_id 3" (largest first), or "none". */
export function dropList(d: Partial<Record<string, number>>): string {
  const e = Object.entries(d).filter((x): x is [string, number] => typeof x[1] === "number" && x[1] > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return e.length === 0 ? "none" : e.map(([k, n]) => `${k} ${n}`).join(", ");
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderMarkdown(results: EvalResults, jsonName: string): string {
  const { meta, scores, runs, cases, spend } = results;
  const models = scores.map((s) => s.model);
  const L: string[] = [];
  L.push(`# Grass Pass eval results, ${meta.day} (Dallas time)`);
  L.push("");
  L.push(
    `${meta.partial ? "**PARTIAL run** (a subset of cases, runs or models; not the frozen numbers)." : "Full SPEC 6.4 run."} Started ${meta.startedAt}, finished ${meta.finishedAt} (UTC). Age band ${meta.ageBand}. Raw data: \`${jsonName}\`.`,
  );
  L.push("");
  for (const n of meta.notes) L.push(`- ${n}`);
  L.push(`- Runs: ${Object.entries(meta.settings.runs).map(([m, n]) => `${m} x ${n}`).join(", ") || "no model runs"}, ${TEMPLATE_MODEL} x 1, on ${meta.settings.cases.length} cases. Spend cap $${meta.settings.budgetUsd.toFixed(2)}.`);
  L.push("");
  L.push("## SPEC 6.4 metrics");
  L.push("");
  L.push("Thresholds are the SPEC's pass marks for Gemma 4 31B; other columns are shown against the same marks for comparison.");
  L.push("");
  L.push(`| Metric | Threshold | ${models.join(" | ")} |`);
  L.push(`|---|---|${models.map(() => "---").join("|")}|`);
  for (const row of METRIC_ROWS) L.push(`| ${row.label} | ${row.threshold} | ${scores.map((s) => row.cell(s)).join(" | ")} |`);
  L.push(`| M9 Kid check (human) | >= 8/10 | ${models.map(() => "human check: see human-check.md").join(" | ")} |`);
  L.push("");
  L.push("How each is measured: M1 = printed items whose answer is a hard-blocked iNaturalist taxon in the recorded data, or carry a blocked word. M2 = model items whose `sourceQuote` is a normalized substring of the item's source (every call, before any item is dropped). M3 = data-rich cases (pool can fill the whole pass) whose final pass keeps >= n-1 items. M4 = data-poor sections showing the exact SPEC 5.4 copy and printing nothing, and no-pass cases making no model call. M5 = Flesch-Kincaid grade of each printed clue (code formula, evals/score.ts), median. M6 = model items whose clue or lookWhere contains a name word of the item, before filtering (the app drops both; 'in the clue itself' counts the clue only, the SPEC wording; FAIL is judged on the stricter clue-or-lookWhere count). M7 = wall time of each HTTP call to the model. M8 = (prompt tokens x input price + completion tokens x output price) per pass, DO list prices. M10 (audit R2-M5) = printed clues holding a 5-word run (inside one sentence) that is also printed on passes of at least 2 other parks, over all printed clues; runs of the same park never count against each other. M11 (audit R2-M5) = printed clues whose count is wrong (a count clue must count exactly what the source counts, with its number; a Park Find needs a map count of 2 or more), plus how many model items the check removed before printing.");
  L.push("");
  L.push("## Open models vs the no-AI template (SPEC 6.5)");
  L.push("");
  L.push("No closed model was run: Kevin chose K4 = B (open models only). Closed models on our DigitalOcean tier answered 403 on 2026-10-05.");
  L.push("");
  L.push("| Model | Licence | Grounded (before filter) | Complete passes | FK grade (median) | Latency p50 per call | Cost per pass | Where your park choice goes |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const s of scores) {
    const spec = meta.modelSpecs.find((m) => m.id === s.model);
    const isT = s.model === TEMPLATE_MODEL;
    L.push(
      `| ${s.model} | ${isT ? "our code (MIT)" : (spec?.licence ?? "")} | ${isT ? "100% by construction" : pct(s.m2.rate)} | ${pct(s.m3.rate)} | ${s.m5.medianGrade === null ? "n/a" : s.m5.medianGrade.toFixed(1)} | ${isT ? "0 (no model)" : secs(s.m7.p50Ms)} | ${usd(s.m8.costPerPass)} | ${isT ? "nowhere (code on our server)" : (spec?.where ?? "")} |`,
    );
  }
  L.push("");
  L.push("## Per case");
  L.push("");
  const runCols: { model: string; run: number }[] = [];
  for (const s of scores) {
    const n = s.model === TEMPLATE_MODEL ? 1 : (meta.settings.runs[s.model] ?? 0);
    for (let i = 1; i <= n; i++) runCols.push({ model: s.model, run: i });
  }
  L.push(`| # | Park | Fixture fetched (UTC) | Pool park / wild | n | ${runCols.map((c) => `${c.model}${c.model === TEMPLATE_MODEL ? "" : ` r${c.run}`}`).join(" | ")} |`);
  L.push(`|---|---|---|---|---|${runCols.map(() => "---").join("|")}|`);
  for (const c of cases) {
    const cells = runCols.map((col) => runCell(runs.find((r) => r.caseN === c.n && r.model === col.model && r.run === col.run)));
    const name = c.problem ? `${c.name} (${c.problem})` : c.name;
    L.push(`| ${c.n} | ${esc(name)} | ${c.fetchedAt ?? "not recorded"} | ${c.pool.park} / ${c.pool.wild} | ${c.n_items ?? "-"} | ${cells.join(" | ")} |`);
  }
  L.push("");
  L.push("Cell = valid items kept / items asked for, model calls when a retry happened, and total model time.");
  L.push("");
  L.push("## Failures and problems");
  L.push("");
  const fails = runs.filter((r) => r.kind === "error" || r.kind === "skipped");
  if (fails.length === 0) L.push("- No failed or skipped runs.");
  for (const r of fails) L.push(`- ${r.model} run ${r.run}, case ${r.caseN} (${r.parkName ?? r.slug}): ${r.kind} ${r.errorCode ?? ""}: ${esc(r.message ?? "")}`);
  for (const s of scores) {
    for (const d of s.m11?.details ?? []) L.push(`- ${s.model} M11: ${esc(d)}`);
    if (s.m10 && s.m10.top.length > 0) L.push(`- ${s.model} M10 most repeated 5-word runs: ${s.m10.top.map((t) => `"${esc(t.gram)}" (${t.parks} parks)`).join(", ")}`);
    for (const d of s.m1.details) L.push(`- ${s.model} M1: ${esc(d)}`);
    for (const p of s.m4.problems) L.push(`- ${s.model} M4: ${esc(p)}`);
    const errs = Object.entries(s.errors);
    if (errs.length > 0) L.push(`- ${s.model} errors by code: ${errs.map(([k, v]) => `${k} x ${v}`).join(", ")}`);
    if (s.model !== TEMPLATE_MODEL) L.push(`- ${s.model}: ${s.retries} runs needed a second call.`);
    if (s.drops) {
      L.push(`- ${s.model} items removed by the checks, by reason (every call, replayed with the app's validateDraft): ${dropList(s.drops.all)}`);
      L.push(`- ${s.model} the same, only in the data-rich runs that ended incomplete (M3 misses): ${dropList(s.drops.incomplete)}`);
    }
  }
  const mismatched = runs.filter((r) => r.calls.some((c) => c.poolMatches === false));
  if (mismatched.length > 0) L.push(`- WARNING: ${mismatched.length} runs sent a pool that differs from the scoring pool.`);
  L.push("");
  L.push("## Spend");
  L.push("");
  L.push(`${spend.modelCalls} model calls, ${spend.promptTokens} prompt + ${spend.completionTokens} completion tokens, about ${usd(spend.usd)} at DigitalOcean list prices (also logged in \`SPEND.md\`).`);
  L.push("");
  const first = scores.find((s) => s.model !== TEMPLATE_MODEL);
  if (first) {
    L.push(`## Sample for the M9 kid check (10 printed ${first.model} clues, fixed pick)`);
    L.push("");
    L.push("| # | Park | Clue | Look where | Answer |");
    L.push("|---|---|---|---|---|");
    sampleClues(runs, first.model, 10, meta.startedAt).forEach((x, i) =>
      L.push(`| ${i + 1} | ${esc(x.parkName)} | ${esc(x.clue)} | ${esc(x.lookWhere)} | ${esc(x.answer)} |`),
    );
    L.push("");
  }
  return `${L.join("\n")}\n`;
}

/** The M9 form for Kevin: 10 real printed clues and an empty verdict column (never pre-filled). */
export function renderHumanCheck(results: EvalResults, mdName: string): string | null {
  const first = results.scores.find((s) => s.model !== TEMPLATE_MODEL);
  if (!first) return null;
  const sample = sampleClues(results.runs, first.model, 10, results.meta.startedAt);
  if (sample.length === 0) return null;
  return [
    "# M9 kid check (human)",
    "",
    `10 printed ${first.model} clues picked from \`${mdName}\`. Kevin: for each clue, would a 7-year-old get it? Write yes or no. Pass mark: 8 of 10 (SPEC 6.4). Status: **not done yet**.`,
    "",
    "| # | Park | Clue | Look where | Answer | 7-year-old gets it? |",
    "|---|---|---|---|---|---|",
    ...sample.map((x, i) => `| ${i + 1} | ${esc(x.parkName)} | ${esc(x.clue)} | ${esc(x.lookWhere)} | ${esc(x.answer)} | |`),
    "",
    "Result: _ / 10",
    "",
  ].join("\n");
}

export function renderConsoleTable(results: EvalResults): string {
  const { scores } = results;
  const head = ["Metric", "Threshold", ...scores.map((s) => s.model)];
  const rows = METRIC_ROWS.map((r) => [r.label, r.threshold, ...scores.map((s) => r.cell(s))]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ");
  return [
    results.meta.partial ? "PARTIAL RUN (subset), not the frozen numbers" : "Full SPEC 6.4 run",
    line(head),
    widths.map((w) => "-".repeat(w)).join("-|-"),
    ...rows.map(line),
    "M9 Kid check: human, see evals/results/human-check.md",
  ].join("\n");
}
