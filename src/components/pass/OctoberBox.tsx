import { ButterflyIcon } from "@/components/art/icons";
import { Chip } from "@/components/ui/Chip";
import { formatTime } from "@/lib/pass/format";
import {
  isOctoberDay,
  milkweedLine,
  OCTOBER_REASONS,
  OCTOBER_TIP,
  octoberCompare,
  octoberDetail,
  octoberHeadline,
  octoberUnavailable,
  type OctoberBoxData,
} from "@/lib/october";
import type { Pass } from "@/lib/pass/schema";

export type OctoberBoxProps = {
  /** Only `day` (Chicago day the pass was made) and `october` (the stored box) are read. */
  pass: Pick<Pass, "day" | "october">;
  /**
   * "screen" (default): ticket-style section with the mint chip, for the pass page.
   * "print": pure black-and-white, no background colours, for the S4 print page to slot in.
   */
  variant?: "screen" | "print";
  /** Heading level for the box title (default 2). */
  headingLevel?: 2 | 3;
};

/**
 * October special (SPEC F10): real iNaturalist monarch counts near the park, this year vs the same
 * two weeks last year, a milkweed yes/no for the park, and a fixed tip. Renders nothing outside
 * October (Chicago time of the pass). Every word is code-written; a zero is printed as a zero, and a
 * failed check says "No data available" and why.
 */
export function OctoberBox({ pass, variant = "screen", headingLevel = 2 }: OctoberBoxProps) {
  if (!isOctoberDay(pass.day)) return null;
  const box: OctoberBoxData = pass.october ?? { status: "unavailable", reason: OCTOBER_REASONS.notChecked };
  const print = variant === "print";
  const H = headingLevel === 3 ? "h3" : "h2";
  const titleId = print ? "october-title-print" : "october-title";

  return (
    <section
      aria-labelledby={titleId}
      data-testid="october-box"
      data-variant={variant}
      data-status={box.status}
      className={
        print
          ? "october-box flex flex-col gap-1 border-2 border-dashed border-black p-3 text-black"
          : "flex flex-col gap-2 rounded-control border-2 border-line p-4"
      }
    >
      <H id={titleId} className={print ? "flex items-center gap-2 text-base font-bold" : "text-xl"}>
        {print ? (
          <>
            <ButterflyIcon className="h-5 w-5 shrink-0" />
            <span>October special: monarch butterflies</span>
          </>
        ) : (
          <Chip kind="october">October special: monarch butterflies</Chip>
        )}
      </H>

      {box.status === "ok" ? (
        <>
          <p className={print ? "font-bold" : "text-lg font-semibold"}>{octoberHeadline(box)}</p>
          <p>{octoberCompare(box)}</p>
          <p className={print ? "" : "text-sm"}>{octoberDetail(box, formatTime(box.checkedAt))}</p>
          <p className={print ? "" : "text-sm"}>{milkweedLine(box.milkweed)}</p>
          <p className={print ? "" : "text-sm font-semibold"}>{OCTOBER_TIP}</p>
        </>
      ) : (
        <p className={print ? "" : "rounded-control border-2 border-dashed border-line px-3 py-2"}>{octoberUnavailable(box.reason)}</p>
      )}
    </section>
  );
}
