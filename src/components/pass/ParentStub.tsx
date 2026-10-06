import type { ReactNode } from "react";
import { formatTime, modelLicence } from "@/lib/pass/format";
import type { Pass, SectionId } from "@/lib/pass/schema";
import { SAFETY_FOOTNOTE } from "@/lib/safety/danger-taxa";

const SECTIONS: SectionId[] = ["park", "wild", "lucky"];

/** Fixed, code-written line for the grown-up (ADR 0003: look-only, never eat or pick). */
export const STUB_LOOK_ONLY = "Look only: don't pick, eat, catch or chase anything on this pass.";
/** Shown when finds carry their own fixed safety line (printed on the kid's row, above). */
export const STUB_EACH_LINE = "Read each find's safety line with your kid.";

const shortDayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "2026-09-21" -> "Sep 21" (a calendar day, so formatted in UTC to avoid shifting it). */
export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return shortDayFmt.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Dashed tear line with scissors between the kid pass and the stub (ADR 0004). */
export function TearLine() {
  return (
    <div className="gp-tear" role="separator" aria-label="Cut or tear here: the kid keeps the top, the grown-up keeps the bottom">
      <svg
        className="gp-scissors"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M8.1 8.1L20 20M8.1 15.9L20 4M14.5 12h0" />
      </svg>
      <span className="gp-tear-line" aria-hidden="true" />
      <span aria-hidden="true">cut here · kid keeps the top, grown-up keeps the bottom</span>
      <span className="gp-tear-line" aria-hidden="true" />
    </div>
  );
}

export type ParentStubProps = {
  pass: Pass;
  /** Where the pass lives, printed as text ("grass-pass.example/pass/<id>"). */
  passUrl: string;
  /** S5 slot: the Find This Spot answer. Absent = nothing is rendered. */
  spotAnswer?: ReactNode;
  /** S7 slot: the October box source line(s). Absent = nothing is rendered. */
  october?: ReactNode;
};

/**
 * The grown-up's stub (SPEC §8.4): answer key (the evidence is printed once, on the kid's rows; PM
 * decision 2026-10-05), the Find This Spot answer, safety notes,
 * what is missing and why, data sources with their dates, and which model wrote the clues and when.
 */
export function ParentStub({ pass, passUrl, spotAnswer, october }: ParentStubProps) {
  const licence = modelLicence(pass.model.answered);
  const safety = [...new Set(pass.items.map((it) => it.safety).filter((s): s is string => Boolean(s)))];
  const short = pass.target - pass.items.length;
  const missing = SECTIONS.flatMap((s) => {
    const st = pass.sections[s];
    return st.status === "ok" ? [] : [{ s, message: st.message }];
  });
  const { notGrounded, other } = pass.removed;
  const notes: string[] = [
    ...missing.map((m) => m.message),
    // S5: why there is no Find This Spot map (the kid side shows nothing in that case).
    ...(pass.spot?.status === "none" ? [pass.spot.message] : []),
    ...(short > 0 ? [`No data available for ${short} more ${short === 1 ? "find" : "finds"}: ${short === 1 ? "its clue" : "their clues"} didn't pass our checks, so we left ${short === 1 ? "it" : "them"} off.`] : []),
    ...(notGrounded > 0 ? [`${notGrounded} ${notGrounded === 1 ? "clue" : "clues"} removed: didn't match ${notGrounded === 1 ? "its" : "their"} source.`] : []),
    ...(other > 0 ? [`${other} ${other === 1 ? "clue" : "clues"} removed: gave away the answer or broke a rule.`] : []),
  ];

  return (
    <section className="gp-stub" aria-labelledby="stub-title">
      <div className="gp-stub-head">
        <h2 id="stub-title">For the grown-up: answer key</h2>
        <p className="gp-small">Keep this part. {pass.parentNote}</p>
      </div>

      <h3>Answers</h3>
      <ol className="gp-answers">
        {pass.items.map((it, i) => (
          <li key={i}>
            {i + 1}. <span className="gp-answer-what">{it.answer}</span>
          </li>
        ))}
      </ol>
      {spotAnswer ? <div data-slot="spot-answer">{spotAnswer}</div> : null}
      {/* Full width: in a narrow column the October details stacked ~9 lines and pushed the sheet to 2 pages. */}
      {october ? (
        <p className="gp-small gp-stub-october" data-slot="october-source">
          {october}
        </p>
      ) : null}

      {/* Safety runs full width (S5 print-space fix): as a narrow column it stacked 4-5 lines. */}
      <div className="gp-stub-safety">
        <h3>Safety</h3>
        <p className="gp-small">
          {[STUB_LOOK_ONLY, ...(safety.length > 0 ? [STUB_EACH_LINE] : []), ...(pass.safetyFiltered > 0 ? [SAFETY_FOOTNOTE] : [])].join(" ")}
        </p>
      </div>

      <div className="gp-stub-cols" data-cols={notes.length > 0 ? "2" : "1"}>

        {notes.length > 0 ? (
          <div className="gp-stub-col">
            <h3>Not on this pass</h3>
            <ul className="gp-notes gp-small">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="gp-stub-col">
          <h3>Where this came from</h3>
          <ul className="gp-notes gp-small">
            <li>Map: © OpenStreetMap contributors (ODbL), checked {formatTime(pass.dataCheckedAt.osm)}.</li>
            {pass.dataCheckedAt.inat ? (
              <li>
                Wildlife: iNaturalist observers, research grade, within 1.5 km
                {pass.wildSince ? `, ${shortDay(pass.wildSince)} to ${shortDay(pass.day)}` : ""}; checked {formatTime(pass.dataCheckedAt.inat)}.
              </li>
            ) : null}
            <li>
              Clues: {pass.model.answered} ({licence ? `open model, ${licence}` : "open model"}), made {formatTime(pass.generatedAt)}. Code
              wrote every number and date.
            </li>
            <li>Made with Grass Pass · {passUrl}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
