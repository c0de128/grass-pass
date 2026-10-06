import type { HTMLAttributes, ReactNode } from "react";

type Side = "left" | "right";

/**
 * Round notch "punched" into the card edge, in the page colour (as on the v0 pass card).
 * `vertical` is the anchor's vertical position class (middle of the card, or on the tear line).
 */
function Notch({ side, vertical }: { side: Side; vertical: string }) {
  const anchor = side === "left" ? "-left-2" : "-right-2";
  return <span aria-hidden="true" data-notch={side} className={`pointer-events-none absolute size-4 -translate-y-1/2 rounded-full bg-background ${anchor} ${vertical}`} />;
}

export type TicketCardProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: "section" | "article" | "div";
  children: ReactNode;
  /** Optional tear-off stub below a dotted tear line (pass preview, main CTA). */
  stub?: ReactNode;
};

/**
 * Ticket-shaped card in the v3 look (Kevin's v0 design): white card, large radius, soft ring and shadow,
 * notches on both sides and an optional perforated tear line before a muted stub (notches sit on the line).
 */
export function TicketCard({ as: Tag = "div", children, stub, className = "", ...rest }: TicketCardProps) {
  return (
    <Tag className={`relative rounded-3xl bg-card text-card-foreground shadow-xl shadow-shadow ring-1 ring-border ${className}`} {...rest}>
      <div className="relative px-5 py-5 sm:px-8 sm:py-7">
        {children}
        {stub ? null : (
          <>
            <Notch side="left" vertical="top-1/2" />
            <Notch side="right" vertical="top-1/2" />
          </>
        )}
      </div>
      {stub ? (
        <div data-testid="ticket-stub" className="relative rounded-b-3xl bg-muted/60 px-5 py-5 sm:px-8 sm:py-7">
          <span aria-hidden="true" className="perforation absolute inset-x-4 top-0 h-1 -translate-y-1/2 opacity-40" />
          <Notch side="left" vertical="top-0" />
          <Notch side="right" vertical="top-0" />
          {stub}
        </div>
      ) : null}
    </Tag>
  );
}
