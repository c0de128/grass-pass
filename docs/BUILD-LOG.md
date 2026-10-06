# Build log

How Grass Pass was built, slice by slice (Oct 5-12, 2026, Hacktoberfest Week 1 entry period). This was the
README's "Built so far" section during the build; the README now explains the app for users, judges and
contributors. Some details here were later changed by audit fixes (see the commit history).

## Slice S0: foundations
- `src/lib/model.ts`: plain `fetch` client for any OpenAI-compatible server. Strict JSON schema + zod, 30 s timeout,
  one retry on network/5xx, one log line per call, distinct error codes, the shown model name comes from the model
  that answered, the DigitalOcean key is only ever sent to `inference.do-ai.run`, and redirects are never followed.
- `src/lib/limits/*`: per-IP rate limits, daily/monthly caps with "charge every started call" tickets, circuit
  breakers, polite queues for free public APIs.
- `src/lib/cache/*`: typed caches with a "stored at" time, a separate negative cache, in-flight de-duplication;
  Upstash Redis in production, memory locally.
- `src/lib/http/guard.ts`: same-origin check, JSON content type, streamed body size cap.
- Security headers (CSP, no framing, nosniff, referrer policy) on every route.

## Slice S2: find a park
- `POST /api/parks` with `{"q": ...}` or `{"lat": ..., "lng": ...}` (a POST so typed text and location stay out of URLs and request logs): up to 10 named OpenStreetMap parks and nature reserves within 5 km,
  nearest first. Place text goes to Nominatim on submit only (no autocomplete) through one 1 request/second queue
  and is cached 30 days. Parks come from Overpass (three public servers tried in order, at most 50 seconds in total,
  a circuit breaker per server, at most 2 queries at once) and are cached 7 days. Empty answers have their own 15-minute cache. Same-origin and JSON only,
  2 KB body cap, 10 searches per minute per IP, plus a daily budget of uncached searches per IP and for everyone.
- "Use my location" is rounded to 2 decimals (about 1 km) in the browser, and again on the server.
- Every request to OpenStreetMap services sends `User-Agent: GrassPass/0.1 (+https://github.com/c0de128/grass-pass)`.

## Slice S3: the pass on screen
- Pick a park, pick an age band (4-6, 6-10 by default, 10-13; remembered on this device only), press **Make my pass**.
  The page shows the server's real progress steps while it works (`POST /api/pass` streams them as NDJSON).
- **Park Finds** come from one fixed Overpass query per park id: what is mapped inside the park (courts by sport,
  playgrounds, shelters, benches, fountains, ponds, creeks, bridges...). Code writes each fact ("Celebration Park has
  2 basketball courts on the map (OpenStreetMap).") and its evidence line. Cached 7 days.
- **Wild Finds** come from iNaturalist: research-grade species seen within 1.5 km in the last 14 days, plus each
  species' Wikipedia summary (the only text a clue may quote). Cached 6 hours (species) and 7 days (summaries). The
  taxa endpoint is never called with an empty id list (it would return "Life, Animals, Plants...").
- **Safety by code** (`src/lib/safety/danger-taxa.ts`): recluse and widow spiders, venomous snakes, fire ants,
  poison ivy/oak/sumac, pokeweed, asp caterpillars, datura, wasps, bull nettle, nettles, nightshades, giant
  centipedes and bark scorpions are blocked by iNaturalist taxon id and ancestor ids, before the model sees the list
  and again after. Every Wild Find carries a fixed safety line ("Look, don't touch.").
- **One model call** (`gemma-4-31B-it` on DigitalOcean by default) picks items by id and writes the clues. The strict
  JSON schema is generated from zod with `minItems = maxItems = n` and an enum of the real pool ids. Code then drops
  any item whose `sourceQuote` is not in its source text, that names the answer, adds a number that isn't in the
  source, contains a link, or breaks the section mix computed by code. Too few survivors: one retry.
- Every number and date on a pass is written by code. Empty sections say "No data available" and why. The footer
  names the model that actually answered and when the pass and the data were made.
- Passes are cached per park, age band and Chicago day (`/pass/<id>` reads only the cache); "Make a different pass"
  makes up to 3 per day. Limits: 3 new passes/min and 20/day per IP, `AI_DAILY_CAP` model calls a day for everyone,
  checked before any upstream call; a started model call is never cancelled and always counted.
