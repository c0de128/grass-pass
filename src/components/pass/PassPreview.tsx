import Link from "next/link";
import { Chip, SECTION_LABELS } from "@/components/ui/Chip";
import { TicketCard } from "@/components/ui/TicketCard";
import { LUCKY_MAYBE } from "./KidPass";
import { ItemReport } from "./ItemReport";
import { OctoberBox } from "./OctoberBox";
import type { PassItemStats } from "@/lib/reports/stats";
import { WINDOW_DAYS } from "@/lib/reports/kinds";
import { SpotMap } from "./SpotMap";
import { SAFETY_FOOTNOTE } from "@/lib/safety/danger-taxa";
import { safeParkName } from "@/lib/ai/validate";
import { BUILT_WITH_LLAMA, formatDay, formatTime, isLlamaModel, modelLicence, WIKIPEDIA_CREDIT } from "@/lib/pass/format";
import { AGE_BAND_INFO, type Pass, type PassItem, type SectionId } from "@/lib/pass/schema";

const SECTIONS: SectionId[] = ["park", "wild", "lucky"];

const DIFFICULTY: Record<PassItem["difficulty"], string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/**
 * Screen preview of a pass (SPEC F5): ticket card with the kid's finds by section (clue, where to look,
 * code-written evidence and safety line), honest "No data available" lines for empty sections, and a
 * stub for the grown-up (answer key, sources, which model made it and when).
 * Model text is rendered as plain text only.
 */
/** Accounts: report buttons for signed-in grown-ups, and real report counts (only items with reports). */
export type PassReports = { signedIn: boolean; stats: PassItemStats };

/** "Visitor reports, last 30 days: 3 found it, 1 didn't" (nothing when there are none). */
export function reportStatsLine(s: { found: number; notFound: number } | undefined): string | null {
  if (!s || s.found + s.notFound === 0) return null;
  const parts: string[] = [];
  if (s.found > 0) parts.push(`${s.found} found it`);
  if (s.notFound > 0) parts.push(`${s.notFound} didn't`);
  return `Visitor reports, last ${WINDOW_DAYS} days: ${parts.join(", ")}`;
}

export function PassPreview({ pass, reused = false, reports }: { pass: Pass; reused?: boolean; reports?: PassReports }) {
  const numbered = new Map<PassItem, number>();
  pass.items.forEach((it, i) => numbered.set(it, i + 1));
  const short = pass.target - pass.items.length;
  const licence = modelLicence(pass.model.answered);
  const madeAt = formatTime(pass.generatedAt);
  // R2-m3: an OSM name with a web address or phone number in it is never shown (the stub says why).
  const parkName = safeParkName(pass.park.name).name;

  return (
    <TicketCard
      as="article"
      aria-labelledby="pass-title"
      stub={<ParentStub pass={pass} numbered={numbered} />}
    >
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <p className="text-xs font-bold tracking-widest text-primary uppercase">Grass Pass · written for this park</p>
          <h1 id="pass-title" className="text-4xl leading-tight font-extrabold tracking-tight text-ink">
            {parkName}
          </h1>
          <p className="text-base text-muted-foreground">
            {AGE_BAND_INFO[pass.ageBand].label} · {formatDay(pass.day)} · {pass.items.length} {pass.items.length === 1 ? "find" : "finds"}
          </p>
        </header>

        {reports && pass.items.some((it) => it.ref) ? (
          <p className="rounded-control bg-muted px-3 py-2 text-sm print:hidden" data-testid="report-intro">
            {reports.signedIn ? (
              "Back from the park? Tap what you found. It helps the next family, and a find nobody can spot (or that isn't safe) gets left off new passes."
            ) : (
              <>
                Grown-ups: back from the park?{" "}
                <Link href={`/signin?from=${encodeURIComponent(`/pass/${pass.id}`)}`} prefetch={false} className="font-semibold text-link underline underline-offset-4">
                  Sign in
                </Link>{" "}
                to tell us what you found. It helps the next family, and a find nobody can spot (or that isn&apos;t safe) gets left off new passes.
              </>
            )}
          </p>
        ) : null}

        {/* R1-m10: a switched-off section (Lucky Finds without SerpApi) is left off the kid's side; the stub keeps the honest note. */}
        {SECTIONS.filter((s) => pass.sections[s].status !== "off" || pass.items.some((i) => i.section === s)).map((s) => {
          const items = pass.items.filter((i) => i.section === s);
          const state = pass.sections[s];
          return (
            <section key={s} aria-labelledby={`sec-${s}`} className="flex flex-col gap-2">
              <h2 id={`sec-${s}`} className="text-xl">
                <Chip kind={s} />
              </h2>
              {s === "lucky" && items.length > 0 ? (
                <p className="text-base">Maybe finds: they come and go, so missing one is totally fine. Visitors&apos; Google reviews say people spot them here.</p>
              ) : null}
              {items.length > 0 ? (
                <ol className="flex flex-col gap-3">
                  {items.map((it) => (
                    <li key={numbered.get(it)} className="flex gap-3">
                      <span aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 rounded-sm border-2 border-line" />
                      <div className="flex flex-col gap-0.5">
                        <p className="text-lg font-semibold">
                          <span className="sr-only">Find {numbered.get(it)}: </span>
                          {it.section === "lucky" ? <span>{LUCKY_MAYBE} </span> : null}
                          {it.clue}
                        </p>
                        {it.lookWhere ? <p className="text-base">Look: {it.lookWhere}</p> : null}
                        <p className="text-sm">
                          {DIFFICULTY[it.difficulty]} · {it.evidence}
                        </p>
                        {it.safety ? <p className="text-sm font-semibold">{it.safety}</p> : null}
                        {reports && it.ref && reportStatsLine(reports.stats[it.ref]) ? (
                          <p className="text-sm text-muted-foreground" data-testid="report-stats">
                            {reportStatsLine(reports.stats[it.ref])}
                          </p>
                        ) : null}
                        {reports?.signedIn && it.ref ? <ItemReport passId={pass.id} itemRef={it.ref} findNumber={numbered.get(it) ?? 0} /> : null}
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
            No data available for {short} more {short === 1 ? "find" : "finds"}: {short === 1 ? "its clue" : "their clues"}{" "}
            didn&apos;t pass our checks, so we left {short === 1 ? "it" : "them"} off.
          </p>
        ) : null}

        {pass.spot ? <SpotMap spot={pass.spot} parkName={parkName} variant="screen" /> : null}

        <OctoberBox pass={pass} />

        <p className="text-sm">
          Clues written {madeAt}
          {reused ? " (reused for this park today)" : ""} by <strong>{pass.model.answered}</strong>
          {licence ? ` (open model, ${licence})` : " (open model)"} from this park&apos;s data. Code checked each one against its
          source.
          {isLlamaModel(pass.model.answered) ? (
            <>
              {" "}
              <strong data-testid="built-with-llama">{BUILT_WITH_LLAMA}</strong>.
            </>
          ) : null}
        </p>
      </div>
    </TicketCard>
  );
}

function ParentStub({ pass, numbered }: { pass: Pass; numbered: Map<PassItem, number> }) {
  const removed = pass.removed.notGrounded;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-extrabold text-ink">For the grown-up</h2>
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
        {pass.items.some((it) => it.section === "wild") ? <li>{WIKIPEDIA_CREDIT}</li> : null}
        {pass.dataCheckedAt.lucky ? (
          <li>
            Visitor reviews checked {formatTime(pass.dataCheckedAt.lucky)} (Google reviews via SerpApi). We only count reviews that mention a
            Lucky Find in the last 2 years; review text is never shown or sent to the AI.
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
