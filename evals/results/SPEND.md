# Eval spend ledger (DigitalOcean serverless inference)

Tokens are counted from each answer's `usage`; USD = tokens x the DO price list in evals/score.ts (prompt tokens at the full input price).

| Started (UTC) | Results | Model calls | Prompt tokens | Completion tokens | USD |
|---|---|---|---|---|---|
| 2026-10-05T23:52:49.321Z | 2026-10-05-partial-1852.md | 4 | 6427 | 2531 | $0.0031 |
| 2026-10-05T23:57Z (approx) | full run #1 ABORTED (no results file): FIXTURE_MISS bug in the replay, stopped by hand | 6 finished + 1 killed in flight | not saved | not saved | about $0.0038 measured before the stop (+ at most ~$0.001 for the killed call) |
| 2026-10-06T00:02:30.458Z | 2026-10-05.md | 82 | 198260 | 44759 | $0.0641 |
