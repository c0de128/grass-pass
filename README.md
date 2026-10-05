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
  and is cached 30 days. Parks come from Overpass (two servers, one failover, a circuit breaker per server, at most
  2 queries at once) and are cached 7 days. Empty answers have their own 15-minute cache. Same-origin only,
  10 searches per minute per IP, plus a daily budget of uncached searches per IP and for everyone.
- "Use my location" is rounded to 2 decimals (about 1 km) in the browser, and again on the server.
- Every request to OpenStreetMap services sends `User-Agent: GrassPass/0.1 (+https://github.com/c0de128/grass-pass)`.

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
- Brand: logo and explorer scene are redrawn as SVG from the author's own banner design (`brand/`, `scripts/brand/art.mjs`).
- Fonts: [Fredoka](https://fonts.google.com/specimen/Fredoka) and [Nunito](https://fonts.google.com/specimen/Nunito),
  both SIL Open Font License 1.1 (served by `next/font`; the logo text is outlined from the `@fontsource` copies).
- Asset tooling (dev only): [opentype.js](https://github.com/opentypejs/opentype.js) (MIT) and
  [@resvg/resvg-js](https://github.com/thx/resvg-js) (MPL-2.0).
- Park names and locations: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0,
  via [Nominatim](https://nominatim.org/) and the [Overpass API](https://overpass-api.de/) (public instances, used under
  their usage policies).
- Data credits for iNaturalist and SerpApi and the model licences are added as those parts land.

## Licence
[MIT](LICENSE)
