# Grass Pass evals: full results and history

Moved from the README on 2026-10-06 (no numbers changed). The README keeps the summary table.

Measured on 20 real parks (recorded live from OpenStreetMap and iNaturalist on Oct 5, 2026), age band 6-10,
with the real pass builder. Current numbers: [`evals/results/2026-10-06-4.md`](../evals/results/2026-10-06-4.md)
(what changed and why: [`2026-10-06-4-notes.md`](../evals/results/2026-10-06-4-notes.md)), one full run on Oct 6 after
audit round 3 (app commit `af39783`), not re-run. The earlier runs ([`2026-10-05.md`](../evals/results/2026-10-05.md),
[`-2`](../evals/results/2026-10-05-2.md), [`-3`](../evals/results/2026-10-05-3.md), [`-4`](../evals/results/2026-10-05-4.md),
[`2026-10-06.md`](../evals/results/2026-10-06.md), [`2026-10-06-2.md`](../evals/results/2026-10-06-2.md) and
[`2026-10-06-3.md`](../evals/results/2026-10-06-3.md)) are kept for comparison. No closed model was run (open models
only; the closed models on our DigitalOcean tier answered 403 on Oct 5). Find This Spot and Lucky Finds are not in
the eval (no map or SerpApi recordings for the test parks; SerpApi was switched off for the run).

| | Gemma 4 31B (3 runs) | Llama 4 Maverick (1 run) | No-AI template | Gemma, previous run (`2026-10-06-3`) | Gemma, first run |
|---|---|---|---|---|---|
| M1 Blocked taxa printed (target 0) | 0 | 0 | 0 | 0 | 0 |
| M2 Clues quoting their source word for word, before the filter (target 85%) | 99.4% | 98.9% | 100% (by construction) | 98.9% | 99.2% |
| M3 Passes with >= n-1 items (target 90%) | **98.0% (50/51)** | 82.4% (FAIL) | 88.2% (FAIL) | 90.2% | 64.7% |
| M4 Honest empty sections (target 100%) | 100% | 100% | 100% | 100% | 100% |
| M5 Reading level, FK grade median (target <= 3.5) | 2.5 | 2.5 | 3.7 (FAIL) | 1.7 | 2.3 |
| M6 Name leaks in clue or hint, before the filter (target <= 5%) | 3.7% (clue only 3.1%) | 9.8% (FAIL) | 1.4% | 2.0% | 17.5% |
| M7 Model call p50 / p95 (target 10 s / 20 s) | **10.0 s / 16.1 s, PASS** (p50 9.98 s; first calls alone 10.6 s) | 35.5 s / 59.4 s (FAIL) | none | 10.0 s / 20.5 s, FAIL (p50 10.04 s) | 13.8 s / 24.3 s |
| Median answer length (tokens, all calls / first calls) | 462 / 489 | 484 / 564 | none | 471 / 501 | 583 |
| M8 Cost per pass (target $0.001) | $0.00089 | $0.00149 (FAIL) | $0 | $0.00070 | $0.00086 |
| M10 Printed clues repeated across parks (target <= 5%) | **13.4% (54/404), FAIL** | 0% (0/118) | 24.0% (FAIL) | 6.8% (FAIL) | not measured |
| M11 Printed clues with a wrong count (target 0) | 0 of 136 (7 removed by the check) | 0 of 9 (8 removed) | 0 of 6 | 0 of 135 (11 removed) | not measured |

Errors in this run: none for Gemma (the run before had 3 timeouts and 1 HTTP 403); Llama 1 x MODEL_TIMEOUT (60 s).
DigitalOcean ran at about the same speed as the run before (the median Gemma call ran at 46 answer tokens/s; 47
before). Gemma needed a second call in 21 of its 60 runs (10 before), which raised its cost per pass and pulled its
per-call p50 down. Llama's M10 of 0% rests on fewer passes and is not comparable with Gemma's.

What got worse, and the likely reasons (suspects, details in the notes):
- **M10 repetition 6.8% -> 13.4%:** all of the rise is in Park Finds (43 of 277 repeat, 14 of 238 before), and 28 of
  those 43 hold a 5-word run copied from the code-written park facts. Gemma copies those facts about as often as
  before; the same phrases now landed on 3 parks instead of 1-2, which is exactly where M10 starts counting. More
  Park Finds were printed (277 vs 238), and copying is only a preference (most pools have no spare to swap in).
- **M5 reading grade 1.7 -> 2.5:** audit round 3 removed the short filler openers ("Quick!", "Wow!", "Psst,"), which
  made very short sentences. Still well under 3.5.
- **M6 name leaks 2.0% -> 3.7%:** round 3 widened what counts as a name word (Wikipedia's bolded other names), so more
  are counted; code still removes every one before printing.
- **M8 cost $0.00070 -> $0.00089:** twice as many second calls (the stricter checks remove more items: 55 generic
  clues vs 30) and a first prompt about 7% longer.
- **The no-AI template's M3 94.1% -> 88.2%:** it goes through the same, now stricter, checks; Spring Creek and Cedar
  Ridge ended 6 of 8.

What changed in audit round 3 (before this run): filler openers are removed and banned; "how many" questions that
answer themselves, sounds for silent things and repeated sentence frames are dropped; name-colour words ("white" for
White Morning-glory) are a preference, not a hard leak; at most 1 Lucky Find while a sure section is short; a
different voice for ages 10-13.

Ages 10-13, a small partial check on the same code ([`2026-10-06-partial-1218.md`](../evals/results/2026-10-06-partial-1218.md),
Gemma, Arbor Hills, White Rock Lake and Cedar Ridge, one run each, not the frozen numbers): 3 of 3 passes complete,
reading grade 4.8 (the aim for this band is grade 5-6), 9.1 s / 12.5 s per call, 12.5% name leaks before the checks
(all removed), and $0.00120 per pass, which is over the $0.001 mark (the 10-13 pass is longer).

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
fruit not seen this month (1 Gemma item in this run) and clues that say "map" on a pass with no map.

In run 2 (`2026-10-05-2`), 3 of 56 Gemma answers (all for one park) had the next JSON field stuck onto every quote; code
now cuts it off at the field name and keeps a quote only if the rest is really in the source (it did not happen in the
current run: 0 of 698 model quotes). The app's `/about` page shows the same numbers (`src/lib/about/eval-summary.ts`,
checked against the results JSON by a unit test).

