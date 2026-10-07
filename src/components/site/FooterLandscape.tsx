/**
 * The footer's hand-drawn ridge (Kevin, 2026-10-07, after his landscape reference): rolling hill bands that fade from
 * the page colour (far, pale sage) to the footer's forest green, a few pines, a big oak, a low sun (a pale moon and a
 * few stars in dark mode) and a family of four on the ridge, holding hands (Kevin, 2026-10-07: natural silhouettes,
 * no pass in hand).
 *
 * Plain inline SVG drawn for this site (no stock art, no raster, no AI image), purely decorative (aria-hidden).
 * Colours come from tokens (--gp-hill-1..4, --gp-footer, --gp-footer-sun, --gp-stars), so it follows light and dark.
 * `xMaxYMax slice`: phones keep the right side (the family and the oak) and crop the left pines.
 * Static on purpose: no motion (a scroll-linked parallax was tried; it never "finishes", which stalls the home page's
 * axe-at-every-scroll-position e2e check, so it was left out).
 * Server component, no client JavaScript.
 */

type Pt = readonly [number, number];
const r1 = (n: number) => Math.round(n * 10) / 10;
const pt = (p: Pt) => `${r1(p[0])} ${r1(p[1])}`;

const dot = (c: Pt, r: number) => `M${r1(c[0] - r)} ${r1(c[1])}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0Z`;

/**
 * A tapered limb (arm, leg or neck) from `a` (width w1) to `b` (width w2): a four-sided shape plus a round joint at each
 * end, returned as separate shapes (one path each, so opposite windings never cut a hole).
 */
function limb(a: Pt, b: Pt, w1: number, w2: number): string[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const side = (c: Pt, w: number, k: number): Pt => [c[0] + (k * nx * w) / 2, c[1] + (k * ny * w) / 2];
  return [`M${pt(side(a, w1, 1))}L${pt(side(b, w2, 1))}L${pt(side(b, w2, -1))}L${pt(side(a, w1, -1))}Z`, dot(a, w1 / 2), dot(b, w2 / 2)];
}

type Person = {
  /** Centre line x, ground y (the feet sink a little into the ridge) and full height in viewBox units. */
  x: number;
  ground: number;
  h: number;
  kind: "man" | "woman" | "boy" | "girl";
  /** Where each hand ends (holding a neighbour's hand, or hanging). */
  left: Pt;
  right: Pt;
};

/**
 * One natural silhouette, seen from behind: a head in proportion (about 1/7.5 of a grown-up's height, 1/5.5 of a
 * kid's), sloping shoulders, a jacket or a dress with a hem, tapered arms and legs, and hair. Separate shapes in one
 * flat colour (no strokes), so the overlaps never cut holes.
 */
function Figure({ p }: { p: Person }) {
  const { x, ground: g, h, kind } = p;
  const kid = kind === "boy" || kind === "girl";
  const dress = kind === "woman" || kind === "girl";
  const Y = (f: number) => g - f * h;
  const X = (f: number) => x + f * h;
  const headRy = h * (kid ? 0.092 : 0.066);
  const headRx = headRy * 0.84;
  const headCy = g - h + headRy;
  const neck = Y(kid ? 0.8 : 0.85);
  const shY = Y(kid ? 0.765 : 0.815);
  const shW = kid ? 0.112 : kind === "man" ? 0.125 : 0.11;
  const waistY = Y(kid ? 0.52 : 0.56);
  const waistW = kid ? 0.09 : kind === "man" ? 0.09 : 0.068;
  const hemY = Y(dress ? (kid ? 0.36 : 0.32) : kid ? 0.44 : 0.45);
  const hemW = dress ? (kid ? 0.15 : 0.13) : kid ? 0.1 : 0.1;
  const nW = kid ? 0.035 : 0.03;
  // Body: neck, shoulders (a soft slope), down the sides to the waist, out to the hem (a jacket or a flared dress).
  const body =
    `M${pt([X(-nW), neck])}Q${pt([X(-shW * 0.8), neck + h * 0.004])} ${pt([X(-shW), shY + h * 0.03])}` +
    `Q${pt([X(-shW - 0.004), shY + h * 0.07])} ${pt([X(-waistW - 0.012), Y(kid ? 0.64 : 0.68)])}` +
    `L${pt([X(-waistW), waistY])}Q${pt([X(-waistW - 0.01), hemY - h * 0.05])} ${pt([X(-hemW), hemY])}` +
    `Q${pt([x, hemY + h * (dress ? 0.025 : 0.012)])} ${pt([X(hemW), hemY])}` +
    `Q${pt([X(waistW + 0.01), hemY - h * 0.05])} ${pt([X(waistW), waistY])}` +
    `L${pt([X(waistW + 0.012), Y(kid ? 0.64 : 0.68)])}Q${pt([X(shW + 0.004), shY + h * 0.07])} ${pt([X(shW), shY + h * 0.03])}` +
    `Q${pt([X(shW * 0.8), neck + h * 0.004])} ${pt([X(nW), neck])}Z`;
  // Legs: from under the hem to the ankles, trousers for the boys and men, slimmer legs under a dress.
  const hipY = dress ? hemY - h * 0.02 : Y(kid ? 0.47 : 0.48);
  const legTop = (dress ? 0.05 : kid ? 0.064 : 0.074) * h;
  const legBot = (kid ? 0.04 : 0.036) * h;
  // The feet end just inside the ridge (seen from behind, shoes barely show).
  const legs = [-1, 1].flatMap((sd) => limb([X(sd * (dress ? 0.04 : 0.046)), hipY], [X(sd * 0.048), g + 1.5], legTop, legBot));
  // Arms: from just inside each shoulder to the hand, wider at the top; a round hand.
  const armTop = (kid ? 0.066 : 0.064) * h;
  const armMid = (kid ? 0.05 : 0.048) * h;
  const armBot = (kid ? 0.04 : 0.036) * h;
  const shoulderL: Pt = [X(-shW + 0.03), shY + h * 0.045];
  const shoulderR: Pt = [X(shW - 0.03), shY + h * 0.045];
  // A slight outward bend at the elbow, so the arms hang naturally rather than as straight rods.
  const elbow = (a: Pt, b: Pt, side: number): Pt => [a[0] + (b[0] - a[0]) * 0.5 + side * h * 0.018, a[1] + (b[1] - a[1]) * 0.5];
  const arms = [
    ...limb(shoulderL, elbow(shoulderL, p.left, -1), armTop, armMid),
    ...limb(elbow(shoulderL, p.left, -1), p.left, armMid, armBot),
    ...limb(shoulderR, elbow(shoulderR, p.right, 1), armTop, armMid),
    ...limb(elbow(shoulderR, p.right, 1), p.right, armMid, armBot),
  ];
  // Hair, seen from behind: his short (a cap of hair on the crown), hers to the shoulders, the girl's in a ponytail.
  const hair =
    kind === "woman"
      ? `M${pt([X(-0.056), headCy - headRy * 0.3])}Q${pt([X(-0.066), headCy + headRy * 1.2])} ${pt([X(-0.068), neck + h * 0.012])}` +
        `Q${pt([x, neck + h * 0.03])} ${pt([X(0.068), neck + h * 0.012])}Q${pt([X(0.066), headCy + headRy * 1.2])} ${pt([X(0.056), headCy - headRy * 0.3])}Z`
      : kind === "girl"
        ? `M${pt([X(0.03), headCy - headRy * 0.6])}Q${pt([X(0.16), headCy - headRy * 0.4])} ${pt([X(0.13), headCy + headRy * 1.5])}Q${pt([X(0.1), headCy + headRy * 0.5])} ${pt([X(0.04), headCy])}Z`
        : null;
  return (
    <g>
      <ellipse cx={r1(x)} cy={r1(headCy)} rx={r1(headRx)} ry={r1(headRy)} />
      {/* The neck, joining the head to the shoulders. */}
      {limb([x, headCy + headRy * 0.5], [x, neck + h * 0.01], h * (kid ? 0.07 : 0.055), h * (kid ? 0.075 : 0.065)).map((d, i) => (
        <path key={i} d={d} />
      ))}
      {hair ? <path d={hair} /> : null}
      <path d={body} />
      {legs.map((d, i) => (
        <path key={i} d={d} />
      ))}
      {arms.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
  );
}

/**
 * The family on the front ridge's crest (ground y ~165 at x 1157 down to ~153 at x 1272), seen from behind and holding
 * hands: a grown-up, a boy, a girl and a grown-up.
 */
const FAMILY: readonly Person[] = [
  { kind: "man", x: 1157, ground: 164.5, h: 88, left: [1146, 129], right: [1176, 131] },
  { kind: "boy", x: 1192, ground: 159.5, h: 50, left: [1176.5, 131.5], right: [1206.5, 134] },
  { kind: "girl", x: 1222, ground: 156.5, h: 56, left: [1207, 134], right: [1239.5, 124.5] },
  { kind: "woman", x: 1258, ground: 155, h: 81, left: [1240, 124], right: [1268, 125] },
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
        <ellipse cx="1150" cy="112" rx="170" ry="108" fill="url(#gp-sun-glow)" />
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
        {FAMILY.map((p) => (
          <Figure key={p.x} p={p} />
        ))}
      </g>
    </svg>
  );
}
