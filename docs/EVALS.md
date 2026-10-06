# Grass Pass evals: full results and history

Moved from the README on 2026-10-06 (no numbers changed). The README keeps the summary table.

Measured on 20 real parks (recorded live from OpenStreetMap and iNaturalist on Oct 5, 2026), age band 6-10,
with the real pass builder. Current numbers: [`evals/results/2026-10-06-6.md`](../evals/results/2026-10-06-6.md)
(what changed and why: [`2026-10-06-6-notes.md`](../evals/results/2026-10-06-6-notes.md)), one full run on Oct 6 after
the completeness work (app commit `b5a862b`), not re-run. The earlier runs ([`2026-10-05.md`](../evals/results/2026-10-05.md),
[`-2`](../evals/results/2026-10-05-2.md), [`-3`](../evals/results/2026-10-05-3.md), [`-4`](../evals/results/2026-10-05-4.md),
[`2026-10-06.md`](../evals/results/2026-10-06.md), [`2026-10-06-2.md`](../evals/results/2026-10-06-2.md),
[`2026-10-06-3.md`](../evals/results/2026-10-06-3.md), [`2026-10-06-4.md`](../evals/results/2026-10-06-4.md) and
[`2026-10-06-5.md`](../evals/results/2026-10-06-5.md)) are kept for comparison. No closed model was run (open models only; the closed models on our DigitalOcean tier answered 403 on
Oct 5). Find This Spot and Lucky Finds are not in the eval (no map or SerpApi recordings for the test parks; SerpApi
was switched off for the run).

| | Gemma 4 31B (3 runs) | Llama 4 Maverick (1 run) | No-AI template | Gemma, previous run (`2026-10-06-5`) | Gemma, first run |
|---|---|---|---|---|---|
| M1 Blocked taxa printed (target 0) | 0 | 0 | 0 | 0 | 0 |
| M2 Clues quoting their source word for word, before the filter (target 85%) | 99.6% | 98.6% | 100% (by construction) | 98.6% | 99.2% |
| M3 Passes with >= n-1 items (target 90%) | **94.1% (48/51), PASS** | 41.2% (FAIL) | 76.5% (FAIL) | 84.3% (FAIL) | 64.7% |
| M4 Honest empty sections (target 100%) | 100% | 100% | 100% | 100% | 100% |
| M5 Reading level, FK grade median (target <= 3.5) | 2.5 | 2.3 | 3.8 (FAIL) | 2.3 | 2.3 |
| M6 Name leaks in clue or hint, before the filter (target <= 5%) | 2.6% (clue only 2.2%) | 16.7% (FAIL) | 1.4% | 4.5% | 17.5% |
| M7 Model call p50 / p95 (target 10 s / 20 s) | **12.0 s / 22.7 s, FAIL** (p50 12.04 s; first calls alone 13.2 s) | 25.3 s / 60.0 s (FAIL) | none | 12.3 s / 23.8 s (FAIL) | 13.8 s / 24.3 s |
| Median answer tokens/s (provider speed) | 36.8 | 17.7 | none | 34.3 | not measured |
| M8 Cost per pass (target $0.001) | $0.00097 | $0.00119 (FAIL) | $0 | $0.00089 | $0.00086 |
| M10 Printed clues repeated across parks (target <= 5%) | **5.1% (20/395), FAIL** | 3.8% (3/80) | 24.4% (FAIL) | 9.6% (FAIL) | not measured |
| M11 Printed clues with a wrong count (target 0) | 0 of 96 (12 removed by the check) | 0 of 11 (12 removed) | 0 of 6 | 0 of 81 (13 removed) | not measured |

Errors in this run: **no Gemma pass was lost.** 3 Gemma first calls failed (2 at the 30 s limit, 1 HTTP 403) and each
got the new whole retry; all 3 passes finished complete (7/8). Gemma made 80 calls for 60 passes: 33 passes used 1
call, 16 used 2, 5 used 3 (6 no-data parks made none). Llama: 4 passes lost to its 60 s limit, and 6 of its refills hit
the new 20 s refill limit (at about 17.7 tokens/s a 300-token refill does not fit); its M6 rose to 16.7%.

What changed since run `-5`, and why (details in the notes):
- **M3 84.3% -> 94.1% (now PASS):** the completeness work (whole retry after a failed first call, refills with 2 spares,
  a second refill, drop false positives fixed). The 3 misses: Connemara Meadow r1 and r2, Klyde Warren r3, the parks
  with the least describable data; each made a first call and 2 refills.
- **M10 9.6% -> 5.1% (still FAIL, by about one clue):** "Where can you hear water" and the "Count the 2 of them."
  trailer no longer repeat; "Somewhere you will see a" still opens clues on 5 parks despite the prompt ban, "for a bird
  that is" on 4, and the Osage-orange's Wikipedia text on 3.
- **M7 12.3 s / 23.8 s -> 12.0 s / 22.7 s (still FAIL):** provider at 36.8 answer tokens/s (34.3 before, 46.2 in run
  `-4`); prompts about 7% longer (median 2,946 tokens vs 2,763). Per-pass wall time p50 14.5 s, slowest 48.9 s.
- **M8 $0.00089 -> $0.00097 (PASS, closer to the mark):** more passes make 2-3 calls, prompts longer.
- **M6 4.5% -> 2.6%**, M2 98.6% -> 99.6%, M5 2.3 -> 2.5.
- **No-AI template M3 17.6% -> 76.5%:** it is now exempt from the repeated-opening drop (see `evals/README.md`).

Builder T's free replay of run `-5` had predicted M3 about 94-96%, M10 about 5.1%, cost about $0.00095-0.00108 per
pass, template M3 76.5%: all four held (M3 at the low end).

Ages 10-13, a small partial check on the same code ([`2026-10-06-partial-1621.md`](../evals/results/2026-10-06-partial-1621.md),
Gemma, Arbor Hills, White Rock Lake and Cedar Ridge, one run each, the same parks as `partial-1439`, not re-run):
**3 of 3 passes complete** (Arbor Hills 8/8 in 2 calls, White Rock 7/8 and Cedar Ridge 7/8 in 1 call each; before: 1 of
3), 4 calls, reading grade 3.8 (aim 5-6; 3.1 before), 14.5 s / 25.7 s per call, 3.4% name leaks before the checks
(removed), **$0.00107 per pass, over the $0.001 mark** ($0.00123 per finished pass before).

## Run `2026-10-06-5` (previous, kept for history)

| | Gemma 4 31B (3 runs) | Llama 4 Maverick (1 run) | No-AI template | Gemma, previous run (`2026-10-06-4`) | Gemma, first run |
|---|---|---|---|---|---|
| M1 Blocked taxa printed (target 0) | 0 | 0 | 0 | 0 | 0 |
| M2 Clues quoting their source word for word, before the filter (target 85%) | 98.6% | 98.5% | 100% (by construction) | 99.4% | 99.2% |
| M3 Passes with >= n-1 items (target 90%) | **84.3% (43/51), FAIL** | 29.4% (FAIL) | 17.6% (FAIL) | 98.0% | 64.7% |
| M4 Honest empty sections (target 100%) | 100% | 100% | 100% | 100% | 100% |
| M5 Reading level, FK grade median (target <= 3.5) | 2.3 | 2.3 | 3.6 (FAIL) | 2.5 | 2.3 |
| M6 Name leaks in clue or hint, before the filter (target <= 5%) | 4.5% (clue only 4.3%) | 6.2% (FAIL) | 1.4% | 3.7% | 17.5% |
| M7 Model call p50 / p95 (target 10 s / 20 s) | **12.3 s / 23.8 s, FAIL** (p50 12.29 s; first calls alone 13.7 s) | 60.0 s / 60.0 s (FAIL) | none | 10.0 s / 16.1 s, PASS (p50 9.98 s) | 13.8 s / 24.3 s |
| Median answer length (tokens, all calls / first calls) | 445 / 476 | 489 / 526 | none | 462 / 489 | 583 |
| M8 Cost per pass (target $0.001) | $0.00089 | $0.00054 (see below) | $0 | $0.00089 | $0.00086 |
| M10 Printed clues repeated across parks (target <= 5%) | **9.6% (36/374), FAIL** | 0% (0/51) | 18.2% (FAIL) | 13.4% (FAIL) | not measured |
| M11 Printed clues with a wrong count (target 0) | 0 of 81 (13 removed by the check) | 0 of 5 (1 removed) | 0 of 6 | 0 of 136 (7 removed) | not measured |

Errors in this run: Gemma 1 x MODEL_PROVIDER (HTTP 403 on a first call, Bob Woodruff run 3) and 1 refill call that hit
the 30 s limit (White Rock run 3, which kept 5 of 8); Llama 11 x MODEL_TIMEOUT (60 s) out of 18 first calls. **The
provider was slower than in the run before:** the median answered Gemma call ran at 34.3 answer tokens/s (46.2
before), Llama at 10.6 (12.7). Gemma needed a second call in 22 of its 60 runs (21 before). Llama's cost per pass
($0.00054) is low only because a timed-out call bills no tokens while its pass still counts; its M10 of 0% rests on
few passes and is not comparable with Gemma's.

What changed since the previous run, and the likely reasons (suspects, details in the notes):
- **M3 complete passes 98.0% -> 84.3% (now FAIL):** 7 passes ended 2-3 finds short after their second try and 1
  first call failed (HTTP 403). The audit-round-4 checks remove more per call (name_leak 15 -> 23, wrong_count 4 ->
  12, broken_count 0 -> 6, repeats_opening 2 -> 8 as a hard drop), and a refill asks only for the missing items + 1
  spare, so it cannot catch up when it loses 2 more. 6 of the 8 misses are in Gemma's third run, together with the
  provider error and the refill timeout.
- **M7 speed 10.0 s / 16.1 s -> 12.3 s / 23.8 s (now FAIL):** mostly the provider (34.3 vs 46.2 answer tokens/s;
  answers were not longer: first-call median 476 tokens vs 489). First calls alone: 13.7 s / 24.0 s.
- **M10 repetition 13.4% -> 9.6% (better, still FAIL):** the fact phrases that repeated in run -4 are gone (fact
  word choices worked), but 21 of the 36 repeated clues now share their FIRST 5 words: Gemma's own clue frames
  ("Somewhere you will see a" on 6 parks, "Where can you hear water" 4, "Where can you find a" 3, "Hunt for a tree
  with" 3) and a "Count the 2 of them." ending (4). Builder R2's offline replay had predicted about 3-4%; it could
  not see new frames. Still repeating facts: the playground fact "kids climb steps and ladders to reach the top" and
  the Osage-orange Wikipedia text.
- **M6 name leaks 3.7% -> 4.5%:** round 4 counts more kinds of leak (name phrases, a Wild Find clue about its own
  name). Code removes every one. Close to the 5% mark.
- **M5 2.5 -> 2.3, M8 unchanged at $0.00089.**
- **No-AI template M3 88.2% -> 17.6%:** repeated openings became a hard drop, and the template's masked Wikipedia
  sentences ("____ is a species of ...") open alike (replayed offline: repeats_opening 28, cut_off 7, name_leak 4 of
  its drops). A measurement effect of the new check on the baseline, not on shipped passes.

What changed in audit round 4 (before this run): a new clue voice (no "Explore/Wander" opener bank, no "I and my"
riddle voice), name phrases and a Wild Find clue about its own name count as leaks, more word choices for the park
facts (M10), a repeated opening and a broken count are hard drops, harder finds for ages 10-13.

Ages 10-13, a small partial check on the same code ([`2026-10-06-partial-1439.md`](../evals/results/2026-10-06-partial-1439.md),
Gemma, Arbor Hills, White Rock Lake and Cedar Ridge, one run each, not the frozen numbers, not re-run): **only 1 of 3
passes complete** (Arbor Hills 7/8, White Rock 6/8 after a refill, Cedar Ridge's call hit the 30 s limit), reading
grade 3.1 (the aim for this band is grade 5-6; 4.8 in the smoke before), 13.4 s / 27.6 s per call, 5.0% name leaks
before the checks (removed), and about $0.00123 per finished pass, over the $0.001 mark (the scorer shows $0.00082
because it divides by all 3 cases, including the one that timed out).

What changed in audit round 3 (run `2026-10-06-4`), still in the code: filler openers are removed and banned; "how
many" questions that answer themselves, sounds for silent things and repeated sentence frames are dropped;
name-colour words ("white" for White Morning-glory) are a preference, not a hard leak; at most 1 Lucky Find while a
sure section is short; a different voice for ages 10-13.

What changed in the content tuning (run `2026-10-06-3`), still in the code:
- **Drop reasons are measured.** Every results file now lists, per model, why the checks removed items, replayed with
  the app's own `validateDraft` (`evals/score.ts` `dropReasons`). On the previous run this showed that 6 of its 7
  incomplete passes were on the 3 parks with the least data (the 7th was a timeout), and their items were lost to
  generic plant clues and repeated ids.
- **Spares scaled to the pool:** a low-data pool (fewer describable items than n + 2) asks for 1 spare item; other
  pools ask for exactly n (each spare is about 57 answer tokens, about 1 s). Wild Finds count as describable only when
  their summary says how they look outside their own names ("Black-and-white Warbler ... a species of New World
  warbler" does not).
- **The one retry is a refill:** it asks only for the missing items (+1 spare) from items the first answer did not
  fill (so ids can't repeat), skips items whose clue already failed when it can, and tells the model which phrases it
  copied. Refill calls took 3.9 s (median) against 10.5 s for first calls. When nothing was kept, the retry is the
  whole request again.
- **Clue variety (M10):** each park gets its own first words for its clues (the "playful dares" voice, which wrote "I
  dare you to find" 16 times, is gone, and the prompt bans "Can you find", "Find a", "a place with" ...); the Park
  Finds facts now vary their words per park (`{roof|cover} {on|held up by} {posts|poles|pillars}`), because Gemma
  copies fact phrases into about half of its Park Find clues even when told not to. A clue that copies a 4-word run of
  its own source, starts with a stock opening or repeats another clue's first words is the first to go when a spare
  can replace it (a preference, never a hard drop: as a hard drop it cost completeness in a smoke run).
- **Low-data pools:** only style checks change (near-repeats become a preference; a Wild Find clue whose describing
  word is in its own quote passes the generic check). Safety, grounding, name leaks, numbers and counts are never
  relaxed.
- **Checks:** a clue cut off mid-sentence ("Hunt for a ", seen 4 times in one smoke answer) is dropped; the generic
  check matches the child's words to the source by word ending too ("wades" ~ "wading").

M10 and M11 were added in audit round 2 (`evals/score.ts`). `validate.ts` still drops plant clues about flowers or
fruit not seen this month (3 Gemma items in this run) and clues that say "map" on a pass with no map.

In run 2 (`2026-10-05-2`), 3 of 56 Gemma answers (all for one park) had the next JSON field stuck onto every quote; code
now cuts it off at the field name and keeps a quote only if the rest is really in the source (it did not happen in the
current run: 0 of 577 model quotes). The app's `/about` page shows the same numbers (`src/lib/about/eval-summary.ts`,
checked against the results JSON by a unit test).

