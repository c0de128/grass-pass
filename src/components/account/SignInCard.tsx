"use client";

/**
 * "Sign in to make this pass" (accounts, Kevin 2026-10-06): "Continue with Google / GitHub" with their logos (2026-10-08; only the ones set up on this
 * server) and the big one-click "Try as a judge". Each button submits a form to a server action, then tells
 * the header to read the session again; `onBeforeSignIn` lets the pass maker remember the park + age so the home
 * page can restore them after the round trip (sessionStorage, this tab only).
 * SEC-4-02: under the judge button, the real number of judge passes left today (GET /api/judge-passes), or
 * an honest line when it can't be checked.
 */
import { Gavel, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction } from "@/app/actions/auth";
import { buttonClassName } from "@/components/ui/Button";
import { ACCOUNT_COPY, judgeLeftCopy, perDayWords, type SignInOptions } from "@/lib/accounts/config";
import { OAUTH_ORDER, OAuthButton } from "./SignInPageForms";
import { announceSessionChange } from "./session-event";

function ProviderButton({ provider, label, judge, onClick }: { provider: string; label: string; judge?: boolean; onClick?: () => void }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("provider") === provider;
  return (
    <button
      type="submit"
      name="provider"
      value={provider}
      onClick={onClick}
      aria-disabled={pending || undefined}
      className={buttonClassName(judge ? "primary" : "secondary", "w-full")}
    >
      {judge ? <Gavel className="size-5" aria-hidden="true" /> : <LogIn className="size-5" aria-hidden="true" />}
      {mine ? "Signing in…" : label}
    </button>
  );
}

/** UX-4-02: the answer's zod schema loads with the request, not in the first JavaScript. */
const loadLeftSchema = () => import("./judge-left-schema");

/** "N of 60 judge passes left today": read when the card shows; nothing made up when it can't be read. */
export function JudgePassesLeft() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([fetch("/api/judge-passes", { cache: "no-store", credentials: "same-origin" }), loadLeftSchema()])
      .then(async ([r, { LeftSchema }]) => {
        const parsed = LeftSchema.safeParse(r.ok ? await r.json() : null);
        if (live) setText(parsed.success ? judgeLeftCopy(parsed.data) : "We couldn't check how many judge passes are left today right now.");
      })
      .catch(() => live && setText("We couldn't check how many judge passes are left today right now."));
    return () => {
      live = false;
    };
  }, []);
  return (
    <p className="min-h-5 text-sm font-semibold" data-testid="judge-left" aria-live="polite">
      {text ?? ""}
    </p>
  );
}

/** Every sign-in button posts to the server action, then the header reads the session again. */
async function submit(fd: FormData) {
  try {
    await signInAction(fd);
  } finally {
    announceSessionChange();
  }
}

export function SignInCard({
  options,
  returnTo,
  heading = "Sign in to make this pass",
  headingLevel = 3,
  onBeforeSignIn,
  id,
  compact = false,
  lead,
}: {
  options: SignInOptions;
  returnTo: string;
  heading?: string;
  headingLevel?: 2 | 3;
  onBeforeSignIn?: () => void;
  id?: string;
  /** UX-5-06: /signin keeps the card to the reason, the buttons and the live counter; its "Why sign in?" list has the details. */
  compact?: boolean;
  /** Kevin 2026-10-08: the line under the heading, when the caller has a better reason (e.g. "You used today's free pass"). */
  lead?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  // Google first (its button guidelines), then GitHub; only the ones set up on this server.
  const providers = OAUTH_ORDER.filter((p) => options.providers.includes(p));
  const headingId = id ? `${id}-heading` : undefined;
  if (!options.configured || (options.providers.length === 0 && !options.judge)) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-2xl bg-muted p-4" data-testid="sign-in-card">
        <H id={headingId} className="text-xl font-extrabold text-ink">
          {heading}
        </H>
        <p>{ACCOUNT_COPY.notConfigured}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-2xl bg-muted p-4 sm:p-5" data-testid="sign-in-card">
      <H id={headingId} tabIndex={-1} className="text-xl font-extrabold text-ink focus:outline-none">
        {heading}
      </H>
      <p className="text-base" data-testid="sign-in-lead">
        {lead ??
          (compact
            ? "Each new pass wakes up a real AI model, so a grown-up signs in for more."
            : `Each new pass wakes up a real AI model. ${
                options.free > 0 ? `After ${options.free} free pass a day, a grown-up signs in: ` : "A grown-up signs in first: "
              }${perDayWords(options.perDay)} each. Examples and saved passes need no sign-in. ${ACCOUNT_COPY.grownUps}`)}
      </p>
      {options.judge ? (
        <form action={submit} className="flex flex-col gap-2">
          <input type="hidden" name="returnTo" value={returnTo} />
          <ProviderButton provider="judge" label="Try as a judge" judge onClick={onBeforeSignIn} />
          <JudgePassesLeft />
          {compact ? null : <p className="text-sm text-muted-foreground">{ACCOUNT_COPY.judgeNote}</p>}
        </form>
      ) : null}
      {options.judge && providers.length > 0 ? (
        <p aria-hidden="true" className="flex items-center gap-3 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          <span className="h-px flex-1 bg-line/40" />
          or
          <span className="h-px flex-1 bg-line/40" />
        </p>
      ) : null}
      {providers.length > 0 ? (
        <form action={submit} className="flex flex-col gap-3" aria-label="Sign in with an account">
          <input type="hidden" name="returnTo" value={returnTo} />
          {providers.map((p) => (
            <OAuthButton key={p} provider={p} onClick={onBeforeSignIn} />
          ))}
        </form>
      ) : null}
      {compact ? null : <p className="text-sm text-muted-foreground">{ACCOUNT_COPY.privacy}</p>}
    </section>
  );
}
