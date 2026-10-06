"use client";

/**
 * "Sign in to make this pass" (accounts, Kevin 2026-10-06): GitHub / Google (only the ones set up on this
 * server) and the big one-click "Try as a judge". Each button submits a form to a server action, then tells
 * the header to read the session again; `onBeforeSignIn` lets the pass maker remember the park + age so the home
 * page can restore them after the round trip (sessionStorage, this tab only).
 */
import { Gavel, LogIn } from "lucide-react";
import { useFormStatus } from "react-dom";
import { signInAction } from "@/app/actions/auth";
import { buttonClassName } from "@/components/ui/Button";
import { ACCOUNT_COPY, PROVIDER_LABELS, type SignInOptions } from "@/lib/accounts/config";
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
      className={buttonClassName(judge ? "primary" : "secondary", "w-full sm:w-auto")}
    >
      {judge ? <Gavel className="size-5" aria-hidden="true" /> : <LogIn className="size-5" aria-hidden="true" />}
      {mine ? "Signing in…" : label}
    </button>
  );
}

export function SignInCard({
  options,
  returnTo,
  heading = "Sign in to make this pass",
  headingLevel = 3,
  onBeforeSignIn,
  id,
}: {
  options: SignInOptions;
  returnTo: string;
  heading?: string;
  headingLevel?: 2 | 3;
  onBeforeSignIn?: () => void;
  id?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
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
      <p className="text-base">
        New passes need a grown-up to sign in: 2 a day each. {ACCOUNT_COPY.grownUps}
      </p>
      <form
        action={async (fd: FormData) => {
          try {
            await signInAction(fd);
          } finally {
            announceSessionChange();
          }
        }}
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap" aria-label="Sign in">
        <input type="hidden" name="returnTo" value={returnTo} />
        {options.judge ? <ProviderButton provider="judge" label="Try as a judge" judge onClick={onBeforeSignIn} /> : null}
        {options.providers.map((p) => (
          <ProviderButton key={p} provider={p} label={`Sign in with ${PROVIDER_LABELS[p]}`} onClick={onBeforeSignIn} />
        ))}
      </form>
      {options.judge ? <p className="text-sm text-muted-foreground">{ACCOUNT_COPY.judgeNote}</p> : null}
      <p className="text-sm text-muted-foreground">{ACCOUNT_COPY.privacy}</p>
    </section>
  );
}
