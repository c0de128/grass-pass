# Test fixtures

Every file here is a **real recording** of a live API answer, labelled with `_recording` (what, when, where).
They are used only by tests and never imported by app code.

| File | What | Recorded |
|---|---|---|
| `do-gemma-4-31b-it-celebration-two-items.json` | One real `gemma-4-31B-it` chat completion from DigitalOcean serverless inference (strict `json_schema`), asked for 2 clues from 3 real OpenStreetMap facts about Celebration Park, Allen TX. No key or auth header is stored. | 2026-10-05 22:19 UTC, 2.1 s |
| `nominatim-allen-tx.json`, `nominatim-connemara-meadow-preserve.json`, `nominatim-celebration-park-allen-tx.json`, `nominatim-no-match.json` | Real Nominatim `format=jsonv2` searches made by `src/lib/sources/nominatim.ts` with the GrassPass User-Agent. | 2026-10-05 22:35-22:37 UTC (exact time in each file) |
| `overpass-parks-allen-tx.json`, `overpass-parks-connemara-meadow-preserve.json`, `overpass-parks-celebration-park-allen-tx.json` | Real Overpass answers to `parksQuery()` (named parks/nature reserves within 5 km) around each Nominatim point, made by `src/lib/sources/overpass.ts`. | 2026-10-05 22:35-22:37 UTC |
| `overpass-parks-empty-west-texas.json` | Real empty Overpass answer for 31.00,-103.00 (open desert, Pecos County TX). | 2026-10-05 UTC (time in file) |
| `overpass-504-too-busy.json` | Real Overpass HTTP 504 HTML page ("server is probably too busy"), captured to test failover. | 2026-10-05 22:30 UTC |
| `overpass-features-connemara-meadow-preserve.json`, `overpass-features-celebration-park.json` | Real Overpass answers to `featuresQuery()` (the park + what is mapped inside it) for way/306191453 and way/188145317. | 2026-10-05 23:14-23:19 UTC |
| `inat-species-connemara-meadow-preserve.json`, `inat-species-celebration-park.json` | Real iNaturalist `observations/species_counts` (research grade, 1.5 km, since 2026-09-21) around each park centre. Connemara: 79 species; Celebration: 0. | 2026-10-05 23:14-23:19 UTC |
| `inat-taxa-connemara-meadow-preserve.json` | Real iNaturalist `taxa/<24 ids>` answer (Wikipedia summaries + ancestor ids) for the Connemara Wild Finds candidates. | 2026-10-05 23:19 UTC |
| `inat-taxa-planted-dangers.json` | Real iNaturalist taxa for the SPEC 6.4 planted safety cases: Eastern Copperhead, Brown Recluse, eastern poison ivy, Red Imported Fire Ant, American pokeweed. | 2026-10-05 UTC (time in file) |
| `inat-monarch-histogram-connemara-meadow-preserve.json`, `inat-monarch-histogram-celebration-park.json` | Real iNaturalist `observations/histogram` (interval=day, verifiable) of Monarch (taxon 48662) observations within 25 km of each park, 2025-09-21..2026-10-05 (`monarchHistogramUrl()`). Connemara: 9 since Sep 21 vs 63 in the same days of 2025; Celebration: 9 vs 56. Full body, untrimmed. | 2026-10-05 23:39 UTC (exact time in each file) |
| `inat-milkweed-count-connemara-meadow-preserve.json`, `inat-milkweed-count-celebration-park.json` | Real iNaturalist `observations?per_page=0` totals of verifiable milkweed (genus 47906) within 1.5 km of each park, all years (`milkweedCountUrl()`). Connemara 199, Celebration 7. | 2026-10-05 23:39 UTC |
| `overpass-geometry-connemara-meadow-preserve.json`, `overpass-geometry-celebration-park.json` | Real Overpass answers to `geometryQuery()` (S5 Find This Spot: park outline + paths, water, pitches, parking, landmarks, `out geom`) for way/306191453 and way/188145317. Connemara: outline + creeks only (no landmark, so no map); Celebration: 105 elements, the X goes on its only picnic shelter. | 2026-10-06 00:25 and 00:28 UTC (overpass-api.de; earlier tries 504'd) |
| `do-gemma-4-31b-it-connemara-meadow-preserve-pass.json`, `do-gemma-4-31b-it-celebration-park-pass.json` | Real `gemma-4-31B-it` answers from DigitalOcean for the two 6-10 passes. Both were **re-recorded for S8c** (2026-10-06 ~02:12 UTC) after the request changed (no `section` field in the answer, sourceQuote 3-8 words and at most 90 characters, one parentNote for the whole pass); before that for S8b (2026-10-06 01:23 UTC: n + 4 pool items per section, trimmed species summaries, the lookWhere name rule, max_tokens 1200). Celebration's prompt carries the S5 Find This Spot target. Every input was replayed from this folder, only the model call was live. Both answers keep 8 of 8 (463 and 484 answer tokens; the S8b recordings were 7/8 and 8/8). The request stored is exactly what `src/lib/ai/prompt.ts` + `schema.ts` build from the fixtures above (a unit test checks this). No key or auth header is stored; `_recording.previous` names the earlier recording. | 2026-10-06 UTC (exact time in each file) |
| `evals/<park>.json` (20 files) | SPEC 6.4 eval parks: real Overpass park features, iNaturalist species_counts (1.5 km, research grade, since 2026-09-21) and taxa summaries per park, recorded by `pnpm eval:record` with the app's own source code. Each answer keeps its URL, fetch time and latency; failed mirror tries are listed. See `evals/RECORDING-LOG.md` there and `evals/README.md`. | 2026-10-05 23:44-23:56 UTC |

The S3 recordings were made by running `makePass()` (the real app code) through a scratch Vitest config. To keep the
repo small, the iNaturalist files keep only the fields the app reads (each file's `_recording.trimmed` says which);
every kept value is exactly as received.

Tests that need a failure we cannot record on demand (a 429, a hung socket, a 200 with an error remark) build that
response inside the test and say so in a comment. Those are never used as park data.
