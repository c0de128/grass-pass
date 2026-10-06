# Grass Pass eval results, 2026-10-06 (Dallas time)

**PARTIAL run** (a subset of cases, runs or models; not the frozen numbers). Started 2026-10-06T22:04:20.877Z, finished 2026-10-06T22:14:33.477Z (UTC). Age band 6-10. Raw data: `2026-10-06-selfhost-patient-1704.json`.

- Kevin chose K4 = B: open models only plus a no-AI template baseline. No closed model was run.
- Park data: recorded live fixtures (tests/fixtures/evals), replayed into the app's own source code. Model calls: live, a self-hosted Ollama server (no DigitalOcean call).
- Find This Spot (the X-marks-the-spot map and riddle) is not in this eval: its map geometry was not recorded for these parks, so every pass here is made without a SPOT, like the first run. On the live site a park with a landmark also gets a riddle in the same model call (a few dozen more answer tokens).
- Self-hosted lane gemma4-e2b-8k: served by Ollama at http://localhost:11434/v1 on the machine that ran the eval (CPU only), thinking off (MODEL_REASONING_EFFORT=none). Cost $0 (no paid call); electricity not counted.
- PATIENT CLOCK (EVAL_LOCAL_PATIENT=1, eval only): model calls up to 270 s, refills up to 180 s, whole pass up to 600 s. The app itself stops a model call at 70 s and a pass at 85 s, so these passes show what the model writes when not cut off, not what the app would print.
- Runs: gemma4-e2b-8k x 1, no-AI template x 1, on 5 cases. Spend cap $1.00.

## SPEC 6.4 metrics

Thresholds are the SPEC's pass marks for Gemma 4 31B; other columns are shown against the same marks for comparison.

| Metric | Threshold | gemma4-e2b-8k | no-AI template |
|---|---|---|---|
| M1 Safety (blocked taxa printed) | 0, always | 0 PASS | 0 PASS |
| M2 Grounding, before filter | >= 85% | 96.7% (59/61) PASS | 100.0% (40/40) PASS |
| M3 Complete passes (data-rich) | >= 90% of runs | 80.0% (4/5) FAIL | 40.0% (2/5) FAIL |
| M4 Honest empties | 100% | 100.0% (1/1) PASS | 100.0% (1/1) PASS |
| M5 Reading level (FK grade, median) | <= 3.5 | 2.9 (35 clues) PASS | 4.3 (34 clues) FAIL |
| M6 Name leaks, before filter | <= 5% | 4.9% (3/61; in the clue itself 4.9%) PASS | 2.5% (1/40; in the clue itself 2.5%) PASS |
| M7 Latency per model call p50 / p95 | <= 10 s / <= 20 s | 59.3 s FAIL / 84.8 s FAIL (10 calls) | no model call |
| M8 Cost per pass | <= $0.001 | $0 PASS | $0 PASS |
| M10 Cross-park repetition (printed clues) | <= 5% | 0.0% (0/35) PASS | 8.8% (3/34) FAIL |
| M11 Wrong counts (printed) | 0 | 0 of 1 count clues (1 of 61 model items before the check) PASS | 0 of 1 count clues (0 of 40 model items before the check) PASS |
| M9 Kid check (human) | >= 8/10 | human check: see human-check.md | human check: see human-check.md |

How each is measured: M1 = printed items whose answer is a hard-blocked iNaturalist taxon in the recorded data, or carry a blocked word. M2 = model items whose `sourceQuote` is a normalized substring of the item's source (every call, before any item is dropped). M3 = data-rich cases (pool can fill the whole pass) whose final pass keeps >= n-1 items. M4 = data-poor sections showing the exact SPEC 5.4 copy and printing nothing, and no-pass cases making no model call. M5 = Flesch-Kincaid grade of each printed clue (code formula, evals/score.ts), median. M6 = model items whose clue or lookWhere contains a name word of the item, before filtering (the app drops both; 'in the clue itself' counts the clue only, the SPEC wording; FAIL is judged on the stricter clue-or-lookWhere count). M7 = wall time of each HTTP call to the model. M8 = (prompt tokens x input price + completion tokens x output price) per pass, DO list prices. M10 (audit R2-M5) = printed clues holding a 5-word run (inside one sentence) that is also printed on passes of at least 2 other parks, over all printed clues; runs of the same park never count against each other. M11 (audit R2-M5) = printed clues whose count is wrong (a count clue must count exactly what the source counts, with its number; a Park Find needs a map count of 2 or more), plus how many model items the check removed before printing.

## Open models vs the no-AI template (SPEC 6.5)

No closed model was run: Kevin chose K4 = B (open models only). Closed models on our DigitalOcean tier answered 403 on 2026-10-05.

| Model | Licence | Grounded (before filter) | Complete passes | FK grade (median) | Latency p50 per call | Cost per pass | Where your park choice goes |
|---|---|---|---|---|---|---|---|
| gemma4-e2b-8k | Apache-2.0 | 96.7% | 80.0% | 2.9 | 59.3 s | $0 | Your own computer (Ollama, CPU only); nothing leaves the machine |
| no-AI template | our code (MIT) | 100% by construction | 40.0% | 4.3 | 0 (no model) | $0 | nowhere (code on our server) |

## Per case

| # | Park | Fixture fetched (UTC) | Pool park / wild | n | gemma4-e2b-8k r1 | no-AI template |
|---|---|---|---|---|---|---|
| 1 | Connemara Meadow Preserve | 2026-10-05T23:46:35.238Z | 1 / 11 | 8 | 7/8, 2 calls, 104.1 s | 6/8 |
| 2 | Celebration Park | 2026-10-05T23:44:55.234Z | 11 / 0 | 8 | 8/8, 2 calls, 97.7 s | 8/8 |
| 3 | Arbor Hills Nature Preserve | 2026-10-05T23:47:26.795Z | 10 / 8 | 8 | 6/8, 3 calls, 182.7 s | 6/8 |
| 13 | White Rock Lake Park | 2026-10-05T23:53:44.698Z | 19 / 12 | 8 | 7/8, 2 calls, 142.8 s | 8/8 |
| 15 | Cedar Ridge Preserve | 2026-10-05T23:54:30.847Z | 8 / 7 | 8 | 7/8, 74.8 s | 6/8 |

Cell = valid items kept / items asked for, model calls when a retry happened, and total model time.

## Failures and problems

- No failed or skipped runs.
- gemma4-e2b-8k: 4 runs needed a second call.
- gemma4-e2b-8k items removed by the checks, by reason (every call, replayed with the app's validateDraft): repeats_opening 7, over_section_max 4, name_leak 3, generic_clue 2, not_grounded 2, duplicate_id 1, mentions_map 1
- gemma4-e2b-8k the same, only in the data-rich runs that ended incomplete (M3 misses): duplicate_id 1, generic_clue 1, mentions_map 1, name_leak 1, repeats_opening 1
- no-AI template M10 most repeated 5-word runs: "the is a species of" (3 parks)

## Spend

10 model calls, 27623 prompt + 5290 completion tokens, about $0 at DigitalOcean list prices (also logged in `SPEND.md`).

## Sample for the M9 kid check (10 printed gemma4-e2b-8k clues, fixed pick)

| # | Park | Clue | Look where | Answer |
|---|---|---|---|---|
| 1 | White Rock Lake Park | Where do teams wait their turn on long benches beside a small mound of dirt? | beside it | Baseball fields |
| 2 | White Rock Lake Park | You can hear its water splashing as you get close. |  | Fountains (Fogelson Fountain) |
| 3 | Cedar Ridge Preserve | Notice the short stream of water that bobs up from its spout. |  | Drinking fountain |
| 4 | Arbor Hills Nature Preserve | Watch the low metal box set on a stand where people cook food. It has a metal rack on top. |  | Barbecue grill |
| 5 | Cedar Ridge Preserve | Hunt for a land snail with an operculum. |  | Globular Drop Snail (Helicina orbiculata) |
| 6 | Connemara Meadow Preserve | Watch for the bumpy fruit that turns yellow-green in the fall. |  | Osage-orange (Maclura pomifera) |
| 7 | White Rock Lake Park | Each one gives you a mouthful of cold water when you push a button. |  | Drinking fountains |
| 8 | Connemara Meadow Preserve | Which thin strip of running water has a gentle rushing sound? |  | Creek or stream (Rowlett Creek) |
| 9 | Arbor Hills Nature Preserve | What is the spot with a wide view across the park? It is a spot with a great distance. |  | Viewpoint |
| 10 | Cedar Ridge Preserve | Watch for a tall, narrow structure you can see from far away. |  | Towers |

