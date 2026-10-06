# Contributing to Grass Pass

Thanks for helping kids get outside. Grass Pass is small on purpose: one Next.js app, one model call per pass, and
code that checks everything the model writes. This guide covers setup, the checks every change must pass, and the
house rules.

## Setup
Needs Node 22 and pnpm.

```bash
pnpm install
cp .env.example .env.local   # every variable is explained in the file
pnpm dev                     # http://localhost:3000
```

- **Model:** set `DO_INFERENCE_API_KEY` (DigitalOcean serverless inference), or point `MODEL_BASE_URL` at any
  OpenAI-compatible server such as a local Ollama (`http://localhost:11434/v1`) and set `MODEL_ID`. Without a model,
  park search works and a new pass says the model is not configured.
- **Store:** without Upstash variables, caches and limits live in memory. That is fine for local work.
- **Example parks:** the server makes the 4 example passes at start-up. Set `PREWARM_EXAMPLES=0` to skip that (it
  saves free API quota while you work on something else).

## Checks (all must pass before a pull request)
```bash
pnpm lint        # ESLint, zero warnings
pnpm typecheck   # next typegen && tsc --noEmit
pnpm test        # Vitest unit tests, no network
pnpm build       # production build
pnpm e2e         # Playwright against `pnpm start` (needs a build); live tests skip with the server's error code when an upstream is down
```

CI runs lint, typecheck, test, build, e2e and gitleaks on every push.

## House rules
1. **No made-up data, ever.** No mock, sample or placeholder data in the app. If a source has nothing, the UI says
   "No data available" and why. Tests use recorded **real** API answers in `tests/fixtures/` (see
   `pnpm eval:record` and `pnpm osm:snapshot`), never invented ones.
2. **Code writes every number and date.** The model only picks items by id and writes words. Counts, dates,
   distances and safety lines come from code.
3. **Safety lives in code.** Blocked species are filtered by iNaturalist taxon id in `src/lib/safety/danger-taxa.ts`
   before and after the model call. Do not move a safety decision into the prompt.
4. **Every clue is checked.** A clue whose `sourceQuote` is not word for word in its source, or that names its
   answer, is dropped. Do not loosen these checks to get more items.
5. **Validate input and output** with zod. Handle timeout, rate limit, model down, bad output and empty output, each
   with its own honest message.
6. **Be polite to free public services.** OpenStreetMap (Nominatim, Overpass) and iNaturalist calls go through the
   queues and caches in `src/lib/limits/` and `src/lib/sources/`. Do not add an uncached or unqueued call.
7. **Accessibility:** semantic HTML, labels, visible focus, WCAG 2.2 AA contrast. The printed pass stays black and
   white on one Letter page (`src/styles/print.css`, checked by `tests/e2e/print.spec.ts` and `spot-map.spec.ts`).
8. **Secrets:** never commit a key. Keys are server-only (never `NEXT_PUBLIC_`). A dummy key in a test needs a
   `// gitleaks:allow` comment on that line.
9. **Credit borrowed code** in the README Credits section, with its licence.

## Pull requests
- Small, focused changes with [conventional commit](https://www.conventionalcommits.org/) messages
  (`fix(print): ...`, `feat(parks): ...`).
- Add or update tests with the code.
- If you change what the app shows or measures, update `/about` (`src/app/about/page.tsx`) and the README so they say
  the same thing, caveats included.
- Ideas to start with: [docs/good-first-issues.md](docs/good-first-issues.md).

## Licence
By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
