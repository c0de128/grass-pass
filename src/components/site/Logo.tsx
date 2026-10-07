import { Sprout } from "lucide-react";

/**
 * The v3 logo from Kevin's v0 design: a small green admission ticket (notched sides) with a sprout, and the
 * "Grass Pass" wordmark in Bricolage Grotesque. `inverted` is the sunflower version for dark bands and the footer.
 * The ticket is decorative; the wordmark is real text. The printed pass keeps its own 1-colour logo
 * (public/logo-print-1c.svg).
 */
export function Logo({ inverted = false, className = "", notchClassName }: { inverted?: boolean; className?: string; notchClassName?: string }) {
  const ticket = inverted ? "bg-sun text-sun-foreground" : "bg-primary text-primary-foreground";
  // The side notches show the colour behind the logo (the footer passes its own band colour).
  const notch = notchClassName ?? (inverted ? "bg-band" : "bg-background");
  return (
    <span className={`inline-flex items-center gap-2.5 max-[359px]:gap-1.5 ${className}`.trim()}>
      <span aria-hidden="true" data-testid="logo-ticket" className={`relative flex h-9 w-12 shrink-0 items-center justify-center rounded-md ${ticket}`}>
        <Sprout className="size-5" strokeWidth={2.5} />
        <span className={`absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full ${notch}`} />
        <span className={`absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full ${notch}`} />
      </span>
      <span className="font-heading text-xl font-extrabold tracking-tight whitespace-nowrap max-[359px]:text-lg">Grass Pass</span>
    </span>
  );
}
