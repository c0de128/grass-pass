"use client";

/** Small pieces of the pass wizard: the step trail in the ticket's ink header, and the "Who's exploring?" choices. */
import { Check } from "lucide-react";
import { AGE_BAND_INFO, AGE_BANDS, DEFAULT_AGE_BAND, type AgeBand } from "@/lib/pass/constants";

export const WIZARD_STEPS = [
  { key: "park", label: "Park", title: "Pick your park" },
  { key: "age", label: "Explorer", title: "Who's exploring?" },
  { key: "make", label: "Make it", title: "Make your pass" },
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number]["key"];

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.key === step);
}

/** "Step 2 of 3: Who's exploring?" (said politely when the step changes). */
export function stepAnnouncement(step: WizardStep, title?: string): string {
  const i = stepIndex(step);
  return `Step ${i + 1} of ${WIZARD_STEPS.length}: ${title ?? WIZARD_STEPS[i].title}`;
}

/** 1 Park · 2 Explorer · 3 Make it, joined by a dotted trail. Done steps get a tick; the current one is sunflower. */
export function StepTrail({ step, finished = false }: { step: WizardStep; finished?: boolean }) {
  const current = stepIndex(step);
  return (
    <ol aria-label="Steps" className="flex min-w-0 items-center gap-1.5 sm:gap-2" data-testid="wizard-steps">
      {WIZARD_STEPS.map((s, i) => {
        const done = i < current || (finished && i === current);
        const here = i === current && !finished;
        return (
          <li key={s.key} aria-current={here ? "step" : undefined} className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            {i > 0 ? <span aria-hidden="true" className={`h-0 w-4 border-t-2 border-dotted sm:w-7 ${i <= current ? "border-sun" : "border-band-foreground/45"}`} /> : null}
            <span
              aria-hidden="true"
              className={`flex size-7 shrink-0 items-center justify-center rounded-full font-heading text-sm font-extrabold transition-colors ${
                here ? "bg-sun text-sun-foreground ring-2 ring-sun ring-offset-2 ring-offset-band" : done ? "bg-band-foreground text-band" : "border-2 border-band-foreground/60 text-band-foreground"
              }`}
            >
              {done ? <Check className="size-4" strokeWidth={3.5} /> : i + 1}
            </span>
            <span className={`text-sm font-bold whitespace-nowrap text-band-foreground ${here ? "" : "max-sm:sr-only"}`}>
              <span className="sr-only">Step {i + 1}: </span>
              {s.label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A sprout that grows taller with each older age (decorative): the n-th choice has n + 1 leaves. */
function AgeSprout({ index }: { index: number }) {
  const h = 18 + index * 9;
  const leaves = Math.min(index + 1, 4);
  return (
    <svg viewBox="0 0 48 56" className="h-14 w-12 shrink-0" aria-hidden="true" focusable="false">
      <path d="M8 54h32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.35" />
      <path d={`M24 54V${54 - h}`} stroke="var(--gp-primary)" strokeWidth="3.5" strokeLinecap="round" />
      {Array.from({ length: leaves }, (_, i) => {
        const y = 54 - h + 4 + i * 8;
        const left = i % 2 === 0;
        return (
          <path
            key={i}
            d={left ? `M24 ${y} c -4 -7 -12 -7 -15 -3 c 4 5 11 6 15 3Z` : `M24 ${y} c 4 -7 12 -7 15 -3 c -4 5 -11 6 -15 3Z`}
            fill="var(--gp-primary)"
          />
        );
      })}
      <circle cx="24" cy={54 - h - 2} r="3.5" fill="var(--gp-sun)" stroke="var(--gp-foreground)" strokeWidth="1.5" />
    </svg>
  );
}

const DESKTOP_COLS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2" };

/**
 * The words on one age card, in ONE place (for the 13+ band merge: swap in `AGE_BAND_INFO[b].short` /
 * `.pickerHint` here). `title` is what the card shows big; `hint` is shown on every screen size.
 */
export function ageOptionText(b: AgeBand): { title: string; hint: string } {
  const info = AGE_BAND_INFO[b];
  return { title: info.label.replace(/(\d)-(\d)/, "$1–$2"), hint: info.hint };
}

/** One age choice: a real radio (visually hidden) inside a big card. */
export function AgeOption({ band, index, checked, stacked, onChange }: { band: AgeBand; index: number; checked: boolean; stacked: boolean; onChange: (b: AgeBand) => void }) {
  const { title, hint } = ageOptionText(band);
  const popular = band === DEFAULT_AGE_BAND;
  return (
    <label
      className={`gp-wiz-rise group relative flex cursor-pointer gap-3 rounded-3xl border-2 p-4 transition-[border-color,background-color,transform,box-shadow] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid ${
        stacked ? "flex-col items-start" : "flex-row items-center sm:flex-col sm:items-start"
      } ${
        checked
          ? "border-ink bg-sun text-sun-foreground shadow-[0_4px_0_0_var(--gp-foreground)]"
          : "border-transparent bg-muted text-foreground hover:border-line motion-safe:hover:-translate-y-0.5"
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <input type="radio" name="ageBand" value={band} checked={checked} onChange={() => onChange(band)} className="sr-only" />
      <span className={checked ? "text-sun-foreground" : "text-foreground"}>
        <AgeSprout index={index} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-heading text-xl leading-tight font-extrabold">
          {title}
          {popular ? <span className="sr-only"> (most kids)</span> : null}
        </span>
        <span className="text-sm leading-snug">{hint}</span>
      </span>
      {popular ? (
        <span
          aria-hidden="true"
          className={`absolute top-3 right-3 rounded-full px-2 py-0.5 text-[11px] font-bold ${checked ? "bg-ink text-on-ink" : "bg-card text-foreground ring-1 ring-border"}`}
        >
          Most kids
        </span>
      ) : null}
    </label>
  );
}

/**
 * "Who's exploring?": one card per age band, straight from the shared list (AGE_BANDS), so a new band shows up here by
 * itself. Arrow keys and screen readers work as usual, and choosing never moves on by itself. Phones: 2 x 2 for an
 * even count (4 bands), one column of wide cards otherwise; from 640 px: 3 across, or 2 x 2. Hints show everywhere.
 */
export function AgeChoices({ band, onChange, legendId }: { band: AgeBand; onChange: (b: AgeBand) => void; legendId: string }) {
  const even = AGE_BANDS.length % 2 === 0;
  return (
    <fieldset aria-describedby={`${legendId}-note`} className="flex flex-col gap-3">
      <legend id={legendId} className="sr-only">
        Explorer age
      </legend>
      <div className={`grid gap-3 ${even ? "grid-cols-2" : "grid-cols-1"} ${DESKTOP_COLS[AGE_BANDS.length] ?? "sm:grid-cols-2"}`}>
        {AGE_BANDS.map((b, i) => (
          <AgeOption key={b} band={b} index={i} checked={band === b} stacked={even} onChange={onChange} />
        ))}
      </div>
      <p id={`${legendId}-note`} className="text-sm text-muted-foreground">
        Only the park and this age range are sent to make the pass. We remember your choice on this device only.
      </p>
    </fieldset>
  );
}
