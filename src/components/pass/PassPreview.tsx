import { Chip, SECTION_LABELS } from "@/components/ui/Chip";
import { TicketCard } from "@/components/ui/TicketCard";
import { OctoberBox } from "./OctoberBox";
import { SpotMap } from "./SpotMap";
import { SAFETY_FOOTNOTE } from "@/lib/safety/danger-taxa";
import { formatDay, formatTime, modelLicence } from "@/lib/pass/format";
import { AGE_BAND_INFO, type Pass, type PassItem, type SectionId } from "@/lib/pass/schema";

const SECTIONS: SectionId[] = ["park", "wild", "lucky"];

const DIFFICULTY: Record<PassItem["difficulty"], string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/**
 * Screen preview of a pass (SPEC F5): ticket card with the kid's finds by section (clue, where to look,
 * code-written evidence and safety line), honest "No data available" lines for empty sections, and a
 * stub for the grown-up (answer key, sources, which model made it and when).
 * Model text is rendered as plain text only.
 */
export function PassPreview({ pass, reused = false }: { pass: Pass; reused?: boolean }) {
  const numbered = new Map<PassItem, number>();
  pass.items.forEach((it, i) => numbered.set(it, i + 1));
  const short = pass.target - pass.items.length;
  const licence = modelLicence(pass.model.answered);
  const madeAt = formatTime(pass.generatedAt);

  return (
    <TicketCard
      as="article"
      aria-labelledby="pass-title"
      stub={<ParentStub pass={pass} numbered={numbered} />}
    >
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <p className="font-display text-sm font-bold uppercase tracking-wide">Grass Pass · your ticket to get outside</p>
          <h1 id="pass-title" className="text-3xl font-bold">
            {pass.park.name}
          </h1>
          <p className="text-base">
            {AGE_BAND_INFO[pass.ageBand].label} · {formatDay(pass.day)} · {pass.items.length} {pass.items.length === 1 ? "find" : "finds"}
          </p>
        </header>

        {/* R1-m10: a switched-off section (Lucky Finds without SerpApi) is left off the kid's side; the stub keeps the honest note. */}
        {SECTIONS.filter((s) => pass.sections[s].status !== "off" || pass.items.some((i) => i.section === s)).map((s) => {
          const items = pass.items.filter((i) => i.section === s);
          const state = pass.sections[s];
          return (
            <section key={s} aria-labelledby={`sec-${s}`} className="flex flex-col gap-2">
              <h2 id={`sec-${s}`} className="text-xl">
                <Chip kind={s} />
              </h2>
              {items.length > 0 ? (
                <ol className="flex flex-col gap-3">
                  {items.map((it) => (
                    <li key={numbered.get(it)} className="flex gap-3">
                      <span aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 rounded-sm border-2 border-line" />
                      <div className="flex flex-col gap-0.5">
                        <p className="text-lg font-semibold">
                          <span className="sr-only">Find {numbered.get(it)}: </span>
                          {it.clue}
                        </p>
                        {it.lookWhere ? <p className="text-base">Look: {it.lookWhere}</p> : null}
                        <p className="text-sm">
                          {DIFFICULTY[it.difficulty]} · {it.evidence}
                        </p>
                        {it.safety ? <p className="text-sm font-semibold">{it.safety}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : state.status !== "ok" ? (
                <p className="rounded-control border-2 border-dashed border-line px-3 py-2">{state.message}</p>
              ) : (
                <p className="rounded-control border-2 border-dashed border-line px-3 py-2">
                  No data available: none of the {SECTION_LABELS[s]} clues passed our checks this time.
                </p>
              )}
            </section>
          );
        })}

        {short > 0 ? (
          <p className="rounded-control border-2 border-dashed border-line px-3 py-2">
            No data available for {short} more {short === 1 ? "find" : "finds"}: the clues we got for them didn&apos;t pass our
            checks, so we left them off instead of guessing.
          </p>
        ) : null}

        {pass.spot ? <SpotMap spot={pass.spot} parkName={pass.park.name} variant="screen" /> : null}

        <OctoberBox pass={pass} />

        <p className="text-sm">
          Made {madeAt}
          {reused ? " (reused for this park today)" : ""} by <strong>{pass.model.answered}</strong>
          {licence ? ` (open model, ${licence})` : " (open model)"}.
        </p>
      </div>
    </TicketCard>
  );
}

function ParentStub({ pass, numbered }: { pass: Pass; numbered: Map<PassItem, number> }) {
  const removed = pass.removed.notGrounded;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl">For the grown-up</h2>
      {pass.parentNote ? <p>{pass.parentNote}</p> : null}
      <details>
        <summary className="cursor-pointer font-semibold">Answer key (don&apos;t peek, kids!)</summary>
        <ol className="mt-2 flex flex-col gap-1">
          {pass.items.map((it) => (
            <li key={numbered.get(it)}>
              {numbered.get(it)}. <span className="font-semibold">{it.answer}</span> <span className="text-sm">({it.evidence})</span>
            </li>
          ))}
        </ol>
        {pass.spot?.status === "ok" ? (
          <p className="mt-2" data-testid="spot-answer">
            <span className="font-semibold">Find This Spot: {pass.spot.target.answer}.</span>{" "}
            <span className="text-sm">
              OpenStreetMap {pass.spot.target.osmId}
              {pass.spot.target.name ? ` ("${pass.spot.target.name}")` : ""}
              {pass.spot.start ? `; START: ${pass.spot.start.label}` : ""}
              {pass.spot.walk ? `, about ${pass.spot.walk.meters} m ${pass.spot.walk.direction} of START` : ""}.
              {pass.spot.riddleBy === "code" ? " The open model's riddle didn't pass our checks, so the pass uses a fixed one." : ""}
            </span>
          </p>
        ) : null}
      </details>
      <ul className="flex flex-col gap-1 text-sm">
        {/* R1-m10: switched-off sections are noted here for the grown-up, not on the kid's side. */}
        {SECTIONS.map((s) => pass.sections[s]).map((st, i) => (st.status === "off" ? <li key={`off-${i}`}>{st.message}</li> : null))}
        {pass.safetyFiltered > 0 ? <li>{SAFETY_FOOTNOTE}</li> : null}
        {pass.removed.other > 0 ? (
          <li>
            {pass.removed.other} {pass.removed.other === 1 ? "clue was" : "clues were"} removed because{" "}
            {pass.removed.other === 1 ? "it" : "they"} gave away the answer or broke one of our rules.
          </li>
        ) : null}
        {removed > 0 ? (
          <li>
            {removed} {removed === 1 ? "clue was" : "clues were"} removed because {removed === 1 ? "it" : "they"} didn&apos;t match
            {removed === 1 ? " its" : " their"} source.
          </li>
        ) : null}
        <li>
          Park map checked {formatTime(pass.dataCheckedAt.osm)} (
          <a className="underline" href="https://www.openstreetmap.org/copyright">
            © OpenStreetMap contributors
          </a>
          ).
        </li>
        {pass.dataCheckedAt.inat ? (
          <li>
            Wildlife sightings checked {formatTime(pass.dataCheckedAt.inat)} (iNaturalist observers, research grade, within 1.5 km, last 14 days).
          </li>
        ) : null}
        <li>
          Clues by {pass.model.answered}, an open-weight model anyone can download and run. Our code picks what is safe and writes
          every number and date; the model only chooses from real park data and writes the words.
        </li>
      </ul>
    </div>
  );
}
