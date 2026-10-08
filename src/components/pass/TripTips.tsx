import { Apple, Clock, Footprints, GlassWater, Layers, Pencil, Route, Shirt, SprayCan, Toilet, TreeDeciduous, Umbrella } from "lucide-react";
import type { SVGProps } from "react";
import { dayLabel } from "@/lib/pass/as-of";
import { modelShortName, TRIP_TIPS_COPY, type TipIcon, type TripTips as TripTipsData } from "@/lib/tips/schema";

/**
 * "How to make this a great trip" (Kevin 2026-10-08), right under the weather card. Screen only (print:hidden: the
 * printed sheet is unchanged). A packing list on a luggage tag: one row per tip with its picture, the tip, and the
 * real fact it is based on (code-written). Every word comes from the stored pass (src/lib/tips); model text is plain text.
 *
 * Accessibility: a labelled region with a real heading and a real list; pictures are aria-hidden (the tip says it all).
 */

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/** A wide-brim sun hat (no Lucide icon fits). Same 24-unit grid and 2 px round stroke as Lucide. */
function HatIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <path d="M7.5 13.5c0-4 2-6.5 4.5-6.5s4.5 2.5 4.5 6.5" />
      <path d="M2.5 15.5c2.5 1.6 6 2.5 9.5 2.5s7-.9 9.5-2.5c-1.6-1.3-3-2-5-2.2-1.4.5-2.9.7-4.5.7s-3.1-.2-4.5-.7c-2 .2-3.4.9-5 2.2Z" />
      <path d="M7.7 11.5c1.3.6 2.7.9 4.3.9s3-.3 4.3-.9" />
    </svg>
  );
}

/** A sunscreen tube with a little sun. */
function SunscreenIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <path d="M8 21h6a1 1 0 0 0 1-1V9.5L13.5 7h-5L7 9.5V20a1 1 0 0 0 1 1Z" />
      <path d="M9 7V4h4v3" />
      <circle cx="11" cy="14.5" r="2" />
      <path d="M18.5 4v1.5M18.5 9.5V11M15 7.5h1.5M20.5 7.5H22M16.4 5.4l.8.8M19.8 8.8l.8.8" />
    </svg>
  );
}

const ICONS: Record<TipIcon, (p: IconProps) => React.ReactNode> = {
  shoes: (p) => <Footprints {...p} />,
  hat: (p) => <HatIcon {...p} />,
  water: (p) => <GlassWater {...p} />,
  sunscreen: (p) => <SunscreenIcon {...p} />,
  jacket: (p) => <Shirt {...p} />,
  umbrella: (p) => <Umbrella {...p} />,
  bugspray: (p) => <SprayCan {...p} />,
  snack: (p) => <Apple {...p} />,
  restroom: (p) => <Toilet {...p} />,
  shade: (p) => <TreeDeciduous {...p} />,
  layers: (p) => <Layers {...p} />,
  time: (p) => <Clock {...p} />,
  path: (p) => <Route {...p} />,
  pencil: (p) => <Pencil {...p} />,
};

/** The luggage tag in the corner: a tag with a punched hole and a loop of string. Decorative. */
function LuggageTag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 84" aria-hidden="true" focusable="false" className={className}>
      <path d="M14 22c-8-6-10-16-4-20" fill="none" stroke="var(--gp-tips-string)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M14 22c10-8 22-6 28 2" fill="none" stroke="var(--gp-tips-string)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M38 14h70a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H38L20 52V32Z" fill="var(--gp-tips-tag)" stroke="var(--gp-tips-tag-line)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="34" cy="42" r="5" fill="var(--gp-tips-hole)" stroke="var(--gp-tips-tag-line)" strokeWidth="2" />
      <path d="M50 30h52M50 42h44M50 54h30" stroke="var(--gp-tips-tag-line)" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      <path d="M90 50l5 5 10-12" fill="none" stroke="var(--gp-tips-check)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Shell({ children, state, label }: { children: React.ReactNode; state: string; label: string }) {
  return (
    <section
      aria-labelledby="trip-tips-title"
      data-testid="trip-tips"
      data-state={state}
      className="gp-tips relative flex flex-col gap-4 overflow-hidden rounded-3xl bg-card p-5 text-card-foreground shadow-[0_10px_30px_-18px_var(--gp-shadow)] ring-1 ring-border sm:gap-5 sm:p-7 print:hidden"
    >
      <div className="flex items-start gap-3 sm:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xs font-bold tracking-widest text-link uppercase" data-testid="trip-tips-for">
            {label}
          </p>
          <h2 id="trip-tips-title" className="font-heading text-2xl leading-tight font-extrabold tracking-tight text-balance sm:text-3xl">
            {TRIP_TIPS_COPY.heading}
          </h2>
        </div>
        <LuggageTag className="-mt-1 -mr-1 w-20 shrink-0 -rotate-6 sm:w-28" />
      </div>
      {children}
    </section>
  );
}

/**
 * `today`: the Chicago day the page is viewed (the pass day uses it). Tips made for an earlier day say so: the weather
 * card above is live, the tips are not.
 */
export function TripTips({ tips, today }: { tips: TripTipsData | undefined; today: string }) {
  if (!tips) {
    return (
      <Shell state="before" label="Trip tips">
        <p className="text-base text-muted-foreground" data-testid="trip-tips-note">
          {TRIP_TIPS_COPY.beforeTips}
        </p>
      </Shell>
    );
  }
  const forDay = dayLabel(tips.forDate);
  const stale = tips.forDate < today;
  const fromWhat = tips.forecast ? `the forecast for ${forDay} and the park map` : "the park map and recent sightings";
  return (
    <Shell state={tips.source} label={`Trip tips for ${forDay}`}>
      <ul className="grid gap-2.5 sm:grid-cols-2 sm:gap-3" data-testid="trip-tips-list">
        {tips.items.map((t, i) => {
          const Icon = ICONS[t.icon];
          return (
            <li key={`${i}-${t.tip}`} className="gp-tips-item flex items-start gap-3 rounded-2xl p-3 sm:p-3.5" data-icon={t.icon}>
              <span aria-hidden="true" className="gp-tips-icon grid size-10 shrink-0 place-items-center rounded-xl">
                <Icon className="size-5" strokeWidth={2} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="leading-snug font-semibold">{t.tip}</span>
                <span className="text-sm leading-snug text-muted-foreground">
                  <span className="font-semibold">Based on:</span> {t.why}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {!tips.forecast ? <p className="text-sm text-muted-foreground">{TRIP_TIPS_COPY.noForecast}</p> : null}
      {stale ? (
        <p className="text-sm font-semibold" data-testid="trip-tips-stale">
          These tips were made for the weather on {forDay}. Today&apos;s forecast is in the weather card above.
        </p>
      ) : null}
      <p className="gp-tips-credit border-t border-dashed pt-3 text-xs text-muted-foreground" data-testid="trip-tips-credit">
        {tips.source === "model" && tips.model ? (
          <>
            Written by {modelShortName(tips.model)} (open model) from {fromWhat}. Code checked that every tip is safe and based on a real fact.
          </>
        ) : (
          <>
            {tips.forecast ? TRIP_TIPS_COPY.rulesLabel : TRIP_TIPS_COPY.rulesLabelNoForecast} ({TRIP_TIPS_COPY.rulesWhy[tips.reason ?? "no_answer"]}). Each one is based on the real fact under it.
          </>
        )}
      </p>
    </Shell>
  );
}
