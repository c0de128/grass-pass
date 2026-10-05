"use client";

/** "Make a different pass" (SPEC F5): a new variant for today, with the same real progress steps. */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MAX_VARIANTS, type AgeBand } from "@/lib/pass/schema";
import { ParkDataList, ProgressSteps } from "./PassStatus";
import { usePassRequest } from "./usePassRequest";

export function DifferentPassButton({ parkId, ageBand, variant }: { parkId: string; ageBand: AgeBand; variant: number }) {
  const router = useRouter();
  const { state, run } = usePassRequest();
  const alertRef = useRef<HTMLDivElement>(null);
  const working = state.kind === "working";

  useEffect(() => {
    if (state.kind === "done") router.push(`/pass/${state.pass.id}${state.cached ? "?reused=1" : ""}`);
    if (state.kind === "failed" || state.kind === "empty") alertRef.current?.focus();
  }, [state, router]);

  if (variant >= MAX_VARIANTS) {
    return <p className="text-base">This is today&apos;s last different pass for this park and age ({MAX_VARIANTS} of {MAX_VARIANTS}).</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="secondary"
        className="self-start"
        aria-disabled={working || undefined}
        onClick={() => {
          if (!working) void run({ parkId, ageBand, fresh: true });
        }}
      >
        {working ? "Making a different pass…" : "Make a different pass"}
      </Button>
      {state.kind === "working" ? <ProgressSteps steps={state.steps} /> : null}
      {state.kind === "failed" || state.kind === "empty" ? (
        <div ref={alertRef} tabIndex={-1} className="flex flex-col gap-2">
          <div role="alert" className="rounded-ticket border-2 border-line bg-surface p-4">
            <p className="font-semibold">{state.message}</p>
          </div>
          {state.kind === "failed" && state.parkData ? <ParkDataList data={state.parkData} /> : null}
        </div>
      ) : null}
    </div>
  );
}
