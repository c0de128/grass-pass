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

Tests that need a failure we cannot record on demand (a 429, a hung socket, a 200 with an error remark) build that
response inside the test and say so in a comment. Those are never used as park data.
