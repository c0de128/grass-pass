/**
 * The footer's hand-drawn ridge (Kevin, 2026-10-07, after his landscape reference): rolling hill bands that fade from
 * the page colour (far, pale sage) to the footer's forest green, a few pines, a big oak, a low sun (a pale moon and a
 * few stars in dark mode) and a family of four on the ridge, one kid holding up a sunflower-yellow pass.
 *
 * Plain inline SVG drawn for this site (no stock art, no raster, no AI image), purely decorative (aria-hidden).
 * Colours come from tokens (--gp-hill-1..4, --gp-footer, --gp-footer-sun, --gp-stars), so it follows light and dark.
 * `xMaxYMax slice`: phones keep the right side (the family and the oak) and crop the left pines.
 * Static on purpose: no motion (a scroll-linked parallax was tried; it never "finishes", which stalls the home page's
 * axe-at-every-scroll-position e2e check, so it was left out).
 * Server component, no client JavaScript.
 */

type Pt = readonly [number, number];
const seg = (a: Pt, b: Pt) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;

type Person = {
  /** Centre line x and ground y (the feet sink a little into the ridge). */
  x: number;
  ground: number;
  /** Size: ~1.45 a grown-up, ~0.95 a kid. */
  s: number;
  left: Pt;
  right: Pt;
  bun?: boolean;
};

/** A silhouette from round-capped strokes (torso, legs, arms) and a round head. */
function Figure({ p }: { p: Person }) {
  const { x, ground: g, s } = p;
  const y = (v: number) => g - v * s;
  const legs = seg([x - 3 * s, y(22)], [x - 3.8 * s, g]) + seg([x + 3 * s, y(22)], [x + 3.8 * s, g]);
  const arms = seg([x - 4.5 * s, y(37)], p.left) + seg([x + 4.5 * s, y(37)], p.right);
  return (
    <g>
      <path d={seg([x, y(38)], [x, y(23)])} strokeWidth={12.5 * s} />
      <path d={legs} strokeWidth={5.6 * s} />
      <path d={arms} strokeWidth={4.4 * s} />
      <circle cx={x} cy={y(50)} r={6.4 * s} />
      {p.bun ? <circle cx={x + 4.8 * s} cy={y(54)} r={3.3 * s} /> : null}
    </g>
  );
}

/** On the front ridge's crest (ground y ~165 at x 1160 down to ~155 at x 1268). */
const FAMILY: readonly Person[] = [
  // A grown-up, holding the first kid's hand.
  { x: 1160, ground: 166, s: 1.5, left: [1149, 140], right: [1181, 138] },
  // A kid between them.
  { x: 1197, ground: 161, s: 0.92, left: [1182, 139], right: [1211, 141] },
  // The kid with the pass, held up high.
  { x: 1228, ground: 158, s: 1, left: [1212, 141], right: [1247, 96] },
  // A grown-up, a hand reaching for that kid.
  { x: 1270, ground: 156.5, s: 1.42, left: [1246, 128], right: [1281, 133], bun: true },
];

/** One pine: three tiers and a short trunk, base at (0, 0), 60 tall. */
const PINE = "M0-60L9-45H5L14-31H8L18-15H10L20 0H2.5V6H-2.5V0H-20L-10-15H-18L-8-31H-14L-5-45H-9Z";

const PINES_MID: ReadonlyArray<readonly [number, number, number]> = [
  [92, 181, 0.8],
  [126, 177, 1.1],
  [160, 175, 0.72],
  [300, 167, 1.3],
  [336, 167, 0.9],
  [476, 169, 0.8],
  [846, 192, 1],
  [878, 193, 0.7],
  [924, 191, 1.2],
];
const PINES_FRONT: ReadonlyArray<readonly [number, number, number]> = [
  [36, 244, 1.5],
  [76, 241, 1],
  [612, 238, 1.1],
  [654, 237, 1.65],
  [696, 236, 0.9],
  [1032, 206, 1.3],
  [1070, 194, 0.85],
];

/** The oak: a wide, lumpy crown (overlapping circles) over a trunk that forks into two branches. */
const OAK_CROWN: ReadonlyArray<readonly [number, number, number]> = [
  [1462, 70, 42],
  [1417, 84, 34],
  [1507, 82, 36],
  [1382, 106, 25],
  [1542, 106, 27],
  [1440, 50, 29],
  [1490, 48, 28],
  [1462, 104, 28],
  [1418, 114, 20],
  [1508, 114, 22],
];
const OAK_TRUNK = "M1452 190L1455 142L1430 120L1434 116L1457 132L1458 106H1466L1467 130L1492 112L1495 116L1469 142L1472 190Z";

/** A few stars, shown only at night (--gp-stars is 0 in light mode). */
const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [60, 40, 1.4],
  [210, 22, 1.1],
  [380, 54, 1.6],
  [540, 28, 1.2],
  [690, 62, 1.3],
  [820, 30, 1.7],
  [930, 58, 1.1],
  [1110, 26, 1.5],
  [1210, 58, 1.1],
  [1330, 24, 1.3],
  [1580, 40, 1.4],
  [1560, 18, 1.1],
  [880, 12, 1],
  [1290, 70, 1],
];

export function FooterLandscape() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid="footer-landscape"
      viewBox="0 0 1600 260"
      preserveAspectRatio="xMaxYMax slice"
      className="absolute inset-0 block h-full w-full"
    >
      <defs>
        <path id="gp-pine" d={PINE} />
        <radialGradient id="gp-sun-glow">
          <stop offset="0.45" className="[stop-color:var(--gp-footer-sun)] [stop-opacity:0.45]" />
          <stop offset="1" className="[stop-color:var(--gp-footer-sun)] [stop-opacity:0]" />
        </radialGradient>
      </defs>
      <g className="fill-footer-foreground opacity-(--gp-stars)">
        {STARS.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
      <g className="fill-(--gp-footer-sun)">
        <circle cx="1128" cy="112" r="120" fill="url(#gp-sun-glow)" />
        <circle cx="1128" cy="112" r="48" />
      </g>
      <g>
        <path className="fill-(--gp-hill-1)" d="M0 128C150 92 300 80 470 104S760 116 900 100S1060 118 1180 116S1440 76 1600 84V260H0Z" />
      </g>
      <g>
        <path className="fill-(--gp-hill-2)" d="M0 160C140 128 300 118 460 140S760 160 940 132S1260 112 1600 138V260H0Z" />
      </g>
      <g>
        <path className="fill-(--gp-hill-3)" d="M0 186C190 160 400 156 620 178S960 196 1120 176S1440 162 1600 176V260H0Z" />
        <g className="fill-(--gp-hill-4)">
          {PINES_MID.map(([x, y, s]) => (
            <use key={x} href="#gp-pine" transform={`translate(${x} ${y}) scale(${s})`} />
          ))}
        </g>
        <path className="fill-(--gp-hill-4)" d="M0 214C180 198 360 202 520 212S820 210 960 202S1080 192 1180 198S1440 212 1600 210V260H0Z" />
      </g>
      <g className="fill-footer">
        <path d="M0 240C240 228 520 236 760 232C900 229 1010 200 1100 176Q1215 144 1330 156C1420 166 1510 188 1600 196V260H0Z" />
        {PINES_FRONT.map(([x, y, s]) => (
          <use key={x} href="#gp-pine" transform={`translate(${x} ${y}) scale(${s})`} />
        ))}
        <path d={OAK_TRUNK} />
        {OAK_CROWN.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
        <g className="stroke-footer" strokeLinecap="round">
          {FAMILY.map((p) => (
            <Figure key={p.x} p={p} />
          ))}
        </g>
      </g>
      {/* The pass the kid holds up: a small sunflower admission ticket (notched sides, dashed tear line). */}
      <g transform="translate(1251 86) rotate(-14)">
        <path className="fill-sun" d="M-14-9H14V-3A3 3 0 0 0 14 3V9H-14V3A3 3 0 0 0-14-3Z" />
        <path d="M6-7V7" className="stroke-sun-foreground" strokeWidth="1.1" strokeDasharray="2 1.6" />
      </g>
    </svg>
  );
}
