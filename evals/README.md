# Evals (SPEC 6.4)

How good are the passes, measured on 20 real parks, with real recorded park data and the real open models.

| Command | What it does | Network / cost |
|---|---|---|
| `pnpm eval:record` | Records the 20 parks LIVE with the app's own source code (Overpass park features, iNaturalist species in 1.5 km over the last 14 days, taxa summaries, and the season check's "Flowers and Fruits" counts for the plant candidates) into `tests/fixtures/evals/<park>.json`, each answer with its fetch time. Keeps existing files unless `EVAL_RECORD_FORCE=1`. Writes `tests/fixtures/evals/RECORDING-LOG.md`. | OpenStreetMap + iNaturalist (free, polite: one park at a time, the app's rate limits, a pause between parks) |
| `pnpm eval` | Runs the real pass builder (`src/lib/ai/build-pass.ts`) on the recorded parks with `gemma-4-31B-it` x 3 runs and `llama-4-maverick` x 1 run on DigitalOcean, plus the no-AI template baseline. Scores M1-M8, M10 and M11, prints the table, writes `evals/results/<date>.md` + `.json` and appends `evals/results/SPEND.md`. | DigitalOcean serverless inference, about $0.07-0.09 for a full run (2026-10-06-8: $0.090); hard cap `EVAL_BUDGET_USD` (default $1) |
| `pnpm eval:check` | Free dry run: every recorded park through the real `buildPass`, twice and in two lanes like `pnpm eval`, with the model off. Fails on any request the fixtures cannot answer. Run it before a paid run. | none |
| `pnpm eval:report` | Re-renders the newest (or `EVAL_FROM=<file>.json`) results file. | none |
| `pnpm eval:replay` | Free replay (builder T, 2026-10-06): `EVAL_FROM=<file>.json` runs today's real `buildPass` on that run's recorded parks and answers each model call with the raw answer the run recorded, in order (virtual clock with the recorded latencies; a recorded timeout or HTTP error is replayed as one). A call today's code makes that the run never made (a second refill, a retry after a timeout) gets no invented answer: it keeps nothing and is listed, so the replayed M3 is a lower bound. Prints M3, M5, M6, M10, M11 and the drops. `EVAL_REPLAY_MODELS` (default `gemma-4-31B-it`; `no-AI template` re-runs the template), `EVAL_REPLAY_OUT=<path>` writes the details. Changed fact-sheet words make old quotes fail grounding, so replays after a fact change under-count. | none |

Settings (environment variables; the DO key is read from `.env.local` and never printed):

| Variable | Default | Meaning |
|---|---|---|
| `DO_INFERENCE_API_KEY` | from `.env.local` | Without it, only the template baseline runs and the report says so. |
| `EVAL_MODELS` | `gemma-4-31B-it,llama-4-maverick` | Comma list, or `none` for the template only. |
| `EVAL_RUNS` | per model (3 / 1) | Override runs per model (makes a partial run). |
| `EVAL_CASES` | all 20 | Comma list of case numbers (makes a partial run). |
| `EVAL_BUDGET_USD` | `1` | No new model call starts once measured spend reaches this. |
| `EVAL_LOCAL_BASE_URL` | `http://localhost:11434/v1` | Where the self-hosted lane (`EVAL_MODELS=gemma4-e2b-8k`) finds Ollama. Plain http only for localhost / 127.0.0.1. |
| `EVAL_LOCAL_PATIENT` | off | `1` = self-hosted lanes get a longer, eval-only clock (calls up to 270 s, refills 180 s, pass 600 s) instead of the app's 70 s / 20 s / 85 s. Results are named `<date>-selfhost-patient-<HHMM>`. |

### Self-hosted lane (2026-10-06)

`EVAL_MODELS=gemma4-e2b-8k` runs the same pass builder against a local Ollama (no key, $0, never in the default list):
Gemma 4 E2B (`ollama pull gemma4:e2b-it-qat`, Apache-2.0) re-tagged with an 8,192-token context by
`ollama create gemma4-e2b-8k -f evals/selfhost/Modelfile`, thinking off (`MODEL_REASONING_EFFORT=none`). Results are
named `<date>-selfhost-<HHMM>`. Measured numbers and the exact commands: `results/2026-10-06-selfhost-notes.md`.

Partial runs are written as `<date>-partial-<HHMM>.md` and are never the frozen numbers.

## Files

- `cases.json`: the 20 parks, their OSM ids and every swap or surprise (`note`).
- `fixture.ts`: fixture format, recording fetch, replay fetch (a request that was not recorded fails and is listed; nothing is invented), and `loadCaseData` (pools + mix from a fixture using the app's code).
- `record.ts`: the live recorder. `run.ts`: the runner. `baseline.ts`: the no-AI template. `score.ts`: M1-M8 (since run 2026-10-06-8, M1 judges each printed Wild Find by its iNaturalist taxon id and ancestors with the current blocklist, and `sound` counts passes with a listening clue and a water-by-ear clue, judge C4), plus M10 (cross-park repetition: printed clues with a 5-word run also printed on 2+ other parks' passes, target 5% or less) and M11 (printed clues with a wrong count, target 0), added for audit R2-M5 (`results/2026-10-06-r2-notes.md`), and (content tuning, `results/2026-10-06-3-notes.md`) why the checks removed items: every call's raw answer replayed through the app's `validateDraft` with the same request plan, refills included (`dropReasons`; also listed for the data-rich runs that ended incomplete). `report.ts`: Markdown and console tables. The no-AI template is exempt from two style checks only: the source-copy check (it copies source sentences by design) and, since run 2026-10-06-5, the repeated-opening drop (every masked sentence opens "____ is a ...": that drop became hard in audit round 4 and cut the template's M3 from 88.2% to 17.6% with no change in data; a free replay with the exemption gives 76.5%).
- `results/`: dated results, `SPEND.md` (every run's tokens and dollars), `human-check.md` (M9, filled in by Kevin).

## What each metric means

See the "How each is measured" paragraph in any results file. Thresholds come from SPEC 6.4 and are written in `score.ts` (`THRESHOLDS`). Failing numbers are reported as FAIL; we do not re-run until it passes.

## The no-AI template baseline

Same pool, same mix limits, same server checks. Each clue is one real sentence with the name masked as `____`: the fixed description of a park feature, or the first sentence of a species' Wikipedia summary. It is grounded by construction, so it shows what the open model adds (reading level, variety, "look where" hints) and what it costs.
