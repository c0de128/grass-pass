# Evals (SPEC 6.4)

How good are the passes, measured on 20 real parks, with real recorded park data and the real open models.

| Command | What it does | Network / cost |
|---|---|---|
| `pnpm eval:record` | Records the 20 parks LIVE with the app's own source code (Overpass park features, iNaturalist species in 1.5 km over the last 14 days, taxa summaries, and the season check's "Flowers and Fruits" counts for the plant candidates) into `tests/fixtures/evals/<park>.json`, each answer with its fetch time. Keeps existing files unless `EVAL_RECORD_FORCE=1`. Writes `tests/fixtures/evals/RECORDING-LOG.md`. | OpenStreetMap + iNaturalist (free, polite: one park at a time, the app's rate limits, a pause between parks) |
| `pnpm eval` | Runs the real pass builder (`src/lib/ai/build-pass.ts`) on the recorded parks with `gemma-4-31B-it` x 3 runs and `llama-4-maverick` x 1 run on DigitalOcean, plus the no-AI template baseline. Scores M1-M8, prints the table, writes `evals/results/<date>.md` + `.json` and appends `evals/results/SPEND.md`. | DigitalOcean serverless inference, about $0.06 for a full run; hard cap `EVAL_BUDGET_USD` (default $1) |
| `pnpm eval:check` | Free dry run: every recorded park through the real `buildPass`, twice and in two lanes like `pnpm eval`, with the model off. Fails on any request the fixtures cannot answer. Run it before a paid run. | none |
| `pnpm eval:report` | Re-renders the newest (or `EVAL_FROM=<file>.json`) results file. | none |

Settings (environment variables; the DO key is read from `.env.local` and never printed):

| Variable | Default | Meaning |
|---|---|---|
| `DO_INFERENCE_API_KEY` | from `.env.local` | Without it, only the template baseline runs and the report says so. |
| `EVAL_MODELS` | `gemma-4-31B-it,llama-4-maverick` | Comma list, or `none` for the template only. |
| `EVAL_RUNS` | per model (3 / 1) | Override runs per model (makes a partial run). |
| `EVAL_CASES` | all 20 | Comma list of case numbers (makes a partial run). |
| `EVAL_BUDGET_USD` | `1` | No new model call starts once measured spend reaches this. |

Partial runs are written as `<date>-partial-<HHMM>.md` and are never the frozen numbers.

## Files

- `cases.json`: the 20 parks, their OSM ids and every swap or surprise (`note`).
- `fixture.ts`: fixture format, recording fetch, replay fetch (a request that was not recorded fails and is listed; nothing is invented), and `loadCaseData` (pools + mix from a fixture using the app's code).
- `record.ts`: the live recorder. `run.ts`: the runner. `baseline.ts`: the no-AI template. `score.ts`: M1-M8. `report.ts`: Markdown and console tables.
- `results/`: dated results, `SPEND.md` (every run's tokens and dollars), `human-check.md` (M9, filled in by Kevin).

## What each metric means

See the "How each is measured" paragraph in any results file. Thresholds come from SPEC 6.4 and are written in `score.ts` (`THRESHOLDS`). Failing numbers are reported as FAIL; we do not re-run until it passes.

## The no-AI template baseline

Same pool, same mix limits, same server checks. Each clue is one real sentence with the name masked as `____`: the fixed description of a park feature, or the first sentence of a species' Wikipedia summary. It is grounded by construction, so it shows what the open model adds (reading level, variety, "look where" hints) and what it costs.
