"use server";

/**
 * Sign in / sign out server actions behind the buttons. Next checks that a server action comes from our own
 * origin (Origin vs Host), which is the CSRF protection here; the provider must be one that is switched on,
 * and the return path is checked against the allowlist in src/lib/accounts/redirect.ts (no open redirects).
 */
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { enabledOAuthProviders, judgeDemoEnabled, authConfigured } from "@/lib/accounts/config";
import { allowedReturnPath } from "@/lib/accounts/redirect";

/** Our own paths only; anything else becomes "/". */
function returnPath(v: FormDataEntryValue | null): string {
  return allowedReturnPath(typeof v === "string" ? v : null, "http://grass-pass.invalid") ?? "/";
}

export async function signInAction(form: FormData): Promise<void> {
  const provider = String(form.get("provider") ?? "");
  const to = returnPath(form.get("returnTo"));
  const allowed: string[] = authConfigured() ? [...enabledOAuthProviders(), ...(judgeDemoEnabled() ? ["judge"] : [])] : [];
  if (!allowed.includes(provider)) redirect(`/signin?error=unavailable`);
  try {
    await signIn(provider, { redirectTo: to });
  } catch (err) {
    // signIn() redirects by throwing; only Auth.js errors (e.g. too many judge sign-ins) are handled here.
    if (err instanceof AuthError) {
      const code = (err as { code?: string }).code === "rate_limited" ? "rate_limited" : "failed";
      redirect(`/signin?error=${code}`);
    }
    throw err;
  }
}

export async function signOutAction(form: FormData): Promise<void> {
  await signOut({ redirectTo: returnPath(form.get("returnTo")) });
}
