"use client";

/**
 * The main journey (SPEC §2 steps 2-5): pick a park (S2's FindAPark) -> "Who's hunting?" age band
 * (4-6, 6-10 default, 10-13; remembered in localStorage only) -> make the pass with the server's real
 * progress steps -> open the pass page. Failures show their exact copy; a model failure also shows
 * the real park data we found (never as a pass).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FindAPark } from "@/components/parks/FindAPark";
import { Button } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";
import type { Park } from "@/lib/parks/schema";
import {
  AGE_BAND_INFO,
  AGE_BAND_STORAGE_KEY,
  AGE_BANDS,
  AgeBandSchema,
  DEFAULT_AGE_BAND,
  type AgeBand,
} from "@/lib/pass/schema";
import { ParkDataList, ProgressSteps, SectionNotes } from "./PassStatus";
import { usePassRequest } from "./usePassRequest";

export function readStoredBand(): AgeBand {
  try {
    const v = AgeBandSchema.safeParse(window.localStorage.getItem(AGE_BAND_STORAGE_KEY));
    return v.success ? v.data : DEFAULT_AGE_BAND;
  } catch {
    return DEFAULT_AGE_BAND;
  }
}

function storeBand(b: AgeBand) {
  try {
    window.localStorage.setItem(AGE_BAND_STORAGE_KEY, b);
  } catch {
    // Private mode / storage off: the default works fine.
  }
}

export function PassMaker() {
  const ids = useId();
  const [park, setPark] = useState<Park | null>(null);
  const [band, setBand] = useState<AgeBand>(DEFAULT_AGE_BAND);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { state, run, reset } = usePassRequest();
  const working = state.kind === "working";

  useEffect(() => {
    if (state.kind === "done") {
      router.push(`/pass/${state.pass.id}${state.cached ? "?reused=1" : ""}`);
    } else if (state.kind === "failed" || state.kind === "empty") {
      resultRef.current?.focus();
    }
  }, [state, router]);

  function onPick(p: Park) {
    reset();
    setPark(p);
    // The age step only appears after a pick, so the remembered band is read here (no effect needed).
    setBand(readStoredBand());
    // Let the age step render, then move focus to it (keyboard and screen-reader users).
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView({ block: "nearest" });
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!park || working) return;
    storeBand(band);
    void run({ parkId: park.id, ageBand: band });
  }

  return (
    <div className="flex flex-col gap-6">
      <FindAPark onPick={onPick} />

      {park ? (
        <TicketCard as="section" aria-labelledby={`${ids}-age`}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Make a pass">
            <h2 id={`${ids}-age`} ref={headingRef} tabIndex={-1} className="text-2xl">
              Who&apos;s hunting at {park.name}?
            </h2>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-lg font-semibold">Age</legend>
              {AGE_BANDS.map((b) => (
                <label
                  key={b}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border-2 border-line bg-surface px-4 py-2 has-[:checked]:bg-chip has-[:checked]:text-on-chip"
                >
                  <input
                    type="radio"
                    name="ageBand"
                    value={b}
                    checked={band === b}
                    onChange={() => setBand(b)}
                    className="h-5 w-5 accent-forest"
                  />
                  <span className="flex flex-col">
                    <span className="font-display text-lg font-semibold">
                      {AGE_BAND_INFO[b].label}
                      {b === DEFAULT_AGE_BAND ? " (most kids)" : ""}
                    </span>
                    <span className="text-base">{AGE_BAND_INFO[b].hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="text-base text-muted">
              Only the park and this age range are sent to make the pass. We remember your choice on this device only.
            </p>
            <Button type="submit" className="self-start" aria-disabled={working || undefined}>
              {working ? "Making your pass…" : "Make my pass"}
            </Button>
          </form>

          {state.kind === "working" ? (
            <div className="mt-4">
              <ProgressSteps steps={state.steps} />
            </div>
          ) : null}

          {state.kind === "done" ? (
            <p role="status" className="mt-4">
              Your pass is ready. Opening it…
            </p>
          ) : null}

          {state.kind === "failed" ? (
            <div ref={resultRef} tabIndex={-1} className="mt-4 flex flex-col gap-3">
              <div role="alert" className="rounded-ticket border-2 border-line bg-surface p-4">
                <p className="font-semibold">{state.message}</p>
              </div>
              {state.parkData ? <ParkDataList data={state.parkData} /> : null}
            </div>
          ) : null}

          {state.kind === "empty" ? (
            <div ref={resultRef} tabIndex={-1} className="mt-4 flex flex-col gap-3">
              <div role="alert" className="rounded-ticket border-2 border-line bg-surface p-4">
                <p className="font-semibold">{state.message}</p>
              </div>
              <SectionNotes sections={state.sections} />
            </div>
          ) : null}
        </TicketCard>
      ) : null}
    </div>
  );
}
