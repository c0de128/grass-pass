"use client";

/**
 * The /signin page's buttons (Kevin's option A, 2026-10-08): full-width "Continue with Google" / "Continue with
 * GitHub" with each provider's own mark (only the providers set up on this server), and the separate "Try as a
 * judge" button. Each is a form posting `provider` + `returnTo` to the same server action as the pass maker's card,
 * then tells the header to read the session again. The pass maker's card (SignInCard.tsx) uses the same OAuthButton.
 */
import { Gavel } from "lucide-react";
import { useFormStatus } from "react-dom";
import { signInAction } from "@/app/actions/auth";
import { buttonClassName } from "@/components/ui/Button";
import { PROVIDER_LABELS, type OAuthProviderId } from "@/lib/accounts/config";
import { GitHubMark, GoogleMark } from "./ProviderLogos";
import { announceSessionChange } from "./session-event";

async function submit(fd: FormData) {
  try {
    await signInAction(fd);
  } finally {
    announceSessionChange();
  }
}

/** Google first (its button guidelines), then GitHub. */
export const OAUTH_ORDER: OAuthProviderId[] = ["google", "github"];

/** One "Continue with ..." button (inside any sign-in form); also used by the pass maker's SignInCard. */
export function OAuthButton({ provider, onClick }: { provider: OAuthProviderId; onClick?: () => void }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("provider") === provider;
  const Mark = provider === "google" ? GoogleMark : GitHubMark;
  return (
    <button
      type="submit"
      name="provider"
      value={provider}
      onClick={onClick}
      aria-disabled={pending || undefined}
      data-provider={provider}
      className="gp-oauth-btn relative inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl px-12 py-2 font-heading text-base leading-tight font-bold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
    >
      <span className="absolute top-1/2 left-4 flex size-6 -translate-y-1/2 items-center justify-center">
        <Mark className="size-5" />
      </span>
      {mine ? "Signing in…" : `Continue with ${PROVIDER_LABELS[provider]}`}
    </button>
  );
}

export function OAuthButtons({ providers, returnTo }: { providers: OAuthProviderId[]; returnTo: string }) {
  const shown = OAUTH_ORDER.filter((p) => providers.includes(p));
  if (shown.length === 0) return null;
  return (
    <form action={submit} aria-label="Sign in with an account" className="flex flex-col gap-3">
      <input type="hidden" name="returnTo" value={returnTo} />
      {shown.map((p) => (
        <OAuthButton key={p} provider={p} />
      ))}
    </form>
  );
}

function JudgeSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="provider" value="judge" aria-disabled={pending || undefined} className={buttonClassName("primary", "w-full")}>
      <Gavel className="size-5" aria-hidden="true" />
      {pending ? "Signing in…" : "Try as a judge"}
    </button>
  );
}

export function JudgeButton({ returnTo }: { returnTo: string }) {
  return (
    <form action={submit} className="flex flex-col">
      <input type="hidden" name="returnTo" value={returnTo} />
      <JudgeSubmit />
    </form>
  );
}
