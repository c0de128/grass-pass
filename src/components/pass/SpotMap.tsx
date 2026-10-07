import { useId } from "react";
import { MapXIcon } from "@/components/art/icons";
import { Chip } from "@/components/ui/Chip";
import { formatTime } from "@/lib/pass/format";
import { drawMap, LEGEND_LABEL, LAYER_STYLE, SMALL_FONT, type LayerStyle, type MapDrawing, type MapLabel } from "@/lib/spot/render-map";
import { SPOT_COPY, type Spot, type SpotOk } from "@/lib/spot/types";

const INK = "#000";
const PAPER = "#fff";

/** One sentence for screen readers: what the map shows, without giving the answer away. */
export function mapDescription(parkName: string, spot: SpotOk): string {
  const lead = `Map of ${parkName} drawn from OpenStreetMap, north is up.`;
  if (spot.start && spot.walk)
    return `${lead} START is at a ${spot.start.label.replace(/ \(.*\)$/, "")}; the X is about ${spot.walk.meters} m ${spot.walk.direction} of it.`;
  return `${lead} The X marks the spot.`;
}

/** A label in a white box with a thin black border (reads over any line, in black and white). */
function BoxLabel({ label, marker }: { label: MapLabel; marker: string }) {
  const b = label.box;
  return (
    <g data-label={marker}>
      <rect x={b.x0} y={b.y0} width={Math.round((b.x1 - b.x0) * 10) / 10} height={Math.round((b.y1 - b.y0) * 10) / 10} rx="4" fill={PAPER} stroke={INK} strokeWidth="1.6" />
      <text className="gp-map-label" x={label.x} y={label.y} textAnchor="middle" fontSize={label.size} fontWeight="800" fill={INK} textLength={label.textLength} lengthAdjust="spacingAndGlyphs">
        {label.text}
      </text>
    </g>
  );
}

/**
 * The X-marks-the-spot map as pure black-and-white SVG (SPEC F9, §8.4; ADR 0004), framed on START and the X
 * (render-map.ts): areas, the park edge, creeks, roads (double lines) and paths, then the chevrons from START
 * toward the X, START, the X, their boxed labels, a small north arrow and a round-number scale bar. Every shape
 * is a real OpenStreetMap object (stored on the pass by code).
 */
export function SpotMapSvg({ drawing: d, title }: { drawing: MapDrawing; title: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hatch = `spot-hatch-${uid}`;
  const dots = `spot-dots-${uid}`;
  const clip = `spot-clip-${uid}`;
  const titleId = `spot-title-${uid}`;
  const halo = { stroke: PAPER, strokeWidth: 3.5, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };

  return (
    <svg className="gp-spot-svg" viewBox={d.viewBox} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet" data-testid="spot-map">
      <title id={titleId}>{title}</title>
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)">
          <path d="M0 0V9" stroke={INK} strokeWidth={LAYER_STYLE.water.width} />
        </pattern>
        <pattern id={dots} patternUnits="userSpaceOnUse" width="12" height="12">
          <circle cx="6" cy="6" r="1.3" fill={INK} />
        </pattern>
        <clipPath id={clip}>
          <rect x="0" y="0" width={d.w} height={d.h} />
        </clipPath>
      </defs>
      <rect x="1" y="1" width={d.w - 2} height={d.h - 2} fill={PAPER} stroke={INK} strokeWidth="2" />
      <g clipPath={`url(#${clip})`} fill="none" stroke={INK} strokeLinejoin="round">
        {d.layers.map((l) => {
          const st = LAYER_STYLE[l.style];
          if (st.casing)
            // A road: black casing, then a white core (all casings first, so crossings merge cleanly).
            return (
              <g key={l.style} data-layer={l.style} strokeLinecap="round">
                <path d={l.d} strokeWidth={st.casing} />
                <path d={l.d} stroke={PAPER} strokeWidth={st.width} />
              </g>
            );
          return (
            <path
              key={l.style}
              data-layer={l.style}
              d={l.d}
              strokeWidth={st.width}
              strokeDasharray={st.dash}
              strokeLinecap={st.cap}
              fill={st.fill === "hatch" ? `url(#${hatch})` : st.fill === "dots" ? `url(#${dots})` : "none"}
            />
          );
        })}
      </g>

      {/* Parking lots: a "P" in the middle. */}
      {d.parkingLabels.map(([px, py]) => (
        <text key={`${px},${py}`} data-marker="parking" className="gp-map-label-sm" x={px} y={py + 5} textAnchor="middle" fontSize={SMALL_FONT} fontWeight="800" fill={INK} {...halo}>
          P
        </text>
      ))}

      {/* This way: chevrons on a straight line from START toward the X (a direction, not a route). */}
      {d.arrow ? (
        <g data-marker="arrow" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={d.arrow.d} stroke={PAPER} strokeWidth="6.5" />
          <path d={d.arrow.d} stroke={INK} strokeWidth="2.6" />
        </g>
      ) : null}

      {/* START: a black triangle with a white halo. */}
      {d.start ? (
        <g data-marker="start">
          <path d={d.start.d} fill={INK} stroke={PAPER} strokeWidth="3.5" paintOrder="stroke" strokeLinejoin="round" />
        </g>
      ) : null}

      {/* The X: a thick black cross with a white halo so it reads over any line. */}
      <g data-marker="x" strokeLinecap="round">
        <path d={d.x.d} stroke={PAPER} strokeWidth="12" fill="none" />
        <path d={d.x.d} stroke={INK} strokeWidth="6.5" fill="none" />
      </g>

      {d.start ? <BoxLabel label={d.start.label} marker="start" /> : null}
      {d.arrow?.label ? <BoxLabel label={d.arrow.label} marker="arrow" /> : null}

      {/* North arrow: small, top right. */}
      <g data-marker="north">
        <rect x={d.north.box.x0} y={d.north.box.y0} width={d.north.box.x1 - d.north.box.x0} height={d.north.box.y1 - d.north.box.y0} rx="4" fill={PAPER} />
        <path d={d.north.arrow} fill={INK} />
        <text className="gp-map-label-sm" x={d.north.x} y={d.north.y} textAnchor="middle" fontSize={SMALL_FONT} fontWeight="800" fill={INK}>
          N
        </text>
      </g>

      {/* Scale bar: bottom left, a round number. */}
      <g data-marker="scale">
        <rect x={d.scale.box.x0} y={d.scale.box.y0} width={Math.round((d.scale.box.x1 - d.scale.box.x0) * 10) / 10} height={Math.round((d.scale.box.y1 - d.scale.box.y0) * 10) / 10} rx="4" fill={PAPER} />
        <path d={d.scale.d} fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="square" />
        <text className="gp-map-label-sm" x={d.scale.x} y={d.scale.y - 10} fontSize={SMALL_FONT} fontWeight="700" fill={INK}>
          {d.scale.label}
        </text>
      </g>
    </svg>
  );
}

type LegendKey = LayerStyle | "x" | "start" | "arrow";

/** A tiny legend sample for one key (aria-hidden; the label next to it is the text). currentColor: readable in dark mode too. */
function LegendGlyph({ style }: { style: LegendKey }) {
  const common = { width: 22, height: 10, viewBox: "0 0 22 10", "aria-hidden": true, focusable: false, className: "gp-spot-glyph shrink-0" } as const;
  if (style === "x")
    return (
      <svg {...common}>
        <path d="M7 1l8 8M15 1l-8 8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    );
  if (style === "start")
    return (
      <svg {...common}>
        <path d="M11 1l5 8H6z" fill="currentColor" />
      </svg>
    );
  if (style === "arrow")
    return (
      <svg {...common}>
        <path d="M3 2l3 3-3 3M10 2l3 3-3 3M17 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  const st = LAYER_STYLE[style];
  if (style === "road")
    return (
      <svg {...common}>
        <path d="M1 2.6H21M1 7.4H21" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  if (style === "water" || style === "pitch" || style === "parking")
    return (
      <svg {...common}>
        {style === "water" ? <path d="M4 9L10 1M10 9l6-8M16 9l4-5.3" stroke="currentColor" strokeWidth="1.2" /> : null}
        {style === "pitch" ? <path d="M6 5h.01M11 5h.01M16 5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : null}
        {style === "parking" ? (
          <text x="11" y="8.2" textAnchor="middle" fontSize="8" fontWeight="800" fill="currentColor">
            P
          </text>
        ) : null}
        <rect x="2" y="1" width="18" height="8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  if (style === "outline")
    return (
      <svg {...common}>
        <path d="M1 5H21" stroke="currentColor" strokeWidth="1.6" strokeDasharray="6 2 1.5 2" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M1 5H21" stroke="currentColor" strokeWidth={Math.min(2.2, st.width)} strokeDasharray={style === "waterway" ? "0.1 3.6" : "4 2.5"} strokeLinecap={st.cap} />
    </svg>
  );
}

/** Legend words. Only what is drawn is listed. */
const legendLabel = (s: LegendKey) => (s === "x" ? "the spot" : s === "start" ? "START (begin here)" : s === "arrow" ? "this way (straight line)" : LEGEND_LABEL[s]);

/** The legend keys for a drawing: the X, START, the arrow, then every visible layer. */
export function legendKeys(d: MapDrawing): LegendKey[] {
  return ["x", ...(d.start ? (["start"] as const) : []), ...(d.arrow ? (["arrow"] as const) : []), ...d.legend];
}

/**
 * Legend columns: rows fill up evenly so no key sits alone on its own line (5-6 keys: 3 + 3, 7-8 keys: 4 + 4,
 * 9 keys: 3 x 3). print.css and globals.css read it as data-cols.
 */
export function legendColumns(n: number): number {
  if (n <= 4) return n;
  if (n <= 6 || n === 9) return 3;
  return 4;
}

export type SpotMapProps = {
  spot: Spot;
  parkName: string;
  /** "print": black-and-white box for the kid pass. "screen": ticket-style section for the pass page. */
  variant?: "print" | "screen";
  headingLevel?: 2 | 3;
};

/**
 * Find This Spot on the kid's side: the riddle, the map, a legend of only what is drawn, and the
 * OpenStreetMap credit. With no target the print variant renders nothing (the stub says why) and the
 * screen variant shows the exact "No Find This Spot today: ..." copy.
 */
export function SpotMap({ spot, parkName, variant = "print", headingLevel = 2 }: SpotMapProps) {
  const H = headingLevel === 3 ? "h3" : "h2";
  const print = variant === "print";
  const headingId = print ? "spot-heading-print" : "spot-heading";
  if (spot.status !== "ok") {
    if (print) return null;
    return (
      <section aria-labelledby={headingId} data-testid="spot-box" data-status="none" className="flex flex-col gap-2">
        <H id={headingId} className="text-xl">
          <Chip kind="spot" />
        </H>
        <p className="rounded-control border-2 border-dashed border-line px-3 py-2">{spot.message}</p>
      </section>
    );
  }

  const drawing = drawMap(spot.map, spot.walk);
  const legend = legendKeys(drawing);
  const cols = legendColumns(legend.length);
  const keys = legend.map((s) => (
    <span key={s} className="gp-spot-key inline-flex min-w-0 items-center gap-1.5 sm:whitespace-nowrap" data-key={s}>
      <LegendGlyph style={s} /> {legendLabel(s)}
    </span>
  ));
  const credit = `Map: ${SPOT_COPY.attribution}`;

  if (print) {
    // Two grid parts (print.css places the map on the left, this text and the October box on the right).
    return (
      <>
        <div className="gp-spot-text" role="group" aria-labelledby={headingId} data-testid="spot-box" data-status="ok" data-variant="print">
          <H id={headingId} className="gp-spot-title">
            <span className="gp-box gp-spot-check" aria-hidden="true" />
            <MapXIcon className="gp-icon" aria-hidden="true" />
            <span>Find This Spot</span>
          </H>
          <p className="gp-spot-riddle">{spot.riddle}</p>
          <p className="gp-small gp-spot-legend" data-print-drop="3" data-cols={cols}>
            {keys}
          </p>
        </div>
        <figure className="gp-spot-figure">
          <div className="gp-spot-frame">
            <SpotMapSvg drawing={drawing} title={mapDescription(parkName, spot)} />
          </div>
          <figcaption className="gp-small">{credit}</figcaption>
        </figure>
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} data-testid="spot-box" data-status="ok" data-variant="screen" className="flex flex-col gap-2">
      <H id={headingId} className="text-xl">
        <Chip kind="spot" />
      </H>
      <p className="text-lg font-semibold">{spot.riddle}</p>
      {/* UX-8-05: the fixed code riddle already says "Follow the map ... to the X", so the second line would repeat it. */}
      {spot.riddleBy === "code" ? null : <p className="text-base">{spot.map.start ? "Start at START and follow the map to the X." : "Follow the map to the X."}</p>}
      <figure className="flex max-w-xl flex-col gap-2">
        <div className="gp-spot-screen overflow-hidden rounded-control border-2 border-line bg-white">
          <SpotMapSvg drawing={drawing} title={mapDescription(parkName, spot)} />
        </div>
        <figcaption className="flex flex-col gap-1.5 text-sm">
          <span className="gp-spot-keys grid grid-cols-2 gap-x-5 gap-y-1" data-cols={cols}>
            {keys}
          </span>
          <span>
            Map:{" "}
            <a className="underline" href="https://www.openstreetmap.org/copyright">
              {SPOT_COPY.attribution}
            </a>
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

/** The answer on the grown-up's stub: what the X is, its OSM id and name, and the walk from START. */
export function SpotAnswer({ spot }: { spot: SpotOk }) {
  const t = spot.target;
  return (
    <p className="gp-spot-answer" data-testid="spot-answer">
      <span className="gp-answer-what">Find This Spot: {t.answer}.</span>{" "}
      <span className="gp-small">
        <span data-print-drop="1">
          OpenStreetMap {t.osmId}
          {t.name ? ` ("${t.name}")` : ""}
          {spot.start ? `; START: ${spot.start.label}, OpenStreetMap ${spot.start.osmId}; ` : "; no mapped entrance or parking for a START; "}
        </span>
        {spot.walk ? `About ${spot.walk.meters} m ${spot.walk.direction} of START. ` : ""}
        <span data-print-drop="1">Map data checked {formatTime(spot.checkedAt)}.</span>
        {spot.riddleBy === "code" ? " The open model's riddle didn't pass our checks, so the pass uses a fixed one." : ""}
      </span>
    </p>
  );
}
