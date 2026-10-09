import { useId } from "react";
import { MapXIcon } from "@/components/art/icons";
import { Chip } from "@/components/ui/Chip";
import { formatTime } from "@/lib/pass/format";
import { drawMap, ICON_R, legendLabel, LAYER_STYLE, SMALL_FONT, type LayerStyle, type LegendKey, type MapDrawing, type MapLabel } from "@/lib/spot/render-map";
import { SPOT_COPY, type LandmarkKind, type Spot, type SpotOk } from "@/lib/spot/types";

/**
 * map-v2 palettes. The map itself is always a light "paper" map (also in dark mode, like a printed trail map on a
 * card). Screen: brand colours (soft green park, blue water, a warm orange route). Print: clean greys that photocopy
 * well; every area also has a dark edge, so nothing depends on a light grey surviving a cheap printer (ADR 0004).
 */
export const MAP_PALETTE = {
  color: {
    land: "#edf4e2",
    frame: "#78867c",
    waterFill: "#a9d4f0",
    waterEdge: "#4a93cb",
    creek: "#4a93cb",
    pitchFill: "#cde6b0",
    pitchEdge: "#8fbf72",
    parkingFill: "#e4e2d9",
    parkingEdge: "#b9b4a6",
    outline: "#6f9e5b",
    roadCasing: "#a39c8b",
    roadCore: "#ffffff",
    path: "#93602f",
    pathCasing: "#ffffff",
    route: "#d9480f",
    routeUnder: "#ffffff",
    ink: "#10291a",
    start: "#137838",
    icon: "#1d3a25",
    parkingIcon: "#1f5fa8",
    glyph: "#ffffff",
    waterText: "#174f7a",
    trailText: "#5c3a1a",
  },
  gray: {
    land: "#ffffff",
    frame: "#000000",
    waterFill: "#cfcfcf",
    waterEdge: "#5c5c5c",
    creek: "#5c5c5c",
    pitchFill: "#efefef",
    pitchEdge: "#8a8a8a",
    parkingFill: "#e3e3e3",
    parkingEdge: "#8a8a8a",
    outline: "#7a7a7a",
    roadCasing: "#333333",
    roadCore: "#ffffff",
    path: "#1a1a1a",
    pathCasing: "#ffffff",
    route: "#000000",
    routeUnder: "#ffffff",
    ink: "#000000",
    start: "#000000",
    icon: "#000000",
    parkingIcon: "#000000",
    glyph: "#ffffff",
    waterText: "#000000",
    trailText: "#000000",
  },
} as const;
export type MapTone = keyof typeof MAP_PALETTE;

/** One sentence for screen readers: what the map shows, without giving the answer away. */
export function mapDescription(parkName: string, spot: SpotOk, d?: MapDrawing): string {
  const lead = `Map of ${parkName} drawn from OpenStreetMap, north is up.`;
  const how = d?.route ? (d.route.mode === "paths" ? ", and a dotted route follows the paths" : ", shown by a dotted straight line") : "";
  const walk =
    spot.start && spot.walk
      ? ` START is at a ${spot.start.label.replace(/ \(.*\)$/, "")}; the X is about ${spot.walk.meters} m ${spot.walk.direction} of it${how}.`
      : " The X marks the spot.";
  const names = d ? [...new Set(d.landmarks.map((l) => l.label.text))] : [];
  const marks = names.length > 0 ? ` Landmarks on the map: ${names.join(", ")}.` : "";
  return `${lead}${walk}${marks}`;
}

/** A label in a white box with a thin border (reads over any line, in colour and in black and white). */
function BoxLabel({ label, marker, ink }: { label: MapLabel; marker: string; ink: string }) {
  const b = label.box;
  return (
    <g data-label={marker}>
      <rect x={b.x0} y={b.y0} width={Math.round((b.x1 - b.x0) * 10) / 10} height={Math.round((b.y1 - b.y0) * 10) / 10} rx="5" fill="#fff" stroke={ink} strokeWidth="1.6" />
      <text className="gp-map-label" x={label.x} y={label.y} textAnchor="middle" fontSize={label.size} fontWeight="800" fill={ink} textLength={label.textLength} lengthAdjust="spacingAndGlyphs">
        {label.text}
      </text>
    </g>
  );
}

/** The white pictogram inside a landmark's badge (drawn about 0,0 inside radius ICON_R). Plain shapes, no text. */
export function landmarkGlyph(kind: LandmarkKind): { stroke?: string; fill?: string } {
  switch (kind) {
    case "playground": // a slide: the ladder on the left, the slide curving down to the right
      return { stroke: "M-5 6V-5H-1.5Q3.5 -5 5.5 6M-5 -1H-2" };
    case "toilets": // a person
      return { fill: "M0 -7.2a2.3 2.3 0 1 1 0 4.6a2.3 2.3 0 1 1 0-4.6ZM-3.6 -1.6H3.6L2.6 3H1.2V7H-1.2V3H-2.6Z" };
    case "shelter": // a roof on two posts
      return { fill: "M-7.5 -0.5L0 -6.5L7.5 -0.5Z", stroke: "M-4.8 -0.5V6.2M4.8 -0.5V6.2" };
    case "bridge": // a deck over an arch
      return { stroke: "M-7.5 -1.5H7.5M-6.5 5Q0 -3 6.5 5M-3.5 -1.5V1.4M3.5 -1.5V1.4" };
    case "parking": // the letter P, drawn as a shape
      return { stroke: "M-2.6 6.5V-6H1.4A3.4 3.4 0 0 1 1.4 0.8H-2.6" };
    case "pitch": // a field with its centre line and circle
      return { stroke: "M-7 -5H7V5H-7ZM0 -5V5", fill: "M0 -2.4a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 1 1 0-4.8Z" };
    case "dog_park": // a paw
      return {
        fill: "M0 0.6c2.6 0 4.2 2.4 4.2 4c0 1.4-1.4 1.9-4.2 1.9s-4.2-0.5-4.2-1.9c0-1.6 1.6-4 4.2-4ZM-5 -3.9a1.7 1.9 0 1 1 0 3.8a1.7 1.9 0 1 1 0-3.8ZM5 -3.9a1.7 1.9 0 1 1 0 3.8a1.7 1.9 0 1 1 0-3.8ZM-1.9 -7.1a1.7 1.9 0 1 1 0 3.8a1.7 1.9 0 1 1 0-3.8ZM1.9 -7.1a1.7 1.9 0 1 1 0 3.8a1.7 1.9 0 1 1 0-3.8Z",
      };
    case "splash_pad":
    case "fountain": // a drop of water
      return { fill: "M0 -7C3.6 -2.4 5 0.2 5 2.4A5 5 0 0 1 -5 2.4C-5 0.2 -3.6 -2.4 0 -7Z" };
    case "viewpoint": // binoculars
      return { fill: "M-3.2 -2.5a2.9 2.9 0 1 1 0 5.8a2.9 2.9 0 1 1 0-5.8ZM3.2 -2.5a2.9 2.9 0 1 1 0 5.8a2.9 2.9 0 1 1 0-5.8ZM-1.2 -1.4H1.2V1.2H-1.2Z" };
    case "tower":
      return { fill: "M-3.6 7L-1.6 -6H1.6L3.6 7Z" };
    default:
      return { fill: "M0 -3a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z" };
  }
}

/**
 * The Find This Spot map as SVG (SPEC F9, §8.4; ADR 0004), framed on START and the X (render-map.ts): soft areas, a
 * faint park edge, thin creeks, roads with a casing, paths, the dotted route, landmark badges with short labels,
 * START, the X, a small north arrow and a round-number scale bar. Every shape is a real OpenStreetMap object.
 * `tone`: "color" on screen, "gray" on the printed pass.
 */
export function SpotMapSvg({ drawing: d, title, tone = "gray" }: { drawing: MapDrawing; title: string; tone?: MapTone }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clip = `spot-clip-${uid}`;
  const titleId = `spot-title-${uid}`;
  const c = MAP_PALETTE[tone];
  const halo = { stroke: "#fff", strokeWidth: 4, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
  const areaOf: Partial<Record<LayerStyle, [string, string]>> = {
    water: [c.waterFill, c.waterEdge],
    pitch: [c.pitchFill, c.pitchEdge],
    parking: [c.parkingFill, c.parkingEdge],
  };
  const lineOf: Partial<Record<LayerStyle, string>> = { outline: c.outline, waterway: c.creek };

  return (
    <svg className="gp-spot-svg" viewBox={d.viewBox} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet" data-testid="spot-map" data-tone={tone}>
      <title id={titleId}>{title}</title>
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="0" width={d.w} height={d.h} />
        </clipPath>
      </defs>
      <rect x="0" y="0" width={d.w} height={d.h} fill={c.land} />
      <g clipPath={`url(#${clip})`} fill="none" strokeLinejoin="round">
        {d.layers.map((l) => {
          const st = LAYER_STYLE[l.style];
          const area = areaOf[l.style];
          if (area) return <path key={l.style} data-layer={l.style} d={l.d} fill={area[0]} stroke={area[1]} strokeWidth={st.width} />;
          if (l.style === "road")
            // A road: a grey casing, then a white core (all casings first, so crossings merge cleanly).
            return (
              <g key={l.style} data-layer={l.style} strokeLinecap="round">
                <path d={l.d} stroke={c.roadCasing} strokeWidth={st.casing} />
                <path d={l.d} stroke={c.roadCore} strokeWidth={st.width} />
              </g>
            );
          if (l.style === "path")
            // A path: one confident solid line on a light halo (crisp over fills and other lines).
            return (
              <g key={l.style} data-layer={l.style} strokeLinecap="round">
                <path d={l.d} stroke={c.pathCasing} strokeWidth={st.casing} />
                <path d={l.d} stroke={c.path} strokeWidth={st.width} />
              </g>
            );
          return <path key={l.style} data-layer={l.style} d={l.d} stroke={lineOf[l.style]} strokeWidth={st.width} strokeDasharray={st.dash} strokeLinecap={st.cap} />;
        })}
      </g>

      {/* The route from START to the X: bold dots on a white band, along the paths (or a straight line). */}
      {d.route ? (
        <g data-marker="route" data-mode={d.route.mode} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={d.route.d} stroke={c.routeUnder} strokeWidth="11" />
          <path d={d.route.d} stroke={c.route} strokeWidth="7.5" strokeDasharray="0.1 11.5" />
        </g>
      ) : null}

      {/* Landmarks: a badge with a pictogram and a short label on a white halo. Water and trail names stand alone. */}
      {d.landmarks.map((lm) => {
        const gl = landmarkGlyph(lm.kind);
        const textFill = lm.kind === "water" ? c.waterText : lm.kind === "trail" ? c.trailText : c.ink;
        return (
          <g key={`${lm.kind}-${lm.label.text}`} data-marker="landmark" data-kind={lm.kind}>
            {lm.icon ? (
              <g transform={`translate(${lm.icon[0]} ${lm.icon[1]})`}>
                {lm.kind === "parking" ? (
                  <rect x={-ICON_R} y={-ICON_R} width={ICON_R * 2} height={ICON_R * 2} rx="4" fill={c.parkingIcon} stroke="#fff" strokeWidth="2" />
                ) : (
                  <circle r={ICON_R} fill={c.icon} stroke="#fff" strokeWidth="2" />
                )}
                {gl.fill ? <path d={gl.fill} fill={c.glyph} /> : null}
                {gl.stroke ? <path d={gl.stroke} fill="none" stroke={c.glyph} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /> : null}
              </g>
            ) : null}
            <text
              className="gp-map-label-sm"
              x={lm.label.x}
              y={lm.label.y}
              textAnchor="middle"
              fontSize={lm.label.size}
              fontWeight="700"
              fontStyle={lm.icon ? undefined : "italic"}
              fill={textFill}
              textLength={lm.label.textLength}
              lengthAdjust="spacingAndGlyphs"
              {...halo}
            >
              {lm.label.text}
            </text>
          </g>
        );
      })}

      {/* START: a triangle with a white halo. */}
      {d.start ? (
        <g data-marker="start">
          <path d={d.start.d} fill={c.start} stroke="#fff" strokeWidth="3.5" paintOrder="stroke" strokeLinejoin="round" />
        </g>
      ) : null}

      {/* The X: a thick cross with a white halo so it reads over any line. */}
      <g data-marker="x" strokeLinecap="round">
        <path d={d.x.d} stroke="#fff" strokeWidth="12.5" fill="none" />
        <path d={d.x.d} stroke={c.ink} strokeWidth="7" fill="none" />
      </g>

      {d.start ? <BoxLabel label={d.start.label} marker="start" ink={c.ink} /> : null}

      {/* North arrow: small, top right. */}
      <g data-marker="north">
        <rect x={d.north.box.x0} y={d.north.box.y0} width={d.north.box.x1 - d.north.box.x0} height={d.north.box.y1 - d.north.box.y0} rx="5" fill="#fff" />
        <path d={d.north.arrow} fill={c.ink} />
        <text className="gp-map-label-sm" x={d.north.x} y={d.north.y} textAnchor="middle" fontSize={SMALL_FONT} fontWeight="800" fill={c.ink}>
          N
        </text>
      </g>

      {/* Scale bar: bottom left, a round number. */}
      <g data-marker="scale">
        <rect x={d.scale.box.x0} y={d.scale.box.y0} width={Math.round((d.scale.box.x1 - d.scale.box.x0) * 10) / 10} height={Math.round((d.scale.box.y1 - d.scale.box.y0) * 10) / 10} rx="5" fill="#fff" />
        <path d={d.scale.d} fill="none" stroke={c.ink} strokeWidth="2.4" strokeLinecap="square" />
        <text className="gp-map-label-sm" x={d.scale.x} y={d.scale.y - 10} fontSize={SMALL_FONT} fontWeight="700" fill={c.ink}>
          {d.scale.label}
        </text>
      </g>
      <rect x="1" y="1" width={d.w - 2} height={d.h - 2} fill="none" stroke={c.frame} strokeWidth="2" />
    </svg>
  );
}

/**
 * A small key sample (aria-hidden; the words next to it are the text). Colours come from --gp-map-* (tokens.css: light
 * and dark values; print.css: black and greys on the printed pass).
 */
function LegendGlyph({ k }: { k: LegendKey }) {
  const common = { width: 22, height: 10, viewBox: "0 0 22 10", "aria-hidden": true, focusable: false, className: "gp-spot-glyph shrink-0" } as const;
  switch (k) {
    case "x":
      return (
        <svg {...common}>
          <path d="M7 1l8 8M15 1l-8 8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      );
    case "start":
      return (
        <svg {...common}>
          <path d="M11 1l5 8H6z" fill="var(--gp-map-start, currentColor)" />
        </svg>
      );
    case "route":
    case "straight":
      return (
        <svg {...common}>
          <path d="M2.5 5H20" stroke="var(--gp-map-route, currentColor)" strokeWidth="3.6" strokeDasharray="0.1 5.6" strokeLinecap="round" />
        </svg>
      );
    case "path":
      return (
        <svg {...common}>
          <path d="M1 6.5C6 2 15 8.5 21 3.5" fill="none" stroke="var(--gp-map-path, currentColor)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "road":
      return (
        <svg {...common}>
          <path d="M1 5H21" stroke="var(--gp-map-road, currentColor)" strokeWidth="6" />
          <path d="M1 5H21" stroke="var(--gp-map-road-core, #fff)" strokeWidth="2.6" />
        </svg>
      );
    case "waterway":
      return (
        <svg {...common}>
          <path d="M1 6C5 3 9 8 13 5s6-2 8-1" fill="none" stroke="var(--gp-map-water-edge, currentColor)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    default: {
      // water, pitch: a soft swatch with its edge
      const v = k === "water" ? "water" : "pitch";
      return (
        <svg {...common}>
          <rect x="2" y="1" width="18" height="8" rx="2" fill={`var(--gp-map-${v}, none)`} stroke={`var(--gp-map-${v}-edge, currentColor)`} strokeWidth="1.3" />
        </svg>
      );
    }
  }
}

/** The key for a drawing (at most MAX_KEYS: the X, START, the route, then what helps most). */
export function legendKeys(d: MapDrawing): LegendKey[] {
  return d.legend;
}

/**
 * Key columns for the keys BEFORE the route (the route's key has a full row of its own, last: it carries the walk).
 * At most 4 keys share a row, so the key is 2 rows on paper (MAX_KEYS = 5), as short as before map-v2.
 */
export function legendColumns(n: number): number {
  return Math.max(1, Math.min(4, n));
}

const isRouteKey = (k: LegendKey) => k === "route" || k === "straight";

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
  const cols = legendColumns(legend.filter((k) => !isRouteKey(k)).length);
  const keys = legend.map((s) => (
    <span key={s} className={`gp-spot-key inline-flex min-w-0 items-center gap-1.5 sm:whitespace-nowrap${isRouteKey(s) ? " gp-spot-key-route" : ""}`} data-key={s}>
      <LegendGlyph k={s} /> {legendLabel(s, spot.walk)}
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
            <SpotMapSvg drawing={drawing} title={mapDescription(parkName, spot, drawing)} tone="gray" />
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
        <div className="gp-spot-screen overflow-hidden rounded-control border-2 border-line bg-white shadow-sm">
          <SpotMapSvg drawing={drawing} title={mapDescription(parkName, spot, drawing)} tone="color" />
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
