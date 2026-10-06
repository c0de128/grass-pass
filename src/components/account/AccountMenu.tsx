"use client";

/**
 * Header account control (accounts, 2026-10-06): "Sign in" when signed out; when signed in, who (a first name
 * if the provider gave one, else "Signed in with GitHub") and a "Sign out" button. Reads /api/me after the
 * page loads, so every page can stay static; it shows nothing until it knows. SEC-4-04: /api/me only reads
 * the session cookie and never sets one (Auth.js's /api/auth/session gave anonymous visitors 2 cookies).
 */
import { LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { PROVIDER_LABELS } from "@/lib/accounts/config";
import { announceSessionChange, SESSION_EVENT } from "./session-event";
// UX-4-02: a small hand-written check (no zod), so the header does not pull zod into every page's first JavaScript.
import { parseMe } from "./session-schema";


type Who = { signedIn: false } | { signedIn: true; label: string };

export function whoLabel(name: string | null | undefined, provider: "github" | "google" | "judge" | undefined): string {
  if (provider === "judge") return "Judge demo";
  if (name) return `Hi, ${name}`;
  return provider ? `Signed in with ${PROVIDER_LABELS[provider]}` : "Signed in";
}

/** UX-5-05: what the header says (polite status) after a sign-in from /signin lands with ?signedin=1. */
export function signedInAnnouncement(provider: "github" | "google" | "judge"): string {
  return provider === "judge" ? "Signed in as a judge. You can make a pass now." : "Signed in. You can make a pass now.";
}

/** The current address without ?signedin=1 (other query parts kept). */
export function withoutSignedInFlag(href: string): string {
  const u = new URL(href);
  u.searchParams.delete("signedin");
  return `${u.pathname}${u.search}${u.hash}`;
}

export function AccountMenu() {
  const [who, setWho] = useState<Who | null>(null);
  const [announce, setAnnounce] = useState("");
  const [version, setVersion] = useState(0);
  const path = usePathname();

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(SESSION_EVENT, bump);
    return () => window.removeEventListener(SESSION_EVENT, bump);
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const s = parseMe(j);
        if (!live) return;
        setWho(s.success && s.data.signedIn ? { signedIn: true, label: whoLabel(s.data.name, s.data.provider) } : { signedIn: false });
        // UX-5-05: back from the sign-in page: say so, move focus to the page's main content, clean the address.
        if (new URLSearchParams(window.location.search).get("signedin") === "1") {
          window.history.replaceState(window.history.state, "", withoutSignedInFlag(window.location.href));
          if (s.success && s.data.signedIn) {
            setAnnounce(signedInAnnouncement(s.data.provider));
            document.getElementById("main")?.focus();
          }
        }
      })
      .catch(() => live && setWho({ signedIn: false }));
    return () => {
      live = false;
    };
  }, [path, version]);

  const status = (
    <p role="status" className="sr-only" data-testid="signin-announce">
      {announce}
    </p>
  );
  if (!who) {
    return (
      <>
        <span className="inline-block min-h-11 w-0" aria-hidden="true" />
        {status}
      </>
    );
  }
  if (!who.signedIn) {
    return (
      <>
      {status}
      <Link
        href="/signin"
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold whitespace-nowrap text-foreground hover:bg-muted max-[359px]:gap-1 max-[359px]:px-1"
        data-testid="header-sign-in"
      >
        <LogIn className="size-4" aria-hidden="true" />
        Sign in
      </Link>
      </>
    );
  }
  const returnTo = path && path.startsWith("/pass/") && !path.endsWith("/print") ? path : "/";
  return (
    <>
    {status}
    <form
      action={async (fd: FormData) => {
        try {
          await signOutAction(fd);
        } finally {
          announceSessionChange();
        }
      }}
      className="flex items-center gap-2"
      aria-label="Account"
    >
      <span className="hidden max-w-36 truncate text-sm font-medium text-muted-foreground md:inline" data-testid="header-who">
        {who.label}
      </span>
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold whitespace-nowrap text-foreground hover:bg-muted max-[359px]:gap-1 max-[359px]:px-1">
        <LogOut className="size-4" aria-hidden="true" />
        Sign out<span className="sr-only md:hidden"> ({who.label})</span>
      </button>
    </form>
    </>
  );
}
