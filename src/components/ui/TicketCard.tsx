import type { HTMLAttributes, ReactNode } from "react";

type Side = "left" | "right";

/**
 * Half-circle notch cut into the card edge: a circle in the page colour, centred on the card's
 * 2 px border and clipped to its inner half, so the notch keeps the forest outline.
 * `vertical` is the anchor's vertical position class (middle of the card, or on the tear line).
 * Set `--notch-bg` on a parent when the card sits on something other than the page background.
 */
function Notch({ side, vertical }: { side: Side; vertical: string }) {
  const anchor = side === "left" ? "-left-px" : "-right-px";
  const clip = side === "left" ? "[clip-path:inset(0_0_0_50%)]" : "[clip-path:inset(0_50%_0_0)]";
  return (
    <span aria-hidden="true" data-notch={side} className={`pointer-events-none absolute h-0 w-0 ${anchor} ${vertical}`}>
      <span
        className={`absolute left-0 top-0 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-line bg-(--notch-bg) ${clip}`}
      />
    </span>
  );
}

export type TicketCardProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: "section" | "article" | "div";
  children: ReactNode;
  /** Optional tear-off stub below a dashed tear line (pass preview, main CTA). */
  stub?: ReactNode;
};

/**
 * Ticket-shaped card (SPEC §8.3): 16 px radius, paper-light fill, 2 px forest border, half-circle
 * notches on both sides and an optional dashed tear line before a stub (notches sit on the tear line).
 */
export function TicketCard({ as: Tag = "div", children, stub, className = "", ...rest }: TicketCardProps) {
  return (
    <Tag className={`relative rounded-ticket border-2 border-line bg-surface text-fg ${className}`} {...rest}>
      <div className="relative px-6 py-5 sm:px-8 sm:py-6">
        {children}
        {stub ? null : (
          <>
            <Notch side="left" vertical="top-1/2" />
            <Notch side="right" vertical="top-1/2" />
          </>
        )}
      </div>
      {stub ? (
        <div data-testid="ticket-stub" className="relative border-t-2 border-dashed border-line px-6 py-5 sm:px-8 sm:py-6">
          <Notch side="left" vertical="-top-px" />
          <Notch side="right" vertical="-top-px" />
          {stub}
        </div>
      ) : null}
    </Tag>
  );
}
