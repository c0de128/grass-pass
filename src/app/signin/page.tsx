import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Ticket } from "lucide-react";
import { currentSession } from "@/lib/accounts/current";
import { signOutAction } from "@/app/actions/auth";
import { JudgePassesLeft } from "@/components/account/SignInCard";
import { JudgeButton, OAuthButtons } from "@/components/account/SignInPageForms";
import { SignInPassPreview } from "@/components/account/SignInPassPreview";
import { buttonClassName } from "@/components/ui/Button";
import {
  ACCOUNT_COPY,
  accountPassesPerDay,
  freePassesPerDay,
  JUDGE_SESSION_MAX_AGE_SEC,
  PROVIDER_LABELS,
  signInOptions,
  type ProviderId,
} from "@/lib/accounts/config";
import { allowedReturnPath, withSignedInFlag } from "@/lib/accounts/redirect";
import { errorText } from "@/lib/accounts/signin-errors";
import { signInPreviewFor } from "@/lib/accounts/signin-preview";

export const metadata: Metadata = { title: "Sign in · Grass Pass", robots: { index: false, follow: false } };

/**
 * Auth.js passes an absolute callbackUrl: keep only its path + query (the sign-in buttons send a path, and
 * the server action + Auth.js redirect callback check it against the allowlist again).
 */
function pathOnly(v: string | undefined): string | null {
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return v;
  try {
    const u = new URL(v);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}


/** The judge demo in one short line, from the same numbers the code uses (SEC-4-02, SEC-4-05); the live count says the cap. */
function judgeNote(): string {
  const days = Math.round(JUDGE_SESSION_MAX_AGE_SEC / 86_400);
  return `One click, no sign-up: a shared demo account for ${days} day${days === 1 ? "" : "s"}.`;
}

/**
 * Sign-in page (also Auth.js's sign-in and error page). Sign-in v2, Kevin's option A "show the reward" (2026-10-08):
 * a compact sign-in card (Google, GitHub, one privacy line, then a quieter "Judging the contest?" tear-off with the live
 * count) next to a small preview of a REAL pinned pass (src/lib/accounts/signin-preview.ts). Phones: the card first.
 * The card is first in the page order too (h1 first); on wide screens the grid puts it on the right.
 */
export default async function SignInPage(props: PageProps<"/signin">) {
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const from = allowedReturnPath(pathOnly(one(sp.from) ?? one(sp.callbackUrl)), "http://grass-pass.invalid") ?? "/";
  const error = one(sp.error);
  const token = await currentSession();
  const session: { provider?: ProviderId } | null = token ? { provider: token.p } : null;
  const options = signInOptions();
  const returnTo = withSignedInFlag(from);
  const nothing = !options.configured || (options.providers.length === 0 && !options.judge);
  const preview = signInPreviewFor();

  return (
    <main id="main" tabIndex={-1} className="relative isolate flex w-full flex-1 flex-col overflow-x-clip px-4 py-8 focus:outline-none sm:px-6 sm:py-12 lg:py-16">
      {/* The hero's dotted grain, fading out around the page (decorative). */}
      <div aria-hidden="true" className="gp-signin-grain grain pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-14 xl:gap-20">
        <section
          aria-labelledby="signin-title"
          className="gp-signin-card mx-auto w-full max-w-[26rem] bg-card text-card-foreground lg:col-start-2 lg:row-start-1"
          data-testid="sign-in-card"
        >
          <div className="flex flex-col gap-5 px-5 pt-7 pb-6 sm:px-8 sm:pt-8">
            <div className="flex flex-col items-start gap-2.5">
              <h1 id="signin-title" className="text-4xl leading-none font-extrabold tracking-tight text-ink">
                Sign in
              </h1>
              {/* Kevin 2026-10-08 ~7:25 PM CDT: today's free pass needs no sign-in; signed in = more a day + rate your pass.
                  The number is the code's own constant (the pass-limits branch sets it), never typed here. */}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-heading text-base font-extrabold text-ink" data-testid="signin-per-day">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sun px-3 py-1 text-sm text-sun-foreground">
                  <Ticket className="size-4" aria-hidden="true" />
                  {accountPassesPerDay()} passes a day
                </span>
                <span>and rate your pass</span>
              </p>
              {freePassesPerDay() > 0 ? (
                <p className="text-base text-muted-foreground text-pretty" data-testid="signin-free-line">
                  Your free pass for today needs no sign-in.
                </p>
              ) : null}
            </div>

            {error ? (
              <div role="alert" className="gp-signin-error rounded-xl border-l-4 border-destructive px-4 py-3 text-left" data-error-code={error}>
                <p className="font-semibold text-pretty">{errorText(error, one(sp.wait))}</p>
              </div>
            ) : null}

            {session?.provider ? (
              <section aria-labelledby="signed-in" className="flex flex-col gap-3">
                <h2 id="signed-in" className="text-xl font-extrabold text-ink">
                  You&apos;re signed in {session.provider === "judge" ? "to the judge demo" : `with ${PROVIDER_LABELS[session.provider]}`}
                </h2>
                <div className="flex w-full flex-col gap-3">
                  <Link href={from} prefetch={false} className={buttonClassName("primary", "w-full")}>
                    {from === "/" ? "Make a pass" : "Go back"}
                  </Link>
                  <form action={signOutAction}>
                    <input type="hidden" name="returnTo" value="/" />
                    <button type="submit" className={buttonClassName("secondary", "w-full")}>
                      Sign out
                    </button>
                  </form>
                </div>
              </section>
            ) : nothing ? (
              <p className="rounded-xl bg-muted px-4 py-3">{ACCOUNT_COPY.notConfigured}</p>
            ) : (
              <OAuthButtons providers={options.providers} returnTo={returnTo} />
            )}

            <div className="-mb-2 flex items-start gap-2 text-sm text-muted-foreground" data-testid="signin-privacy">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="flex flex-col items-start">
                <span>No email or name kept.</span>
                <Link href="/about#privacy" prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-balance text-link underline underline-offset-4">
                  What we keep (spoiler: not much) and for how long
                </Link>
              </p>
            </div>
          </div>

          {!session?.provider && !nothing && options.judge ? (
            <section aria-labelledby="judge-title" className="gp-signin-stub relative flex flex-col gap-3 px-5 pt-6 pb-6 sm:px-8">
              <h2 id="judge-title" className="font-heading text-base leading-tight font-extrabold text-ink">
                Judging the contest?
              </h2>
              <JudgeButton returnTo={returnTo} variant="secondary" />
              <div className="flex flex-col gap-1">
                <JudgePassesLeft />
                <p className="text-sm text-balance text-muted-foreground">{judgeNote()}</p>
              </div>
            </section>
          ) : null}
        </section>

        <section aria-labelledby="signin-reward" className="relative flex flex-col items-center gap-14 lg:col-start-1 lg:row-start-1 lg:items-start lg:gap-12" data-testid="signin-reward">
          <h2 id="signin-reward" className="text-center font-heading text-3xl leading-[1.05] font-extrabold tracking-tight text-balance text-ink sm:text-4xl lg:text-left lg:text-5xl">
            <span className="block">Your park. Your kid.</span>
            <span className="block text-primary">One page. Phone away.</span>
          </h2>
          <SignInPassPreview preview={preview} />
        </section>
      </div>
    </main>
  );
}
