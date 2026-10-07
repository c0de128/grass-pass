"use client";

/**
 * The wizard's "Making your pass" moment (Kevin 2026-10-07: "a fun animation when the pass is being created").
 *
 * Everything here follows the server's REAL progress lines (POST /api/pass NDJSON `step` lines, emitted by
 * src/lib/ai/build-pass.ts in this order: map -> wildlife -> clues (or retry) -> check, where a retry goes back to
 * writing). Nothing is timed or made up: no percentages, no fake timers.
 * - `checklistRows`: the four planned steps; the latest real step is "in progress", the ones before it are done
 *   (the server runs them in order), the ones after it are still to come.
 * - `MakingScene`: an inline SVG of a pass ticket being made. Each part appears only when its real step starts:
 *   the map pin drops (map), a butterfly lands (wildlife), the pencil writes lines (clues), ticks are stamped
 *   (check), and a tuft of grass grows from the ticket for every real step so far. Decorative (aria-hidden): the
 *   checklist says the same in words. With prefers-reduced-motion every part is drawn still, in its final pose.
 */
import type { PassStep } from "@/lib/pass/schema";

export type ChecklistStep = Exclude<PassStep, "retry">;
export type RowState = "done" | "active" | "todo";

/** The usual order of a new pass (labels for steps not reached yet; a reached step shows the server's own text). */
export const MAKING_PLAN: { step: ChecklistStep; label: string }[] = [
  { step: "map", label: "Read the park map" },
  { step: "wildlife", label: "Check recent wildlife sightings" },
  { step: "clues", label: "Write the clues" },
  { step: "check", label: "Check every clue" },
];

const rowOf = (s: PassStep): ChecklistStep => (s === "retry" ? "clues" : s);

/**
 * The checklist from the real steps received so far. `finished`: the pass came back, so the latest step is done too.
 * With no step yet, every row is still to come.
 */
export function checklistRows(
  steps: readonly { step: PassStep; text: string }[],
  finished = false,
): { step: ChecklistStep; text: string; state: RowState }[] {
  const latest = steps.at(-1);
  const activeIndex = latest ? MAKING_PLAN.findIndex((p) => p.step === rowOf(latest.step)) : -1;
  return MAKING_PLAN.map((p, i) => {
    // The newest real text for this row (a retry's own text replaces "Writing clues…" while it runs).
    const real = [...steps].reverse().find((s) => rowOf(s.step) === p.step);
    const text = real?.text ?? p.label;
    const state: RowState = activeIndex < 0 || i > activeIndex ? "todo" : i < activeIndex || finished ? "done" : "active";
    return { step: p.step, text, state };
  });
}

/** How far the real work got, for the picture: the index of the latest real step (-1 before any). */
export function sceneStage(steps: readonly { step: PassStep }[]): number {
  const latest = steps.at(-1);
  return latest ? MAKING_PLAN.findIndex((p) => p.step === rowOf(latest.step)) : -1;
}

export function MakingChecklist({ steps, finished = false }: { steps: readonly { step: PassStep; text: string }[]; finished?: boolean }) {
  const rows = checklistRows(steps, finished);
  const latest = steps.at(-1);
  return (
    <div className="flex flex-col gap-2">
      {/* Only the newest real step is announced (politely); the list below is for reading. */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="making-live">
        {latest ? latest.text : "Starting…"}
      </p>
      <ol className="flex flex-col gap-1.5" aria-label="Making your pass" data-testid="making-checklist">
        {rows.map((r) => (
          <li
            key={r.step}
            data-state={r.state}
            className={`flex items-start gap-3 rounded-xl px-2 py-1.5 text-base transition-colors ${
              r.state === "active" ? "bg-muted font-semibold text-foreground" : r.state === "done" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <StateIcon state={r.state} />
            <span className="min-w-0">
              {r.text}
              <span className="sr-only">{r.state === "done" ? " Done." : r.state === "active" ? " In progress." : " Not started yet."}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StateIcon({ state }: { state: RowState }) {
  if (state === "done") {
    return (
      <span className="gp-wiz-pop mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-sun" aria-hidden="true">
        <span className="gp-wiz-pulse size-2 rounded-full bg-ink" />
      </span>
    );
  }
  return <span className="mt-0.5 size-6 shrink-0 rounded-full border-2 border-dashed border-line" aria-hidden="true" />;
}

/* ---------- The picture ---------- */

const TICKET =
  "M70 58H290a16 16 0 0 1 16 16V100a14 14 0 0 0 0 28V154a16 16 0 0 1-16 16H70a16 16 0 0 1-16-16V128a14 14 0 0 0 0-28V74a16 16 0 0 1 16-16Z";

/** One tuft of lawn grass (at most 3 soft blades from one root, BRAND.md), rooted at (x, 58). */
function Tuft({ x, delay, tall = 1 }: { x: number; delay: number; tall?: number }) {
  const h = 16 * tall;
  return (
    <g className="gp-wiz-grow" style={{ animationDelay: `${delay}ms`, transformOrigin: `${x}px 58px` }}>
      <path d={`M${x} 58 C ${x - 1} ${58 - h * 0.6}, ${x - 5} ${58 - h * 0.9}, ${x - 7} ${58 - h}`} stroke="var(--gp-primary)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d={`M${x + 2} 58 C ${x + 2} ${58 - h * 0.7}, ${x + 3} ${58 - h * 1.1}, ${x + 4} ${58 - h * 1.25}`} stroke="var(--gp-primary)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d={`M${x + 4} 58 C ${x + 6} ${58 - h * 0.5}, ${x + 9} ${58 - h * 0.7}, ${x + 12} ${58 - h * 0.8}`} stroke="var(--gp-hill-4)" strokeWidth="3" strokeLinecap="round" fill="none" />
    </g>
  );
}

const TUFTS_PER_STAGE = [
  [92, 250],
  [130, 210],
  [170, 280],
  [110, 150, 232],
];

const LINES = [88, 106, 124, 142];

/**
 * The making picture. `stage`: index of the latest real step (MAKING_PLAN), -1 before the first; `ready`: the pass
 * came back (full lawn and a burst). Decorative only.
 */
export function MakingScene({ stage, ready = false }: { stage: number; ready?: boolean }) {
  const reached = (i: number) => ready || stage >= i;
  const writing = !ready && stage === 2;
  const tufts = TUFTS_PER_STAGE.slice(0, ready ? TUFTS_PER_STAGE.length : Math.max(0, stage + 1)).flat();
  return (
    <svg viewBox="0 0 360 220" className="h-auto w-full overflow-visible" aria-hidden="true" focusable="false" data-testid="making-scene" data-stage={ready ? "ready" : stage}>
      {/* Sky: a soft sun and two hills (fills only). */}
      <circle cx="316" cy="34" r="20" fill="var(--gp-sun)" opacity="0.9" className="gp-wiz-sun" />
      <path d="M-320 200 C -160 176, -70 172, 0 196 C 70 168, 140 172, 200 190 C 260 206, 310 180, 360 186 C 450 196, 560 174, 680 190 V230 H-320Z" fill="var(--gp-hill-1)" />
      <path d="M-320 212 C -120 198, 0 194, 90 196 C 200 198, 300 206, 360 204 C 470 200, 580 196, 680 206 V230 H-320Z" fill="var(--gp-hill-2)" />

      {/* Grass grows from the ticket's top edge: one tuft group per real step (all of it when ready). */}
      {tufts.map((x, i) => (
        <Tuft key={x} x={x} delay={(i % 3) * 120} tall={0.85 + ((x * 7) % 5) / 10} />
      ))}

      {/* The pass ticket, drawn in once. */}
      <g className="gp-wiz-float">
        <path d={TICKET} fill="var(--gp-card)" stroke="var(--gp-foreground)" strokeWidth="3" strokeLinejoin="round" pathLength={1} className="gp-wiz-draw" />
        <path d="M246 66V162" stroke="var(--gp-foreground)" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" opacity="0.6" />
        {/* The stub's little sun. */}
        <circle cx="276" cy="96" r="11" fill="var(--gp-sun)" stroke="var(--gp-foreground)" strokeWidth="2" />
        <path d="M266 128h20M268 140h16" stroke="var(--gp-foreground)" strokeWidth="3" strokeLinecap="round" opacity="0.35" />

        {/* Step 1, the park map: a tiny map with a path, and the pin drops in. */}
        {reached(0) ? (
          <g data-part="map">
            <rect x="70" y="74" width="58" height="80" rx="10" fill="var(--gp-muted)" className="gp-wiz-fade" />
            <path d="M76 146 C 92 132, 84 112, 104 104 S 122 86, 124 80" stroke="var(--gp-primary)" strokeWidth="2.5" strokeDasharray="3 5" strokeLinecap="round" fill="none" pathLength={1} className="gp-wiz-draw-slow" />
            <g className="gp-wiz-drop" style={{ transformOrigin: "100px 104px" }}>
              <path d="M100 106 C 92 96, 90 92, 90 88 a10 10 0 0 1 20 0 c0 4 -2 8 -10 18Z" fill="var(--gp-primary)" stroke="var(--gp-foreground)" strokeWidth="2" />
              <circle cx="100" cy="88" r="3.5" fill="var(--gp-card)" />
            </g>
          </g>
        ) : null}

        {/* Step 3, the clues: lines written by the pencil. */}
        {reached(2)
          ? LINES.map((y, i) => (
              <path
                key={y}
                d={`M150 ${y}H${i % 2 ? 214 : 230}`}
                stroke="var(--gp-foreground)"
                strokeWidth="3.5"
                strokeLinecap="round"
                pathLength={1}
                className={writing ? "gp-wiz-write" : "gp-wiz-draw-fast"}
                style={{ animationDelay: `${i * (writing ? 700 : 90)}ms` }}
                opacity="0.8"
              />
            ))
          : null}

        {/* Step 4, the check: a tick by every line. */}
        {reached(3)
          ? LINES.map((y, i) => (
              <path
                key={`t${y}`}
                d={`M136 ${y}l4 4 7-8`}
                stroke="var(--gp-primary)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                className="gp-wiz-pop"
                style={{ animationDelay: `${i * 220}ms`, transformOrigin: `${141}px ${y}px` }}
              />
            ))
          : null}
      </g>

      {/* Step 2, wildlife spotted nearby: a butterfly flutters in and rests on the stub. */}
      {reached(1) ? (
        <g className="gp-wiz-flyin" data-part="butterfly">
          <g transform="translate(300 62)">
            <g className="gp-wiz-flap" style={{ transformOrigin: "0px 0px" }}>
              <path d="M0 0 C -14 -16, -24 -4, -16 6 C -10 12, -4 8, 0 2Z" fill="var(--gp-sun)" stroke="var(--gp-foreground)" strokeWidth="1.8" />
              <path d="M0 0 C 14 -16, 24 -4, 16 6 C 10 12, 4 8, 0 2Z" fill="var(--gp-sun)" stroke="var(--gp-foreground)" strokeWidth="1.8" />
            </g>
            <path d="M0 -6V10" stroke="var(--gp-foreground)" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        </g>
      ) : null}

      {/* The pencil: waits by the ticket, writes while the clues are written, rests when done. */}
      {!ready ? (
        <g className={writing ? "gp-wiz-pencil-write" : "gp-wiz-pencil-idle"}>
          <g transform={writing ? "translate(150 88) rotate(-35)" : "translate(232 52) rotate(-35)"}>
            <rect x="0" y="-5" width="54" height="10" rx="2" fill="var(--gp-sun)" stroke="var(--gp-foreground)" strokeWidth="2" />
            <rect x="46" y="-5" width="10" height="10" rx="2" fill="#e88f8f" stroke="var(--gp-foreground)" strokeWidth="2" />
            <path d="M0 -5 L-12 0 L0 5Z" fill="#f2d7a8" stroke="var(--gp-foreground)" strokeWidth="2" strokeLinejoin="round" />
            <path d="M-8 -1.6 L-12 0 L-8 1.6Z" fill="var(--gp-foreground)" />
          </g>
        </g>
      ) : null}

      {/* Ready: a little burst of leaves and sun dots (motion only; still, it is just a few dots around the pass). */}
      {ready ? (
        <g data-part="burst">
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            const r = 118 + (i % 3) * 10;
            const x = 180 + Math.cos(a) * r;
            const y = 114 + Math.sin(a) * r * 0.62;
            return i % 2 ? (
              <circle key={i} cx={x} cy={y} r={4 + (i % 3)} fill="var(--gp-sun)" className="gp-wiz-burst" style={{ ["--dx" as string]: `${180 - x}px`, ["--dy" as string]: `${114 - y}px`, animationDelay: `${i * 18}ms` }} />
            ) : (
              <path
                key={i}
                d={`M${x} ${y} q 6 -8 12 0 q -6 8 -12 0Z`}
                fill="var(--gp-primary)"
                className="gp-wiz-burst"
                style={{ ["--dx" as string]: `${180 - x}px`, ["--dy" as string]: `${114 - y}px`, animationDelay: `${i * 18}ms` }}
              />
            );
          })}
        </g>
      ) : null}
    </svg>
  );
}
