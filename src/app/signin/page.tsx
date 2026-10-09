import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { currentSession } from "@/lib/accounts/current";
import { signOutAction } from "@/app/actions/auth";
import { JudgePassesLeft } from "@/components/account/SignInCard";
import { JudgeButton, OAuthButtons } from "@/components/account/SignInPageForms";
import { buttonClassName } from "@/components/ui/Button";
import {
  ACCOUNT_COPY,
  accountPassesPerDay,
  freePassesPerDay,
  JUDGE_SESSION_MAX_AGE_SEC,
  judgeDailyCap,
  PROVIDER_LABELS,
  signInOptions,
  type ProviderId,
} from "@/lib/accounts/config";
import { allowedReturnPath, withSignedInFlag } from "@/lib/accounts/redirect";
import { errorText } from "@/lib/accounts/signin-errors";

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

/** The judge demo in one short line, from the same numbers the code uses (SEC-4-02, SEC-4-05). */
function judgeNote(): string {
  const days = Math.round(JUDGE_SESSION_MAX_AGE_SEC / 86_400);
  const cap = judgeDailyCap();
  const base = `One click, no sign-up: a shared demo account for ${days} day${days === 1 ? "" : "s"}`;
  return cap > 0 ? `${base}, ${cap} new passes a day for all judges.` : `${base}.`;
}

/** "Why sign in?" in three short lines (every fact from config/ACCOUNT_COPY: count, privacy, grown-ups). */
function why(): { title: string; detail: string }[] {
  const free = freePassesPerDay();
  return [
    {
      title: `${accountPassesPerDay()} new passes a day`,
      detail: `${free > 0 ? `After your ${free} free pass a day: to` : "To"} make more passes, tell us what you found and rate passes. Examples, shared links and printing work without it.`,
    },
    { title: "We keep no email or name", detail: "Just a scrambled ID, to count your passes, reports and ratings." },
    { title: "Grown-ups only", detail: "Kids just need the printed pass." },
  ];
}

/** The line under "Sign in" (Kevin 2026-10-08: 1 free pass a day without signing in). */
function signInLead(): string {
  const free = freePassesPerDay();
  if (free <= 0) return "Each new pass wakes up a real AI model, so a grown-up signs in first.";
  return `Each new pass wakes up a real AI model. Your first ${free === 1 ? "one" : free} each day is free; signed in, a grown-up gets ${accountPassesPerDay()} a day.`;
}

/**
 * Sign-in page (also Auth.js's sign-in and error page), Kevin's option A (2026-10-08): one ticket in the middle,
 * like the pass maker's dialog (paper body, a tear-off stub; Kevin 2026-10-08: no ink band or logo on top). Google and
 * GitHub (only those set up here), then a separate judge box with the live count, then "Why sign in?" on the stub.
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

  return (
    <main id="main" tabIndex={-1} className="relative isolate flex w-full flex-1 flex-col items-center px-4 py-10 focus:outline-none sm:py-16">
      {/* The hero's dotted grain, fading out around the ticket (decorative). */}
      <div aria-hidden="true" className="gp-signin-grain grain pointer-events-none absolute inset-0 -z-10" />
      <section aria-labelledby="signin-title" className="gp-signin-ticket w-full max-w-[28rem]" data-testid="sign-in-card">
        <div className="gp-signin-main bg-card text-card-foreground">
          <div className="flex flex-col gap-5 px-5 pt-7 pb-8 text-center sm:px-9 sm:pt-8">
            <div className="flex flex-col gap-2">
              <h1 id="signin-title" className="text-4xl leading-tight font-extrabold tracking-tight text-ink">
                Sign in
              </h1>
              <p className="text-base text-muted-foreground text-pretty">{signInLead()}</p>
            </div>

            {error ? (
              <div role="alert" className="gp-signin-error rounded-xl border-l-4 border-destructive px-4 py-3 text-left" data-error-code={error}>
                <p className="font-semibold text-pretty">{errorText(error, one(sp.wait))}</p>
              </div>
            ) : null}

            {session?.provider ? (
              <section aria-labelledby="signed-in" className="flex flex-col items-center gap-3">
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
              <>
                <OAuthButtons providers={options.providers} returnTo={returnTo} />
                {options.judge ? (
                  <>
                    {options.providers.length > 0 ? <hr className="gp-signin-rule" /> : null}
                    <section aria-labelledby="judge-title" className="gp-signin-judge flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
                      <h2 id="judge-title" className="font-heading text-lg leading-tight font-extrabold text-ink">
                        Judging the contest?
                      </h2>
                      <JudgeButton returnTo={returnTo} />
                      <JudgePassesLeft />
                      <p className="text-sm text-balance text-muted-foreground">{judgeNote()}</p>
                    </section>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="gp-signin-stub text-card-foreground">
          <section aria-labelledby="why-sign-in" className="flex flex-col gap-4 px-5 pt-7 pb-7 sm:px-9">
            <h2 id="why-sign-in" className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Why sign in?
            </h2>
            <ul className="flex flex-col gap-3.5">
              {why().map((w) => (
                <li key={w.title} className="flex gap-3">
                  <span aria-hidden="true" className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                  <span className="flex flex-col">
                    <strong className="font-heading text-base leading-snug font-extrabold text-ink">{w.title}</strong>
                    <span className="text-sm text-muted-foreground">{w.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="pt-1 text-sm">
              <Link href="/about#privacy" prefetch={false} className="font-semibold text-link underline underline-offset-4">
                What we keep (spoiler: not much) and for how long
              </Link>
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
