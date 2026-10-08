import type { WeatherLook } from "@/lib/weather/view";

/**
 * The weather card's picture: flat shapes in the site's illustration style (the footer landscape: flat fills, no
 * outlines). Decorative only (aria-hidden): the card says everything in words. Colours come from the card's CSS
 * variables (globals.css, `.gp-wx`), so they follow light and dark mode. Rays turn, clouds drift and drops fall only
 * when the visitor allows motion (prefers-reduced-motion: no-preference); nothing flashes.
 */

function Sun({ cx = 60, cy = 52, r = 22, hot = false }: { cx?: number; cy?: number; r?: number; hot?: boolean }) {
  const rays = Array.from({ length: 12 }, (_, i) => (i * 360) / 12);
  const fill = hot ? "fill-(--wx-hot)" : "fill-(--wx-sun)";
  return (
    <g>
      <g className="gp-wx-rays">
        {rays.map((a) => (
          <rect
            key={a}
            x={cx - 3}
            y={cy - r - (i(a) ? 17 : 13)}
            width={6}
            height={i(a) ? 11 : 7}
            rx={3}
            transform={`rotate(${a} ${cx} ${cy})`}
            className={fill}
          />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={r} className={fill} />
      <circle cx={cx} cy={cy} r={r - 5} className={hot ? "fill-(--wx-hot-core)" : "fill-(--wx-sun-core)"} />
      <path d={`M${cx - r * 0.55} ${cy - r * 0.15}a${r * 0.6} ${r * 0.6} 0 0 1 ${r * 0.45} -${r * 0.42}`} className="fill-none stroke-white opacity-60" strokeWidth={4} strokeLinecap="round" />
    </g>
  );
}
/** Long and short rays, alternating. */
const i = (deg: number) => (deg / 30) % 2 === 0;

function Cloud({ x = 0, y = 0, scale = 1, dark = false, drift = true }: { x?: number; y?: number; scale?: number; dark?: boolean; drift?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className={drift ? "gp-wx-cloud" : undefined}>
        <path
          d="M22 70c-9 0-15-6-15-14s6-14 15-14c1-11 10-19 21-19 9 0 17 5 20 13 2-1 4-1 6-1 10 0 17 7 17 16 0 1 0 2-.2 3C91 55 96 61 96 67c0 2-1 3-3 3z"
          className={dark ? "fill-(--wx-cloud-dark)" : "fill-(--wx-cloud)"}
        />
        <path d="M14 68h77" className="stroke-(--wx-cloud-shade)" strokeWidth={4} strokeLinecap="round" />
      </g>
    </g>
  );
}

function Drops({ y = 86, color = "fill-(--wx-rain)", xs = [34, 52, 70, 88] }: { y?: number; color?: string; xs?: number[] }) {
  return (
    <g>
      {xs.map((x, k) => (
        <path
          key={x}
          d={`M${x} ${y + (k % 2) * 8}c0 0-6 8-6 12a6 6 0 0 0 12 0c0-4-6-12-6-12z`}
          className={`gp-wx-drop ${color}`}
          style={{ animationDelay: `${k * 0.35}s` }}
        />
      ))}
    </g>
  );
}

function Flakes({ y = 88 }: { y?: number }) {
  const xs = [36, 56, 76, 92];
  return (
    <g className="stroke-(--wx-snow)" strokeWidth={3} strokeLinecap="round">
      {xs.map((x, k) => {
        const cy = y + (k % 2) * 10;
        return (
          <g key={x} className="gp-wx-flake" style={{ animationDelay: `${k * 0.5}s` }}>
            <path d={`M${x - 6} ${cy}h12M${x} ${cy - 6}v12M${x - 4} ${cy - 4}l8 8M${x + 4} ${cy - 4}l-8 8`} />
          </g>
        );
      })}
    </g>
  );
}

/** Soft lawn-grass tuft (at most 3 curved blades from one root, BRAND.md). */
function Tuft({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const c = (dx1: number, dy1: number, dx2: number, dy2: number, dx: number, dy: number) =>
    `M${x} ${y}c${dx1 * s} ${dy1 * s} ${dx2 * s} ${dy2 * s} ${dx * s} ${dy * s}`;
  return <path d={`${c(-1, -6, -5, -12, -11, -15)}${c(0, -9, 1, -16, 4, -22)}${c(2, -5, 6, -9, 12, -11)}`} />;
}

/**
 * Rolling hills and a few grass tufts along the card's bottom edge, in the footer landscape's hill colours. Decorative.
 * `slice` keeps the shapes undistorted at every width (a phone shows the middle of the scene).
 */
export function WeatherHills({ className = "" }: { className?: string }) {
  const tufts: [number, number, number][] = [
    [170, 47, 1],
    [196, 49, 0.8],
    [430, 52, 1.1],
    [520, 49, 0.9],
    [640, 50, 1],
    [668, 52, 0.8],
    [820, 47, 1.1],
    [985, 50, 0.9],
    [1010, 52, 1],
  ];
  return (
    <svg viewBox="0 0 1200 60" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false" className={className}>
      <path d="M0 40C140 18 260 16 400 30S700 52 860 34 1080 14 1200 26V60H0z" className="fill-(--wx-hill-back)" />
      <path d="M0 52C160 38 300 40 460 50S760 58 920 48 1100 40 1200 46V60H0z" className="fill-(--wx-hill-front)" />
      <g className="fill-none stroke-(--wx-grass)" strokeWidth={3} strokeLinecap="round">
        {tufts.map(([x, y, s]) => (
          <Tuft key={x} x={x} y={y} s={s} />
        ))}
      </g>
    </svg>
  );
}

export function WeatherArt({ look, className = "" }: { look: WeatherLook | "none"; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" className={`gp-wx-art ${className}`}>
      {look === "sunny" ? <Sun cx={60} cy={58} r={26} /> : null}
      {look === "hot" ? (
        <>
          <Sun cx={60} cy={52} r={26} hot />
          <g className="fill-none stroke-(--wx-hot)" strokeWidth={4} strokeLinecap="round">
            <path d="M30 104c6-5 12 5 18 0s12 5 18 0 12 5 18 0" className="gp-wx-wave" />
          </g>
        </>
      ) : null}
      {look === "partly" ? (
        <>
          <Sun cx={72} cy={42} r={20} />
          <Cloud x={-2} y={24} scale={0.95} />
        </>
      ) : null}
      {look === "cloudy" ? (
        <>
          <Cloud x={26} y={4} scale={0.7} dark />
          <Cloud x={4} y={26} scale={1} />
        </>
      ) : null}
      {look === "fog" ? (
        <>
          <Cloud x={8} y={6} scale={0.95} />
          <g className="stroke-(--wx-cloud-dark)" strokeWidth={5} strokeLinecap="round">
            <path d="M18 88h70M30 100h74M14 112h56" className="gp-wx-cloud" />
          </g>
        </>
      ) : null}
      {look === "rain" ? (
        <>
          <Cloud x={4} y={4} scale={1} dark />
          <Drops y={82} />
        </>
      ) : null}
      {look === "snow" || look === "cold" ? (
        <>
          <Cloud x={4} y={4} scale={1} />
          <Flakes y={86} />
        </>
      ) : null}
      {look === "storm" ? (
        <>
          <Drops y={80} xs={[26, 96]} />
          <Cloud x={4} y={2} scale={1} dark />
          <path d="M66 58 44 92h17l-9 26 30-40H64l12-20z" strokeLinejoin="round" strokeWidth={3} className="fill-(--wx-sun) stroke-(--wx-sun)" />
        </>
      ) : null}
      {look === "alert" ? (
        <>
          <Cloud x={-4} y={-6} scale={0.9} dark />
          <path d="M60 50 94 108H26z" strokeLinejoin="round" strokeWidth={8} className="fill-(--wx-alert) stroke-(--wx-alert)" />
          <path d="M60 66v22" strokeWidth={7} strokeLinecap="round" className="stroke-(--wx-alert-fg)" />
          <circle cx={60} cy={99} r={4} className="fill-(--wx-alert-fg)" />
        </>
      ) : null}
      {look === "none" ? (
        <>
          <Cloud x={4} y={14} scale={1} drift={false} />
          <text x={55} y={74} textAnchor="middle" className="fill-(--wx-muted) font-heading" fontSize={30} fontWeight={800}>
            ?
          </text>
        </>
      ) : null}
    </svg>
  );
}
