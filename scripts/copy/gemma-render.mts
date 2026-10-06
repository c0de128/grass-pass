/**
 * Step 4 of the Gemma copy pipeline: render docs/COPY-BY-GEMMA.md from the run file (Gemma's drafts + the
 * code check) and docs/copy-by-gemma/review.json (people's decisions). No model calls.
 *
 *   pnpm copy:render
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { BLOCKS } from "./blocks.mts";
import { BANNED_WORDS, normaliseSource, SITE_WORDS, type CopyBlock } from "./check.mts";
import type { RunFile } from "./gemma-revise.mts";
import { SYSTEM_PROMPT } from "./prompt.mts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

type Decision = { id: string; decision: "accepted" | "edited" | "rejected" | "unchanged"; stage: "code" | "gemma" | "people"; reason: string; shipped: string; factFixAfterRun?: boolean };
type Review = { reviewedBy: string; run: string; counts: Record<string, number>; decisions: Decision[] };

/** First line of `file` that holds the start of `text` (JSX entities and wraps allowed). */
function lineOf(b: CopyBlock, text: string): number | null {
  const lines = readFileSync(path.join(ROOT, b.file), "utf8").split("\n");
  const head = normaliseSource(text.split(/\{[a-zA-Z]+\}/)[0] ?? "").trim().slice(0, 24);
  if (head.length < 4) return null;
  const i = lines.findIndex((l) => normaliseSource(l).includes(head));
  return i >= 0 ? i + 1 : null;
}

const q = (s: string | null) => (s === null ? "_(none)_" : s.replace(/\|/g, "\\|"));

test("render docs/COPY-BY-GEMMA.md (pnpm copy:render)", () => {
  const review = JSON.parse(readFileSync(path.join(ROOT, "docs/copy-by-gemma/review.json"), "utf8")) as Review;
  const run = JSON.parse(readFileSync(path.join(ROOT, "docs/copy-by-gemma", review.run), "utf8")) as RunFile;
  const blocks = new Map(BLOCKS.map((b) => [b.id, b]));
  const drafts = new Map(run.drafts.map((d) => [d.id, d]));
  const c = review.counts;
  const codeRejected = review.decisions.filter((d) => d.stage === "code").length;

  const out: string[] = [];
  out.push("# Site copy drafted by Gemma 4");
  out.push("");
  out.push(
    `On ${run.startedAt.slice(0, 10)}, Kevin asked for the rest of the website copy to be revised with Google's Gemma. This file is the full record: what Gemma was told, what it wrote for each block, what code and people checked, and what shipped. Kevin's own lines were not sent (list below).`,
  );
  out.push("");
  out.push("## In short");
  out.push("");
  out.push(`- **Model:** \`${run.model}\` on DigitalOcean serverless inference, through the app's own model client (\`src/lib/model.ts\`, strict JSON schema output).`);
  out.push(`- **Calls:** ${run.calls} (batches of ${run.batchSize}), ${run.promptTokens.toLocaleString("en-US")} prompt + ${run.completionTokens.toLocaleString("en-US")} completion tokens, **$${run.usd.toFixed(4)}** at DigitalOcean list prices (logged in \`evals/results/SPEND.md\`). Failures: ${run.failures.length === 0 ? "none" : run.failures.map((f) => `batch ${f.batch}: ${f.error}`).join("; ")}.`);
  out.push(`- **Blocks sent:** ${review.decisions.length}.`);
  out.push(`  - **Accepted** as Gemma wrote them: ${c.accepted}`);
  out.push(`  - **Edited** (Gemma draft with a small fix by a person, marked "Gemma draft, edited"): ${c.edited}`);
  out.push(`  - **Rejected** (old text kept): ${c.rejected} (${codeRejected} by the code check, ${c.rejected - codeRejected} by people)`);
  out.push(`  - **Unchanged** (Gemma returned the old text): ${c.unchanged}`);
  out.push(`- **Reviewed by:** ${review.reviewedBy}. Decisions and reasons: \`docs/copy-by-gemma/review.json\`. Raw drafts: \`docs/copy-by-gemma/${review.run}\`.`);
  out.push("- **Test:** `tests/unit/copy-check.test.ts` checks the code check itself, that every block's old text passes its own rules, that every hand edit passes them too, and that every shipped text is really in the code.");
  out.push("");
  out.push("## How it works (and how to run it again)");
  out.push("");
  out.push("1. `scripts/copy/blocks.mts` lists every block: its id, page, file, role (with a size), character limit, current text, and a FACTS sheet written by hand from the code and eval files (with the constant each fact comes from). `KEEP` lists exact strings that must survive. `{placeholders}` stand for values code fills in.");
  out.push("2. `pnpm copy:gemma` (paid, about 19 calls, about $0.01; capped at 40 calls and $0.05) sends the blocks to Gemma in batches with the system prompt below and asks for `{\"drafts\": [{\"id\", \"text\"}]}` under a strict JSON schema whose `id` can only be the batch's own ids.");
  out.push("3. **Code check** (`scripts/copy/check.mts`) on every draft. A draft is rejected, and the old text stays, when it:");
  out.push("   - is empty or longer than the block's limit;");
  out.push("   - drops or adds a `{placeholder}`;");
  out.push('   - drops any `KEEP` string (and always "No data available" when the old text has it);');
  out.push("   - adds a number (digits, or a number word like \"three\") not in the old text or FACTS;");
  out.push(`   - adds a name (a capitalised word mid-sentence, or one with inner capitals like "iNaturalist") not in the old text, FACTS or these site words: ${SITE_WORDS.join(", ")};`);
  out.push(`   - uses a banned word: ${BANNED_WORDS.join(", ")};`);
  out.push("   - has an emoji or markup.");
  out.push("4. **People** read every draft that passed: untrue, garbled, off-tone or weaker drafts are rejected; tiny fixes are allowed and marked. Decisions go in `docs/copy-by-gemma/review.json`; accepted and edited texts are applied by hand in the files named below.");
  out.push("5. `pnpm copy:render` writes this file.");
  out.push("");
  out.push(
    "**Correction after the run:** the FACTS sheet sent to Gemma said there were 18 blocked species groups; the real count (`BLOCKED_TAXA.length`) is 17. The sheet below is corrected. No shipped text was affected: every block that mentions the count uses the `{blocked}` placeholder, which code fills in.",
  );
  out.push("");
  out.push(
    `**Fact fixes after the run (not Gemma):** after the run, main changed the pass builder so a pass makes 1-3 model calls (\`MAX_MODEL_CALLS = 3\`: one whole retry if the first call fails, refills if too few clues pass). Gemma had been sent the old \"one retry\" facts. ${review.decisions.filter((d) => d.factFixAfterRun && d.reason.includes("rebase")).length} blocks were fixed by hand for that (marked \"Fact fix after the rebase\" below): two accepted Gemma drafts became \"edited\", and two kept old lines were corrected. Their FACTS sheets below show the new rule.`,
  );
  out.push("");
  out.push(
    `**Fact fixes after the self-host measurement (not Gemma, 2026-10-06):** a self-hosted Gemma 4 E2B run on a laptop CPU was measured (\`evals/results/2026-10-06-selfhost-notes.md\`), so \"not measured yet\" became untrue. ${review.decisions.filter((d) => d.factFixAfterRun && d.reason.includes("self-host measurement")).length} blocks were fixed by hand (marked \"Fact fix after the self-host measurement\" below): one accepted Gemma draft became \"edited\", and one kept line was corrected. Their FACTS sheets below show the measured result.`,
  );
  out.push("");
  out.push("The code check catches new facts, lost facts and hype. It cannot catch a sentence that is true word by word but wrong as a whole: those were caught in step 4 (look for **UNTRUE** below). It also had one false positive: \"No one\" counted as the number word \"one\".");
  out.push("");
  out.push("## Not sent to Gemma");
  out.push("");
  out.push("- **Kevin's own lines:** the home hero (chip \"SCREEN-FREE & RE-WILDED\", the headline \"Family time is back! / powered by AI.\", the hero paragraph, \"Free for parents.\"), the problem band (heading, both paragraphs, the two park verdicts), the how-it-works headline \"Real park data in. Advanced AI processing. Screen-free adventure out.\", the header nav labels, and the lines from his home copy reference that shipped as he wrote them (\"Proof in every clue.\", \"See a real pass, right now.\", \"Print the pass. Pocket the pencil. Leave the phone.\", \"Make your first pass free\"). Three step titles from his reference were sent by mistake (\"Pick a park & age\", \"Print the page\", \"Hide the phone\"); Gemma's versions were rejected for that reason.");
  out.push("- **Numbers-only and legal text:** eval tables and stat tiles, the privacy table, licences and credits, the report rule, the October box dates, the progress-step labels (they mirror the server's real steps).");
  out.push("- **Folded technical details** on /how-it-works and /about (dense numbers mixed with markup: a rewrite could only lose facts).");
  out.push("- **Files another builder is editing** (`src/lib/ai/**`), and the printed kid pass and its safety lines (sized to fit one page; safety wording is code-owned).");
  out.push("");
  out.push("## The system prompt (word for word)");
  out.push("");
  out.push("```text");
  out.push(SYSTEM_PROMPT);
  out.push("```");
  out.push("");
  out.push("Each batch's user message is `Rewrite these N blocks.` followed by the blocks as JSON: `id`, `page`, `ROLE`, `MAX_CHARS`, `CURRENT`, `FACTS`, `KEEP` (see `scripts/copy/prompt.mts`).");
  out.push("");
  out.push("## Every block");
  out.push("");
  let page = "";
  for (const d of review.decisions) {
    const b = blocks.get(d.id);
    const r = drafts.get(d.id);
    if (!b || !r) throw new Error(`missing block or draft for ${d.id}`);
    if (b.page !== page) {
      page = b.page;
      out.push(`### ${page}`);
      out.push("");
    }
    const line = lineOf(b, d.shipped);
    out.push(`#### \`${d.id}\`: ${d.decision}`);
    out.push("");
    out.push(`\`${b.file}${line ? `:${line}` : ""}\` · ${b.role} · max ${b.maxChars} characters`);
    out.push("");
    out.push(`- **Old:** ${q(r.current)}`);
    out.push(`- **Gemma:** ${q(r.draft)}`);
    out.push(`- **Code check:** ${r.codeCheck.ok ? "passed" : `rejected (${r.codeCheck.reasons.join("; ")})`}`);
    out.push(`- **Shipped:** ${q(d.shipped)}${d.decision === "edited" ? " _(Gemma draft, edited)_" : ""}`);
    out.push(`- **Why:** ${d.reason}`);
    out.push(`- **FACTS:** ${b.facts.map((f) => q(f)).join(" / ")}${b.keep?.length ? ` · KEEP: ${b.keep.map((k) => `"${k}"`).join(", ")}` : ""}`);
    out.push("");
  }
  writeFileSync(path.join(ROOT, "docs", "COPY-BY-GEMMA.md"), out.join("\n"));
});
