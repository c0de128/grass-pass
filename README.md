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
- `GET /api/parks?q=` or `?lat=&lng=`: up to 10 named OpenStreetMap parks and nature reserves within 5 km,
  nearest first. Place text goes to Nominatim on submit only (no autocomplete) through one 1 request/second queue
  and is cached 30 days. Parks come from Overpass (three public servers tried in order, at most 50 seconds in total,
  a circuit breaker per server, at most 2 queries at once) and are cached 7 days. Empty answers have their own 15-minute cache. Same-origin only,
  10 searches per minute per IP, plus a daily budget of uncached searches per IP and for everyone.
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

## Why open
*Coming*, with measured numbers from our evals (open models vs. a no-AI baseline on 20 real parks).

## Privacy
*Coming.* Short version of the plan: no accounts, nothing about the child leaves the device, location is rounded
in the browser to about 1 km, no analytics.

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
- Fonts: [Fredoka](https://fonts.google.com/specimen/Fredoka) and [Nunito](https://fonts.google.com/specimen/Nunito)
  for the site text (served by `next/font`). The logo lettering is outlined to SVG paths from
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
