"use client";

/**
 * Header account control (accounts, 2026-10-06): "Sign in" when signed out; when signed in, who (a first name
 * if the provider gave one, else "Signed in with GitHub") and a "Sign out" button. Reads /api/auth/session
 * after the page loads, so every page can stay static; it shows nothing until it knows.
 */
import { LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { signOutAction } from "@/app/actions/auth";
import { PROVIDER_LABELS } from "@/lib/accounts/config";

const SessionSchema = z
  .object({
    user: z.object({ name: z.string().max(40).nullable().optional() }).optional(),
    provider: z.enum(["github", "google", "judge"]).optional(),
  })
  .nullable();

type Who = { signedIn: false } | { signedIn: true; label: string };

export function whoLabel(name: string | null | undefined, provider: "github" | "google" | "judge" | undefined): string {
  if (provider === "judge") return "Judge demo";
  if (name) return `Hi, ${name}`;
  return provider ? `Signed in with ${PROVIDER_LABELS[provider]}` : "Signed in";
}

export function AccountMenu() {
  const [who, setWho] = useState<Who | null>(null);
  const path = usePathname();

  useEffect(() => {
    let live = true;
    fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const s = SessionSchema.safeParse(j);
        const signedIn = s.success && s.data !== null && s.data.provider !== undefined;
        if (live) setWho(signedIn && s.success && s.data ? { signedIn: true, label: whoLabel(s.data.user?.name, s.data.provider) } : { signedIn: false });
      })
      .catch(() => live && setWho({ signedIn: false }));
    return () => {
      live = false;
    };
  }, [path]);

  if (!who) return <span className="inline-block min-h-11 w-0" aria-hidden="true" />;
  if (!who.signedIn) {
    return (
      <Link
        href="/signin"
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-foreground hover:bg-muted"
        data-testid="header-sign-in"
      >
        <LogIn className="size-4" aria-hidden="true" />
        Sign in
      </Link>
    );
  }
  const returnTo = path && path.startsWith("/pass/") && !path.endsWith("/print") ? path : "/";
  return (
    <form action={signOutAction} className="flex items-center gap-2" aria-label="Account">
      <span className="hidden max-w-36 truncate text-sm font-medium text-muted-foreground md:inline" data-testid="header-who">
        {who.label}
      </span>
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-foreground hover:bg-muted">
        <LogOut className="size-4" aria-hidden="true" />
        Sign out<span className="sr-only md:hidden"> ({who.label})</span>
      </button>
    </form>
  );
}
