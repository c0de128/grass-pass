import { ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { bandLabel, placeLabel, type HeroCard } from "@/lib/home/showcase";

/**
 * The tilted pass card over the hero picture (Kevin's v0 design), filled from a REAL saved example pass:
 * its park, place, age band and 4 of its finds (a counted Park Find first; src/lib/home/showcase.ts heroFinds) with their code-written evidence lines. The ticks on the
 * first two rows are decoration (a kid half-way through). With no ready example pass, the same card says
 * why. Never hard-coded clues.
 */
export function HeroPassCard({ card }: { card: HeroCard | null }) {
  const name = card ? (card.kind === "ready" ? card.ex.example.name : card.name) : "Example pass";
  return (
    <figure
      aria-labelledby="hero-pass-name"
      data-testid="hero-pass-card"
      data-state={card?.kind ?? "missing"}
      className="relative overflow-hidden rounded-2xl bg-paper text-ink shadow-2xl shadow-shadow ring-1 ring-border"
    >
      <div className="flex items-center justify-between bg-ink px-4 py-2.5 text-on-ink">
        <span className="font-heading text-sm font-extrabold tracking-wider uppercase">Grass Pass</span>
        {card?.kind === "ready" ? (
          <span className="rounded-full bg-sun px-2 py-0.5 text-[11px] font-bold text-sun-foreground">{bandLabel(card.ex.pass)}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
        <div>
          <p id="hero-pass-name" className="font-heading text-lg leading-tight font-extrabold">
            {name}
          </p>
          {card?.kind === "ready" ? (
            <p className="text-xs text-muted-foreground">
              {placeLabel(card.ex.example.place)} · real pass, made {card.ex.madeAt}
            </p>
          ) : card ? (
            <p className="text-xs text-muted-foreground">{card.place}</p>
          ) : null}
        </div>

        {card?.kind === "ready" ? (
          <ul className="flex flex-col gap-2" aria-label={`${card.finds.length} finds from the ${name} example pass`}>
            {card.finds.map((find, i) => {
              const done = i < 2;
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border-2 ${
                      done ? "border-primary bg-primary text-primary-foreground" : "border-ink"
                    }`}
                  >
                    {done ? <Check className="size-3" strokeWidth={4} /> : null}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={`text-sm leading-snug font-medium ${done ? "line-through decoration-primary/70 decoration-2" : ""}`}>
                      {find.section === "lucky" ? "Maybe! " : ""}
                      {find.clue}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{find.evidence}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm font-medium" data-testid="hero-pass-missing">
            Example pass not ready yet: {card?.kind === "missing" ? card.reason : "no example parks are set up on this server."}
          </p>
        )}
      </div>

      <div className="relative h-4" aria-hidden="true">
        <span className="absolute top-1/2 -left-2 size-4 -translate-y-1/2 rounded-full bg-background" />
        <span className="perforation absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 opacity-40" />
        <span className="absolute top-1/2 -right-2 size-4 -translate-y-1/2 rounded-full bg-background" />
      </div>

      <figcaption className="flex items-center justify-between gap-2 bg-muted px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span>Grown-up&apos;s stub · answers &amp; safety</span>
        {card?.kind === "ready" ? (
          <Link
            href={card.ex.href}
            prefetch={false}
            className="inline-flex min-h-8 items-center gap-1 rounded-md font-bold text-link underline-offset-2 hover:underline"
          >
            View pass
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : (
          <span aria-hidden="true">✂</span>
        )}
      </figcaption>
    </figure>
  );
}
