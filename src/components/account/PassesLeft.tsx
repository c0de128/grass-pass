"use client";

/**
 * Pass limits in the wizard (Kevin, 2026-10-08): "how many new passes are left today" next to "Make my pass", and the
 * sign-in step's heading + reason once a signed-out visitor's free pass is used.
 * - Signed out: the free passes left, from the page's own count (the signed cookie, read on the server) and each
 *   answer's count. No request.
 * - Signed in: GET /api/passes-left (the account's real counter; the judge demo: its shared pool), read again after
 *   every finished request. Nothing made up when it can't be read.
 */
import { useEffect, useState } from "react";
import { judgeLeftCopy, perDayWords, type SignInOptions } from "@/lib/accounts/config";

/** UX-4-02: the answer's zod schema loads with the request, not in the first JavaScript. */
const loadSchema = () => import("./judge-left-schema");

export const PASSES_LEFT_COPY = {
  unknown: "We couldn't check how many new passes you have left today right now.",
} as const;

/** Signed out, with a free pass left: said above "Make my pass". */
export function freeLeftLine(freeLeft: number, perDay: number): string {
  return `No sign-in needed: you have ${freeLeft} free ${freeLeft === 1 ? "pass" : "passes"} left today. A grown-up who signs in gets ${perDayWords(perDay)}.`;
}

/** Signed in (not the judge demo). */
export function accountLeftLine(left: number, perDay: number): string {
  if (left <= 0) return `You used your ${perDay} new passes for today. You get ${perDay} more after midnight Dallas time.`;
  return `You have ${left} of ${perDay} new passes left today.`;
}

/** What the sign-in options really offer, in words (only the buttons that exist). */
function nextStep(o: SignInOptions): string {
  const more = perDayWords(o.perDay);
  if (o.providers.length > 0 && o.judge) return `Sign in for ${more}, or press Try as a judge.`;
  if (o.providers.length > 0) return `Sign in for ${more}.`;
  if (o.judge) return "Press Try as a judge to keep going.";
  return "";
}

/**
 * The sign-in card's heading and reason for the wizard and "Make a different pass" (Kevin 2026-10-08: when the free
 * pass is used, a friendly step: sign in for 5 a day, or Try as a judge). `what`: "this pass" / "a different pass".
 */
export function signInPromptFor(p: { options: SignInOptions; signedIn: boolean; code: string | null; what: string }): { heading: string; lead?: string } {
  if (p.signedIn && p.code === "SIGN_IN_REQUIRED") return { heading: `Please sign in again to make ${p.what}` };
  if (p.options.free <= 0) return { heading: `Sign in to make ${p.what}` };
  const back = "Saved passes and examples still work, and your free pass comes back after midnight Dallas time.";
  if (p.code === "ANON_IP_DAILY_LIMIT") {
    return { heading: "This connection's free passes are used for today", lead: `${nextStep(p.options)} ${back}`.trim() };
  }
  return { heading: "You used today's free pass", lead: `${nextStep(p.options)} ${back}`.trim() };
}

type Props = { signedIn: boolean; judge: boolean; freeLeft: number; options: SignInOptions; refresh: number };

export function PassesLeftLine({ signedIn, judge, freeLeft, options, refresh }: Props) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    Promise.all([fetch("/api/passes-left", { cache: "no-store", credentials: "same-origin" }), loadSchema()])
      .then(async ([r, { PassesLeftSchema }]) => {
        const parsed = PassesLeftSchema.safeParse(r.ok ? await r.json() : null);
        if (!live) return;
        if (!parsed.success || parsed.data.kind === "free") setText(PASSES_LEFT_COPY.unknown);
        else if (parsed.data.kind === "judge") setText(judgeLeftCopy(parsed.data));
        else setText(accountLeftLine(parsed.data.left, parsed.data.perDay));
      })
      .catch(() => live && setText(PASSES_LEFT_COPY.unknown));
    return () => {
      live = false;
    };
  }, [signedIn, judge, refresh]);
  const line = signedIn ? text : options.free > 0 ? freeLeftLine(freeLeft, options.perDay) : null;
  return (
    <p className="min-h-6 text-base font-semibold" data-testid="passes-left" aria-live="polite">
      {line ?? ""}
    </p>
  );
}
