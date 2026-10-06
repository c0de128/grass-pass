# Good first issues

Three real, small improvements, each found while building or auditing Grass Pass. They are listed here (not yet
opened as GitHub issues). Read [CONTRIBUTING.md](../CONTRIBUTING.md) first.

## 1. "Show more parks" after a town search
**Why:** a town search shows only the 10 nearest named parks within 5 km. "Allen TX" finds 53 parks, so a well-known
park like Connemara Meadow Preserve is not in the list, and people have to search it by name. The page already says
"The 10 nearest of 53 named parks within 5 km." (`src/components/parks/FindAPark.tsx`).

**What to do:** add a "Show 10 more parks" button under the list. The server already counts `totalFound`
(`src/lib/parks/search.ts`), but today it caches only the 10 nearest (`MAX_PARKS` in `src/lib/parks/schema.ts`). Keep
more of the same Overpass answer in the cache (for example up to 30) so the next page never needs a new Overpass
query, keep 10 per page in the response, and hide the button when everything is shown.

**Done when:** unit tests cover the paging from a recorded real answer (`tests/fixtures/`), the button is a real
`<button>` with a clear label, focus moves to the first new park, and `pnpm lint && pnpm typecheck && pnpm test` pass.

## 2. Unit test for the park-search fallback note and the example button
**Why:** when the public Overpass servers are busy, park search falls back to the saved Dallas-area park list or to a
Nominatim park search, and the page shows a note saying so. When nothing answers, it offers a "See a ready example
pass" button. This is covered at the API level and by e2e, but `FindAPark` has no component test for it.

**What to do:** in `tests/unit/`, render `FindAPark` with real recorded search answers that carry `fallback.message`
and an error carrying `example: { name, href }` (see `src/lib/parks/schema.ts` and the parks-search tests for the
shapes), and check the note text, the button's name and link, and that no button appears without a ready example.

**Done when:** the new test fails if the fallback note or the example button is removed, and all checks pass.

## 3. Measure a self-hosted model run
**Why:** Grass Pass says you can run the clue writer yourself (the weights are open, and the app talks to any
OpenAI-compatible server), but a self-hosted run has **not** been measured. The README and `/about` say so.

**What to do:** run the 20-park eval (`pnpm eval`, see `evals/README.md`) against a local Ollama model (for example a
Gemma 4 or Qwen3 build that fits your machine). Check how the eval runner picks its model endpoint in `evals/run.ts`
first; it may need a small change to honour `MODEL_BASE_URL` and `MODEL_ID`. Commit the results file as written
(failing numbers included, with your hardware: CPU/GPU, RAM) and add a row to the README Evals section.

**Done when:** a dated results file under `evals/results/` names the model, the hardware and every metric, and the
README links it. Do not edit numbers by hand.
