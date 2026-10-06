import { Chip } from "@/components/ui/Chip";
import type { ParkData, Pass, PassStep } from "@/lib/pass/schema";

/** The usual order of a new pass, for the "still to come" list (labels only; the real text comes from the server). */
const PLAN: { step: PassStep; label: string }[] = [
  { step: "map", label: "Read the park map" },
  { step: "wildlife", label: "Check recent wildlife sightings" },
  { step: "clues", label: "Write the clues" },
  { step: "check", label: "Check every clue" },
];

/**
 * Real progress from the server, as a checklist (SPEC §8.3 "Progress steps": text list with
 * checkmarks, aria-live polite). Earlier steps are done; the last one is in progress. Steps that have
 * not started yet are listed after it (outside the live region, so they are not announced).
 */
export function ProgressSteps({ steps }: { steps: { step: PassStep; text: string }[] }) {
  const seen = new Set<PassStep>(steps.map((s) => (s.step === "retry" ? "clues" : s.step)));
  const upcoming = steps.length === 0 ? [] : PLAN.filter((p) => !seen.has(p.step));
  return (
    <div className="flex flex-col gap-1">
    <div role="status" aria-live="polite" className="flex flex-col gap-1">
      {steps.length === 0 ? (
        <p>Starting…</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {steps.map((s, i) => {
            const done = i < steps.length - 1;
            return (
              <li key={`${s.step}-${i}`} className="flex items-start gap-2">
                <span aria-hidden="true" className="w-5 shrink-0 font-bold">
                  {done ? "✓" : "…"}
                </span>
                <span>
                  {s.text}
                  {done ? <span className="sr-only"> Done.</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
      {upcoming.length > 0 ? (
        <ol className="flex flex-col gap-1 text-muted-foreground" aria-label="Still to come">
          {upcoming.map((u) => (
            <li key={u.step} className="flex items-start gap-2">
              <span aria-hidden="true" className="w-5 shrink-0 font-bold">
                ○
              </span>
              <span>{u.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Section states that are not "ok", each with its exact "No data available" copy (SPEC §5.4). */
export function SectionNotes({ sections }: { sections: Pass["sections"] }) {
  const rows = (["park", "wild", "lucky"] as const).filter((k) => sections[k].status !== "ok");
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((k) => {
        const s = sections[k];
        return (
          <li key={k} className="flex flex-col items-start gap-1">
            <Chip kind={k} />
            <p>{"message" in s ? s.message : null}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** When the model failed: the real park data we found, clearly NOT a pass (it has no clues). */
export function ParkDataList({ data }: { data: ParkData }) {
  if (data.items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-lg">Real data we found for {data.parkName} (no clues yet, so this isn&apos;t a pass)</h3>
      <ul className="flex flex-col gap-1">
        {data.items.map((i, n) => (
          <li key={`${i.section}-${n}`}>
            <span className="font-semibold">{i.answer}</span> <span className="text-sm">({i.evidence})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
