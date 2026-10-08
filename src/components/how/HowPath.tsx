import { ArrowRight, Bot, Database, ShieldCheck, Sprout, type LucideIcon } from "lucide-react";
import { PATH_STEPS, PATH_WHO, type PathWho } from "@/lib/how/path";

/*
 * The winding trail at the top of /how-it-works (Kevin, 2026-10-08, after his "path" picture): eight numbered stops on
 * a road that snakes down the page, each card tagged with what does the work, ending on the dark "Touch grass" stop.
 *
 * Layout. Phones (< 768 px): a straight vertical rail, numbered stops down the left, cards stacked beside them.
 * From 768 px: every row has a FIXED height (14rem at md, 12rem from lg; the last row is 1.5 rows), so one inline SVG
 * with preserveAspectRatio="none" and non-scaling strokes can draw the S-curve through the stop centres without
 * measuring anything. The geometry below is in "row units" (one row = 12): x is a percentage of the width.
 *
 * Accessibility: the steps are a real <ol> of text; the road, the stop circles and the arrows are aria-hidden. The road
 * draws itself on scroll only when motion is OK and the browser has scroll timelines (globals.css "how-path" block);
 * otherwise it is simply there.
 */

const ROW = 12;
const LAST = 18;
const LEFT_X = 9;
const RIGHT_X = 91;
const LAST_NODE_Y = (PATH_STEPS.length - 1) * ROW + LAST / 4;
const VIEW_H = (PATH_STEPS.length - 1) * ROW + LAST;

function nodeOf(i: number): { x: number; y: number } {
  if (i === PATH_STEPS.length - 1) return { x: 50, y: LAST_NODE_Y };
  return { x: i % 2 === 0 ? LEFT_X : RIGHT_X, y: i * ROW + ROW / 2 };
}

/** The road: in from the top above stop 1, then a smooth S between every pair of stops (vertical tangents at each stop). */
function roadPath(): string {
  const first = nodeOf(0);
  let d = `M ${first.x} 0 L ${first.x} ${first.y}`;
  for (let i = 0; i < PATH_STEPS.length - 1; i++) {
    const a = nodeOf(i);
    const b = nodeOf(i + 1);
    const k = (b.y - a.y) * 0.85;
    d += ` C ${a.x} ${a.y + k} ${b.x} ${b.y - k} ${b.x} ${b.y}`;
  }
  return d;
}

const ROAD = roadPath();

const ICON: Record<PathWho, LucideIcon> = { data: Database, ai: Bot, code: ShieldCheck, you: Sprout };

/** Badge colours: grass green for data, sunflower for the open model, ink for code (inverse in dark mode). */
const BADGE: Record<PathWho, string> = {
  data: "bg-primary text-primary-foreground",
  ai: "bg-sun text-sun-foreground",
  code: "bg-ink text-on-ink",
  you: "bg-footer text-footer-heading ring-1 ring-footer-heading/70",
};

const NODE: Record<PathWho, string> = {
  data: "bg-primary text-primary-foreground ring-4 ring-background",
  ai: "bg-sun text-sun-foreground ring-4 ring-background shadow-[0_0_0_11px_rgb(255_199_44_/_0.35)]",
  code: "bg-ink text-on-ink ring-4 ring-background",
  you: "bg-footer text-footer-heading ring-4 ring-footer-heading shadow-[0_0_0_12px_rgb(255_199_44_/_0.12),0_0_56px_10px_rgb(255_199_44_/_0.28)]",
};

function Badge({ who, className = "" }: { who: PathWho; className?: string }) {
  const Icon = ICON[who];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs leading-none font-bold tracking-wide ${BADGE[who]} ${className}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {PATH_WHO[who].badge}
    </span>
  );
}

/** One tuft of lawn grass (at most 3 soft blades from one root, BRAND.md), rooted at (x, 24). Decorative. */
function Tuft({ x, h = 16, flip = false }: { x: number; h?: number; flip?: boolean }) {
  const s = flip ? -1 : 1;
  return (
    <g>
      <path d={`M${x} 24 C ${x - s} ${24 - h * 0.6}, ${x - 5 * s} ${24 - h * 0.9}, ${x - 7 * s} ${24 - h}`} stroke="#4cc274" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d={`M${x + 2 * s} 24 C ${x + 2 * s} ${24 - h * 0.7}, ${x + 3 * s} ${24 - h * 1.1}, ${x + 4 * s} ${24 - h * 1.25}`} stroke="#70b364" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d={`M${x + 4 * s} 24 C ${x + 6 * s} ${24 - h * 0.5}, ${x + 9 * s} ${24 - h * 0.7}, ${x + 12 * s} ${24 - h * 0.8}`} stroke="#4cc274" strokeWidth="3" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** Grass growing from the top edge of the last card ("Touch grass"). */
function Grass() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 400 24" preserveAspectRatio="xMidYMax meet" className="pointer-events-none absolute -top-[1.4rem] left-6 h-6 w-[calc(100%-3rem)] overflow-visible">
      <Tuft x={14} h={14} />
      <Tuft x={44} h={19} flip />
      <Tuft x={78} h={12} />
      <Tuft x={312} h={13} flip />
      <Tuft x={346} h={20} />
      <Tuft x={380} h={14} flip />
    </svg>
  );
}

function Road() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="gp-how-road pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible md:block"
      viewBox={`0 0 100 ${VIEW_H}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="gp-how-road-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={VIEW_H}>
          <stop offset="0" stopColor="var(--gp-how-road-1)" />
          <stop offset="0.55" stopColor="var(--gp-how-road-2)" />
          <stop offset="1" stopColor="var(--gp-how-road-3)" />
        </linearGradient>
      </defs>
      {/* Verge, road, and the sunflower centre line (non-scaling strokes keep their pixel width at every size). */}
      <path d={ROAD} fill="none" stroke="var(--gp-how-verge)" strokeWidth="44" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={ROAD} fill="none" stroke="url(#gp-how-road-fill)" strokeWidth="34" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path
        d={ROAD}
        fill="none"
        stroke="var(--gp-sun)"
        strokeWidth="2.5"
        strokeDasharray="10 12"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.9"
      />
    </svg>
  );
}

export function HowPath() {
  const last = PATH_STEPS.length - 1;
  return (
    <div className="flex flex-col gap-10">
      {/* The legend is the 10-second read: data in, the open model writes, code checks, paper out. */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-muted-foreground">Who does each step:</p>
        <ul aria-label="Who does the work" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-2.5">
          {(["data", "ai", "code", "you"] as const).map((w, i) => (
            <li key={w} className="flex items-center gap-2">
              {i > 0 ? <ArrowRight aria-hidden="true" className="hidden size-4 text-muted-foreground sm:block" /> : null}
              <span className={`inline-flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2 text-sm font-bold ${BADGE[w]}`}>
                <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-background/20">
                  {(() => {
                    const Icon = ICON[w];
                    return <Icon className="size-3.5" />;
                  })()}
                </span>
                {w === "ai" ? (
                  <>
                    {PATH_WHO.ai.legend} <span className="hidden font-semibold opacity-80 lg:inline">(Gemma 4)</span>
                  </>
                ) : (
                  PATH_WHO[w].legend
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative">
        {/* Phones: one straight rail behind the stops. */}
        <span aria-hidden="true" className="gp-how-rail absolute top-2 bottom-24 left-7 w-3 -translate-x-1/2 rounded-full md:hidden" />
        <Road />
        <ol aria-label="How Grass Pass works, in 8 stops" className="relative flex flex-col gap-6 md:gap-0">
          {PATH_STEPS.map((s, i) => {
            const isLast = i === last;
            const right = !isLast && i % 2 === 1;
            const n = nodeOf(i);
            return (
              <li
                key={s.id}
                data-who={s.who}
                className={`relative grid grid-cols-[3.5rem_1fr] items-start gap-x-3 gap-y-3 md:flex md:gap-0 ${
                  isLast
                    ? "md:h-[22.5rem] md:flex-col md:items-center md:justify-end md:pb-2 lg:h-[19.5rem]"
                    : `md:h-60 md:items-center lg:h-52 ${right ? "md:justify-end" : ""}`
                }`}
              >
                {/* The numbered stop. Phones: in the left column. From 768 px: on the road (left, right, then centred). */}
                <span
                  aria-hidden="true"
                  style={{ ["--x" as string]: `${n.x}%`, ["--y" as string]: isLast ? "25%" : "50%" }}
                  className={`relative z-10 flex items-center justify-center rounded-full font-heading font-extrabold tabular-nums md:absolute md:top-(--y) md:left-(--x) md:-translate-x-1/2 md:-translate-y-1/2 ${
                    isLast ? "size-14 text-2xl md:size-24 md:text-4xl" : "size-14 text-2xl md:size-16 md:text-3xl"
                  } ${NODE[s.who]}`}
                >
                  {i + 1}
                  {s.who === "ai" ? (
                    <span className="absolute -top-2 -right-2 rounded-full bg-band px-1.5 py-0.5 font-sans text-[0.65rem] leading-none font-extrabold tracking-wider text-sun ring-2 ring-background">
                      AI
                    </span>
                  ) : null}
                </span>

                <div
                  className={`relative flex shadow-[0_1px_2px_var(--gp-shadow),0_16px_40px_-16px_var(--gp-shadow)] min-w-0 flex-col gap-2 rounded-3xl p-4 sm:p-5 md:w-[46%] md:p-6 ${
                    isLast
                      ? "gp-how-card-end bg-footer text-footer-foreground ring-1 ring-footer-heading/40 md:w-[min(32rem,70%)] md:items-center md:text-center"
                      : `bg-card text-card-foreground ${s.who === "ai" ? "gp-how-card-ai ring-2 ring-sun" : "ring-1 ring-border"} ${right ? "md:mr-[17%]" : "md:ml-[17%]"}`
                  }`}
                >
                  {isLast ? <Grass /> : null}
                  <Badge who={s.who} className={isLast ? "self-start md:self-center" : "self-start"} />
                  <h3 className={`font-heading text-xl leading-tight font-extrabold tracking-tight text-balance md:text-2xl ${isLast ? "text-footer-heading md:text-3xl" : "text-ink"}`}>
                    {s.title}
                  </h3>
                  <p className={`leading-snug text-pretty ${isLast ? "text-footer-foreground" : "text-muted-foreground"}`}>{s.line}</p>
                </div>

                {s.handoff ? (
                  <p className="col-start-2 -mt-1 md:absolute md:bottom-0 md:left-1/2 md:z-20 md:mt-0 md:-translate-x-1/2 md:translate-y-1/2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm ring-1 ring-border">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-sun ring-1 ring-ink/40" />
                      {s.handoff}
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
