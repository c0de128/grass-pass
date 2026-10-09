import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { HoopIcon, MapXIcon, PawIcon } from "@/components/art/icons";
import { bladeOutline, GRASS_LAYERS, GRASS_PALETTE } from "@/components/art/grass";
import type { SignInPreview } from "@/lib/accounts/signin-preview";

const KIND: Record<string, { label: string; Icon: typeof HoopIcon }> = {
  park: { label: "Park Find", Icon: HoopIcon },
  wild: { label: "Wild Find", Icon: PawIcon },
  lucky: { label: "Lucky Find", Icon: HoopIcon },
};

/** The site strip's four signature tufts (TALL), each moved to a spot along the ticket's top edge (x in a 340-wide box). */
const TUFT_SPOTS = [34, 128, 236, 300];
const TUFT_PATH = (() => {
  const tall = GRASS_LAYERS.tall;
  const groups: (typeof tall)[number][][] = [];
  for (const b of tall) {
    const g = groups.find((x) => Math.abs(x[0][0] - b[0]) < 20);
    if (g) g.push(b);
    else groups.push([b]);
  }
  return groups
    .slice(0, TUFT_SPOTS.length)
    .map((g, i) => g.map((b) => bladeOutline([b[0] - g[0][0] + TUFT_SPOTS[i], b[1], b[2], b[3], b[4]], 34)).join(""))
    .join("");
})();

/** Lawn growing from the ticket's top (BRAND.md: "a ticket that's growing grass"), in logo B's soft blades. */
function TicketGrass() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 340 34" className="absolute inset-x-0 -top-[30px] -z-10 h-[36px] w-full" preserveAspectRatio="xMidYMax meet">
      <path fill={GRASS_PALETTE.light.mid} d={TUFT_PATH} />
    </svg>
  );
}

/**
 * The sign-in page's "what you get" ticket (Kevin's option A, 2026-10-08): a small, slightly tilted copy of a REAL
 * pinned pass (src/lib/accounts/signin-preview.ts): its park, age band, two of its finds and its Find This Spot riddle,
 * all read from the pinned file. With no preview (the file can't be loaded) it renders nothing: never a made-up pass.
 */
export function SignInPassPreview({ preview }: { preview: SignInPreview | null }) {
  if (!preview) return null;
  const { parkName, place, band, madeAt, href, finds, riddle, total } = preview;
  const more = total - finds.length;
  return (
    <figure className="gp-signin-preview relative isolate flex w-full max-w-[24rem] flex-col items-center gap-5 lg:ml-10" data-testid="signin-pass-preview" aria-labelledby="signin-preview-park">
      <div className="gp-signin-tilt relative w-full">
      <span aria-hidden="true" className="gp-signin-sun absolute -top-9 -right-4 -z-10 size-24 rounded-full sm:-right-7 sm:size-28" />
      <TicketGrass />
      <div className="gp-signin-pass relative w-full overflow-hidden rounded-2xl bg-paper text-ink ring-1 ring-border">
        <div className="flex items-center justify-between gap-3 bg-ink px-4 py-2.5 text-on-ink">
          <span className="font-heading text-sm font-extrabold tracking-wider uppercase">Grass Pass</span>
          <span className="rounded-full bg-sun px-2.5 py-0.5 text-xs font-bold text-sun-foreground" data-testid="signin-preview-band">
            {band}
          </span>
        </div>

        <div className="flex flex-col gap-3.5 px-4 pt-3.5 pb-4">
          <p id="signin-preview-park" className="font-heading text-xl leading-tight font-extrabold text-balance" data-testid="signin-preview-park">
            {parkName}
          </p>
          <ul className="flex flex-col gap-3" aria-label={`${finds.length} of the ${total} finds on this pass`}>
            {finds.map((f, i) => {
              const k = KIND[f.section] ?? KIND.park;
              return (
                <li key={i} className="flex items-start gap-3" data-testid="signin-preview-find">
                  <span aria-hidden="true" className="mt-0.5 size-5 shrink-0 rounded-[5px] border-2 border-ink" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      <k.Icon className="size-3.5" aria-hidden="true" />
                      {k.label}
                    </span>
                    <span className="text-[0.95rem] leading-snug font-medium">{f.clue}</span>
                  </span>
                </li>
              );
            })}
            {riddle ? (
              <li className="gp-signin-spot flex items-start gap-3 rounded-xl px-3 py-2.5" data-testid="signin-preview-spot">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sun text-sun-foreground">
                  <MapXIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Find This Spot</span>
                  <span className="text-[0.95rem] leading-snug font-medium italic">&ldquo;{riddle}&rdquo;</span>
                </span>
              </li>
            ) : null}
          </ul>
        </div>

        <div className="relative h-4" aria-hidden="true">
          <span className="gp-signin-notch absolute top-1/2 -left-2 size-4 -translate-y-1/2 rounded-full" />
          <span className="perforation absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 opacity-40" />
          <span className="gp-signin-notch absolute top-1/2 -right-2 size-4 -translate-y-1/2 rounded-full" />
        </div>
        <p className="flex items-center justify-between gap-2 bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Grown-up&apos;s stub · answers &amp; safety</span>
          {more > 0 ? <span className="font-bold whitespace-nowrap">+{more} more finds</span> : null}
        </p>
      </div>
      </div>

      <figcaption className="flex flex-col items-center text-center text-sm text-muted-foreground text-pretty" data-testid="signin-preview-caption">
        <span>
          <strong className="font-semibold text-foreground">A real pass:</strong> {parkName}
          {place ? `, ${place}` : ""}, made {madeAt}.
        </span>
        <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center gap-0.5 font-semibold whitespace-nowrap text-link underline underline-offset-4">
          See the whole pass
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </figcaption>
    </figure>
  );
}
