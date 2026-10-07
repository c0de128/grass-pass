import { useId } from "react";
import { MapXIcon } from "@/components/art/icons";
import { Chip } from "@/components/ui/Chip";
import { formatTime } from "@/lib/pass/format";
import { drawMap, LEGEND_LABEL, LAYER_STYLE, type LayerStyle } from "@/lib/spot/render-map";
import { SPOT_COPY, type Spot, type SpotMap as SpotMapData, type SpotOk } from "@/lib/spot/types";

const INK = "#000";
const PAPER = "#fff";

/** One sentence for screen readers: what the map shows, without giving the answer away. */
export function mapDescription(parkName: string, spot: SpotOk): string {
  const lead = `Map of ${parkName} drawn from OpenStreetMap, north is up.`;
  if (spot.start && spot.walk) return `${lead} START is at a ${spot.start.label.replace(/ \(.*\)$/, "")}; the X is about ${spot.walk.meters} m ${spot.walk.direction} of it.`;
  return `${lead} The X marks the spot.`;
}

/**
 * The X-marks-the-spot map as pure black-and-white SVG (SPEC F9, §8.4; ADR 0004): park edge, roads,
 * paths, creeks, hatched water, sports fields, parking, the START triangle, the X, a north arrow and
 * a scale bar. Every shape is a real OpenStreetMap object (stored on the pass by code).
 */
export function SpotMapSvg({ map, title }: { map: SpotMapData; title: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const d = drawMap(map);
  const hatch = `spot-hatch-${uid}`;
  const clip = `spot-clip-${uid}`;
  const titleId = `spot-title-${uid}`;
  const halo = { stroke: PAPER, strokeWidth: 3.5, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };

  return (
    <svg className="gp-spot-svg" viewBox={d.viewBox} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet" data-testid="spot-map">
      <title id={titleId}>{title}</title>
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <path d="M0 0V6" stroke={INK} strokeWidth={LAYER_STYLE.water.width} />
        </pattern>
        <clipPath id={clip}>
          <rect x="0" y="0" width={d.w} height={d.h} />
        </clipPath>
      </defs>
      <rect x="1" y="1" width={d.w - 2} height={d.h - 2} fill={PAPER} stroke={INK} strokeWidth="2" />
      <g clipPath={`url(#${clip})`} fill="none" stroke={INK} strokeLinejoin="round">
        {d.layers.map((l) => {
          const st = LAYER_STYLE[l.style];
          return (
            <path
              key={l.style}
              data-layer={l.style}
              d={l.d}
              strokeWidth={st.width}
              strokeDasharray={st.dash}
              strokeLinecap={st.cap}
              fill={st.fill === "hatch" ? `url(#${hatch})` : "none"}
            />
          );
        })}
      </g>

      {/* Parking lots: a "P" in the middle. */}
      {d.parkingLabels.map(([px, py]) => (
        <text key={`${px},${py}`} data-marker="parking" className="gp-map-label-sm" x={px} y={py + 4.5} textAnchor="middle" fontSize="12" fontWeight="800" fill={INK} {...halo}>
          P
        </text>
      ))}

      {/* START: a black triangle with a white halo, and its label. */}
      {d.start ? (
        <g data-marker="start">
          <path d={d.start.d} fill={INK} stroke={PAPER} strokeWidth="3" paintOrder="stroke" strokeLinejoin="round" />
          <text className="gp-map-label-lg" x={d.start.label.x} y={d.start.label.y} textAnchor={d.start.label.anchor} fontSize="13" fontWeight="800" fill={INK} {...halo}>
            START
          </text>
        </g>
      ) : null}

      {/* The X: a thick black cross with a white halo so it reads over any line. */}
      <g data-marker="x" strokeLinecap="round">
        <path d={d.x.d} stroke={PAPER} strokeWidth="10" fill="none" />
        <path d={d.x.d} stroke={INK} strokeWidth="5.5" fill="none" />
      </g>

      {/* North arrow. */}
      <g data-marker="north">
        <path d={d.north.arrow} fill={INK} stroke={PAPER} strokeWidth="2" paintOrder="stroke" />
        <text className="gp-map-label-lg" x={d.north.x} y={d.north.y} textAnchor="middle" fontSize="13" fontWeight="800" fill={INK} {...halo}>
          N
        </text>
      </g>

      {/* Scale bar. */}
      <g data-marker="scale">
        <path d={d.scale.d} fill="none" stroke={PAPER} strokeWidth="6" strokeLinecap="square" />
        <path d={d.scale.d} fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="square" />
        <text className="gp-map-label-sm" x={d.scale.x} y={d.scale.y - 9} fontSize="12" fontWeight="700" fill={INK} {...halo}>
          {d.scale.label}
        </text>
      </g>
    </svg>
  );
}

/** A tiny legend sample for one layer (aria-hidden; the label next to it is the text). currentColor: readable in dark mode too. */
function LegendGlyph({ style }: { style: LayerStyle | "x" | "start" }) {
  const common = { width: 22, height: 10, viewBox: "0 0 22 10", "aria-hidden": true, focusable: false, className: "gp-spot-glyph" } as const;
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
  const st = LAYER_STYLE[style];
  if (style === "water" || style === "pitch" || style === "parking")
    return (
      <svg {...common}>
        {style === "water" ? <path d="M3 9L9 1M8 9l6-8M13 9l6-8" stroke="currentColor" strokeWidth="1.4" /> : null}
        <rect x="2" y="1.5" width="18" height="7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray={st.dash} />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M1 5H21" stroke="currentColor" strokeWidth={Math.min(2.4, st.width)} strokeDasharray={st.dash} strokeLinecap={st.cap} />
    </svg>
  );
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

  const legend: (LayerStyle | "x" | "start")[] = ["x", ...(spot.map.start ? (["start"] as const) : []), ...drawMap(spot.map).legend];
  const legendLabel = (s: LayerStyle | "x" | "start") => (s === "x" ? "the spot" : s === "start" ? "START (begin here)" : LEGEND_LABEL[s]);

  const keys = legend.map((s) => (
    <span key={s} className="gp-spot-key">
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
          <p className="gp-small gp-spot-legend" data-print-drop="3">
            {keys}
          </p>
        </div>
        <figure className="gp-spot-figure">
          <div className="gp-spot-frame">
            <SpotMapSvg map={spot.map} title={mapDescription(parkName, spot)} />
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
      <p className="text-base">{spot.map.start ? "Start at START and follow the map to the X." : "Follow the map to the X."}</p>
      <figure className="flex max-w-xl flex-col gap-1">
        <div className="gp-spot-screen overflow-hidden rounded-control border-2 border-line bg-white">
          <SpotMapSvg map={spot.map} title={mapDescription(parkName, spot)} />
        </div>
        <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {keys}
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
