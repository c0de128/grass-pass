import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * "Details on demand" (v3): a native <details>/<summary>, closed by default. Keyboard-operable (Enter/Space on
 * the summary) with the global focus ring, announced as expanded/collapsed by the browser, and works without
 * JavaScript. The heading inside the summary keeps the page outline in order. Content stays in the HTML, so
 * find-in-page and fragment links (see OpenOnHash) still reach it.
 */
export function Disclosure({
  id,
  title,
  hint,
  icon: Icon,
  level = 3,
  tone = "card",
  children,
}: {
  id?: string;
  title: string;
  /** One short line under the title: what is inside. */
  hint?: string;
  icon?: LucideIcon;
  level?: 3 | 4;
  /** "card" on the light page, "band" inside a dark band, "inset" inside a card (smaller, muted fill). */
  tone?: "card" | "band" | "inset";
  children: ReactNode;
}) {
  const H = level === 3 ? "h3" : "h4";
  const box =
    tone === "band"
      ? "bg-band-foreground/[0.06] ring-band-foreground/15 text-band-foreground"
      : tone === "inset"
        ? "bg-muted/60 ring-border text-card-foreground"
        : "bg-card ring-border text-card-foreground";
  const inset = tone === "inset";
  const hintClass = tone === "band" ? "text-band-muted" : "text-muted-foreground";
  return (
    <details id={id} className={`group scroll-mt-4 ring-1 sm:scroll-mt-3 ${inset ? "rounded-2xl" : "rounded-3xl"} ${box}`}>
      <summary
        className={`flex cursor-pointer list-none items-center gap-4 [&::-webkit-details-marker]:hidden ${inset ? "min-h-12 rounded-2xl px-4 py-2.5" : "min-h-14 rounded-3xl px-5 py-4 sm:px-6"}`}
      >
        {Icon ? (
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-ink">
            <Icon className="size-5" />
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <H className={`leading-snug font-extrabold ${inset ? "text-base" : "text-lg"}`}>{title}</H>
          {hint ? <span className={`text-sm ${hintClass}`}>{hint}</span> : null}
        </span>
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 motion-safe:transition-transform group-open:rotate-180" />
      </summary>
      {/* Wide layout (2026-10-09): running text keeps a readable measure however wide the box gets. */}
      <div className={`flex flex-col leading-relaxed [&>p]:max-w-[75ch] ${inset ? "gap-3 px-4 pt-1 pb-4" : "gap-4 px-5 pt-1 pb-6 sm:px-6"}`}>{children}</div>
    </details>
  );
}
