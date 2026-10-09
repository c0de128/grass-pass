"use client";

/** "Make a different pass" (SPEC F5): a new variant for today, with the same real progress steps. */
import { useEffect, useRef, useState } from "react";
import { SignInCard } from "@/components/account/SignInCard";
import { signInPromptFor } from "@/components/account/PassesLeft";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MAX_VARIANTS, type AgeBand } from "@/lib/pass/schema";
import { ParkDataList, ProgressSteps } from "./PassStatus";
import { FREE_GONE_CODES, type PassMakerAccount } from "./PassMaker";
import { usePassRequest } from "./usePassRequest";

/**
 * Accounts: a different pass is a NEW pass. A signed-out visitor with a free pass left today may use it here (Kevin
 * 2026-10-08); without one they get the sign-in card instead.
 */
export function DifferentPassButton({
  parkId,
  ageBand,
  variant,
  madeToday = true,
  example = false,
  account,
  returnTo = "/",
}: {
  parkId: string;
  ageBand: AgeBand;
  variant: number;
  /**
   * Judge R9: was this pass made today (Chicago time)? The 3-a-day limit counts today's passes for this park and age,
   * so an older pass (an example from an earlier day) still offers a different pass for today.
   */
  madeToday?: boolean;
  /**
   * Judge R9: an example page (?example=1) is a showcase, not the visitor's own pass. When today's 3 are used, it shows
   * no limit line (its "Pick another park" link stays); the visitor's own pass page keeps the line.
   */
  example?: boolean;
  account?: PassMakerAccount;
  returnTo?: string;
}) {
  const router = useRouter();
  const { state, run } = usePassRequest();
  const alertRef = useRef<HTMLDivElement>(null);
  const working = state.kind === "working";
  const [askSignIn, setAskSignIn] = useState(false);
  const [freeLeftSeen, setFreeLeftSeen] = useState<number | undefined>(undefined);
  const freeLeft = freeLeftSeen ?? account?.freeLeft ?? 0;
  const failedCode = state.kind === "failed" ? state.code : null;
  const freeGone = failedCode !== null && FREE_GONE_CODES.includes(failedCode);
  const showSignIn = askSignIn || failedCode === "SIGN_IN_REQUIRED" || freeGone;

  useEffect(() => {
    if (state.kind === "done") router.push(`/pass/${state.pass.id}${state.cached ? "?reused=1" : ""}`);
    if (state.kind === "failed" || state.kind === "empty") alertRef.current?.focus();
  }, [state, router]);

  if (madeToday && variant >= MAX_VARIANTS) {
    if (example) return null;
    return <p className="text-base">That&apos;s today&apos;s last different pass for this park and age ({MAX_VARIANTS} of {MAX_VARIANTS}). Come back tomorrow for a new one.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="secondary"
        className="self-start"
        aria-disabled={working || undefined}
        onClick={() => {
          if (working) return;
          if (account && !account.signedIn && freeLeft <= 0) setAskSignIn(true);
          else
            void run({ parkId, ageBand, fresh: true }).then((s) => {
              if ((s.kind === "done" || s.kind === "failed") && s.freeLeft !== undefined) setFreeLeftSeen(s.freeLeft);
              else if (s.kind === "failed" && FREE_GONE_CODES.includes(s.code)) setFreeLeftSeen(0);
            });
        }}
      >
        {working ? "Making a different pass…" : "Make a different pass"}
      </Button>
      {state.kind === "working" ? <ProgressSteps steps={state.steps} /> : null}
      {showSignIn && account ? (
        <SignInCard
          id="different-signin"
          options={account.options}
          returnTo={returnTo}
          {...signInPromptFor({ options: account.options, signedIn: account.signedIn, code: failedCode, what: "a different pass" })}
        />
      ) : null}
      {(state.kind === "failed" && state.code !== "SIGN_IN_REQUIRED" && !freeGone) || state.kind === "empty" ? (
        <div ref={alertRef} tabIndex={-1} className="flex flex-col gap-2">
          <div role="alert" className="rounded-2xl bg-muted p-4">
            <p className="font-semibold">{state.message}</p>
          </div>
          {state.kind === "failed" && state.parkData ? <ParkDataList data={state.parkData} /> : null}
        </div>
      ) : null}
    </div>
  );
}
