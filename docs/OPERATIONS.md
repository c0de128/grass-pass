# Grass Pass operations: limits, storage quota, accounts and cold start

Moved from the README on 2026-10-06 (no facts changed). For maintainers and the deploy.

## Cold start (measured)
Measured on Oct 5, 2026 (~11:15 PM CDT) on the build laptop (Windows 11, Node 22), from a fresh git worktree:
- `pnpm build` with no `.next` cache: **17.2 s** (Next.js 16.3.8, Turbopack).
- `next start`, fresh process, empty in-memory store: first `GET /` answered **0.98 s after the process started**
  (the request itself 0.62 s). The next `GET /` took 25 ms, the first `GET /about` 56 ms.
- The first example pass was ready **30.9 s after start** (the start-up warm-up makes all 4 example passes from live
  data and the model). A ready pass page then loads in about 25 ms.
- A brand-new pass for a park nobody asked for today: about 10 s when the map servers are healthy (one measured
  run: 10.1 s, of which the model took 9.6 s). The server gives up at 85 s, the browser stops waiting at 95 s (measured 2026-10-06: new passes took 58-67 s while public Overpass was failing over).

These are laptop numbers, not the hosting provider's; the deployed cold start will be added after the deploy.

## Example warm-up on Vercel (changed 2026-10-07)
On the first private preview (Oct 7) the start-up warm-up ran outside any request. Vercel paused the instance between
requests, so the store's 3 s timers fired 4-105 s late (7 `store_error` lines), and the warm-up used all 6 of the
preview's daily SerpApi searches. Now (`src/lib/prewarm.ts`, `src/lib/prewarm-cron.ts`):
- On Vercel (`VERCEL` set) nothing starts at boot. A home-page request starts at most **one** example (none while one
  is still running in that instance) and keeps it alive with `after()` (Vercel `waitUntil`) for at most 105 s; the
  page's `maxDuration` is 120 s. The next request picks up the next example.
- A **daily Vercel Cron** (`vercel.json`: `/api/cron/warm-examples` at `0 10 * * *`, so 5:00-5:59 AM CDT; Hobby allows
  daily crons for free) warms the examples one after another while a whole pass (85 s + 10 s) still fits its 280 s
  budget (`maxDuration` 300, the Hobby maximum). It needs `CRON_SECRET` (Vercel sends it as a Bearer header);
  without it the route answers 503 and spends nothing.
- An example whose pass came out short, with no complete pass saved, gets **one** more full attempt that day (a new
  variant), inside the daily AI cap. A short pass is never shown.
- The warm-up may use at most **half** of `SERPAPI_DAILY_CAP` (`SERPAPI_WARMUP_DAILY_CAP` can only lower it).
- Store trouble during a warm-up stops that round and is logged once (`prewarm_store_unavailable`, at most every
  10 min per instance). Upstash network errors are logged at most once a minute per instance, with the number left
  out (`notLogged`); every failed command still fails safe.
- On a long-running server (local, self-hosted) the start-up warm-up still makes all examples, one at a time.


## Abuse limits and the free storage quota
Every cache, limit and saved pass lives in Upstash Redis, whose free plan allows 500,000 commands a month. A
flood of requests must not use that up, or saved pass links would stop opening. So, in front of every page and API
that reads the store, an in-process limiter (`src/proxy.ts`, `src/lib/limits/prelimit.ts`) answers 429 before any
store command:
- **Pages** (`/`, `/pass/*`): a flood guard only, 120 at once, then 2 a second per IP. Links to these pages don't
  prefetch (`prefetch={false}`), so one click is one request. An e2e (`pnpm e2e:limits`) walks home, every example
  pass and its print page three times at the default limits and expects no 429.
- **Store cost:** each request is charged about the store commands it can cause (a saved-pass page 1, plus 1 for a
  signed-in visitor's report counts; `/api/pass` 5, `/api/parks` 4, `/api/report` 5, `/api/feedback` 4, a sign-in
  start/callback or a sign-in button 1, the judge passes left 1, the passes left 1, `/api/free-pass` 0, the header's
  "who is signed in" check 0; measured in
  `tests/unit/store-cost.test.ts`): 60 at once, then 45 an hour per IP. Measured with the real store code
  (2026-10-06, round 4): a cache hit 3, a cached failure (not a park, too big, too slow, OpenStreetMap resting) 4,
  a signed-out visitor whose free pass is used 2, a signed-out connection over its free passes 5, an account over
  its 5 a day 5 the first time then 4, a judge over its 3 per connection 5, a report 4 (a repeat 3, a judge demo
  report 4), a rating 4 (a re-rating 3, a judge demo rating 3), the passes left 1 (signed out 0), a cached park
  search 3; re-measured 2026-10-08: a signed-out new pass 115 and a signed-in one 117; a new pass 113 with the
  usage bookkeeping (the biggest test park, Connemara), 118 when it also starts a fresh Lucky Finds lookup (4
  SerpApi searches; Celebration Park 55), and an uncached park search 15, which only an address's daily share of
  new passes (20) and searches (60) can reach.
- **IPv6:** one shared bucket per /48 network (2 clients' worth), not one per /64.
- **Pass ids that can't exist** (a day in the future or older than the 30-day pass life, a variant above 3, a
  malformed park id) are a 404 with no store read. Saved passes are kept in memory for 30 minutes after a read.

With these defaults one IPv4 address can spend at most **about 163,000 commands a month (32.6%)**, new passes and
park searches included. The math is in `src/lib/limits/prelimit.ts` and checked by a unit test. The limits are per
server instance, so the optional firewall rule below is the backstop across instances.

**A daily pace across everyone.** Many addresses, each inside its own limits, could still use the month up in a
few days. So each day (Chicago time) may use at most 90% of the month divided by its days (about 14,500 commands a
day in October). After that, new passes and new park searches say they are paused for today until midnight
(Chicago time); saved passes, the example passes and searches already made keep working. The logs get
`upstash_daily_pace` once when a day reaches it.

**At 90% of the monthly budget Grass Pass rests instead of breaking.** Saved passes and the example passes still
open. New passes and park searches answer "Grass Pass is resting until <the 1st of next month>", and the home page
shows the same notice. The logs get `upstash_budget` at 50%, 80% and 90%. The app counts its own commands (added to
a shared counter every 10, read by every new server instance first), so its count can run a little behind; 90%
leaves room for that. **After the deploy, compare the app's count with the Upstash console once** and adjust.

### Optional: a Vercel Firewall rate-limit rule (not set up)
Vercel's WAF rate limiting is on every plan; Hobby gets 1 rate-limit rule per project, a fixed window of 10 s to
10 min, IP or JA4 keys, and 1,000,000 allowed requests included
([docs](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), checked Oct 6, 2026). Counters are per
region. A rule that matches the in-app limits across all instances:
1. Project → **Firewall** → **Configure** → **+ New Rule**, name it `pass-and-api-per-ip`.
2. **If** Request Path **matches expression** `^/(pass|api)/`.
3. **Then** Rate Limit, Fixed Window, **Time Window 600 s**, **Request Limit 60**, key **IP**, action **Default (429)**.
   Start with **Log** for a day to check that no real visitor hits it, then switch to 429.
4. **Review Changes** → **Publish**.

This is a decision for the project owner (see `ACCEPTED-RISKS.md` / the decision log); nothing has been created on
Vercel.

## Accounts and visitor reports
Kevin's rules (2026-10-06, limits changed 2026-10-08): anyone can search parks, open the example passes and any shared
pass link, and print. **Without signing in, a browser gets 1 free NEW pass per Chicago day.** After that **a grown-up
signs in** with GitHub, or Google when configured (OAuth through Auth.js / next-auth v5; no password is ever stored):
**`ACCOUNT_DAILY_PASSES` new passes a day per account** (default 5; it was 2 until 2026-10-08). A pass already made today
for that park and age is served to anyone (it costs nothing and counts for nobody). The order on `POST /api/pass` is:
cached? -> signed in, or a free pass left? -> the account's (or this connection's signed-out) daily count -> the existing
per-IP and global limits; the count is given back unless an upstream call really started (a failed build that did call
the model still counts). A build that stops with "Not enough real data for a pass" (before any model call) gives the
account's, judge's or free pass back too (review 2026-10-08); the per-IP share still counts, because the map and
wildlife calls really happened. Such a park also sends no SerpApi search: the Lucky Finds search starts only once the
park map and wildlife finds can fill a pass. A rebuild of today's pass after a source was down
(at most 3 a day per park and age) does not count toward anyone's passes; a signed-out visitor is shown the saved pass
instead of a rebuild.

**The free-pass cookie** (`src/lib/limits/free-pass.ts`): `gp-free` on http, `__Host-gp-free` on https, value
`v1.<yyyymmdd>.<count>.<HMAC-SHA256>` (only the Chicago date and a count; no ID), keyed from `AUTH_SECRET` (or the limiter
key when sign-in is off), httpOnly, SameSite=Lax, Path=/, Secure on https, expiring at the next Chicago midnight. A
missing, edited, forged or other-day cookie means 0 used. It is set **only when a free pass is charged**: on the
response itself when nothing was streamed yet, otherwise the stream's last line carries the signed value
(`free.receipt`) and the page posts it to `POST /api/free-pass`, which checks the signature and sets the cookie (it can
only raise today's count). `GET /api/passes-left` gives the wizard its "passes left today" line (signed out: from the
cookie, 0 store commands; an account 1 GET; the judge demo 1 MGET). **Cookies are easy to clear**, so every backstop
still applies: `ANON_PASSES_PER_IP_PER_DAY` (default 3; quota `anon-new`, keyed by the hashed IP; 0 switches free passes
off), the per-IP store-cost limits, the per-IP daily share of new passes (`PASS_PER_IP_PER_DAY`), `AI_DAILY_CAP`, the
Upstash pace and budget, the breakers and the SerpApi caps. Codes: `FREE_PASS_USED` (429, until midnight),
`ANON_IP_DAILY_LIMIT` (429), `SIGN_IN_REQUIRED` (401, only when free passes are off).

**Pass ratings** (Kevin, 2026-10-08; `src/lib/feedback`): on the screen pass a signed-in grown-up picks 1-5 stars and
any of the tags Too easy / Too hard / Kids loved it / Something was missing / Not safe (no free text: the request schema
is strict). `POST /api/feedback`: same-origin + JSON + 2 KB guard, signed in (401), 60 an hour per IP, the pass must be
saved (404), 30 an hour per account (the judge demo: per judge sign-in), then ONE store command: the park's hash
`fb:{<park>}:h`, field `<pass id>|<per-park reporter id>` = `<yyyymmdd>|<stars>|<tag mask>`, so one rating per account
per pass and the latest wins; the hash expires 90 days after its last write and each write drops older fields. Judge
demo ratings are only logged (`feedback_judge`), once per judge sign-in per pass per day. A rating with "Not safe" logs
`feedback_not_safe` (park, pass, stars; nothing about the person). Nothing is shown publicly. To read the counts:
`pnpm feedback:report` (reads `UPSTASH_REDIS_REST_URL`/`_TOKEN` from the shell or `.env.local`; one SCAN plus 1 HGETALL
and 1 GET per park; says "No data available" without Upstash or ratings).

A sign-in lasts **7 days** (GitHub, or Google when configured) or **1 day** (the judge demo), counted from signing in however much it is
used; the cookie expires at the same time. GitHub is asked only for `read:user` (no email scope, and the email
lookup is skipped), Google only for `openid profile`. The header reads who is signed in from `GET /api/me`, which only
decodes the cookie: browsing without signing in sets no cookie at all (only using a free pass sets the free-pass
cookie above).

**Try as a judge:** a big one-click button signs in to a shared demo account (no OAuth, no typing). All judges
together get `JUDGE_DEMO_DAILY_CAP` new passes a day (default 60), at most 3 of them from one connection (IP), on top
of the per-IP limits; the sign-in card shows the real number left (`GET /api/judge-passes`). Judge demo reports are
**logged for review only**: they never count toward any threshold and never show in the counts, and each judge
sign-in (browser) has its own "already reported today" check. `JUDGE_DEMO=0` switches the button off.

**Reports** (signed-in only, on the screen pass, not the printout): Found it / Didn't find it / Not safe, one per
account per find per day, 30 an hour per account and 60 an hour per IP. Every threshold counts **different
accounts, not reports**: an account is one voice per find (Found it / Didn't find it is one opinion, the latest
wins). An item that at least 3 different accounts didn't find in the last 30 days, when they are more than 60% of
the different accounts with an opinion on it, is left out of new passes for that park (the pool step, before the
model sees anything). "Not safe" from 2 different accounts (not the judge demo) hides the item from new passes for
that park at once. Reports are deleted after 90 days. Signed-in visitors see real counts of different visitors
("Visitor reports, last 30 days: 3 found it"), nothing when there are none.

**How Kevin reviews "Not safe" reports** (no admin page):
- Vercel -> project -> Logs, search `report_not_safe` (every not-safe report: park, item, how many accounts;
  `"judge":true` for the judge demo, which never hides anything), `report_judge` (judge demo found / didn't find)
  and `report_item_hidden` (level error: an item was just hidden). No account id or name is ever logged.
- Upstash console -> Data Browser: `gp:meta:not-safe-hidden` counts hidden items; the park's hash
  `gp:rep:{way/123}:h` holds `<item>|hide` (the day it was hidden) and one field per account opinion,
  `<item>|<kind>|<reporter id>` = the day (the reporter id is a per-park HMAC of the account).
- To un-hide an item after checking it: delete the `<item>|hide` field from that hash (HDEL) and the key
  `gp:rep:{way/123}:ns:<item>` (the set of reporter ids that said not safe).

**Setting up the sign-in providers** (env names in `.env.example`; a provider without both values has no button):
- `AUTH_SECRET`: 32+ random bytes (`npx auth secret` or `openssl rand -base64 33`). It encrypts the session cookie and
  keys the account IDs; changing it signs everyone out and resets the account counts.
- GitHub OAuth app callback URL: `http://localhost:3123/api/auth/callback/github` (local) and
  `https://<production-domain>/api/auth/callback/github`. A GitHub OAuth app has ONE callback URL, so use one app per
  origin. Env: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`.
- Google OAuth client (Web application) redirect URIs: `http://localhost:3123/api/auth/callback/google` and
  `https://<production-domain>/api/auth/callback/google` (Google allows several). Env: `AUTH_GOOGLE_ID`,
  `AUTH_GOOGLE_SECRET`.
- Vercel: Auth.js trusts the host on Vercel; set `AUTH_URL=https://<production-domain>` only if the site is served
  from a custom domain different from what Vercel reports. Preview deployments have their own URLs, which the OAuth
  apps don't list, so on previews only "Try as a judge" works.

