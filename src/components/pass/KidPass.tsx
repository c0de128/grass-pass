import Image from "next/image";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { HoopIcon, MagnifierIcon, PawIcon } from "@/components/art/icons";
import { SECTION_LABELS } from "@/components/ui/Chip";
import { formatDay } from "@/lib/pass/format";
import { AGE_BAND_INFO, type Pass, type PassItem, type SectionId } from "@/lib/pass/schema";

/**
 * The 1-colour black logo for print (ADR 0004). Referenced by path, never inlined: the brand
 * hand-off swaps the file in public/ without touching code. viewBox 394x90.
 */
export const PRINT_LOGO_SRC = "/logo-print-1c.svg";
const PRINT_LOGO_RATIO = 394 / 90;

const SECTION_ICON: Record<SectionId, ComponentType<SVGProps<SVGSVGElement>>> = {
  park: HoopIcon,
  wild: MagnifierIcon,
  lucky: PawIcon,
};

/** Singular section names for the screen-reader text on each row ("Park Find"). */
const SECTION_ONE: Record<SectionId, string> = {
  park: SECTION_LABELS.park.replace(/s$/, ""),
  wild: SECTION_LABELS.wild.replace(/s$/, ""),
  lucky: SECTION_LABELS.lucky.replace(/s$/, ""),
};

/** Fixed kid safety line printed on every pass (ADR 0003). */
export const KID_STAY_CLOSE = "Stay where your grown-up can see you.";

/** Rough characters per printed line at full width: clue (12.5 pt bold) and hint (11 pt). */
const CLUE_CHARS_PER_LINE = 62;
const HINT_CHARS_PER_LINE = 80;

/** Estimated printed lines of the finds list (clue, then look/safety/evidence, per row). */
export function estimatedLines(items: readonly PassItem[]): number {
  return items.reduce((n, it) => {
    // The evidence is small print (8.5 pt) on the hint line: about 0.8 of a hint character each.
    const hint = (it.lookWhere ? it.lookWhere.length + 8 : 0) + (it.safety?.length ?? 0) + Math.ceil((it.evidence.length + 2) * 0.8);
    return n + Math.ceil(it.clue.length / CLUE_CHARS_PER_LINE) + Math.ceil(hint / HINT_CHARS_PER_LINE);
  }, 0);
}

/**
 * Line budgets for one Letter sheet, set from measured print layouts (S4, 2026-10-05). Real 8-find
 * passes (S3 recordings) estimate 17-22 lines. Above SNUG the rows sit closer and the clue is
 * 11.5 pt; above TIGHT (long clues on most rows, up to the 120-character maximum) the kid half is
 * scaled to 88% so the sheet still prints on one page.
 */
export const SNUG_LINE_BUDGET = 24;
export const TIGHT_LINE_BUDGET = 26;

export type Density = "roomy" | "snug" | "tight";

/** How tightly the kid pass is set, from the text length and whether the side slots are used. */
export function passDensity(items: readonly PassItem[], hasExtras: boolean): Density {
  const lines = estimatedLines(items);
  if (lines > TIGHT_LINE_BUDGET) return "tight";
  return hasExtras || lines > SNUG_LINE_BUDGET ? "snug" : "roomy";
}

export type KidPassProps = {
  pass: Pass;
  /** S5 slot: the Find This Spot map + riddle. Absent = nothing is rendered (never a placeholder). */
  spot?: ReactNode;
  /** S7 slot: the October monarch box. Absent = nothing is rendered (never a placeholder). */
  october?: ReactNode;
};

/**
 * The kid's half of the printed sheet (SPEC §8.4): 1-colour logo, the park and day, a handwriting
 * name line, numbered rows with a >= 7 mm checkbox, a small section icon, the clue, where to look,
 * the fixed safety line and the code-written evidence in small print. Plain text only.
 */
export function KidPass({ pass, spot, october }: KidPassProps) {
  const hasExtras = Boolean(spot) || Boolean(october);
  const density = passDensity(pass.items, hasExtras);
  const logoHeight = 48;
  const n = pass.items.length;

  return (
    <section className="gp-kid" aria-labelledby="kid-pass-title" data-density={density}>
      <div className="gp-kid-head">
        <Image
          src={PRINT_LOGO_SRC}
          alt="Grass Pass: your ticket to get outside"
          width={Math.round(logoHeight * PRINT_LOGO_RATIO)}
          height={logoHeight}
          unoptimized
          loading="eager"
          className="gp-logo"
        />
        <div className="gp-kid-meta">
          <h1 id="kid-pass-title">
            <span className="gp-label">Park:</span> {pass.park.name}
          </h1>
          {/* One wrapping row (S5 print-space fix): date + age, then the stay-close line. */}
          <p className="gp-kid-when">
            <span>
              {formatDay(pass.day)} · {AGE_BAND_INFO[pass.ageBand].label}
            </span>{" "}
            <span className="gp-stay">{KID_STAY_CLOSE}</span>
          </p>
        </div>
      </div>

      <div className="gp-kid-row">
        <p className="gp-name">
          <span>Name:</span>
          <span className="gp-name-line" aria-hidden="true" />
        </p>
        <p className="gp-intro">
          {n === 1 ? "Find this thing." : `Find these ${n} things.`} Tick a box when you find one!
        </p>
      </div>

      <div className="gp-kid-body" data-extras={hasExtras ? "true" : "false"}>
        {n > 0 ? (
          <ol className="gp-finds" aria-label="Things to find">
            {pass.items.map((it, i) => {
              const IconFor = SECTION_ICON[it.section];
              return (
                <li key={i} className="gp-find" data-section={it.section}>
                  <span className="gp-box" aria-hidden="true" />
                  <span className="gp-num" aria-hidden="true">
                    {i + 1}
                    <IconFor className="gp-icon" />
                  </span>
                  <div>
                    <p className="gp-clue">
                      <span className="sr-only">
                        Find {i + 1}, {SECTION_ONE[it.section]}:{" "}
                      </span>
                      {it.clue}
                    </p>
                    <p className="gp-hint">
                      {it.lookWhere ? <>Look: {it.lookWhere}. </> : null}
                      {it.safety ? <span className="gp-safety">{it.safety} </span> : null}
                      <span className="gp-small">({it.evidence})</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="gp-hint">No data available: this pass has no finds that passed our checks.</p>
        )}

        {hasExtras ? (
          <div className="gp-extras" data-spot={spot ? "true" : "false"}>
            {spot ? <div data-slot="spot">{spot}</div> : null}
            {october ? <div data-slot="october">{october}</div> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
