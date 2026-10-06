# Grass Pass: your ticket to get outside

> Pick a park. Print a pass. Phone away.

**Status: in development** for the DEV Hacktoberfest 2026 Open-Source AI Challenge, Week 1 "Touch Grass"
(entry period Oct 5 to Oct 12, 2026). This README grows with the build; sections marked *coming* are not built yet.

Grass Pass makes a printable scavenger "pass" for a real park and a child's age. Every item on it is backed by
real, dated data about **that** park: OpenStreetMap features (courts, shelters, playgrounds), species people
actually photographed there in the last 14 days (iNaturalist), and visitor-review counts. An open-weight model
(Gemma 4, Apache-2.0) picks a fair mix for each park and writes kid-level clues; code checks every clue against its
source and decides what is safe. If a source has nothing, the pass says **"No data available"** and why. It never
pads with generic items.

## Live demo
*Coming* (deploy planned for Oct 9, 2026). No login needed.

## Quick start
```bash
pnpm install
cp .env.example .env.local   # add DO_INFERENCE_API_KEY (or point MODEL_BASE_URL at a local Ollama)
pnpm dev                     # http://localhost:3000
```

| Script | What it does |
|---|---|
| `pnpm lint` | ESLint, zero warnings allowed |
| `pnpm typecheck` | `next typegen && tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm build` / `pnpm start` | production build / server |
| `pnpm e2e` | Playwright against `pnpm start` (port 3123, or `E2E_BASE_URL`) |
| `pnpm eval` | SPEC 6.4 evals: 20 recorded real parks, live open models on DigitalOcean (about $0.06, capped at $1), no-AI baseline; see [`evals/README.md`](evals/README.md) |
| `pnpm eval:check` | free dry run: every recorded park through the real pass builder, model off |
| `pnpm eval:record` | re-record the 20 eval parks live from OpenStreetMap and iNaturalist |
| `node scripts/render-brand.mjs` | re-renders every logo, icon and share image from `scripts/brand/art.mjs` |

## Environment variables
All are listed and explained in [`.env.example`](.env.example). Keys are server-only.

## How it works
*Coming.* Architecture diagram, model, data sources and safety rules are added as each part is built.

Built so far (slice S0):
- `src/lib/model.ts`: plain `fetch` client for any OpenAI-compatible server. Strict JSON schema + zod, 30 s timeout,
  one retry on network/5xx, one log line per call, distinct error codes, the shown model name comes from the model
  that answered, the DigitalOcean key is only ever sent to `inference.do-ai.run`, and redirects are never followed.
- `src/lib/limits/*`: per-IP rate limits, daily/monthly caps with "charge every started call" tickets, circuit
  breakers, polite queues for free public APIs.
- `src/lib/cache/*`: typed caches with a "stored at" time, a separate negative cache, in-flight de-duplication;
  Upstash Redis in production, memory locally.
- `src/lib/http/guard.ts`: same-origin check, JSON content type, streamed body size cap.
- Security headers (CSP, no framing, nosniff, referrer policy) on every route.

Slice S2, find a park:
- `POST /api/parks` with `{"q": ...}` or `{"lat": ..., "lng": ...}` (a POST so typed text and location stay out of URLs and request logs): up to 10 named OpenStreetMap parks and nature reserves within 5 km,
  nearest first. Place text goes to Nominatim on submit only (no autocomplete) through one 1 request/second queue
  and is cached 30 days. Parks come from Overpass (three public servers tried in order, at most 50 seconds in total,
  a circuit breaker per server, at most 2 queries at once) and are cached 7 days. Empty answers have their own 15-minute cache. Same-origin and JSON only,
  2 KB body cap, 10 searches per minute per IP, plus a daily budget of uncached searches per IP and for everyone.
- "Use my location" is rounded to 2 decimals (about 1 km) in the browser, and again on the server.
- Every request to OpenStreetMap services sends `User-Agent: GrassPass/0.1 (+https://github.com/c0de128/grass-pass)`.

Slice S3, the pass on screen:
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

## Evals
Measured on 20 real parks (recorded live from OpenStreetMap and iNaturalist on Oct 5, 2026), age band 6-10,
with the real pass builder. Current numbers: [`evals/results/2026-10-05-4.md`](evals/results/2026-10-05-4.md)
(what changed and why: [`2026-10-05-4-notes.md`](evals/results/2026-10-05-4-notes.md)). The earlier runs,
[`2026-10-05.md`](evals/results/2026-10-05.md), [`2026-10-05-2.md`](evals/results/2026-10-05-2.md) and
[`2026-10-05-3.md`](evals/results/2026-10-05-3.md), are kept for comparison. No closed model was run (open models only).
Find This Spot is not in the eval (its map data was not recorded for these parks).

| | Gemma 4 31B (3 runs) | Llama 4 Maverick (1 run) | No-AI template | Gemma, run 3 | Gemma, first run |
|---|---|---|---|---|---|
| Blocked taxa printed | 0 | 0 | 0 | 0 | 0 |
| Clues quoting their source word for word (target 85%) | 99.6% | 80.1% | 100% (by construction) | 99.5% | 99.2% |
| Passes with >= n-1 items (target 90%) | 100% | 41.2% | 94.1% | 96.1% | 64.7% |
| Reading level, FK grade median (target <= 3.5) | 1.7 | 1.9 | 5.8 | 2.3 | 2.3 |
| Name leaks in clue or hint, before the filter (target <= 5%) | 10.5% (FAIL; clue only 6.7%) | 12.2% | 6.4% | 5.4% (6.1% with today's stricter check) | 17.5% |
| Model call p50 / p95 (target 10 s / 20 s) | 8.9 s / 12.8 s | 39.2 s / 46.3 s | none | 9.4 s / 11.3 s | 13.8 s / 24.3 s |
| Median answer length (tokens) | 460 | 455 | none | 456 | 583 |
| Cost per pass | $0.00064 | $0.00116 | $0 | $0.00056 | $0.00086 |
| Printed plant clues about flowers or fruit not seen this month (season check) | 0 | 0 | 0 | 6 (checked afterwards) | not checked |
| Printed clues or hints that say "map" on a pass with no map | 0 | 0 | 0 | 6 (checked afterwards) | not checked |

The last two rows are counted by `validate.ts` rules on the saved answers (the season evidence is the recorded
iNaturalist "Flowers and Fruits" annotations for each park, this month, all years, within 50 km); they are not SPEC 6.4
metrics. The season rule is cautious: a plant with fewer than 3 such records this month (for example autumn clematis
near White Rock Lake, 2 of 3) is treated as not flowering, so the model describes its leaves instead.

## Why open
The clue writer is an open-weight model: `gemma-4-31B-it` (Gemma 4, Apache-2.0) on DigitalOcean serverless
inference by default. Measured in the eval above (same parks, same checks for every column):
- **It makes the words kid-sized:** Gemma's clues read at FK grade 1.7 (median); the no-AI template on the same data
  reads at 5.8.
- **It sticks to the facts:** 99.6% of its clues quoted their source word for word before any filter (the rest are
  dropped by code); 0 blocked species printed in 60 runs.
- **It is cheap enough for a classroom:** about $0.00064 per pass at DigitalOcean list prices.
- **The safety rules live in our code, not a vendor's:** the same checks run on any model, and switching is one
  setting (`MODEL_ID`); Llama 4 Maverick ran through the same code in the eval.
- **You can run it yourself:** the weights are downloadable (Apache-2.0) and the app talks to any OpenAI-compatible
  server, e.g. Ollama. A self-hosted run has **not** been measured for this app yet.

No closed model was compared (open models only; the closed models on our DigitalOcean tier answered 403 on Oct 5).
What did not pass yet: name leaks before the filter, 10.5% of Gemma's clues or "look where" hints (target 5%; in the
clue itself 6.7%). Two changes in this round raised it: the check is stricter (it now also catches words built on a
name, like "Passifloraceae" for a passionflower; on run 3's saved answers that alone moves 5.4% to 6.1%), and the new
"make the child look closely" rule for Park Finds led to clues like "Count the bridges" for the bridges. Code drops
every leaky clue and blanks every leaky hint, so nothing is given away on a pass, and with the retry at n-1 every
data-rich Gemma pass still kept at least n-1 finds. Llama 4 Maverick got worse in this run (80.1% grounded, 41.2%
complete): it often copied the new code-written season note ("flowers seen in October") as its quote, which is not in
the source text, so those clues were dropped. The human kid check is not done yet. The app's `/about` page shows the same numbers (`src/lib/about/eval-summary.ts`, checked against the
results JSON by a unit test).

### Example parks (pre-warmed)
The home page links real passes for four example parks (Connemara Meadow Preserve, Celebration Park, Arbor Hills
Nature Preserve, White Rock Lake Park), made by the normal pass builder from live data when the server starts and
refreshed once a day in the background (stale-while-revalidate, global caps only, never charged to a visitor). Each
link shows the real time its pass was made; an example without a pass says why. `PREWARM_EXAMPLES=0` turns it off.

## Privacy
No accounts, no names, no photos, no cookies, no analytics. Nothing about the child is asked for or sent. What does
leave the device (also on `/about`):

| What | Where it goes | Why |
|---|---|---|
| Typed place text | our server (in the request body, never in the web address), then Nominatim; answers are cached 30 days in our storage (Upstash Redis) by the text, not by who typed it | find the town or park |
| "Use my location" | rounded in the browser to 2 decimals (~1 km), then our server, then Overpass | list nearby parks |
| The chosen park (public place + map position) | our server, then Overpass and iNaturalist | park map, sightings, monarch counts |
| Age band | our server, then the model on DigitalOcean (inside the prompt) | item count and reading level |
| IP address | our server; in our storage (Upstash Redis) only as a keyed hash (HMAC), never the address itself, inside rate-limit counters that expire within about a day (IPv6 by its /64 and /48 network) | abuse and cost limits |
| Every request (IP address, web address, time) | our hosting provider's request logs (Vercel), kept for a short time (about 1 hour on the Hobby plan). Park searches are POSTs, so these logs never hold the typed place or location | running the site |
| The finished pass | saved in our storage (Upstash Redis) for 30 days | the pass link and print page |

Our own server logs record source/model, timing, outcome and pass ids, never the prompt, the IP address or the typed text.
Storage: Upstash Redis (free plan) holds the caches, the saved passes and the rate-limit counters. The IP hash key is
`LIMITER_KEY_SECRET`; if it is not set, it is derived from the Upstash token (and is random per process without Upstash).
The browser keeps only the light/dark choice and the last age band (localStorage).

## Limitations
*Coming.*

## Contest note
Any commit made after the submission deadline (Mon Oct 12, 2026, 06:59 UTC) will be listed here.

## Credits
- Scaffolded with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app) (Next.js, MIT).
- The model client, limits, request guards and in-flight de-duplication are adapted from the author's earlier
  practice project (same author, MIT).
- Brand: logo and explorer scene are redrawn as SVG from the author's own banner design (`brand/`, `scripts/brand/art.mjs`;
  the kid's clothes and hair are cleaned traces of that drawing in `scripts/brand/kid-trace.json`).
- Fonts: [Fredoka](https://fonts.google.com/specimen/Fredoka) 600/700 and [Nunito](https://fonts.google.com/specimen/Nunito)
  400/600/700 for the site text: the latin `.woff2` files from [Fontsource](https://fontsource.org/) 5.3.0
  (`@fontsource/fredoka`, `@fontsource/nunito`) are committed in `src/app/fonts/` with their OFL licence texts and
  served by `next/font/local`, so neither the build nor the browser contacts Google Fonts. The logo lettering is outlined to SVG paths from
  [M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c) ExtraBold ("GRASS PASS") and
  [Varela Round](https://fonts.google.com/specimen/Varela+Round) (tagline), via their `@fontsource` copies (dev only).
  All four are SIL Open Font License 1.1.
- Asset tooling (dev only): [opentype.js](https://github.com/opentypejs/opentype.js) (MIT) and
  [@resvg/resvg-js](https://github.com/thx/resvg-js) (MPL-2.0).
- Park names and locations: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0,
  via [Nominatim](https://nominatim.org/) and the [Overpass API](https://overpass-api.de/) (public instances, used under
  their usage policies).
- Park features: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0, via the Overpass
  API instances at overpass-api.de, maps.mail.ru (VK Maps) and overpass.private.coffee.
- Wildlife sightings: [iNaturalist](https://www.inaturalist.org/) observers (research-grade observations; we show
  species names and counts only, no photos) and species summaries from Wikipedia (CC BY-SA) via the iNaturalist API.
- Clues: [Gemma 4](https://huggingface.co/google/gemma-4-31B-it) (`gemma-4-31B-it`, Apache-2.0) on DigitalOcean
  serverless inference.
- Data credits for SerpApi are added when Lucky Finds land.

## Licence
[MIT](LICENSE)
