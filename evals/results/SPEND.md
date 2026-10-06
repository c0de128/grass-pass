# Eval spend ledger (DigitalOcean serverless inference)

Tokens are counted from each answer's `usage`; USD = tokens x the DO price list in evals/score.ts (prompt tokens at the full input price).

| Started (UTC) | Results | Model calls | Prompt tokens | Completion tokens | USD |
|---|---|---|---|---|---|
| 2026-10-05T23:52:49.321Z | 2026-10-05-partial-1852.md | 4 | 6427 | 2531 | $0.0031 |
| 2026-10-05T23:57Z (approx) | full run #1 ABORTED (no results file): FIXTURE_MISS bug in the replay, stopped by hand | 6 finished + 1 killed in flight | not saved | not saved | about $0.0038 measured before the stop (+ at most ~$0.001 for the killed call) |
| 2026-10-06T00:02:30.458Z | 2026-10-05.md | 82 | 198260 | 44759 | $0.0641 |
| 2026-10-06T01:11:01.888Z | 2026-10-05-partial-2011.md | 5 | 10426 | 2706 | $0.0032 |
| 2026-10-06T01:12:54.083Z | 2026-10-05-partial-2012.md | 4 | 8241 | 2371 | $0.0027 |
| 2026-10-06T01:14:20.428Z | 2026-10-05-partial-2014.md | 4 | 8289 | 2444 | $0.0027 |
| 2026-10-06T01:15:24Z (approx) | S8b full run ABORTED (no results file): hung for 10+ min inside llama-4-maverick case 14 (no CPU use), stopped by hand after Gemma 3x20 and Llama 13 of 20 finished; harness now has a per-case guard | about 78 | not saved | not saved | $0.0394 measured before the stop (+ at most ~$0.001 for the hung call) |
| 2026-10-06T01:23Z | S8b re-recording of the two model fixtures in tests/fixtures (not an eval run) | 2 | about 3,400 | 1208 | about $0.0013 |
| 2026-10-06T01:36:22.211Z | 2026-10-05-2.md | 76 | 129455 | 39466 | $0.0484 |
