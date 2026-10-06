"use client";

/** "Make a different pass" (SPEC F5): a new variant for today, with the same real progress steps. */
import { useEffect, useRef, useState } from "react";
import { SignInCard } from "@/components/account/SignInCard";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MAX_VARIANTS, type AgeBand } from "@/lib/pass/schema";
import { ParkDataList, ProgressSteps } from "./PassStatus";
import type { PassMakerAccount } from "./PassMaker";
import { usePassRequest } from "./usePassRequest";

/** Accounts: a different pass is a NEW pass, so a signed-out visitor gets the sign-in card instead. */
export function DifferentPassButton({
  parkId,
  ageBand,
  variant,
  account,
  returnTo = "/",
}: {
  parkId: string;
  ageBand: AgeBand;
  variant: number;
  account?: PassMakerAccount;
  returnTo?: string;
}) {
  const router = useRouter();
  const { state, run } = usePassRequest();
  const alertRef = useRef<HTMLDivElement>(null);
  const working = state.kind === "working";
  const [askSignIn, setAskSignIn] = useState(false);
  const showSignIn = askSignIn || (state.kind === "failed" && state.code === "SIGN_IN_REQUIRED");

  useEffect(() => {
    if (state.kind === "done") router.push(`/pass/${state.pass.id}${state.cached ? "?reused=1" : ""}`);
    if (state.kind === "failed" || state.kind === "empty") alertRef.current?.focus();
  }, [state, router]);

  if (variant >= MAX_VARIANTS) {
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
          if (account && !account.signedIn) setAskSignIn(true);
          else void run({ parkId, ageBand, fresh: true });
        }}
      >
        {working ? "Making a different pass…" : "Make a different pass"}
      </Button>
      {state.kind === "working" ? <ProgressSteps steps={state.steps} /> : null}
      {showSignIn && account ? <SignInCard id="different-signin" options={account.options} returnTo={returnTo} heading="Sign in to make a different pass" /> : null}
      {(state.kind === "failed" && state.code !== "SIGN_IN_REQUIRED") || state.kind === "empty" ? (
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
