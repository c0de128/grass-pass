# Grass Pass ship checklist (production deploy)

Written 2026-10-07 after the first private Vercel preview. Every item is a step a person does in a dashboard or in
`.env` before or right after the production deploy. Values that are secrets are never written here, only their names.
Tick each box in the PR or ship report that does the deploy.

## 1. Production environment variables (Vercel, Production scope)
On the preview every variable was Preview-scoped only; **Production had none**. Add each to Production, and mark every
key, token and secret as **Sensitive**.

Required:
- [ ] `DO_INFERENCE_API_KEY` (the model; only ever sent to `https://inference.do-ai.run`)
- [ ] `AUTH_SECRET` (32+ random bytes; a new value signs everyone out)
- [ ] `LIMITER_KEY_SECRET`
- [ ] `KV_REST_API_URL`, `KV_REST_API_TOKEN` (added by the Upstash integration, see section 4; `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work)
- [ ] `CRON_SECRET` (16+ random characters, e.g. `openssl rand -hex 32`; the daily example warm-up refuses to run without it)
- [ ] `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (the **production** GitHub OAuth app, section 2)
- [ ] `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (section 3)

Caps and switches (set explicitly, so a default can't surprise anyone):
- [ ] `SERPAPI_API_KEY`
- [ ] `SERPAPI_DAILY_CAP=25` **from Friday Oct 9, 2026** (the preview used 6). The example warm-up may use at most half
      (12); the rest is kept for visitors. `SERPAPI_WARMUP_DAILY_CAP` stays unset (= half).
- [ ] `SERPAPI_MONTHLY_CAP=200`, `SERPAPI_RENEWS_DAY=16` (the free plan renews on the 16th)
- [ ] `JUDGE_DEMO=1`, `JUDGE_DEMO_DAILY_CAP=60`
- [ ] `PREWARM_EXAMPLES=1`
- [ ] Optional: `SITE_URL` / `AUTH_URL` only if a custom domain is used; `APP_CONTACT_URL` (public repo URL)
- [ ] Never on Vercel: `EVAL_*`, `LOCAL_*`, `MODEL_REASONING_EFFORT` (self-host only)
- [ ] `GP_E2E_FIXTURE_PASSES` **unset** in every Vercel scope (Production and Preview). It is a test-only switch for
      the Playwright server; the code also refuses it on any Vercel deployment (`VERCEL=1`), and `tests/**` is not
      traced into the deploy (`next.config.ts` `outputFileTracingExcludes`, round 9 SEC-9-02).

## 2. GitHub sign-in (production OAuth app)
- [ ] Create a **separate** GitHub OAuth app for production (the local one keeps `http://localhost:3123`).
- [ ] Homepage URL: `https://<production-domain>`
- [ ] Authorization callback URL: `https://<production-domain>/api/auth/callback/github`
- [ ] Put its client id and secret in `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` (Production scope).

## 3. Google sign-in
- [ ] In the Google Cloud OAuth client (Web application), add **Authorized JavaScript origin** `https://<production-domain>`.
- [ ] Add **Authorized redirect URI** `https://<production-domain>/api/auth/callback/google`.
- [ ] **Publish the OAuth consent screen** (Testing -> In production). In Testing mode only listed test users can sign in,
      so judges would get "access blocked".

## 4. Upstash (shared store)
- [ ] Keep the `upstash-kv-bisque-bucket` connection scoped to **Preview and Production** (connect Production; don't
      disconnect Preview). Grass Pass only writes keys under `gp:`; girl-tube's key stays untouched.
- [ ] After the deploy, confirm the logs say `"store":"upstash"` (not memory).

## 5. Search engines
- [ ] Production must be indexable: the `X-Robots-Tag: noindex` seen on the preview comes from Vercel's preview
      deployments, not from the app. After the deploy, `curl -sI https://<production-domain>/` must show **no**
      `X-Robots-Tag: noindex`. Check Project -> Settings for any "noindex" / password protection left on production.
- [ ] The app's own `noindex` stays on pass pages, print pages and `/signin` (private, per-person pages). That is intended.
- [ ] Turn off Vercel Deployment Protection (Vercel Authentication) for **production** only, so judges can open it;
      previews can stay protected.

## 6. Vercel secrets and protection
- [ ] **Revoke the "Protection Bypass for Automation" secret** (Project -> Settings -> Deployment Protection). `vercel curl`
      created it on Oct 7; anyone with it can open protected deployments.

## 7. Example passes
- [ ] The daily cron is in `vercel.json` (`/api/cron/warm-examples`, `0 10 * * *` = 5:00-5:59 AM CDT). Crons run on
      production deployments only. After the first production deploy, check Project -> Settings -> Cron Jobs lists it,
      then trigger it once from that page ("Run") and check the log line `cron_warm_done`.
- [ ] Open the home page: all 4 example cards should show a complete pass ("See the pass"). A card that says "No data
      available yet" says why; a short pass is never shown. Each example gets one second try a day when its pass
      comes out short.
- [ ] "Pin" the examples for judging: three real passes are pinned in the repo (`src/data/pinned-examples/`, see
      `src/lib/pinned.ts`): Oak Point (the hero card), White Rock and Celebration. Their links always open, from the
      repo, with no store. Arbor Hills has nothing pinned (all 6 tries on Oct 7 came out short): the home page keeps their last complete pass (60 days),
      the pass itself opens for 30 days, and the daily cron keeps them fresh. Before publishing, write down the example
      pass links that are complete and use those in the DEV post and README.

## 8. README and post
- [ ] README: add the live URL at the top and a real screenshot of the production home page (no mock-ups).
- [ ] README "Run it yourself" and the DEV post name the same model that the pages name (`gemma-4-31B-it`).
- [ ] GitHub Actions `check` is green on the exact commit you deploy (`gh run list -c <sha>`), RULES-8-01. `/how-it-works`
  says the CI results are public, so a red X on the shipped commit contradicts the page.
- [ ] Re-count `AUDIT_ROUNDS` and `UNIT_TESTS` in `src/lib/about/content.ts`.

## 9. After the deploy
- [ ] `node scripts/smoke.mjs <url> --expect "Grass Pass"` (factory repo), then add the URL to `ops/uptime.json`.
- [ ] Judge flow once (sign in -> "Try as a judge" -> a pass), and check `/api/judge-passes` goes down by 1.
- [ ] `package.json` `engines.node` is `"22.x"` (done 2026-10-07), so Vercel shows no Node auto-upgrade warning.
