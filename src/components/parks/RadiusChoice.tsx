"use client";

/**
 * Search v2 (Kevin 2026-10-10): "how far away do you want to search?" Four native radio buttons styled as chips
 * (1, 3, 5, 10 mi; km in small text), so the arrow keys, Space and screen readers work as for any radio group. While
 * a search runs the choice is shown but can't change (aria-disabled keeps it focusable and readable).
 */
import { useId } from "react";
import { METERS_PER_MILE, RADIUS_MILES, type RadiusMiles } from "@/lib/parks/constants";

function kmText(mi: RadiusMiles): string {
  const km = (mi * METERS_PER_MILE) / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function RadiusChoice({
  value,
  onChange,
  busy,
  rerun,
}: {
  value: RadiusMiles;
  onChange: (mi: RadiusMiles) => void;
  busy: boolean;
  /** True when a new distance will run the last search again (there is a finished search). */
  rerun: boolean;
}) {
  const ids = useId();
  const legendId = `${ids}-legend`;
  const hintId = `${ids}-hint`;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={hintId} data-testid="radius-choice">
      <legend id={legendId} className="mb-1.5 text-sm font-bold text-foreground">
        How far to look
      </legend>
      <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-muted p-1.5">
        {RADIUS_MILES.map((mi) => {
          const checked = mi === value;
          return (
            <label
              key={mi}
              className="relative flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-xl px-1 py-1 text-center leading-tight text-foreground transition-colors has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:shadow-md has-[:checked]:shadow-shadow has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring hover:bg-card has-[:checked]:hover:bg-primary has-[[aria-disabled=true]]:cursor-not-allowed"
            >
              <input
                type="radio"
                name={`${ids}-radius`}
                value={mi}
                checked={checked}
                onChange={() => onChange(mi)}
                aria-disabled={busy || undefined}
                className="sr-only"
              />
              <span className="font-heading text-base font-extrabold">{mi} mi</span>
              <span className="text-xs opacity-90">{kmText(mi)}</span>
            </label>
          );
        })}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {busy ? "You can change the distance when this search finishes." : rerun ? "Pick another distance to search the same place again." : "Measured in a straight line from your place."}
      </p>
    </fieldset>
  );
}
