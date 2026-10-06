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
| 2026-10-06T02:10:52.435Z | 2026-10-05-partial-2110.md | 6 | 12049 | 2741 | $0.0035 |
| 2026-10-06T02:12Z | S8c re-recording of the two model fixtures in tests/fixtures (not an eval run) | 2 | 2829 | 947 | $0.0010 |
| 2026-10-06T02:15:33.541Z | 2026-10-05-3.md | 73 | 133550 | 32579 | $0.0457 |

S8c total (builder, 2026-10-05 CDT): smoke $0.0035 + fixture re-recording $0.0010 + full run $0.0457 = **$0.0502** (cap $0.12).
| 2026-10-06T03:19Z + 03:20Z | Audit R1 (Builder B) re-recording of the two model fixtures in tests/fixtures, twice (prompt changed between them; not an eval run) | 4 | 6333 | 1994 | $0.0021 |
| 2026-10-06T03:37:10.582Z | 2026-10-05-partial-2237.md | 6 | 11715 | 2272 | $0.0032 |
| 2026-10-06T03:39:04.451Z | 2026-10-05-4.md | 87 | 166294 | 36215 | $0.0552 |

Audit round 1 total (Builder B, 2026-10-05 CDT): fixture re-recordings $0.0021 + smoke $0.0032 + full run $0.0552 = **$0.0605** (cap $0.10).
| 2026-10-06T04:41Z | Audit R1 follow-up (Builder E) re-recording of the two model fixtures in tests/fixtures (not an eval run) | 2 | 3577 | 989 | $0.0011 |
| 2026-10-06T05:07:55.192Z | 2026-10-06-partial-0007.md | 14 | 30951 | 6091 | $0.0114 |
| 2026-10-06T05:13:16.346Z | 2026-10-06.md | 78 | 179143 | 35965 | $0.0581 |

Audit round 1 follow-up total (Builder E, 2026-10-05/06 CDT): fixture re-recording $0.0011 + smoke $0.0114 + full run $0.0581 = **$0.0706** (cap $0.10).
| 2026-10-06T06:20:30.048Z | 2026-10-06-partial-0120.md | 11 | 28510 | 5123 | $0.0077 |
| 2026-10-06T06:25:23.952Z | 2026-10-06-partial-0125.md | 10 | 25546 | 4760 | $0.0070 |
| 2026-10-06T06:10Z-07:00Z | Audit R2 (Builder H) re-recordings of the two model fixtures in tests/fixtures while the R2-M5 prompt changed (not an eval run): 23 answered calls counted from `usage` (50,251 prompt + 11,519 completion tokens), plus 4 calls that timed out at 30 s (tokens unknown; at most about $0.0027 if each was billed in full) | 23 | 50251 | 11519 | $0.0148 |
| 2026-10-06T06:57Z | **Aborted** full run (Builder H): DigitalOcean was about 3x slower than earlier that night (Gemma 18-30 s per call, 10 of the first 22 Gemma calls timed out at 30 s; a 150-word probe ran at about 15 tokens/s vs about 50 earlier), so the numbers would have measured the provider, not the change. Stopped after Gemma run 2 case 2; no results file. Spend meter at the stop (answered calls only) | ~35 | n/a | n/a | $0.0206 |

| 2026-10-06T07:20:54.740Z | 2026-10-06-partial-0220.md | 7 | 12514 | 2596 | $0.0036 |

Audit round 2 (Builder H, 2026-10-06 CDT) total: fixture re-recordings $0.0148 (+ up to about $0.0027 for 4 timed-out calls) + smoke 0120 $0.0077 + smoke 0125 $0.0070 + aborted full run $0.0206 (+ its 10 timed-out calls, tokens unknown) + final-code smoke 0220 $0.0036 = **$0.0537** measured (cap $0.10; with the unknown timed-out calls at most about $0.065). No full run was completed: one would cost about $0.065-0.075 and does not fit in what is left of the cap.
| 2026-10-06T09:44Z | Post-R2 eval sync (builder): 2 speed probes through callModel (not an eval run) | 2 | 66 | 76 | $0.0001 |
| 2026-10-06T09:45Z | Post-R2 eval sync: re-recording of the Celebration model fixture in tests/fixtures (not an eval run). 2 answered calls; the first answer was discarded (recorder script crashed on a log line after the call, usage not saved; assumed the same size as the second) | 2 | about 3448 | about 1182 | about $0.0012 |
| 2026-10-06T09:53:42.263Z | 2026-10-06-2.md | 92 | 184630 | 42692 | $0.0612 |

Post-R2 eval sync total (builder, 2026-10-06 CDT): probes $0.0001 + fixture re-recording about $0.0012 + full run $0.0612 = **about $0.0625** (cap $0.10).
