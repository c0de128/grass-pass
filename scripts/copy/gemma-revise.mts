/**
 * Step 1 + 2 of the Gemma copy pipeline (docs/COPY-BY-GEMMA.md): send every block in scripts/copy/blocks.mts to
 * Gemma 4 (the app's own model client, src/lib/model.ts: same model, key and host rules as the live site) in
 * batches, then run the code check on each draft. Writes docs/copy-by-gemma/run-<stamp>.json and one row in
 * evals/results/SPEND.md. Nothing in the site changes here: a reviewer (so far an AI coding agent, Claude Code) reviews the drafts, then applies them by hand.
 *
 *   pnpm copy:gemma            (paid: about 15 calls, cap 40 calls and $0.05)
 *   COPY_ONLY=id1,id2 pnpm copy:gemma   (re-run some blocks only)
 *
 * Runs under Vitest (like the evals) so it can import the app's TypeScript with the @ alias.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { z } from "zod";
import { callModel, ModelError, type ModelLogLine } from "@/lib/model";
import { callCost } from "../../evals/score";
import { evalEnv } from "../../evals/env";
import { BLOCKS } from "./blocks.mts";
import { batchJsonSchema, checkDraft, type CopyBlock } from "./check.mts";
import { batchMessage, SYSTEM_PROMPT } from "./prompt.mts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const BATCH_SIZE = 10;
export const MAX_CALLS = 40;
export const MAX_USD = 0.05;

export type DraftRecord = {
  id: string;
  current: string;
  draft: string | null;
  codeCheck: { ok: boolean; reasons: string[] };
  model: string | null;
};

export type RunFile = {
  startedAt: string;
  model: string | null;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  usd: number;
  batchSize: number;
  failures: { batch: number; error: string }[];
  drafts: DraftRecord[];
};

const DraftsSchema = z.object({ drafts: z.array(z.object({ id: z.string(), text: z.string() })) });

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

test("Gemma drafts the site copy, code checks every draft (pnpm copy:gemma)", async () => {
  const env = evalEnv(ROOT);
  const only = (env.COPY_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const blocks: readonly CopyBlock[] = only.length > 0 ? BLOCKS.filter((b) => only.includes(b.id)) : BLOCKS;
  const startedAt = new Date().toISOString();
  const run: RunFile = { startedAt, model: null, calls: 0, promptTokens: 0, completionTokens: 0, usd: 0, batchSize: BATCH_SIZE, failures: [], drafts: [] };

  // Count every attempt (a retried 5xx is a second call) from the client's own log lines.
  const logger = (line: ModelLogLine) => {
    run.calls += 1;
    run.promptTokens += line.promptTokens ?? 0;
    run.completionTokens += line.completionTokens ?? 0;
    run.usd += callCost(line.answeredModel ?? line.model, line.promptTokens, line.completionTokens);
    console.info(`[copy] call ${run.calls}: ${line.outcome} ${line.latencyMs} ms, ${line.promptTokens ?? "?"}+${line.completionTokens ?? "?"} tokens`);
  };

  for (const [i, batch] of batches(blocks, BATCH_SIZE).entries()) {
    const ids = batch.map((b) => b.id);
    let got: Map<string, string> | null = null;
    let model: string | null = null;
    // One extra try per batch on a bad answer, inside the call and money caps.
    for (let attempt = 1; attempt <= 2 && got === null; attempt++) {
      if (run.calls >= MAX_CALLS || run.usd >= MAX_USD) {
        run.failures.push({ batch: i, error: `stopped: cap reached (${run.calls} calls, $${run.usd.toFixed(4)})` });
        break;
      }
      try {
        const res = await callModel(
          {
            task: "copy-rewrite",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: batchMessage(batch) },
            ],
            jsonSchema: batchJsonSchema(ids),
            schemaName: "copy_drafts",
            schema: DraftsSchema,
            maxTokens: 4_000,
            temperature: 0.5,
          },
          { env, logger, timeoutMs: 60_000 },
        );
        model = res.modelLabel;
        run.model = res.modelLabel;
        got = new Map(res.data.drafts.map((d) => [d.id, d.text]));
      } catch (e) {
        const msg = e instanceof ModelError ? `${e.code}${e.badOutput ? ` (${e.badOutput})` : ""}${e.upstreamStatus ? ` HTTP ${e.upstreamStatus}` : ""}` : String(e);
        run.failures.push({ batch: i, error: `attempt ${attempt}: ${msg}` });
        if (e instanceof ModelError && (e.code === "MODEL_NOT_CONFIGURED" || e.code === "MODEL_QUOTA")) break;
      }
    }
    for (const b of batch) {
      const draft = got?.get(b.id) ?? null;
      const codeCheck = draft === null ? { ok: false, reasons: ["no draft (model call failed or skipped the id)"] } : checkDraft(b, draft);
      run.drafts.push({ id: b.id, current: b.text, draft, codeCheck, model });
    }
    if (run.failures.some((f) => f.error.startsWith("stopped"))) break;
  }

  const stamp = startedAt.replace(/[:.]/g, "-");
  const dir = path.join(ROOT, "docs", "copy-by-gemma");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `run-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);

  const spend = path.join(ROOT, "evals", "results", "SPEND.md");
  const row = `| ${startedAt} | Site copy rewrite by Gemma (Builder G, not an eval run): docs/copy-by-gemma/${path.basename(file)} | ${run.calls} | ${run.promptTokens} | ${run.completionTokens} | $${run.usd.toFixed(4)} |\n`;
  const prev = readFileSync(spend, "utf8");
  appendFileSync(spend, prev.endsWith("\n") ? row : `\n${row}`);

  const passed = run.drafts.filter((d) => d.codeCheck.ok).length;
  console.info(`[copy] ${run.drafts.length} blocks, ${passed} passed the code check, ${run.calls} calls, $${run.usd.toFixed(4)} -> ${path.relative(ROOT, file)}`);
});
