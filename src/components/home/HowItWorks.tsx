import {
  Binoculars,
  ListChecks,
  Map as MapIcon,
  MapPinned,
  PenLine,
  Printer,
  ShieldCheck,
  Smartphone,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { DROP_REASONS } from "@/lib/ai/validate";
import { DROP_REASON_INFO } from "@/lib/how/drop-reasons";
import { BLOCKED_TAXA } from "@/lib/safety/danger-taxa";
import { WILD_RADIUS_KM, WILD_WINDOW_DAYS } from "@/lib/sources/inat";

type Phase = "in" | "ai" | "out";
type Step = { icon: LucideIcon; title: string; body: string; ticker?: readonly string[] };

/**
 * Kevin's v0 copy, checked against what the app really does (times from PASS_WAIT_COPY and the eval
 * run; steps from the pass builder's real progress lines, src/lib/ai/build-pass.ts stepText).
 * These four are the big cards of the diagram (steps 1, 5, 7 and 8 below).
 */
export const HOW_STEPS: readonly Step[] = [
  {
    icon: MapPinned,
    title: "Pick a park & age",
    body: "Type a town, ZIP or park name, or tap Use my location. Then pick 4–6, 6–10, 10–13 or 13+ (teens and adults): it sets how many clues and how hard.",
  },
  {
    icon: PenLine,
    title: "AI builds the hunt",
    body: "Gemma writes, code checks. Gemma 4 picks a fair mix from the park’s real map and 14 days of nearby sightings, then writes the clues. Code checks each one against its source. Usually 10–30 seconds, up to about a minute and a half on a slow evening.",
    ticker: ["Reading the park map…", "Checking what people spotted…", "Writing clues…"],
  },
  {
    icon: Printer,
    title: "Print the page",
    body: "One black-and-white Letter page: the kid’s pass on top, a tear line, and a grown-up stub with the answers and sources.",
  },
  {
    icon: Smartphone,
    title: "Hide the phone",
    body: "Phone away. Kids tick off finds with a pencil while you keep the stub for hints (and sanity).",
  },
];

/** Hard rules a clue must pass (the same count /how-it-works step 5 shows). */
const HARD_RULES = DROP_REASONS.filter((r) => DROP_REASON_INFO[r].kind === "always").length;

/**
 * The four in-between steps of the diagram. Short facts from /how-it-works (src/app/how-it-works/page.tsx steps
 * "data", "safety", "checks"), with the numbers read from code at render: WILD_RADIUS_KM / WILD_WINDOW_DAYS
 * (src/lib/sources/inat.ts), BLOCKED_TAXA (src/lib/safety/danger-taxa.ts), the "always" DROP_REASONS.
 */
const MAP_STEP: Step = { icon: MapIcon, title: "Real park map", body: "From OpenStreetMap: what is mapped inside the park." };
const WILD_STEP: Step = {
  icon: Binoculars,
  title: "Wildlife sightings",
  body: `From iNaturalist: research-grade sightings within ${WILD_RADIUS_KM} km, last ${WILD_WINDOW_DAYS} days.`,
};
const SAFETY_STEP: Step = {
  icon: ShieldCheck,
  title: "Safety filter, by code",
  body: `Code removes ${BLOCKED_TAXA.length} groups of risky species, like fire ants and poison ivy, before the AI sees the list.`,
};
const CHECK_STEP: Step = {
  icon: ListChecks,
  title: "Code checks every clue",
  body: `A clue that breaks one of ${HARD_RULES} hard rules (proof quote, name leaks, numbers, safety) is removed.`,
};

/** The three phases of the headline, as colour bands: grass green (data in), sunflower (AI), ink (paper out; cream at night). */
const PHASES: Record<Phase, { label: string; fill: string; node: string; stroke: string }> = {
  in: { label: "Data in", fill: "bg-primary", node: "bg-primary text-primary-foreground", stroke: "stroke-primary" },
  ai: { label: "AI processing", fill: "bg-sun", node: "bg-sun text-sun-foreground", stroke: "stroke-sun" },
  out: { label: "Adventure out", fill: "bg-ink", node: "bg-ink text-on-ink", stroke: "stroke-ink" },
};

/*
 * Desktop diagram geometry, drawn for a 1216 px box (the box at 1280 px). Wide layout (2026-10-09): from 1280 px the box
 * grows with the shared container (up to 1536 px); positions and card widths are fractions of the box, so it scales as one.
 * The nodes sit on an arc around (CX, CY); every card is pinned by its anchor point (where its leader line ends).
 */
const BOX_W = 1216;
const BOX_H = 780;
const CX = 608;
const CY = 652;
const R = 300;
const polar = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.round((CX + R * Math.cos(a)) * 10) / 10, y: Math.round((CY - R * Math.sin(a)) * 10) / 10 };
};

type Anchor = "left" | "right" | "bottom";
type Layout = { deg: number; cx: number; cy: number; w: number; anchor: Anchor };
type DiagramStep = Step & { phase: Phase; big?: boolean; layout: Layout };

const DIAGRAM: readonly DiagramStep[] = [
  { ...HOW_STEPS[0], phase: "in", big: true, layout: { deg: 180, cx: 250, cy: 690, w: 250, anchor: "left" } },
  { ...MAP_STEP, phase: "in", layout: { deg: 160, cx: 250, cy: 530, w: 250, anchor: "left" } },
  { ...WILD_STEP, phase: "in", layout: { deg: 140, cx: 250, cy: 385, w: 250, anchor: "left" } },
  { ...SAFETY_STEP, phase: "ai", layout: { deg: 112, cx: 258, cy: 292, w: 280, anchor: "bottom" } },
  { ...HOW_STEPS[1], phase: "ai", big: true, layout: { deg: 90, cx: 608, cy: 292, w: 400, anchor: "bottom" } },
  { ...CHECK_STEP, phase: "ai", layout: { deg: 68, cx: 958, cy: 292, w: 280, anchor: "bottom" } },
  { ...HOW_STEPS[2], phase: "out", big: true, layout: { deg: 40, cx: 966, cy: 400, w: 250, anchor: "right" } },
  { ...HOW_STEPS[3], phase: "out", big: true, layout: { deg: 20, cx: 966, cy: 575, w: 250, anchor: "right" } },
];

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

const ANCHOR_CLASS: Record<Anchor, string> = {
  left: "xl:-translate-x-full xl:-translate-y-1/2",
  right: "xl:-translate-y-1/2",
  bottom: "xl:-translate-x-1/2 xl:-translate-y-full",
};

/** An SVG arc path along the node circle from one angle to another (degrees, counter-clockwise from 3 o'clock). */
function arc(r: number, from: number, to: number) {
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(CX + r * Math.cos(a)).toFixed(1)} ${(CY - r * Math.sin(a)).toFixed(1)}`;
  };
  const large = Math.abs(from - to) > 180 ? 1 : 0;
  return `M ${p(from)} A ${r} ${r} 0 ${large} 1 ${p(to)}`;
}

/** The decorative arc art behind the desktop diagram: phase bands, a tear-line track, leaders and the pass in the middle. */
function DiagramArt() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${BOX_W} ${BOX_H}`}
      className="pointer-events-none absolute inset-0 hidden size-full xl:block"
    >
      <defs>
        <radialGradient id="how-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--gp-sun)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--gp-sun)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="how-hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--gp-muted)" />
          <stop offset="100%" stopColor="var(--gp-muted)" stopOpacity="0" />
        </linearGradient>
        <mask id="how-ticket-notches">
          <rect x="-140" y="-90" width="280" height="180" fill="white" />
          <circle cx="-118" cy="0" r="18" fill="black" />
          <circle cx="118" cy="0" r="18" fill="black" />
        </mask>
        <path id="how-label-in" d={arc(R - 56, 178, 132)} />
        <path id="how-label-ai" d={arc(R - 56, 124, 56)} />
        <path id="how-label-out" d={arc(R - 56, 48, 2)} />
      </defs>
      {/* The meadow hill and the dotted outer orbit. */}
      <path d={`${arc(R - 74, 180, 0)} Z`} fill="url(#how-hill)" />
      <path d={arc(R + 70, 178, 2)} fill="none" className="stroke-line" strokeWidth="1.5" strokeDasharray="1 9" strokeLinecap="round" />
      {/* Ticket tear line inside the bands. */}
      <path d={arc(R - 34, 182, -2)} fill="none" className="gp-how-flow stroke-line" strokeWidth="2" strokeDasharray="6 8" strokeLinecap="round" />
      {/* Three phase bands. */}
      <path d={arc(R, 186, 128)} fill="none" className="stroke-primary" strokeWidth="18" strokeLinecap="round" />
      <path d={arc(R, 122, 58)} fill="none" className="stroke-sun" strokeWidth="18" strokeLinecap="round" />
      <path d={arc(R, 52, 8)} fill="none" className="stroke-ink" strokeWidth="18" strokeLinecap="round" />
      <circle cx={polar(90).x} cy={polar(90).y} r="90" fill="url(#how-glow)" />
      {/* Phase labels along the outer orbit. */}
      <g className="fill-foreground font-heading text-[12px] font-extrabold tracking-[0.2em] uppercase">
        <text>
          <textPath href="#how-label-in" startOffset="50%" textAnchor="middle">
            Data in
          </textPath>
        </text>
        <text>
          <textPath href="#how-label-ai" startOffset="50%" textAnchor="middle">
            AI processing
          </textPath>
        </text>
        <text>
          <textPath href="#how-label-out" startOffset="50%" textAnchor="middle">
            Adventure out
          </textPath>
        </text>
      </g>
      {/* Leader lines from each node to its card. */}
      {DIAGRAM.map((s) => {
        const n = polar(s.layout.deg);
        const { cx, cy, anchor } = s.layout;
        const d =
          anchor === "bottom"
            ? `M ${n.x} ${n.y} C ${n.x} ${(n.y + cy) / 2}, ${cx} ${(n.y + cy) / 2 + 20}, ${cx} ${cy}`
            : `M ${n.x} ${n.y} C ${(n.x + cx) / 2} ${n.y}, ${(n.x + cx) / 2} ${cy}, ${cx} ${cy}`;
        return (
          <g key={s.title}>
            <path d={d} fill="none" className={PHASES[s.phase].stroke} strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={cx} cy={cy} r="5" className={`fill-background ${PHASES[s.phase].stroke}`} strokeWidth="2.5" />
          </g>
        );
      })}
      {/* The printed pass in the middle: the sprout ticket from the logo, big. */}
      <g transform={`translate(${CX} ${CY - 112}) rotate(-6)`}>
        <rect x="-118" y="-74" width="236" height="148" rx="22" className="fill-primary" mask="url(#how-ticket-notches)" />
        <line x1="62" y1="-58" x2="62" y2="58" className="stroke-primary-foreground" strokeOpacity="0.55" strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
        <Sprout x="-92" y="-38" width="76" height="76" strokeWidth={2.25} className="text-primary-foreground" />
        {[-30, 0, 30].map((y) => (
          <g key={y} className="stroke-primary-foreground" strokeWidth="3" strokeLinecap="round" fill="none">
            <rect x="-6" y={y - 8} width="16" height="16" rx="3" />
            <line x1="20" y1={y} x2={y === 0 ? 38 : 46} y2={y} strokeOpacity="0.7" />
          </g>
        ))}
        <path d="M -3 -30 l 4 4 l 7 -9" className="stroke-sun" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
    </svg>
  );
}

function Node({ step, index }: { step: DiagramStep; index: number }) {
  const p = polar(step.layout.deg);
  const style = { "--nx": pct(p.x, BOX_W), "--ny": pct(p.y, BOX_H) } as CSSProperties;
  const ai = step.phase === "ai" && step.big;
  return (
    <div
      aria-hidden="true"
      style={style}
      className="relative z-10 flex shrink-0 items-start justify-center xl:absolute xl:top-(--ny) xl:left-(--nx) xl:-translate-x-1/2 xl:-translate-y-1/2"
    >
      <span
        className={`relative flex items-center justify-center rounded-full ring-4 ring-background transition-transform motion-safe:group-hover:scale-110 ${PHASES[step.phase].node} ${ai ? "size-14 xl:size-20" : "size-12 xl:size-14"}`}
      >
        <step.icon className={ai ? "size-6 xl:size-9" : "size-5 xl:size-6"} strokeWidth={2.25} />
        <span className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-card font-heading text-xs font-extrabold text-ink ring-2 ring-ink">
          {index + 1}
        </span>
      </span>
    </div>
  );
}

function Card({ step, index, children }: { step: DiagramStep; index: number; children?: ReactNode }) {
  // On the phone/tablet stepper the phase chip shows once, on the first step of each phase (screen readers hear it on every step).
  const first = index === 0 || DIAGRAM[index - 1].phase !== step.phase;
  const { cx, cy, w, anchor } = step.layout;
  const style = { "--cx": pct(cx, BOX_W), "--cy": pct(cy, BOX_H), "--cw": pct(w, BOX_W) } as CSSProperties;
  const ai = step.phase === "ai" && step.big;
  return (
    <div
      style={style}
      className={`relative flex min-w-0 flex-1 flex-col gap-2 rounded-3xl bg-card p-5 xl:absolute xl:top-(--cy) xl:left-(--cx) xl:w-(--cw) xl:flex-none ${ANCHOR_CLASS[anchor]} ${
        ai ? "shadow-xl shadow-shadow ring-2 ring-sun" : "shadow-lg shadow-shadow/60 ring-1 ring-border"
      } transition-shadow motion-safe:group-hover:shadow-xl`}
    >
      <p className={`w-fit rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold tracking-wider uppercase xl:sr-only ${first ? "" : "sr-only"} ${PHASES[step.phase].node}`}>
        {PHASES[step.phase].label}
      </p>
      <span aria-hidden="true" className={`absolute top-6 left-0 hidden h-7 w-1.5 rounded-r-full xl:block ${PHASES[step.phase].fill}`} />
      <h3 className={`font-extrabold text-ink ${ai ? "text-2xl 2xl:text-[1.75rem]" : step.big ? "text-xl 2xl:text-2xl" : "text-lg 2xl:text-xl"} leading-tight`}>
        <span className="sr-only">Step {index + 1}: </span>
        {step.title}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground 2xl:text-[0.95rem]">{step.body}</p>
      {children}
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="relative scroll-mt-28 bg-muted/70 sm:scroll-mt-16">
      <div className="gp-container flex flex-col gap-14 py-24 lg:py-32 xl:gap-12">
        <div className="flex max-w-3xl flex-col gap-4">
          {/* Kevin 2026-10-07: same font and size as the hero's "Family time is back!" (HomeHero h1 sizes x 1.25). */}
          <h2 id="how-title" className="text-6xl leading-[0.95] font-extrabold tracking-tighter text-ink sm:text-7xl lg:text-[clamp(2.75rem,4.1vw,3.75rem)]">
            <span className="text-[1.25em] leading-[0.95]">How it works</span>
          </h2>
        </div>

        <div data-testid="how-diagram" className="relative xl:aspect-[1216/780]">
          <DiagramArt />
          <ol aria-label="How a pass is made, in 8 steps" className="flex flex-col gap-6 md:max-w-3xl xl:static xl:block xl:max-w-none">
            {DIAGRAM.map((step, index) => (
              <li key={step.title} className={`group relative flex gap-4 xl:static ${index > 0 && DIAGRAM[index - 1].phase !== step.phase ? "mt-4 xl:mt-0" : ""}`}>
                {index < DIAGRAM.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={`absolute top-12 left-6 w-1 -translate-x-1/2 ${index < DIAGRAM.length - 1 && DIAGRAM[index + 1].phase !== step.phase ? "-bottom-10" : "-bottom-6"} rounded-full xl:hidden ${
                      PHASES[DIAGRAM[index + 1].phase].fill
                    }`}
                  />
                ) : null}
                <Node step={step} index={index} />
                <Card step={step} index={index}>
                  {step.ticker ? (
                    <ul aria-label="What you see while it works" className="mt-1 flex flex-col gap-1.5 rounded-2xl bg-muted p-3 text-xs font-medium text-ink">
                      {step.ticker.map((line, i) => (
                        <li key={line} className="flex items-center gap-2">
                          <span
                            className={`size-2 rounded-full ${i === step.ticker!.length - 1 ? "bg-sun ring-2 ring-ink/20 motion-safe:animate-pulse" : "bg-primary"}`}
                            aria-hidden="true"
                          />
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
