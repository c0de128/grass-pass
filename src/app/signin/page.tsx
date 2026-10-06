import type { Metadata } from "next";
import Link from "next/link";
import { currentSession } from "@/lib/accounts/current";
import { signOutAction } from "@/app/actions/auth";
import { SignInCard } from "@/components/account/SignInCard";
import { buttonClassName } from "@/components/ui/Button";
import { ACCOUNT_COPY, judgeShareCopy, PROVIDER_LABELS, signInOptions, type ProviderId } from "@/lib/accounts/config";
import { allowedReturnPath } from "@/lib/accounts/redirect";

export const metadata: Metadata = { title: "Sign in · Grass Pass", robots: { index: false, follow: false } };

/** Auth.js error codes (pages.error) and ours, as plain words. Unknown codes get the general line. */
const ERRORS: Record<string, string> = {
  rate_limited: "Whoa, that's a lot of sign-in attempts from your connection. Please wait a few minutes and try again.",
  unavailable: "That sign-in option is not set up here. Try another one below.",
  AccessDenied: "Sign-in was cancelled. Nothing changed, but you can try again below.",
  OAuthCallbackError: "The sign-in page didn't finish. Please try again.",
  Configuration: "Sign-in isn't set up right on this server. Examples and saved passes still work.",
  Verification: "That sign-in link didn't work. Please try again.",
};
const GENERAL_ERROR = "Sign-in didn't work this time. Give it another try.";

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

/**
 * Sign-in page (also Auth.js's sign-in and error page): the same buttons as the pass maker's card, the
 * privacy promise, and where you'll go back to (an allowlisted path only).
 */
export default async function SignInPage(props: PageProps<"/signin">) {
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const from = allowedReturnPath(pathOnly(one(sp.from) ?? one(sp.callbackUrl)), "http://grass-pass.invalid") ?? "/";
  const error = one(sp.error);
  const token = await currentSession();
  const session: { provider?: ProviderId } | null = token ? { provider: token.p } : null;
  const options = signInOptions();

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-10 focus:outline-none sm:py-14">
      <h1 className="text-4xl leading-tight font-extrabold tracking-tight text-ink">Sign in</h1>
      {error ? (
        <div role="alert" className="rounded-2xl bg-muted p-4" data-error-code={error}>
          <p className="font-semibold">{ERRORS[error] ?? GENERAL_ERROR}</p>
        </div>
      ) : null}
      {session?.provider ? (
        <section aria-labelledby="signed-in" className="flex flex-col gap-3 rounded-2xl bg-muted p-4 sm:p-5">
          <h2 id="signed-in" className="text-xl font-extrabold text-ink">
            You&apos;re signed in {session.provider === "judge" ? "to the judge demo" : `with ${PROVIDER_LABELS[session.provider]}`}
          </h2>
          <div className="flex flex-wrap gap-3">
            <Link href={from} prefetch={false} className={buttonClassName("primary")}>
              {from === "/" ? "Make a pass" : "Go back"}
            </Link>
            <form action={signOutAction}>
              <input type="hidden" name="returnTo" value="/" />
              <button type="submit" className={buttonClassName("secondary")}>
                Sign out
              </button>
            </form>
          </div>
        </section>
      ) : (
        <SignInCard options={options} returnTo={from} heading="Sign in to make new passes and report your finds" headingLevel={2} id="signin-page" />
      )}
      <section aria-labelledby="why-sign-in" className="flex flex-col gap-2">
        <h2 id="why-sign-in" className="text-xl font-extrabold text-ink">
          Why sign in?
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Only to make a new pass (2 a day) or to tell us what you found. Examples, shared links and printing work without it.</li>
          <li>{ACCOUNT_COPY.privacy}</li>
          <li>{ACCOUNT_COPY.grownUps}</li>
          <li>
            Judges: <strong>Try as a judge</strong> signs in to a shared demo account in one click, for 1 day. {judgeShareCopy()}
          </li>
        </ul>
        <p>
          <Link href="/about#privacy" prefetch={false} className="font-semibold text-link underline underline-offset-4">
            What we keep (spoiler: not much) and for how long
          </Link>
        </p>
      </section>
    </main>
  );
}
