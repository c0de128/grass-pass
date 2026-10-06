import { restingMessage, type Resting } from "@/lib/limits/budget";

/**
 * SEC-2-01: the honest notice while Grass Pass rests (the shared store's monthly command budget is
 * nearly used up; src/lib/limits/budget.ts). Nothing when it isn't resting.
 */
export function RestingNotice({ state }: { state: Resting }) {
  if (!state.resting) return null;
  const [first, ...rest] = restingMessage(state).split(". ");
  return (
    <p className="rounded-control border-2 border-line bg-surface px-4 py-3 text-base text-fg" data-testid="resting-notice">
      <strong>{first}.</strong> {rest.join(". ")}
    </p>
  );
}
